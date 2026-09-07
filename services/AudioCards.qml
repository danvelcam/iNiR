pragma Singleton
pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Io
import "audioCards.js" as AudioCardsLib

/**
 * Card-level view of PipeWire that Quickshell's Pipewire service does not model.
 * Quickshell exposes nodes, links and defaults — never devices or card profiles —
 * so an output that lives in a non-active profile (internal speakers while the
 * headphone profile is active) has no node and is invisible to node enumeration.
 * pactl is the only interface that reports the full port/profile map.
 */
Singleton {
    id: root

    property bool ready: false
    property var cards: []
    readonly property var outputPorts: AudioCardsLib.outputPortsOf(root.cards)

    // Set when refresh() is called while listCardsProc is already running,
    // since that call is otherwise silently dropped (refresh() below no-ops
    // rather than queuing). Drained by listCardsProc.onExited once the
    // in-flight run finishes, so a refresh requested mid-run is never lost.
    property bool _refreshPending: false

    signal profileApplied(string cardName, string profileName)
    signal profileFailed(string cardName, string profileName, string reason)

    function cardFor(cardName: string) {
        for (const card of root.cards) {
            if (card.name === cardName)
                return card
        }
        return null
    }

    function profileForPort(port) {
        if (!port)
            return null
        return AudioCardsLib.pickProfileForPort(root.cardFor(port.cardName), port)
    }

    function refresh(): void {
        if (listCardsProc.running) {
            root._refreshPending = true
            return
        }
        listCardsProc.running = true
    }

    // Re-issues a refresh queued while listCardsProc was busy. Deferred with
    // Qt.callLater rather than calling listCardsProc.running = true directly:
    // setting running=true from inside this same Process's own onExited
    // handler is silently dropped (see the `requester` Process in
    // services/Ai.qml for the same gotcha), so it has to start on the next
    // event-loop turn instead.
    function _rearmPendingRefresh(): void {
        if (!root._refreshPending)
            return
        root._refreshPending = false
        Qt.callLater(() => { listCardsProc.running = true })
    }

    function setCardProfile(cardName: string, profileName: string): void {
        if (!cardName || !profileName) {
            root.profileFailed(cardName ?? "", profileName ?? "", "empty argument")
            return
        }
        if (setProfileProc.running) {
            root.profileFailed(cardName, profileName, "another switch is in flight")
            return
        }
        setProfileProc._cardName = cardName
        setProfileProc._profileName = profileName
        setProfileProc.command = ["pactl", "set-card-profile", cardName, profileName]
        setProfileProc.running = true
    }

    Process {
        id: listCardsProc
        command: ["pactl", "-f", "json", "list", "cards"]
        stdout: StdioCollector { id: listCardsCollector }
        onExited: (exitCode, _exitStatus) => {
            if (exitCode !== 0) {
                // pactl missing or PulseAudio layer unavailable. Keep whatever we
                // had: consumers fall back to node enumeration, never to an empty list.
                root.ready = false
                root._rearmPendingRefresh()
                return
            }
            const parsed = AudioCardsLib.parseCards(listCardsCollector.text ?? "")
            // Discard an unparseable refresh rather than blanking a good state.
            if (parsed.length === 0 && root.cards.length > 0) {
                root._rearmPendingRefresh()
                return
            }
            root.cards = parsed
            root.ready = true
            root._rearmPendingRefresh()
        }
    }

    Process {
        id: setProfileProc
        property string _cardName: ""
        property string _profileName: ""
        command: ["pactl", "set-card-profile", "", ""]
        stderr: StdioCollector { id: setProfileErr }
        onExited: (exitCode, _exitStatus) => {
            if (exitCode === 0)
                root.profileApplied(setProfileProc._cardName, setProfileProc._profileName)
            else
                root.profileFailed(setProfileProc._cardName, setProfileProc._profileName,
                    (setProfileErr.text ?? "").trim() || `pactl exited ${exitCode}`)
            root.refresh()
        }
    }

    // pactl subscribe streams one line per server event. Card add/remove/change
    // are the only ones that can alter the port/profile map; polling instead
    // would either lag behind a plugged cable or burn CPU for nothing.
    Process {
        id: subscribeProc
        running: true
        command: ["pactl", "subscribe"]
        stdout: SplitParser {
            splitMarker: "\n"
            onRead: data => {
                if (data.includes("on card") || data.includes("on server"))
                    debounce.restart()
            }
        }
        onExited: (_exitCode, _exitStatus) => {
            // pactl subscribe blocks until killed or disconnected, so it has no
            // clean exit path: a PipeWire/pipewire-pulse restart, a suspend/resume
            // hiccup and a missing binary all surface as a non-zero exit — exit 0
            // is effectively unreachable. Retry unconditionally; the 2s resubscribe
            // cooldown below is what bounds the retry (and self-heals a missing
            // binary once it's installed), not the exit code. Without this, live
            // updates die silently and permanently after the first hiccup.
            resubscribe.restart()
        }
    }

    Timer {
        id: debounce
        interval: 120
        onTriggered: root.refresh()
    }

    Timer {
        id: resubscribe
        interval: 2000
        onTriggered: { subscribeProc.running = true; root.refresh() }
    }

    Component.onCompleted: root.refresh()
}
