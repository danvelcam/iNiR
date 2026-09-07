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

        var cardProperties = card.properties || {}
        cards.push({
            name: name,
            index: Number(card.index !== undefined ? card.index : -1),
            // The PipeWire global object id of the device behind this card,
            // kept as a string because that is how both sides of the join
            // spell it. NOT `index`: pipewire-pulse reports "object.serial"
            // as the pulse index (verified on live hardware -- an alsa sink
            // there has index 3739, object.serial 3739 and object.id 76),
            // while a node's "device.id" points at the device's *global* id,
            // which pactl exposes here as properties["object.id"]. The two
            // agree for a card created at startup and diverge for anything
            // hotplugged later. "" when pactl reports no id at all.
            deviceId: String(cardProperties["object.id"] !== undefined
                && cardProperties["object.id"] !== null
                ? cardProperties["object.id"] : ""),
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
            // The "[Out] " prefix is UCM-only: libspa-alsa.so pairs it with
            // the UCM verbs (e.g. "HiFi"), which is what this laptop's card
            // uses. Non-UCM ALSA cards key their ports with bare mixer-path
            // names instead — analog-output-speaker, analog-output-headphones,
            // analog-output-lineout, hdmi-output, iec958-stereo-output — and
            // libspa-bluez5.so names Bluetooth ports "%s-output"/"%s-hf-output"
            // (headphone-output, handsfree-hf-output). None of those carry
            // this prefix, so classic HDA cards and Bluetooth headsets
            // contribute zero rows today; this filter does not see them.
            // Do not widen it on its own: matchStrength (below) scores 0 for
            // a name like "headphone-output" against a real node such as
            // "bluez_output.AA_BB.1.a2dp-sink", so an unmatched port would go
            // from absent to visible-but-permanently-"Not ready", which is
            // worse. Supporting these families needs a matching rule for
            // their naming too, not just a wider filter.
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
                // Only the literal "not available" flips this false. pactl
                // also reports "availability unknown" for ports with no
                // jack-detection hardware -- the real fixture's own
                // "[Out] Speaker" is exactly that case -- and treating
                // "unknown" as unavailable would disable the very row this
                // whole branch exists to enable. Do not tighten this.
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

// One place that knows where a node keeps its metadata, so every reader below
// stays in step with the others.
function nodePropertiesOf(node) {
    return (node && node.properties) || {}
}

// The PipeWire node name, wherever it actually lives. Shared by matchStrength
// and cardAffinity so the two never drift apart on how they read a node.
function nodeNameOf(node) {
    var properties = nodePropertiesOf(node)
    return String(properties["node.name"] !== undefined
        ? properties["node.name"] : ((node && node.name) || ""))
}

// The global object id of the device this node hangs off, as a string, or ""
// when the node carries no such link. WirePlumber stamps "device.id" on every
// node it creates from a device with that device's bound (global) id, so this
// is a fact PipeWire maintains rather than anything inferred from a name --
// and it exists on bluez nodes too, where names carry no card signal at all.
function nodeDeviceId(node) {
    var properties = nodePropertiesOf(node)
    var value = properties["device.id"]
    return value === undefined || value === null ? "" : String(value)
}

// Verdict of the node/card hard join. UNKNOWN is not "no": it means one side
// never reported an id, so the join has nothing to say and the name heuristic
// below has to answer instead.
var DEVICE_LINK_MISMATCH = -1
var DEVICE_LINK_UNKNOWN = 0
var DEVICE_LINK_MATCH = 1

function deviceLink(nodeId, cardId) {
    if (nodeId.length === 0 || cardId.length === 0)
        return DEVICE_LINK_UNKNOWN
    // Compared as strings: pactl reports ids as JSON strings and a PwNode
    // property is a string, but a hand-built card object may hold a number.
    return nodeId === cardId ? DEVICE_LINK_MATCH : DEVICE_LINK_MISMATCH
}

function findCard(cards, cardName) {
    for (var i = 0; i < cards.length; i++) {
        if (cards[i] && cards[i].name === cardName)
            return cards[i]
    }
    return null
}

function cardDeviceIdOf(cards, cardName) {
    var card = findCard(cards, cardName)
    if (!card || card.deviceId === undefined || card.deviceId === null)
        return ""
    return String(card.deviceId)
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
// Fallback only: it is consulted when the hard device link above cannot
// answer, and it guesses card ownership from spelling, which the link knows
// for certain. Both sides are padded and compared at a token boundary, the
// same way matchStrength does, so a stem cannot match halfway through a
// longer word ("dock" inside "dockstation").
//
// The padding does NOT separate two identical USB cards, which PipeWire
// names "..._Product-00" and "..._Product-00-2": "00" is a genuine token
// boundary inside "00-2", so the first card's stem is a legitimate
// whole-token match in the second card's node names and both cards score
// the bonus. Only the device link tells those apart -- and it always can,
// since alsa nodes always carry "device.id". Padding is a strict
// improvement here, not the fix for that case.
function cardAffinity(node, cardName) {
    var stem = canonicalToken(String(cardName).replace(/^alsa_card\./, ""))
    if (stem.length === 0)
        return false
    var haystack = "_" + canonicalToken(nodeNameOf(node)) + "_"
    return haystack.indexOf("_" + stem + "_") !== -1
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
    // it outright; the score is the port-name match strength, boosted by
    // CARD_AFFINITY_BONUS when the node is confirmed to belong to that
    // port's card.
    //
    // The two tie directions are deliberately NOT symmetric, and making them
    // symmetric would be a regression in whichever direction it was applied:
    //
    //  - Several targets tie for one node: nobody gets it. The node's
    //    identity is genuinely ambiguous, and guessing would route audio out
    //    of the wrong physical device -- a worse outcome than showing one
    //    output as not-live.
    //  - Several nodes tie for one target: the first in list order keeps it
    //    (the `>` below never lets a later, equal-scoring node displace it).
    //    Duplicate nodes for one port are a transient of profile-switch
    //    churn -- the old node lingers for a moment beside the new one --
    //    and outputTargets is a reactive QML property that recomputes as
    //    soon as PipeWire drops the stale node. Failing closed here would
    //    make the target flicker to "not live" on every profile switch.
    //
    // A target that wins more than one node keeps only the strongest of
    // them; the rest are left unassigned rather than spilling over to
    // whichever target came second.
    var bestScoreByTarget = []
    var cardDeviceIdByPort = []
    for (var z = 0; z < targets.length; z++) {
        bestScoreByTarget.push(0)
        cardDeviceIdByPort.push(cardDeviceIdOf(cards, ports[z].cardName))
    }

    for (var n = 0; n < nodeList.length; n++) {
        var node = nodeList[n]
        var thisNodeDeviceId = nodeDeviceId(node)
        var bestScore = 0
        var bestTarget = -1
        var tiedAtBest = false

        for (var t = 0; t < ports.length; t++) {
            if (!ports[t].inActiveProfile)
                continue

            var score = matchStrength(node, ports[t])
            if (score === 0)
                continue

            // Card ownership is decided by PipeWire's own parent-child link
            // whenever both sides report an id; the name-stem heuristic only
            // fills in for node kinds that carry no "device.id" at all (and
            // for cards pactl gave no "object.id").
            var link = deviceLink(thisNodeDeviceId, cardDeviceIdByPort[t])

            // A link naming a *different* card is not a weaker candidate, it
            // is not a candidate: PipeWire says this node hangs off other
            // hardware. Merely withholding the bonus would leave the port
            // competing on its raw name score and winning the node outright
            // whenever nothing outscores it -- which happens for real when
            // the true owner's port is momentarily absent from the polled
            // card snapshot, the same profile-switch lag described above.
            // Audio would come out of the wrong device.
            if (link === DEVICE_LINK_MISMATCH)
                continue

            if (link === DEVICE_LINK_MATCH || cardAffinity(node, ports[t].cardName))
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
        var card = findCard(cards, ports[k].cardName)
        // Mutually exclusive with `node` by construction: pickProfileForPort
        // returns null whenever the port sits in the active profile.
        targets[k].needsProfile = targets[k].node !== null
            ? null : pickProfileForPort(card, ports[k])
    }

    return targets
}
