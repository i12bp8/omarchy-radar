import QtQuick
import qs.Commons
import qs.Ui
import "ui/glyphs.js" as Glyphs

// RadarGroup - one lookup check, rendered as a card.
//
// Renders a live check from RadarEngine.checksModel: while the request is
// running the header carries a pulsing spinner; once it settles the header
// shows the outcome glyph and the parsed rows stream in below. Absent and
// failed checks collapse to their header plus explanation, so a big sweep
// reads as a stack of cards instead of a wall of "not found" text. Found
// checks stay expanded; any card can be collapsed or expanded by hand.
Rectangle {
    id: root

    property var check: ({}) // one entry of engine.checksModel
    property color foreground: Color.foreground
    property color accent: Color.accent
    property color urgent: Color.urgent
    property color surface: Color.popups.background
    signal copyRequested(string text)
    signal openRequested(string url)

    readonly property bool running: check.state === "running"
    readonly property bool isFound: check.state === "found"
    readonly property bool isNone: check.state === "none"
    readonly property bool isError: check.state === "error"
    readonly property bool isCanceled: check.state === "canceled"
    readonly property bool settleable: !root.running

    // Found and running cards are expanded; absent/failed cards collapse to
    // their header plus explanation (the note stays visible either way).
    // Cards settle exactly once, so the header is free to toggle afterwards.
    property bool expanded: true
    onCheckChanged: {
        root.expanded = root.isFound || root.running;
    }

    readonly property color headerColor: running || isFound || isNone ? foreground : (isError ? urgent : Qt.darker(foreground, 1.4))

    width: parent ? parent.width : 0
    height: column.implicitHeight + Style.space(10)
    radius: Style.cornerRadius > 0 ? Style.cornerRadius : 6
    color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.04)
    border.width: Style.spacing.hairline
    border.color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.1)

    Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.topMargin: Style.space(5)
        anchors.leftMargin: Style.space(4)
        anchors.rightMargin: Style.space(4)
        spacing: Style.space(1)

        // ---- header (click toggles the card)
        Item {
            width: parent.width
            height: Style.space(26)

            MouseArea {
                id: headerMouse
                anchors.fill: parent
                hoverEnabled: root.settleable
                cursorShape: root.settleable ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: root.expanded = !root.expanded
            }

            Item {
                id: headIcon
                anchors.left: parent.left
                anchors.leftMargin: Style.space(4)
                width: Style.space(18)
                height: parent.height

                Text {
                    anchors.centerIn: parent
                    visible: root.isFound
                    text: Glyphs.GLYPH_CHECK
                    color: root.accent
                    font.family: Style.font.family
                    font.pixelSize: Style.font.iconSmall
                }
                Rectangle {
                    anchors.centerIn: parent
                    visible: root.isNone
                    width: Style.space(5)
                    height: Style.space(5)
                    radius: width / 2
                    color: Qt.darker(root.foreground, 1.6)
                    opacity: 0.85
                }
                Text {
                    anchors.centerIn: parent
                    visible: root.isError
                    text: Glyphs.GLYPH_ALERT
                    color: root.urgent
                    font.family: Style.font.family
                    font.pixelSize: Style.font.iconSmall
                }
                Text {
                    anchors.centerIn: parent
                    visible: root.isCanceled
                    text: Glyphs.GLYPH_XMARK
                    color: Qt.darker(root.foreground, 1.6)
                    font.family: Style.font.family
                    font.pixelSize: Style.font.iconSmall
                }
                Text {
                    anchors.centerIn: parent
                    visible: root.running
                    text: Glyphs.GLYPH_SPINNER
                    color: Qt.darker(root.foreground, 1.4)
                    font.family: Style.font.family
                    font.pixelSize: Style.font.iconSmall
                    SequentialAnimation on opacity {
                        running: root.running
                        loops: Animation.Infinite
                        PropertyAnimation {
                            to: 0.35
                            duration: 500
                        }
                        PropertyAnimation {
                            to: 0.9
                            duration: 500
                        }
                    }
                }
            }

            Text {
                anchors.left: headIcon.right
                anchors.leftMargin: Style.space(6)
                anchors.right: hostLabel.left
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                text: check.label || ""
                color: root.headerColor
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
                font.bold: root.isFound
                opacity: root.isCanceled ? 0.6 : 1
                elide: Text.ElideRight
            }

            Text {
                id: hostLabel
                anchors.right: parent.right
                anchors.rightMargin: root.settleable ? Style.space(20) : Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                text: check.host || ""
                color: Qt.darker(root.foreground, 1.7)
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                opacity: 0.85
                elide: Text.ElideLeft
            }

            Text {
                anchors.right: parent.right
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                visible: root.settleable
                text: root.expanded ? Glyphs.GLYPH_CHEVRON_RIGHT : Glyphs.GLYPH_CHEVRON_RIGHT
                rotation: root.expanded ? 90 : 0
                color: Qt.darker(root.foreground, 1.9)
                font.family: Style.font.family
                font.pixelSize: Style.font.iconSmall
                Behavior on rotation {
                    NumberAnimation {
                        duration: 120
                    }
                }
            }
        }

        // ---- explanation for none / error / canceled states
        Text {
            visible: !root.running && !root.isFound && check.note !== ""
            anchors.left: parent.left
            anchors.leftMargin: Style.space(26)
            anchors.right: parent.right
            anchors.rightMargin: Style.space(8)
            text: check.note || ""
            color: root.isError ? Qt.darker(root.urgent, 1.1) : Qt.darker(root.foreground, 1.5)
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
            bottomPadding: Style.space(3)
        }

        // ---- rows (stream in live; collapsed cards hide them)
        Column {
            width: parent.width
            visible: root.expanded

            Repeater {
                model: check.rows || []

                RadarRow {
                    width: parent.width
                    rowData: modelData
                    foreground: root.foreground
                    accent: root.accent
                    urgent: root.urgent
                    surface: root.surface
                    onCopyRequested: root.copyRequested(text)
                    onOpenRequested: root.openRequested(url)
                }
            }

            // Breathing room at the card tail.
            Item {
                width: parent.width
                height: Style.space(4)
            }
        }
    }
}
