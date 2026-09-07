import qs.modules.common
import qs.modules.common.widgets
import qs.services
import QtQuick
import QtQuick.Layouts

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
}
