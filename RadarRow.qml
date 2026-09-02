import QtQuick
import qs.Commons
import qs.Ui
import "ui/glyphs.js" as Glyphs

// RadarRow - one key/value line inside a result group.
//
// A row is plain data: { label, value, url?, tone? }. Clicking a row with
// a url opens it; any other row copies its value. Hover reveals the
// action button on the right. The value column starts at a fixed gutter
// so label-less continuation rows stay aligned with their group.
Item {
    id: root

    property var rowData: ({})
    property color foreground: Color.foreground
    property color accent: Color.accent
    property color urgent: Color.urgent
    property color surface: Color.popups.background

    signal copyRequested(string text)
    signal openRequested(string url)

    function activate() {
        if (rowData && rowData.url)
            openRequested(rowData.url);
        else if (rowData && rowData.value)
            copyRequested(rowData.value);
    }

    readonly property bool hasUrl: !!(rowData && rowData.url)
    readonly property bool isMuted: rowData && rowData.tone === "muted"
    readonly property bool isWarn: rowData && (rowData.tone === "warn" || rowData.tone === "err")
    readonly property color valueColor: root.isWarn ? root.urgent : root.foreground

    width: parent ? parent.width : 0
    height: Math.max(Style.space(22), Math.round(Style.space(4)) + 15)
    visible: !!rowData && rowData.value !== undefined

    // Hover tint behind everything.
    Rectangle {
        anchors.fill: parent
        radius: Style.cornerRadius
        color: mouse.containsMouse ? Style.hoverFillFor(root.foreground, root.accent, root.urgent) : "transparent"
    }

    // Label gutter: 8px inset + 138px label + 6px gap = the value column.
    Text {
        id: labelText
        anchors.left: parent.left
        anchors.leftMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(138)
        visible: rowData && rowData.label !== ""
        text: rowData ? rowData.label : ""
        color: Qt.darker(root.foreground, root.isMuted ? 1.25 : 1.5)
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
    }

    Text {
        id: valueText
        anchors.left: parent.left
        anchors.leftMargin: Style.space(152)
        anchors.right: actions.visible ? actionScrim.left : parent.right
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        text: rowData ? rowData.value : ""
        color: root.valueColor
        opacity: root.isMuted ? 0.7 : 1
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideMiddle
    }

    // Whole-row click target.
    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton
        cursorShape: root.hasUrl ? Qt.PointingHandCursor : Qt.IBeamCursor
        onClicked: root.activate()
    }

    // Action button, stacked above the row target so its hover works.
    Rectangle {
        id: actionScrim
        anchors.right: parent.right
        anchors.rightMargin: Style.space(1)
        anchors.verticalCenter: parent.verticalCenter
        width: actions.implicitWidth + Style.space(5)
        height: parent.height
        radius: Style.cornerRadius
        visible: actions.visible
        color: root.surface
        opacity: 0.94
    }

    Row {
        id: actions
        anchors.right: parent.right
        anchors.rightMargin: Style.space(2)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(1)
        visible: mouse.containsMouse

        PanelActionButton {
            anchors.verticalCenter: parent.verticalCenter
            iconText: root.hasUrl ? Glyphs.GLYPH_OPEN : Glyphs.GLYPH_COPY
            tooltipText: root.hasUrl ? "Open in browser" : "Copy value"
            foreground: root.foreground
            fontFamily: Style.font.family
            fontSize: Style.font.iconSmall
            onClicked: root.activate()
        }
    }
}
