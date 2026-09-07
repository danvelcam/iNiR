.pragma library

// Pure helpers for PipeWire card/profile handling. No Qt imports: this file is
// loaded both by services/AudioCards.qml and by scripts/test-audio-cards.mjs.
// Profiles we never offer: "off" silences the card, "pro-audio" exposes raw
// device sinks that nobody picks from a desktop bar.
var EXCLUDED_PROFILES = ["off", "pro-audio"]

function parseCards(jsonText) {
    if (typeof jsonText !== "string" || jsonText.trim().length === 0)
        return []

    var raw
    try {
        raw = JSON.parse(jsonText)
    } catch (e) {
        return []
    }
    if (!Array.isArray(raw))
        return []

    var cards = []
    for (var i = 0; i < raw.length; i++) {
        var card = raw[i]
        if (!card || typeof card !== "object")
            continue

        var name = String(card.name !== undefined ? card.name : "")
        if (name.length === 0)
            continue

        var profileMap = card.profiles || {}
        var profiles = []
        var profileNames = Object.keys(profileMap)
        for (var p = 0; p < profileNames.length; p++) {
            var pname = profileNames[p]
            var profile = profileMap[pname] || {}
            profiles.push({
                name: pname,
                priority: Number(profile.priority !== undefined ? profile.priority : 0),
                available: profile.available !== false,
                sinks: Number(profile.sinks !== undefined ? profile.sinks : 0),
            })
        }

        cards.push({
            name: name,
            index: Number(card.index !== undefined ? card.index : -1),
            activeProfile: String(card.active_profile !== undefined ? card.active_profile : ""),
            profiles: profiles,
            ports: card.ports || {},
        })
    }
    return cards
}

function outputPortsOf(cards) {
    var ports = []
    if (!Array.isArray(cards))
        return ports

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i]
        var portNames = Object.keys(card.ports || {})
        for (var j = 0; j < portNames.length; j++) {
            var portName = portNames[j]
            // pactl keys output ports "[Out] <name>" and inputs "[In] <name>".
            // These keys are not localised, so the prefix is a safe filter.
            if (portName.indexOf("[Out]") !== 0)
                continue

            var port = card.ports[portName] || {}
            var portProfiles = Array.isArray(port.profiles) ? port.profiles.slice() : []
            var properties = port.properties || {}

            ports.push({
                key: card.name + "::" + portName,
                cardName: card.name,
                portName: portName,
                label: String(port.description !== undefined ? port.description : portName),
                type: String(port.type !== undefined ? port.type : "Unknown"),
                iconName: String(properties["device.icon_name"] !== undefined
                    ? properties["device.icon_name"] : ""),
                priority: Number(port.priority !== undefined ? port.priority : 0),
                available: String(port.availability !== undefined ? port.availability : "unknown")
                    !== "not available",
                profiles: portProfiles,
                inActiveProfile: portProfiles.indexOf(card.activeProfile) !== -1,
            })
        }
    }

    ports.sort(function (a, b) { return b.priority - a.priority })
    return ports
}

function pickProfileForPort(card, port) {
    if (!card || !port)
        return null
    // Already reachable: no profile switch needed.
    if (port.inActiveProfile)
        return null

    var best = null
    for (var i = 0; i < card.profiles.length; i++) {
        var profile = card.profiles[i]
        if (EXCLUDED_PROFILES.indexOf(profile.name) !== -1)
            continue
        if (!profile.available)
            continue
        if (port.profiles.indexOf(profile.name) === -1)
            continue
        if (best === null || profile.priority > best.priority)
            best = profile
    }
    return best === null ? null : best.name
}

// Folds every separator a port/node name pair might use for the same word
// ("__", ".", "-", " ") to one canonical delimiter and lowercases. A pactl
// port key can contain spaces ("Line Out"); a PipeWire node.name cannot, so
// the same port surfaces there with underscores, hyphens or dots instead.
// Normalising both sides is what lets the two spellings compare equal.
function canonicalToken(value) {
    return String(value).toLowerCase().replace(/[\s_.-]+/g, "_").replace(/^_+|_+$/g, "")
}

