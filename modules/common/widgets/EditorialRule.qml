pragma ComponentBehavior: Bound
import QtQuick
import qs.modules.common

Item {
    id: root
    property bool emphasized: false
    property bool vertical: false
    property real inset: 16
    readonly property real extent: Math.max(0, (vertical ? height : width) - inset * 2)
    visible: Appearance.editorialEverywhere

    Rectangle {
        x: root.vertical ? 0 : root.inset
        y: root.vertical ? root.inset : 0
        width: root.vertical ? 1 : root.extent
        height: root.vertical ? root.extent : 1
        color: Appearance.editorial.rule
    }
    Rectangle {
        x: root.vertical ? 0 : root.inset
        y: root.vertical ? root.inset : 0
        width: root.vertical ? 2 : Math.min(root.extent, root.emphasized ? 72 : 28)
        height: root.vertical ? Math.min(root.extent, root.emphasized ? 72 : 28) : 2
        color: Appearance.editorial.accent
        Behavior on width {
            enabled: Appearance.animationsEnabled && root.visible
            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
        }
        Behavior on height {
            enabled: Appearance.animationsEnabled && root.visible
            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
        }
    }
}
