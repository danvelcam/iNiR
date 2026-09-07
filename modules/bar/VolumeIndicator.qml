import qs.modules.common
import qs.modules.common.widgets
import qs.services
import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Wayland

MouseArea {
    id: root

    property bool flyoutOpen: false

    implicitWidth: contentRow.implicitWidth + 10
    implicitHeight: Appearance.sizes.barHeight

    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton

    onClicked: mouse => {
        if (mouse.button === Qt.MiddleButton) {
            Audio.toggleMute()
            return
        }
        root.flyoutOpen = !root.flyoutOpen
    }

    // Scrolling over the indicator adjusts volume, matching the bar's other
    // scrollable modules (see bar.leftScrollAction).
    onWheel: wheel => {
        if (wheel.angleDelta.y > 0)
            Audio.incrementVolume()
        else if (wheel.angleDelta.y < 0)
            Audio.decrementVolume()
    }

    RowLayout {
        id: contentRow
        anchors.centerIn: parent
        spacing: 3

        MaterialSymbol {
            Layout.alignment: Qt.AlignVCenter
            text: {
                if (Audio.sink?.audio?.muted ?? false)
                    return "volume_off"
                const level = Audio.value
                if (level <= 0.001) return "volume_mute"
                if (level < 0.5) return "volume_down"
                return "volume_up"
            }
            iconSize: Appearance.font.pixelSize.larger
            color: Appearance.angelEverywhere ? Appearance.angel.colText
                : Appearance.inirEverywhere ? Appearance.inir.colText
                : Appearance.colors.colOnLayer0
        }

        StyledText {
            Layout.alignment: Qt.AlignVCenter
            visible: Config.options?.bar?.volume?.showPercentage ?? false
            text: `${Math.round(Audio.value * 100)}`
            font.pixelSize: Appearance.font.pixelSize.smaller
            color: Appearance.angelEverywhere ? Appearance.angel.colText
                : Appearance.inirEverywhere ? Appearance.inir.colText
                : Appearance.colors.colOnLayer0
        }
    }

    VolumeFlyout {
        id: flyout
        hoverTarget: root
        active: root.flyoutOpen
        onRequestClose: root.flyoutOpen = false
    }

    // Outside-click backdrop for the flyout, standing in for StyledPopup's own
    // backdrop (StyledPopup.qml:31-45), which never instantiates: it is a bare
    // PanelWindow child of a LazyLoader whose default property is `Item
    // contentItem`, and a PanelWindow is not an Item, so QML silently drops it.
    // `root` here is a MouseArea -- a real Item with a `data` list -- so the
    // same shape actually works when declared here instead. See the
    // closeOnOutsideClick comment in VolumeFlyout.qml.
    //
    // Layer: StyledPopup's own popup window (the flyout) renders on
    // WlrLayer.Overlay. This backdrop is deliberately one layer below, on
    // WlrLayer.Top -- strictly under Overlay in the wlr-layer-shell stacking
    // order -- so the flyout is guaranteed to paint above it and keep
    // receiving its own clicks. (The dead code put both surfaces on Overlay,
    // which would have left their relative order unspecified.)
    PanelWindow {
        id: outsideClickBackdrop
        visible: root.flyoutOpen
        // Alpha must be non-zero or the compositor treats the surface as
        // input-transparent and outside clicks never reach it.
        color: Qt.rgba(0, 0, 0, 1 / 255)
        exclusiveZone: 0
        WlrLayershell.layer: WlrLayer.Top
        WlrLayershell.namespace: "quickshell:volume-flyout-catcher"
        WlrLayershell.exclusionMode: ExclusionMode.Ignore
        anchors { top: true; bottom: true; left: true; right: true }

        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.AllButtons
            onClicked: flyout.requestClose()
        }
    }
}
