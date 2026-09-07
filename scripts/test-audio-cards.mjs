// Tests for services/audioCards.js — pure logic, no Qt.
// Run: node scripts/test-audio-cards.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

// audioCards.js is a QML `.pragma library`: valid JS once the pragma is stripped.
// Loading it this way keeps one source of truth for QML and for these tests.
function loadLibrary(relativePath) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
        .replace(/^\s*\.pragma\s+library\s*$/m, "")
    const sandbox = {}
    vm.createContext(sandbox)
    vm.runInContext(source, sandbox)
    return sandbox
}

const lib = loadLibrary("../services/audioCards.js")
const fixture = readFileSync(new URL("./fixtures/pactl-cards.json", import.meta.url), "utf8")

test("parseCards reads the real pactl payload", () => {
    const cards = lib.parseCards(fixture)
    assert.equal(cards.length, 1)
    assert.match(cards[0].name, /^alsa_card\./)
    assert.equal(cards[0].activeProfile, "HiFi (HDMI1, HDMI2, HDMI3, Headphones, Mic1, Mic2)")
    assert.equal(cards[0].profiles.length, 4)
})

test("parseCards survives garbage instead of throwing", () => {
    assert.equal(lib.parseCards("").length, 0)
    assert.equal(lib.parseCards("{not json").length, 0)
    assert.equal(lib.parseCards("null").length, 0)
    assert.equal(lib.parseCards(undefined).length, 0)
})

test("outputPortsOf returns only output ports, highest priority first", () => {
    const ports = lib.outputPortsOf(lib.parseCards(fixture))
    assert.equal(ports.length, 5)
    assert.ok(ports.every(p => p.portName.startsWith("[Out]")))
    for (let i = 1; i < ports.length; i++)
        assert.ok(ports[i - 1].priority >= ports[i].priority)
})

test("outputPortsOf marks Speaker as latent and Headphones as live", () => {
    const ports = lib.outputPortsOf(lib.parseCards(fixture))
    const speaker = ports.find(p => p.label === "Speaker")
    const headphones = ports.find(p => p.label === "Headphones")
    assert.equal(speaker.inActiveProfile, false)
    assert.equal(headphones.inActiveProfile, true)
})

test("outputPortsOf reports HDMI without a cable as unavailable", () => {
    const ports = lib.outputPortsOf(lib.parseCards(fixture))
    assert.equal(ports.find(p => p.portName === "[Out] HDMI1").available, false)
})

test("port keys are unique and stable", () => {
    const cards = lib.parseCards(fixture)
    const first = lib.outputPortsOf(cards).map(p => p.key)
    const second = lib.outputPortsOf(lib.parseCards(fixture)).map(p => p.key)
    assert.deepEqual(first, second)
    assert.equal(new Set(first).size, first.length)
})

test("pickProfileForPort chooses the profile that exposes Speaker", () => {
    const cards = lib.parseCards(fixture)
    const speaker = lib.outputPortsOf(cards).find(p => p.label === "Speaker")
    assert.equal(lib.pickProfileForPort(cards[0], speaker),
        "HiFi (HDMI1, HDMI2, HDMI3, Mic1, Mic2, Speaker)")
})

test("pickProfileForPort never returns off or pro-audio", () => {
    const cards = lib.parseCards(fixture)
    for (const port of lib.outputPortsOf(cards)) {
        const chosen = lib.pickProfileForPort(cards[0], port)
        assert.notEqual(chosen, "off")
        assert.notEqual(chosen, "pro-audio")
    }
})

test("pickProfileForPort returns null when the port is already reachable", () => {
    const cards = lib.parseCards(fixture)
    const headphones = lib.outputPortsOf(cards).find(p => p.label === "Headphones")
    assert.equal(lib.pickProfileForPort(cards[0], headphones), null)
})

// buildOutputTargets joins card ports with live PipeWire nodes. Nodes are passed
// in as plain objects: the function must not touch anything Qt-specific.
const nodeStub = (name, description) => ({
    id: 1, name, description,
    properties: { "node.name": name, "api.alsa.path": "" },
})

