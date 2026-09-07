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

// The PipeWire node name, wherever it actually lives. Shared by matchStrength
// and cardAffinity so the two never drift apart on how they read a node.
function nodeNameOf(node) {
    if (!node)
        return ""
    var properties = node.properties || {}
    return String(properties["node.name"] !== undefined
        ? properties["node.name"] : (node.name || ""))
}

// Length of the canonical port name when it appears in the node name as a
// whole token (padded token-boundary match, not a raw substring check — "Mic"
// must not match inside "Microphone"), or 0 when it does not match at all.
// The length is the specificity signal buildOutputTargets ranks candidates
// on: a node named "..._Rear_Speaker_.." satisfies both "Speaker" and "Rear
// Speaker" as token-boundary matches, and the longer one is the real,
// unambiguous one — matching on the description instead of node.name would
// have the same problem and would also break the moment the card is renamed
// or translated.
function matchStrength(node, port) {
    if (!node || !port)
        return 0
    var nodeName = nodeNameOf(node)
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

// Whether a node's name carries the given card's own name as a stem, e.g.
// card "alsa_card.pci-0000_00_1f.3-platform-skl_hda_dsp_generic" produces
// nodes named "alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic....".
// This is the only signal that can tell apart two cards that happen to
// expose an identically-named port (two "Line Out"s, one onboard and one on
// a USB dock): a port-name match alone cannot distinguish them, since it
// never looks at which card the node actually came from.
function cardAffinity(node, cardName) {
    var stem = canonicalToken(String(cardName).replace(/^alsa_card\./, ""))
    if (stem.length === 0)
        return false
    return canonicalToken(nodeNameOf(node)).indexOf(stem) !== -1
}

// Exceeds any realistic canonical port-name length (matchStrength's return
// value), so a same-card match always outranks a same-name match that came
// from the wrong card, no matter how specific that wrong-card name is.
var CARD_AFFINITY_BONUS = 1000

function buildOutputTargets(cards, nodes) {
    var targets = []
    if (!Array.isArray(cards))
        return targets
    var nodeList = Array.isArray(nodes) ? nodes : []

    var ports = outputPortsOf(cards)

    // Every port becomes a target up front, unassigned. node/needsProfile are
    // filled in once the assignment pass below has picked winners.
    for (var i = 0; i < ports.length; i++) {
        targets.push({
            key: ports[i].key,
            label: ports[i].label,
            iconName: ports[i].iconName,
            cardName: ports[i].cardName,
            portName: ports[i].portName,
            type: ports[i].type,
            available: ports[i].available,
            node: null,
            needsProfile: null,
        })
    }

    // A node can score a token-boundary match against ports on more than one
    // card (two cards can both have a "Line Out"), so assignment cannot be
    // decided port-by-port -- doing so lets the same live node attach to two
    // different cards' targets at once. Instead every node is placed in one
    // global pass: for each node, the highest-scoring eligible target wins
    // it outright (a tie assigns it to nobody, failing closed exactly as an
    // ambiguous same-card match does); the score is the port-name match
    // strength, boosted by CARD_AFFINITY_BONUS when the node's own name
    // confirms it belongs to that port's card. If that leaves one target as
    // the top scorer for more than one node, it keeps only the strongest of
    // those and the rest are left unassigned rather than spilling over to
    // whichever target came second.
    var bestScoreByTarget = []
    for (var z = 0; z < targets.length; z++)
        bestScoreByTarget.push(0)

    for (var n = 0; n < nodeList.length; n++) {
        var node = nodeList[n]
        var bestScore = 0
        var bestTarget = -1
        var tiedAtBest = false

        for (var t = 0; t < ports.length; t++) {
            if (!ports[t].inActiveProfile)
                continue

            var score = matchStrength(node, ports[t])
            if (score === 0)
                continue
            if (cardAffinity(node, ports[t].cardName))
                score += CARD_AFFINITY_BONUS

            if (score > bestScore) {
                bestScore = score
                bestTarget = t
                tiedAtBest = false
            } else if (score === bestScore) {
                tiedAtBest = true
            }
        }

        if (bestTarget === -1 || tiedAtBest)
            continue // no candidate, or an unresolved tie: nobody gets this node

        if (bestScore > bestScoreByTarget[bestTarget]) {
            targets[bestTarget].node = node
            bestScoreByTarget[bestTarget] = bestScore
        }
    }

    for (var k = 0; k < targets.length; k++) {
        var card = null
        for (var c = 0; c < cards.length; c++) {
            if (cards[c].name === ports[k].cardName) {
                card = cards[c]
                break
            }
        }
        // Mutually exclusive with `node` by construction: pickProfileForPort
        // returns null whenever the port sits in the active profile.
        targets[k].needsProfile = targets[k].node !== null
            ? null : pickProfileForPort(card, ports[k])
    }

    return targets
}
