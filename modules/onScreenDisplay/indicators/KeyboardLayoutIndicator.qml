pragma ComponentBehavior: Bound

import qs.modules.common
import qs.modules.common.widgets
import qs.services
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    // Translated strings ("Bloqueo de mayúsculas activado") are far wider than the
    // fixed osdWidth, and clip:true silently cut them off. Grow with the text instead,
    // keeping osdWidth as the floor so short strings still get the usual pill.
    readonly property real minWidth: Appearance.sizes.osdWidth + 2 * Appearance.sizes.elevationMargin
    readonly property real maxWidth: Math.round(Screen.width * 0.5)
    readonly property real contentImplicitWidth: contentRow.implicitWidth
        + contentRow.anchors.leftMargin + contentRow.anchors.rightMargin
        + 2 * Appearance.sizes.elevationMargin

    implicitWidth: Math.min(root.maxWidth, Math.max(root.minWidth, root.contentImplicitWidth))
    implicitHeight: card.implicitHeight + 2 * Appearance.sizes.elevationMargin
    clip: true

    StyledRectangularShadow { target: card }

    Rectangle {
        id: card
        anchors {
            fill: parent
            margins: Appearance.sizes.elevationMargin
        }
        radius: Appearance.rounding.full
        color: Appearance.angelEverywhere ? Appearance.angel.colGlassPopup
             : Appearance.inirEverywhere ? Appearance.inir.colLayer1
             : Appearance.auroraEverywhere ? Appearance.aurora.colPopupSurface
             : Appearance.colors.colLayer0
        border.width: Appearance.angelEverywhere ? Appearance.angel.cardBorderWidth
            : Appearance.auroraEverywhere || Appearance.inirEverywhere ? 1 : 0
        border.color: Appearance.angelEverywhere ? Appearance.angel.colCardBorder
            : Appearance.inirEverywhere ? Appearance.inir.colBorder
            : Appearance.auroraEverywhere ? Appearance.aurora.colTooltipBorder : "transparent"
        implicitHeight: contentRow.implicitHeight + contentRow.anchors.topMargin + contentRow.anchors.bottomMargin

        RowLayout {
            id: contentRow
            anchors {
                fill: parent
                leftMargin: 14
                rightMargin: 20
                topMargin: 9
                bottomMargin: 9
            }
            spacing: 12

            Item {
                Layout.preferredWidth: 30
                Layout.preferredHeight: 30

                CookieFace {
                    anchors.fill: parent
                    visible: Appearance.cookieEverywhere
                    role: "badge"
                    selected: KeyboardIndicators.popupActive
                    color: Appearance.colors.colPrimaryContainer
                }

                MaterialSymbol {
                    anchors.centerIn: parent
                    text: KeyboardIndicators.popupMaterialIcon
                    iconSize: Appearance.font.pixelSize.hugeass
                    fill: 1
                    color: Appearance.cookieEverywhere
                        ? Appearance.colors.colOnPrimaryContainer
                        : KeyboardIndicators.popupActive
                            ? Appearance.colors.colPrimary : Appearance.colors.colOnLayer0
                }
            }

            StyledText {
                Layout.fillWidth: true
                text: KeyboardIndicators.popupText
                // Only reachable past maxWidth; without it the overflow is cut blind.
                elide: Text.ElideRight
                font.pixelSize: Appearance.font.pixelSize.normal
                color: Appearance.angelEverywhere ? Appearance.angel.colText
                     : Appearance.inirEverywhere ? Appearance.inir.colText
                     : Appearance.colors.colOnLayer0
            }
        }
    }
}