test("buildOutputTargets attaches a node to the port it belongs to", () => {
    const cards = lib.parseCards(fixture)
    const nodes = [nodeStub(
        "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Headphones__sink",
        "Raptor Lake-P/U/H cAVS Headphones")]
    const targets = lib.buildOutputTargets(cards, nodes)
    const headphones = targets.find(t => t.label === "Headphones")
    assert.notEqual(headphones.node, null)
    assert.equal(headphones.needsProfile, null)
})

test("buildOutputTargets marks a latent port with the profile it needs", () => {
    const targets = lib.buildOutputTargets(lib.parseCards(fixture), [])
    const speaker = targets.find(t => t.label === "Speaker")
    assert.equal(speaker.node, null)
    assert.equal(speaker.needsProfile, "HiFi (HDMI1, HDMI2, HDMI3, Mic1, Mic2, Speaker)")
})

test("buildOutputTargets never returns both a node and a needed profile", () => {
    const nodes = [nodeStub(
        "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Headphones__sink",
        "Headphones")]
    for (const target of lib.buildOutputTargets(lib.parseCards(fixture), nodes))
        assert.ok(target.node === null || target.needsProfile === null)
})

test("buildOutputTargets tolerates no cards at all", () => {
    // Not assert.deepEqual([], []): an array built inside the vm sandbox has a
    // different Array.prototype object than a native literal, so strict deep
    // equality on [[Prototype]] fails even though both are empty arrays.
    assert.equal(lib.buildOutputTargets([], []).length, 0)
    assert.equal(lib.buildOutputTargets(null, null).length, 0)
})

test("buildOutputTargets carries the port's type for icon selection", () => {
    const targets = lib.buildOutputTargets(lib.parseCards(fixture), [])
    const speaker = targets.find(t => t.label === "Speaker")
    const hdmi = targets.find(t => t.portName === "[Out] HDMI1")
    assert.equal(speaker.type, "Speaker")
    assert.equal(hdmi.type, "HDMI")
})

// The "never returns both a node and a needed profile" test above is guaranteed
// by buildOutputTargets's own ternary and would pass even if node matching were
// completely broken. This is the test that actually proves the spec's claim:
// an active-profile port with a real matching node must resolve to that node,
// not silently fall through to node:null/needsProfile:null. It uses a synthetic
// card (not the fixture, which is UCM-only and has no such case) shaped like a
// non-UCM/mixer-path card, where pactl port keys can contain spaces
// ("Line Out") while the PipeWire node name spells the same port with a
// different separator, since node names cannot contain literal spaces.
test("buildOutputTargets resolves a multi-token port even when the node name uses different separators", () => {
    const card = {
        name: "alsa_card.synthetic",
        index: 99,
        activeProfile: "HiFi (Line Out)",
        profiles: [{ name: "HiFi (Line Out)", priority: 100, available: true, sinks: 1 }],
        ports: {
            "[Out] Line Out": {
                description: "Line Out",
                type: "Line",
                priority: 100,
                availability: "available",
                properties: {},
                profiles: ["HiFi (Line Out)"],
            },
        },
    }
    const node = nodeStub("alsa_output.pci-0000_00_1f.3.HiFi-Line-Out-sink", "Line Out")
    const target = lib.buildOutputTargets([card], [node]).find(t => t.portName === "[Out] Line Out")
    assert.equal(target.node, node)
    assert.notEqual(target.node, null)
    assert.equal(target.needsProfile, null)
})

