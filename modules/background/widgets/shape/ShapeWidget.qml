pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts
import qs.services
import qs.modules.common
import qs.modules.common.widgets
import qs.modules.background.widgets

AbstractBackgroundWidget {
    id: root
    configEntryName: "shape"
    defaultConfig: ({ placementStrategy: "free", contentWidth: 160, contentHeight: 160,
        shape: "Flower", outline: false, angle: 0, strokeWidth: 3,
        widgetScale: 100, widgetOpacity: 100, colorMode: "auto", dim: 0,
        showBackground: false, showBorder: false, backgroundOpacity: 0,
        borderWidth: 0, borderOpacity: 0.2, cornerRadius: -1, useBlur: false, x: 80, y: 240 })
    implicitWidth: Math.max(64, Number(root._readConfigKey("contentWidth") ?? 160)) * scaleFactor
    implicitHeight: Math.max(64, Number(root._readConfigKey("contentHeight") ?? 160)) * scaleFactor
    resizableAxes: ({ width: "contentWidth", height: "contentHeight" })
    resizeMinWidth: 64
    resizeMinHeight: 64
    readonly property string shapeName: String(root._readConfigKey("shape") ?? "Flower")
    readonly property bool outline: Boolean(root._readConfigKey("outline") ?? false)
    readonly property real angle: Number(root._readConfigKey("angle") ?? 0)
    readonly property real lineWidth: Math.max(1, Number(root._readConfigKey("strokeWidth") ?? 3)) * scaleFactor

    MaterialShape {
        anchors.centerIn: parent
        implicitSize: Math.max(1, (Math.min(root.width, root.height) - root.lineWidth * 2)
            / (Math.abs(Math.cos(root.angle * Math.PI / 180)) + Math.abs(Math.sin(root.angle * Math.PI / 180))))
        shape: DesktopWidgetShapes.shapeForName(root.shapeName)
        color: root.outline ? "transparent" : root.widgetAccent
        strokeColor: root.outline ? root.widgetAccent : "transparent"
        strokeWidth: root.outline ? root.lineWidth : 0
        rotation: root.angle
    }

    editPopoverContent: Component {
        ColumnLayout {
            spacing: 8
            WidgetShapePicker {
                Layout.fillWidth: true
                selectedShape: root.shapeName
                onShapeSelected: name => root._setOutputValue("shape", name)
            }
            RowLayout {
                Layout.fillWidth: true
                SelectionGroupButton {
                    Layout.fillWidth: true
                    buttonText: Translation.tr("Filled")
                    toggled: !root.outline
                    onClicked: root._setOutputValue("outline", false)
                }
                SelectionGroupButton {
                    Layout.fillWidth: true
                    buttonText: Translation.tr("Outline")
                    toggled: root.outline
                    onClicked: root._setOutputValue("outline", true)
                }
            }
            StyledText { text: Translation.tr("Rotation") }
            StyledSlider {
                Layout.fillWidth: true
                from: 0; to: 360; stepSize: 15
                value: root.angle
                onMoved: root._setOutputValue("angle", value)
            }
        }
    }
}
