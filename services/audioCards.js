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

// A sink node belongs to a port when its PipeWire node name carries the port's
// UCM verb ("HiFi__Headphones__sink" for "[Out] Headphones"). Matching on the
// description instead would break the moment the card is renamed or translated.
function nodeMatchesPort(node, port) {
    if (!node || !port)
        return false
    var properties = node.properties || {}
    var nodeName = String(properties["node.name"] !== undefined
        ? properties["node.name"] : (node.name || ""))
    if (nodeName.length === 0)
        return false

    // "[Out] Headphones" -> "Headphones"
    var shortName = port.portName.replace("[Out]", "").trim()
    if (shortName.length === 0)
        return false

    return nodeName.indexOf("__" + shortName + "__") !== -1
        || nodeName.indexOf("." + shortName + ".") !== -1
}

function buildOutputTargets(cards, nodes) {
    var targets = []
    if (!Array.isArray(cards))
        return targets
    var nodeList = Array.isArray(nodes) ? nodes : []

    var ports = outputPortsOf(cards)
    for (var i = 0; i < ports.length; i++) {
        var port = ports[i]

        var matched = null
        if (port.inActiveProfile) {
            for (var j = 0; j < nodeList.length; j++) {
                if (nodeMatchesPort(nodeList[j], port)) {
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