// Round-2 finding: the token-boundary match alone is not enough. A node name
// can embed more than one port's token as a whole token each -- "Rear_Speaker"
// contains both "Speaker" and "Rear Speaker" at valid token boundaries -- so
// without ranking by specificity the shorter, less specific port would
// silently claim a node that belongs to a more specific sibling port. That is
// a false positive: it would route audio through the wrong physical output,
// which is worse than the false negative this whole matcher exists to fix.
test("buildOutputTargets does not let a shorter port name claim a sibling's more specific node", () => {
    const card = {
        name: "alsa_card.synthetic-speakers",
        index: 98,
        activeProfile: "HiFi (Speaker, Rear Speaker)",
        profiles: [{ name: "HiFi (Speaker, Rear Speaker)", priority: 100, available: true, sinks: 2 }],
        ports: {
            "[Out] Speaker": {
                description: "Speaker", type: "Speaker", priority: 100,
                availability: "available", properties: {},
                profiles: ["HiFi (Speaker, Rear Speaker)"],
            },
            "[Out] Rear Speaker": {
                description: "Rear Speaker", type: "Speaker", priority: 90,
                availability: "available", properties: {},
                profiles: ["HiFi (Speaker, Rear Speaker)"],
            },
        },
    }
    const rearNode = nodeStub(
        "alsa_output.pci-0000_00_1f.3.HiFi__Rear_Speaker__sink", "Rear Speaker")
    const targets = lib.buildOutputTargets([card], [rearNode])
    const speaker = targets.find(t => t.portName === "[Out] Speaker")
    const rearSpeaker = targets.find(t => t.portName === "[Out] Rear Speaker")
    assert.equal(rearSpeaker.node, rearNode)
    assert.equal(speaker.node, null)
    assert.notEqual(speaker.node, rearSpeaker.node)
})

test("buildOutputTargets resolves the same ambiguity when the shorter name is a bare \"Out\"", () => {
    const card = {
        name: "alsa_card.synthetic-lineout",
        index: 97,
        activeProfile: "HiFi (Out, Line Out)",
        profiles: [{ name: "HiFi (Out, Line Out)", priority: 100, available: true, sinks: 2 }],
        ports: {
            "[Out] Out": {
                description: "Out", type: "Line", priority: 100,
                availability: "available", properties: {},
                profiles: ["HiFi (Out, Line Out)"],
            },
            "[Out] Line Out": {
                description: "Line Out", type: "Line", priority: 90,
                availability: "available", properties: {},
                profiles: ["HiFi (Out, Line Out)"],
            },
        },
    }
    const node = nodeStub("alsa_output.pci-0000_00_1f.3.HiFi-Line-Out-sink", "Line Out")
    const targets = lib.buildOutputTargets([card], [node])
    const out = targets.find(t => t.portName === "[Out] Out")
    const lineOut = targets.find(t => t.portName === "[Out] Line Out")
    assert.equal(lineOut.node, node)
    assert.equal(out.node, null)
    assert.notEqual(out.node, lineOut.node)
})

test("buildOutputTargets keeps every real-fixture active port mapped to its own node", () => {
    const cards = lib.parseCards(fixture)
    const hdmi1 = nodeStub(
        "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__HDMI1__sink", "HDMI1")
    const hdmi2 = nodeStub(
        "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__HDMI2__sink", "HDMI2")
    const hdmi3 = nodeStub(
        "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__HDMI3__sink", "HDMI3")
    const headphones = nodeStub(
        "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Headphones__sink",
        "Raptor Lake-P/U/H cAVS Headphones")
    const targets = lib.buildOutputTargets(cards, [hdmi1, hdmi2, hdmi3, headphones])
    const byPort = name => targets.find(t => t.portName === name)

    assert.equal(byPort("[Out] HDMI1").node, hdmi1)
    assert.equal(byPort("[Out] HDMI2").node, hdmi2)
    assert.equal(byPort("[Out] HDMI3").node, hdmi3)
    assert.equal(byPort("[Out] Headphones").node, headphones)

    // No two ports share a node, and inputs (Mic1, Mic2) never surface here at all.
    const assignedNodes = targets.map(t => t.node).filter(n => n !== null)
    assert.equal(new Set(assignedNodes).size, assignedNodes.length)
    assert.ok(targets.every(t => !t.portName.startsWith("[In]")))
})

