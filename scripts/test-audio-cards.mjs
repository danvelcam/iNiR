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
