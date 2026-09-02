import QtQuick
import qs.Commons

// WebSearchCard - "take this elsewhere" links for the current target.
//
// A lookup answers the keyless sources; the web is where the long tail
// lives. One card at the foot of the results offers the target as a query
// to four engines, opened in the user's browser — nothing is scraped here.
Rectangle {
    id: root

    property string kind: ""
    property string value: ""
    property color foreground: Color.foreground
    property color accent: Color.accent
    property color urgent: Color.urgent
    property color surface: Color.popups.background

    signal openRequested(string url)

    function query() {
        // Quoting keeps engines from splitting handles and addresses.
        return '"' + String(root.value) + '"';
    }

    function engineUrl(name) {
        var q = encodeURIComponent(root.query());
        if (name === "DuckDuckGo")
            return "https://duckduckgo.com/?q=" + q;
        if (name === "Google")
            return "https://www.google.com/search?q=" + q;
        if (name === "Bing")
            return "https://www.bing.com/search?q=" + q;
        return "https://www.startpage.com/sp/search?query=" + q; // Startpage
    }

    readonly property var engines: ["DuckDuckGo", "Google", "Bing", "Startpage"]

    width: parent ? parent.width : 0
    height: column.implicitHeight + Style.space(8)
    radius: Style.cornerRadius > 0 ? Style.cornerRadius : 6
    color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.03)
    border.width: Style.spacing.hairline
    border.color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.08)

    Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.topMargin: Style.space(4)
        anchors.leftMargin: Style.space(8)
        anchors.rightMargin: Style.space(8)
        spacing: Style.space(5)

        Text {
            text: "SEARCH THE WEB"
            color: Qt.darker(root.foreground, 1.6)
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            font.letterSpacing: 1.5
            font.bold: true
        }

        Text {
            width: parent.width
            text: "Deeper results for \u201c" + root.value + "\u201d open in your browser."
            color: Qt.darker(root.foreground, 1.8)
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
        }

        Flow {
            width: parent.width
            spacing: Style.space(6)

            Repeater {
                model: root.engines

                Rectangle {
                    required property string modelData
                    width: chipText.implicitWidth + Style.space(16)
                    height: Style.space(22)
                    radius: Style.cornerRadius > 0 ? Style.cornerRadius : 5
                    color: chipMouse.containsMouse ? Style.hoverFillFor(root.foreground, root.accent, root.urgent) : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.05)
                    border.width: chipMouse.containsMouse ? Style.spacing.hairline : 0
                    border.color: Qt.darker(root.foreground, 1.7)

                    Text {
                        id: chipText
                        anchors.centerIn: parent
                        text: modelData
                        color: chipMouse.containsMouse ? root.foreground : Qt.darker(root.foreground, 1.35)
                        font.family: Style.font.family
                        font.pixelSize: Style.font.bodySmall
                    }

                    MouseArea {
                        id: chipMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.openRequested(root.engineUrl(modelData))
                    }
                }
            }
        }
    }
}
