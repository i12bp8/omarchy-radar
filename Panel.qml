import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "engine/engine.js" as Engine
import "ui/glyphs.js" as Glyphs

// Panel.qml - the Radar lookup panel.
//
// One surface for everything the plugin does: type a target, watch the
// checks sweep, read the grouped findings. The panel is the popup of a
// bar-widget (host contract lives in BarWidget.qml); the UI here only
// talks to the engine's model through RadarEngine and RadarHistory —
// never to HTTP or parsing.
Panel {
    id: root
    moduleName: "wolfs.radar"
    ipcTarget: "wolfs.radar"
    manageIpc: false

    property var anchorItem: null
    property var hostWidget: null
    readonly property var barIdentity: hostWidget || root

    // ---- session state ------------------------------------------------------

    property var detected: ({
            kind: "unknown",
            value: "",
            hint: ""
        })
    property var currentTarget: null   // { kind, value } of the active lookup
    property bool hasResults: false
    property string hint: ""
    property string statusText: ""     // outcome summary of the finished sweep

    function tallies() {
        var found = 0, absent = 0, failed = 0, canceled = 0;
        var model = engine.checksModel;
        for (var i = 0; i < model.length; i++) {
            if (model[i].state === "found")
                found++;
            else if (model[i].state === "none")
                absent++;
            else if (model[i].state === "error")
                failed++;
            else if (model[i].state === "canceled")
                canceled++;
        }
        return {
            found: found,
            absent: absent,
            failed: failed,
            canceled: canceled,
            total: model.length
        };
    }

    function refreshStatus() {
        var t = root.tallies();
        var parts = [];
        if (t.found > 0)
            parts.push(t.found + " found");
        if (t.absent > 0)
            parts.push(t.absent + " absent");
        if (t.failed > 0)
            parts.push(t.failed + " failed");
        if (t.canceled > 0)
            parts.push("stopped");
        root.statusText = parts.length > 0 ? parts.join(" · ") : "no source answered";
    }

    function kindGlyph(kind) {
        return Glyphs.GLYPH_BY_KIND[kind] || Glyphs.GLYPH_SEARCH;
    }

    // ---- panel lifecycle ----------------------------------------------------

    function refresh() {
        history.reload();
    }

    function open() {
        root.hint = "";
        history.reload();
        root.refit();
        root.controller.show();
        Qt.callLater(function () {
            searchField.forceActiveFocus();
            searchField.selectAll();
        });
    }

    function close() {
        root.controller.hide();
    }

    function toggle() {
        if (root.opened)
            root.close();
        else
            root.open();
    }

    function switchPanel(direction) {
        if (root.bar && typeof root.bar.switchPanelFrom === "function")
            return root.bar.switchPanelFrom(root.barIdentity, direction);
        return false;
    }

    // ---- lookups ------------------------------------------------------------

    function submitCurrent() {
        var raw = searchField.text;
        // Enter during a run for the same target is a no-op; the Stop action
        // is the explicit way out. A different target starts a new sweep.
        if (engine.busy && currentTarget && raw.trim() === currentTarget.value)
            return;
        var det = Engine.detect(raw);
        root.detected = det;
        if (det.kind === "unknown") {
            root.hint = det.hint || "Enter a @username, email, IP address, or domain.";
            return;
        }
        root.hint = "";
        runLookup(det.kind, det.value);
    }

    function runLookup(kind, value) {
        currentTarget = {
            kind: kind,
            value: value
        };
        hasResults = true;
        engine.startLookup(kind, value);
        history.add(value, kind);
    }

    function rerunEntry(target, kind) {
        searchField.text = target;
        runLookup(kind, target);
    }

    function newLookup() {
        engine.cancelRun();
        currentTarget = null;
        hasResults = false;
        root.hint = "";
        Qt.callLater(function () {
            searchField.forceActiveFocus();
            searchField.selectAll();
        });
    }

    // ---- shared actions -----------------------------------------------------

    function openUrl(url) {
        var value = String(url || "");
        if (value.indexOf("http://") !== 0 && value.indexOf("https://") !== 0)
            return;
        Quickshell.execDetached(["xdg-open", value]);
    }

    function copyText(text, message) {
        var value = String(text || "");
        if (value === "")
            return;
        Quickshell.execDetached(["bash", "-c", "printf %s " + Util.shellQuote(value) + " | wl-copy"]);
        showToast(message || "Copied to clipboard");
    }

    function copyReport() {
        if (!currentTarget)
            return;
        var md = Engine.reportMarkdown(currentTarget.kind, currentTarget.value, engine.checksModel, new Date().toISOString());
        copyText(md, "Report copied");
    }

    function showToast(message) {
        toastLabel.text = message;
        toast.opacity = 1;
        toastTimer.restart();
    }

    // ---- managed sizing ------------------------------------------------------
    // The implicit-height change notifications from nested columns are not
    // reliable enough to drive popup geometry, so sizes are recomputed
    // explicitly after every model change instead of through bindings.
    function refit() {
        Qt.callLater(function () {
            var res = Math.min(Style.space(760), Math.max(Style.space(90), resultsColumn.implicitHeight));
            var rec = Math.min(Style.space(760), Math.max(Style.space(90), recentsColumn.implicitHeight));
            resultsFlick.height = res;
            recentsFlick.height = rec;
            resultsFlick.contentHeight = resultsColumn.implicitHeight;
            recentsFlick.contentHeight = recentsColumn.implicitHeight;
            bodyItem.height = root.hasResults ? res : rec;
            // Second pass: the popup height must reflect the body just set.
            Qt.callLater(function () {
                panel.contentHeight = panel.fittedContentHeight(contentColumn.implicitHeight);
            });
        });
    }

    // ---- palette ------------------------------------------------------------

    readonly property color contentForeground: bar ? bar.barForeground : Color.foreground
    readonly property color contentAccent: bar ? (bar.accent || Color.accent) : Color.accent
    readonly property color contentUrgent: bar ? (bar.urgent || Color.urgent) : Color.urgent
    readonly property color surface: Color.popups.background
    readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

    // ---- services -----------------------------------------------------------

    RadarHistory {
        id: history
        visible: false
        onEntriesChanged: root.refit()
        historySize: {
            var size = Number(root.settings && root.settings.historySize);
            return isFinite(size) && size > 0 ? size : 8;
        }
    }

    RadarEngine {
        id: engine
        visible: false
        onResultsStreamed: {
            if (!engine.busy)
                root.refreshStatus();
            root.refit();
        }
        onLookupFinished: {
            root.refreshStatus();
            root.refit();
        }
    }

    Timer {
        id: toastTimer
        interval: 1500
        onTriggered: toast.opacity = 0
    }

    // ---- keyboard + surface -------------------------------------------------

    RadarOverlay {
        id: panel
        anchorItem: root.anchorItem
        owner: root
        bar: root.bar
        open: root.opened
        focusTarget: keyCatcher
        contentWidth: panel.fittedContentWidth(Style.space(640))
        contentHeight: Style.space(320)

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent
            blocked: searchField.activeFocus

            onCloseRequested: root.close()
            onTabRequested: function (direction) {
                root.switchPanel(direction);
            }
            onReturnRequested: root.submitCurrent()

            Column {
                id: contentColumn
                width: parent.width
                spacing: Style.space(10)

                // ---- header line
                Item {
                    width: parent.width
                    height: Style.space(24)

                    Text {
                        id: markText
                        anchors.verticalCenter: parent.verticalCenter
                        text: Glyphs.GLYPH_RADAR
                        color: root.contentAccent
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.subtitle
                    }

                    Text {
                        id: nameText
                        anchors.left: markText.right
                        anchors.leftMargin: Style.space(8)
                        anchors.verticalCenter: parent.verticalCenter
                        text: "RADAR"
                        color: root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.bodySmall
                        font.letterSpacing: 2
                        font.bold: true
                    }

                    Text {
                        anchors.left: nameText.right
                        anchors.leftMargin: Style.space(10)
                        anchors.right: closeButton.left
                        anchors.rightMargin: Style.space(10)
                        anchors.verticalCenter: parent.verticalCenter
                        text: root.currentTarget ? Engine.kindLabel(root.currentTarget.kind) + " · " + root.currentTarget.value : "look up a person, an email, an IP, or a domain"
                        color: Qt.darker(root.contentForeground, 1.5)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideMiddle
                    }

                    PanelActionButton {
                        id: closeButton
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        iconText: Glyphs.GLYPH_CLOSE
                        tooltipText: "Close"
                        foreground: root.contentForeground
                        fontFamily: root.contentFontFamily
                        onClicked: root.close()
                    }
                }

                // ---- search row
                Row {
                    id: searchRow
                    width: parent.width
                    height: Style.space(38)
                    spacing: Style.space(8)

                    Item {
                        id: kindBox
                        width: Style.space(34)
                        height: parent.height

                        Rectangle {
                            anchors.fill: parent
                            radius: Style.cornerRadius
                            color: Style.controlFill(searchField.activeFocus, false, root.contentForeground, root.contentAccent)
                            border.width: Style.spacing.hairline
                            border.color: Qt.darker(root.contentForeground, 1.6)
                        }

                        Text {
                            anchors.centerIn: parent
                            text: root.detected.kind !== "unknown" ? root.kindGlyph(root.detected.kind) : Glyphs.GLYPH_SEARCH
                            color: root.detected.kind !== "unknown" ? root.contentAccent : Qt.darker(root.contentForeground, 1.6)
                            font.family: root.contentFontFamily
                            font.pixelSize: Style.font.body
                        }
                    }

                    TextField {
                        id: searchField
                        width: searchRow.width - kindBox.width - goButton.width - searchRow.spacing * 2
                        height: parent.height
                        verticalPadding: 0
                        placeholderText: "@username, email, IP, or domain"
                        foreground: root.contentForeground
                        accent: root.contentAccent
                        font.pixelSize: Style.font.subtitle
                        selectByMouse: true

                        Keys.onPressed: function (event) {
                            if (event.key === Qt.Key_Escape) {
                                root.close();
                                event.accepted = true;
                            }
                        }

                        onAccepted: root.submitCurrent()
                        onTextChanged: {
                            root.detected = Engine.detect(text);
                            root.hint = "";
                        }
                    }

                    Item {
                        id: goButton
                        width: Style.space(40)
                        height: parent.height

                        Rectangle {
                            anchors.fill: parent
                            radius: Style.cornerRadius
                            color: goMouse.containsMouse ? Style.selectedFillFor(root.contentForeground, root.contentAccent, root.contentUrgent) : Style.controlFill(false, false, root.contentForeground, root.contentAccent)
                        }

                        Text {
                            anchors.centerIn: parent
                            text: Glyphs.GLYPH_MAGNIFY
                            color: root.contentForeground
                            font.family: root.contentFontFamily
                            font.pixelSize: Style.font.body
                        }

                        MouseArea {
                            id: goMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.submitCurrent()
                        }
                    }
                }

                // ---- status / hint line
                Text {
                    width: parent.width
                    visible: root.currentTarget !== null || root.hint !== ""
                    text: root.hint !== "" ? root.hint : (engine.busy ? "Checking " + engine.doneChecks + " of " + engine.totalChecks + " sources…" : "Checked " + engine.totalChecks + " sources · " + root.statusText)
                    color: root.hint !== "" ? root.contentUrgent : Qt.darker(root.contentForeground, 1.5)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                    elide: Text.ElideRight
                }

                Rectangle {
                    width: parent.width
                    height: Style.spacing.hairline
                    color: root.contentForeground
                    opacity: 0.08
                }

                // ---- body: sweep results, or the start view with recents.
                // Two independent viewports; the inactive one collapses to zero
                // height so the panel sizes to whichever screen is live.
                Item {
                    id: bodyItem
                    width: parent.width

                    Flickable {
                        id: resultsFlick
                        visible: root.hasResults
                        anchors.fill: parent
                        clip: true
                        interactive: contentHeight > height
                        boundsBehavior: Flickable.StopAtBounds

                        Column {
                            id: resultsColumn
                            width: parent.width
                            spacing: Style.space(4)

                            Row {
                                width: parent.width
                                visible: engine.busy
                                height: Style.space(26)
                                spacing: Style.space(8)

                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "Sweeping " + engine.totalChecks + " sources…"
                                    color: Qt.darker(root.contentForeground, 1.5)
                                    font.family: root.contentFontFamily
                                    font.pixelSize: Style.font.bodySmall
                                    font.italic: true
                                }

                                PanelActionButton {
                                    anchors.verticalCenter: parent.verticalCenter
                                    iconText: Glyphs.GLYPH_XMARK
                                    tooltipText: "Stop sweep"
                                    foreground: root.contentUrgent
                                    fontFamily: root.contentFontFamily
                                    onClicked: engine.cancelRun()
                                }
                            }

                            Repeater {
                                model: engine.checksModel

                                RadarGroup {
                                    width: parent.width
                                    check: modelData
                                    foreground: root.contentForeground
                                    accent: root.contentAccent
                                    urgent: root.contentUrgent
                                    onCopyRequested: function (text) {
                                        root.copyText(text);
                                    }
                                    onOpenRequested: function (url) {
                                        root.openUrl(url);
                                    }
                                }
                            }

                            WebSearchCard {
                                width: parent.width
                                visible: !engine.busy
                                kind: root.currentTarget ? root.currentTarget.kind : ""
                                value: root.currentTarget ? root.currentTarget.value : ""
                                foreground: root.contentForeground
                                accent: root.contentAccent
                                urgent: root.contentUrgent
                                surface: root.surface
                                onOpenRequested: function (url) {
                                    root.openUrl(url);
                                }
                            }
                        }
                    }

                    Flickable {
                        id: recentsFlick
                        visible: !root.hasResults
                        anchors.fill: parent
                        clip: true
                        interactive: contentHeight > height
                        boundsBehavior: Flickable.StopAtBounds

                        Column {
                            id: recentsColumn
                            width: parent.width
                            spacing: Style.space(8)

                            Column {
                                width: parent.width
                                spacing: Style.space(6)
                                visible: history.entries.length === 0

                                Text {
                                    width: parent.width
                                    text: "Radar finds the public footprint of a username, an email, an IP address, or a domain — in a few seconds, from your machine, with no account or API key."
                                    color: Qt.darker(root.contentForeground, 1.2)
                                    font.family: root.contentFontFamily
                                    font.pixelSize: Style.font.body
                                    wrapMode: Text.WordWrap
                                }

                                Text {
                                    width: parent.width
                                    text: "Try one:"
                                    color: Qt.darker(root.contentForeground, 1.7)
                                    font.family: root.contentFontFamily
                                    font.pixelSize: Style.font.bodySmall
                                }

                                Flow {
                                    width: parent.width
                                    spacing: Style.space(6)

                                    Repeater {
                                        model: [
                                            {
                                                target: "@torvalds",
                                                kind: "username"
                                            },
                                            {
                                                target: "someone@example.com",
                                                kind: "email"
                                            },
                                            {
                                                target: "8.8.8.8",
                                                kind: "ip"
                                            },
                                            {
                                                target: "example.org",
                                                kind: "domain"
                                            }
                                        ]

                                        Rectangle {
                                            required property var modelData
                                            width: sampleText.implicitWidth + Style.space(14)
                                            height: Style.space(22)
                                            radius: Style.cornerRadius > 0 ? Style.cornerRadius : 5
                                            color: sampleMouse.containsMouse ? Style.hoverFillFor(root.contentForeground, root.contentAccent, root.contentUrgent) : Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.05)
                                            border.width: sampleMouse.containsMouse ? Style.spacing.hairline : 0
                                            border.color: Qt.darker(root.contentForeground, 1.7)

                                            Text {
                                                id: sampleText
                                                anchors.centerIn: parent
                                                text: modelData.target
                                                color: sampleMouse.containsMouse ? root.contentForeground : Qt.darker(root.contentForeground, 1.4)
                                                font.family: root.contentFontFamily
                                                font.pixelSize: Style.font.bodySmall
                                            }

                                            MouseArea {
                                                id: sampleMouse
                                                anchors.fill: parent
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                onClicked: root.rerunEntry(modelData.target, modelData.kind)
                                            }
                                        }
                                    }
                                }
                            }

                            Item {
                                width: parent.width
                                visible: history.entries.length > 0
                                height: Style.space(22)

                                Text {
                                    anchors.left: parent.left
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "RECENT LOOKUPS"
                                    color: Qt.darker(root.contentForeground, 1.5)
                                    font.family: root.contentFontFamily
                                    font.pixelSize: Style.font.caption
                                    font.letterSpacing: 1.5
                                    font.bold: true
                                }

                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.right: parent.right
                                    text: "clear history"
                                    color: clearHover.containsMouse ? root.contentForeground : Qt.darker(root.contentForeground, 1.7)
                                    font.family: root.contentFontFamily
                                    font.pixelSize: Style.font.caption

                                    MouseArea {
                                        id: clearHover
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: history.clear()
                                    }
                                }
                            }

                            Repeater {
                                model: history.entries

                                Item {
                                    required property var modelData
                                    width: recentsColumn.width
                                    height: Style.space(30)

                                    Rectangle {
                                        anchors.fill: parent
                                        radius: Style.cornerRadius
                                        color: recentHover.containsMouse ? Style.hoverFillFor(root.contentForeground, root.contentAccent, root.contentUrgent) : "transparent"
                                    }

                                    Text {
                                        anchors.left: parent.left
                                        anchors.leftMargin: Style.space(12)
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: root.kindGlyph(modelData.kind)
                                        color: Qt.darker(root.contentForeground, 1.4)
                                        font.family: root.contentFontFamily
                                        font.pixelSize: Style.font.body
                                    }

                                    Text {
                                        anchors.left: parent.left
                                        anchors.leftMargin: Style.space(38)
                                        anchors.right: parent.right
                                        anchors.rightMargin: Style.space(34)
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: modelData.target
                                        color: root.contentForeground
                                        font.family: root.contentFontFamily
                                        font.pixelSize: Style.font.body
                                        elide: Text.ElideMiddle
                                    }

                                    Text {
                                        anchors.right: parent.right
                                        anchors.rightMargin: Style.space(44)
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: Engine.kindLabel(modelData.kind).toLowerCase()
                                        color: Qt.darker(root.contentForeground, 1.7)
                                        font.family: root.contentFontFamily
                                        font.pixelSize: Style.font.caption
                                    }

                                    MouseArea {
                                        id: recentHover
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: root.rerunEntry(modelData.target, modelData.kind)
                                    }

                                    PanelActionButton {
                                        anchors.right: parent.right
                                        anchors.rightMargin: Style.space(6)
                                        anchors.verticalCenter: parent.verticalCenter
                                        iconText: Glyphs.GLYPH_XMARK
                                        tooltipText: "Remove from history"
                                        foreground: Qt.darker(root.contentForeground, 1.6)
                                        fontFamily: root.contentFontFamily
                                        fontSize: Style.font.iconSmall
                                        visible: recentHover.containsMouse
                                        onClicked: history.removeAt(modelData.target, modelData.kind)
                                    }
                                }
                            }
                        }
                    }

                    // ---- slim scroll indicators (over the flick viewports)
                    Rectangle {
                        id: resultsTrack
                        visible: root.hasResults && resultsFlick.contentHeight > resultsFlick.height + 4
                        anchors.top: resultsFlick.top
                        anchors.bottom: resultsFlick.bottom
                        anchors.right: resultsFlick.right
                        anchors.rightMargin: Style.space(1)
                        width: Style.space(3)
                        radius: width / 2
                        color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.1)

                        Rectangle {
                            width: parent.width
                            radius: width / 2
                            color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.55)
                            height: Math.max(Style.space(18), resultsFlick.height * Math.min(1, resultsFlick.height / Math.max(1, resultsFlick.contentHeight)))
                            y: Math.max(0, Math.min(parent.height - height, (parent.height - height) * (resultsFlick.contentY / Math.max(1, resultsFlick.contentHeight - resultsFlick.height))))
                        }
                    }

                    Rectangle {
                        id: recentsTrack
                        visible: !root.hasResults && recentsFlick.contentHeight > recentsFlick.height + 4
                        anchors.top: recentsFlick.top
                        anchors.bottom: recentsFlick.bottom
                        anchors.right: recentsFlick.right
                        anchors.rightMargin: Style.space(1)
                        width: Style.space(3)
                        radius: width / 2
                        color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.1)

                        Rectangle {
                            width: parent.width
                            radius: width / 2
                            color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.55)
                            height: Math.max(Style.space(18), recentsFlick.height * Math.min(1, recentsFlick.height / Math.max(1, recentsFlick.contentHeight)))
                            y: Math.max(0, Math.min(parent.height - height, (parent.height - height) * (recentsFlick.contentY / Math.max(1, recentsFlick.contentHeight - recentsFlick.height))))
                        }
                    }
                }

                // ---- footer
                Item {
                    id: footerRow
                    width: parent.width
                    height: Style.space(20)

                    Row {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        visible: root.hasResults
                        spacing: Style.space(14)

                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "copy report"
                            color: reportHover.containsMouse ? root.contentForeground : Qt.darker(root.contentForeground, 1.6)
                            font.family: root.contentFontFamily
                            font.pixelSize: Style.font.caption
                            font.underline: reportHover.containsMouse

                            MouseArea {
                                id: reportHover
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.copyReport()
                            }
                        }

                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "new lookup"
                            color: newHover.containsMouse ? root.contentForeground : Qt.darker(root.contentForeground, 1.6)
                            font.family: root.contentFontFamily
                            font.pixelSize: Style.font.caption
                            font.underline: newHover.containsMouse

                            MouseArea {
                                id: newHover
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.newLookup()
                            }
                        }
                    }

                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.right: parent.right
                        text: "queries go to the public sources shown · nothing is stored online"
                        color: Qt.darker(root.contentForeground, 1.9)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                    }
                }
            }

            // ---- copy feedback toast, centered over the content's tail
            Item {
                id: toast
                anchors.bottom: parent.bottom
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottomMargin: Style.space(6)
                width: toastLabel.implicitWidth + Style.space(30)
                height: toastLabel.implicitHeight + Style.space(8)
                opacity: 0

                Behavior on opacity {
                    NumberAnimation {
                        duration: 140
                    }
                }

                Rectangle {
                    anchors.fill: parent
                    radius: Style.cornerRadius
                    color: Qt.darker(root.surface, 1.4)
                    border.width: Style.spacing.hairline
                    border.color: Qt.darker(root.contentForeground, 1.8)
                }

                Text {
                    id: toastLabel
                    anchors.centerIn: parent
                    text: ""
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                }
            }
        }
    }
}
