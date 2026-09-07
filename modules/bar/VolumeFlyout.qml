pragma ComponentBehavior: Bound
import qs.services
import qs.modules.common
import qs.modules.common.widgets
import qs.modules.sidebarRight.volumeMixer
import QtQuick
import QtQuick.Layouts
import Quickshell

StyledPopup {
    id: root

    // Click-driven, not hover-driven: picking an output is a deliberate act and
    // a hover popup would fight the pointer on the way to the list.
    hoverActivates: false
    closeOnOutsideClick: true

    readonly property list<var> targets: Audio.outputTargets
    readonly property list<var> appNodes: MprisController.mixerAppNodes

    ColumnLayout {
        anchors.centerIn: parent
        implicitWidth: 320
        spacing: 12

        // ── Master volume ────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            RippleButton {
                implicitWidth: 34
                implicitHeight: 34
                buttonRadius: Appearance.rounding.full
                colBackground: "transparent"
                colBackgroundHover: Appearance.colors.colLayer2Hover
                colRipple: Appearance.colors.colLayer2Active
                onClicked: Audio.toggleMute()

                contentItem: MaterialSymbol {
                    anchors.centerIn: parent
                    text: Audio.sink?.audio?.muted ? "volume_off" : "volume_up"
                    iconSize: Appearance.font.pixelSize.larger
                    color: Appearance.colors.colOnLayer1
                }
            }

            StyledSlider {
                id: masterSlider
                Layout.fillWidth: true
                property real modelValue: Audio.value
                Binding {
                    target: masterSlider
                    property: "value"
                    value: masterSlider.modelValue
                    when: !masterSlider.pressed
                }
                onMoved: Audio.setSinkVolume(value)
            }

            StyledText {
                Layout.minimumWidth: 38
                horizontalAlignment: Text.AlignRight
                text: `${Math.round(Audio.value * 100)}%`
                font.pixelSize: Appearance.font.pixelSize.smaller
                color: Appearance.colors.colSubtext
            }
        }

        // ── Outputs ──────────────────────────────────────────────────
        StyledText {
            text: Translation.tr("Output")
            font.pixelSize: Appearance.font.pixelSize.smaller
            font.weight: Font.Medium
            color: Appearance.colors.colSubtext
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Repeater {
                model: ScriptModel { values: root.targets }

                delegate: RippleButton {
                    id: targetButton
                    required property var modelData

                    readonly property bool isCurrent: modelData.node
                        && Audio.defaultSink
                        && modelData.node.id === Audio.defaultSink.id
                    // Selecting this row runs Audio.switchToTarget's long path: a
                    // card profile switch, not an immediate default-sink change.
                    readonly property bool isLatent: modelData.needsProfile !== null
                    // Reachable since Task 1, not a bug: pickProfileForPort short-circuits
                    // to null whenever the port is already in its active profile, so a
                    // port that IS in the active profile but whose live node has not
                    // appeared yet (or whose device link is stale) ends up with node AND
                    // needsProfile both null. It is available, but there is nothing to
                    // switch to and nothing to switch through right now.
                    readonly property bool isStale: modelData.available && !modelData.node && !isLatent
                    readonly property bool isSelectable: modelData.available && !isStale

                    Layout.fillWidth: true
                    implicitHeight: 40
                    enabled: isSelectable && !Audio.switching
                    opacity: isSelectable ? 1 : 0.45
                    buttonRadius: Appearance.rounding.small

                    colBackground: isCurrent ? Appearance.colors.colPrimaryContainer : "transparent"
                    colBackgroundHover: Appearance.colors.colLayer2Hover
                    colRipple: Appearance.colors.colLayer2Active

                    contentItem: RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 10
                        anchors.rightMargin: 10
                        spacing: 10

                        MaterialSymbol {
                            text: targetButton.isCurrent ? "check"
                                : targetButton.modelData.type === "HDMI" ? "tv"
                                : targetButton.modelData.type === "Headphones" ? "headphones"
                                : "speaker"
                            iconSize: Appearance.font.pixelSize.large
                            color: targetButton.isCurrent
                                ? Appearance.colors.colOnPrimaryContainer
                                : Appearance.colors.colSubtext
                        }

                        StyledText {
                            Layout.fillWidth: true
                            text: targetButton.modelData.label
                            elide: Text.ElideRight
                            font.pixelSize: Appearance.font.pixelSize.normal
                            color: targetButton.isCurrent
                                ? Appearance.colors.colOnPrimaryContainer
                                : Appearance.colors.colOnSurface
                        }

                        StyledText {
                            visible: text !== ""
                            text: !targetButton.modelData.available
                                ? Translation.tr("Not connected")
                                : targetButton.isStale
                                    ? Translation.tr("Not ready")
                                    : targetButton.isLatent
                                        ? Translation.tr("Switch profile")
                                        : ""
                            font.pixelSize: Appearance.font.pixelSize.smallest
                            color: Appearance.colors.colSubtext
                        }
                    }

                    onClicked: Audio.switchToTarget(modelData)
                }
            }

            MaterialPlaceholderMessage {
                Layout.fillWidth: true
                shown: root.targets.length === 0
                icon: "speaker"
                text: Translation.tr("No outputs found")
                explanation: Translation.tr("pactl is unavailable, so only the current device can be used")
            }
        }

        // ── Per-application volume ───────────────────────────────────
        StyledText {
            visible: root.appNodes.length > 0
            text: Translation.tr("Applications")
            font.pixelSize: Appearance.font.pixelSize.smaller
            font.weight: Font.Medium
            color: Appearance.colors.colSubtext
        }

        ColumnLayout {
            Layout.fillWidth: true
            visible: root.appNodes.length > 0
            spacing: 6

            Repeater {
                model: ScriptModel { values: root.appNodes }
                delegate: VolumeMixerEntry {
                    required property var modelData
                    Layout.fillWidth: true
                    node: modelData
                }
            }
        }
    }
}