// Length of the canonical port name when it appears in the node name as a
// whole token (padded token-boundary match, not a raw substring check — "Mic"
// must not match inside "Microphone"), or 0 when it does not match at all.
// The length is the specificity signal nodeMatchesPort ranks siblings on: a
// node named "..._Rear_Speaker_.." satisfies both "Speaker" and "Rear
// Speaker" as token-boundary matches, and the longer one is the real,
// unambiguous one — matching on the description instead of node.name would
// have the same problem and would also break the moment the card is renamed
// or translated.
function matchStrength(node, port) {
    if (!node || !port)
        return 0
    var properties = node.properties || {}
    var nodeName = String(properties["node.name"] !== undefined
        ? properties["node.name"] : (node.name || ""))
    if (nodeName.length === 0)
        return 0

    // "[Out] Headphones" -> "Headphones"
    var shortName = port.portName.replace("[Out]", "").trim()
    if (shortName.length === 0)
        return 0

    var needle = canonicalToken(shortName)
    if (needle.length === 0)
        return 0

    var haystack = "_" + canonicalToken(nodeName) + "_"
    return haystack.indexOf("_" + needle + "_") !== -1 ? needle.length : 0
}

// A sink node belongs to a port when it matches (see matchStrength) AND no
// sibling port on the same card matches at least as well. Without the
// sibling check, a node whose name embeds more than one port's token (e.g.
// "Rear_Speaker" embeds "Speaker") would satisfy both "Speaker" and "Rear
// Speaker", and whichever port happened to be tried first would silently
// claim it — a false positive that routes audio through the wrong physical
// output, worse than not matching at all. Ambiguity is resolved by
// specificity (the longer canonical token wins) and an exact tie fails
// closed to neither port, rather than guessing.
function nodeMatchesPort(node, port, siblingPorts) {
    var strength = matchStrength(node, port)
    if (strength === 0)
        return false
    if (!Array.isArray(siblingPorts))
        return true // no sibling context supplied: unranked, back-compat behaviour

    for (var i = 0; i < siblingPorts.length; i++) {
        var other = siblingPorts[i]
        if (other === port || other.key === port.key)
            continue
        if (matchStrength(node, other) >= strength)
            return false
    }
    return true
}

function buildOutputTargets(cards, nodes) {
    var targets = []
    if (!Array.isArray(cards))
        return targets
    var nodeList = Array.isArray(nodes) ? nodes : []

    var ports = outputPortsOf(cards)
    for (var i = 0; i < ports.length; i++) {
        var port = ports[i]

        // Other output ports on the same card. A node's name can embed more
        // than one port's token (e.g. "Rear_Speaker" contains "Speaker"), so
        // nodeMatchesPort needs these to resolve the ambiguity itself rather
        // than let the shorter, less specific name claim the node first.
        var siblingPorts = []
        for (var s = 0; s < ports.length; s++) {
            if (s !== i && ports[s].cardName === port.cardName)
                siblingPorts.push(ports[s])
        }

        var matched = null
        if (port.inActiveProfile) {
            for (var j = 0; j < nodeList.length; j++) {
                if (nodeMatchesPort(nodeList[j], port, siblingPorts)) {
                    matched = nodeList[j]
                    break
                }
            }
        }

        var card = null
        for (var c = 0; c < cards.length; c++) {
            if (cards[c].name === port.cardName) {
                card = cards[c]
                break
            }
        }

        targets.push({
            key: port.key,
            label: port.label,
            iconName: port.iconName,
            cardName: port.cardName,
            portName: port.portName,
            type: port.type,
            available: port.available,
            node: matched,
            // Mutually exclusive with `node` by construction: pickProfileForPort
            // returns null whenever the port sits in the active profile.
            needsProfile: matched !== null ? null : pickProfileForPort(card, port),
        })
    }
    return targets
}