// Round-3 finding: the round-2 sibling veto is scoped to one card, so it does
// nothing to stop a node from ALSO matching an identically-named port on a
// different card -- e.g. an onboard "Line Out" and a USB dock's "Line Out".
// Nothing before this made the matcher card-aware, so whichever port
// happened to be checked first silently claimed the node regardless of which
// card it actually came from. These two synthetic cards, sharing a port
// name, are reused by both new tests below.
const onboardCard = {
    name: "alsa_card.onboard",
    index: 1,
    activeProfile: "HiFi (Line Out)",
    profiles: [{ name: "HiFi (Line Out)", priority: 100, available: true, sinks: 1 }],
    ports: {
        "[Out] Line Out": {
            description: "Line Out", type: "Line", priority: 100,
            availability: "available", properties: {},
            profiles: ["HiFi (Line Out)"],
        },
    },
}
const dockCard = {
    name: "alsa_card.usb_dock",
    index: 2,
    activeProfile: "HiFi (Line Out)",
    profiles: [{ name: "HiFi (Line Out)", priority: 100, available: true, sinks: 1 }],
    ports: {
        "[Out] Line Out": {
            description: "Line Out", type: "Line", priority: 100,
            availability: "available", properties: {},
            profiles: ["HiFi (Line Out)"],
        },
    },
}

test("buildOutputTargets does not let a node from one card leak into another card's identically-named port", () => {
    // Only one live node exists, and its name carries the onboard card's own
    // stem -- it must go to onboard's target, never to the dock's.
    const onboardNode = nodeStub("alsa_output.onboard.HiFi-Line-Out-sink", "Line Out")
    const targets = lib.buildOutputTargets([onboardCard, dockCard], [onboardNode])
    const onboardTarget = targets.find(t => t.cardName === "alsa_card.onboard")
    const dockTarget = targets.find(t => t.cardName === "alsa_card.usb_dock")
    assert.equal(onboardTarget.node, onboardNode)
    assert.equal(dockTarget.node, null)
    assert.notEqual(onboardTarget.node, dockTarget.node)
})

test("buildOutputTargets uses card affinity to give each card its own identically-named node", () => {
    // Two live nodes this time, one per card. This is the case that proves
    // affinity actually discriminates rather than just suppressing the
    // ambiguous one: both nodes score identically on port name alone, so
    // only the card-stem bonus can tell them apart.
    const onboardNode = nodeStub("alsa_output.onboard.HiFi-Line-Out-sink", "Line Out")
    const dockNode = nodeStub("alsa_output.usb_dock.HiFi-Line-Out-sink", "Line Out")
    const targets = lib.buildOutputTargets([onboardCard, dockCard], [onboardNode, dockNode])
    const onboardTarget = targets.find(t => t.cardName === "alsa_card.onboard")
    const dockTarget = targets.find(t => t.cardName === "alsa_card.usb_dock")
    assert.equal(onboardTarget.node, onboardNode)
    assert.equal(dockTarget.node, dockNode)
    assert.notEqual(onboardTarget.node, dockTarget.node)
})

test("buildOutputTargets still resolves when the node name carries no recognisable card stem", () => {
    // A node name that echoes nothing about its card at all -- e.g. a
    // Bluetooth-style node that never mentions the ALSA card path. Card
    // affinity correctly finds nothing here; with only one card and one
    // port in the whole system, the port-name match alone must still be
    // enough to resolve it. This guards against the affinity mechanism
    // turning into a new false negative for unusual naming.
    const card = {
        name: "alsa_card.mystery",
        index: 3,
        activeProfile: "HiFi (Headphones)",
        profiles: [{ name: "HiFi (Headphones)", priority: 100, available: true, sinks: 1 }],
        ports: {
            "[Out] Headphones": {
                description: "Headphones", type: "Headphones", priority: 100,
                availability: "available", properties: {},
                profiles: ["HiFi (Headphones)"],
            },
        },
    }
    const node = nodeStub("bluez_output.AA_BB_CC_DD_EE_FF.1.Headphones", "Headphones")
    const targets = lib.buildOutputTargets([card], [node])
    const headphones = targets.find(t => t.portName === "[Out] Headphones")
    assert.equal(headphones.node, node)
    assert.equal(headphones.needsProfile, null)
})
