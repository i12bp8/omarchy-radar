import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "ui/glyphs.js" as Glyphs

// BarWidget.qml - the Radar bar button and popup host.
//
// Contract with the shell (mirrors the built-in clock plugin): the widget
// root exposes open/close/opened so bar popout routing and
// `omarchy-shell shell summon wolfs.radar` can drive the panel, and the
// panel is loaded lazily through a Loader and injected with the bar
// context (bar, settings, anchor button) once ready.
BarWidget {
    id: root
    moduleName: "wolfs.radar"

    readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
    readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

    function open() {
        if (panelLoader.item)
            panelLoader.item.open();
    }

    function close() {
        if (panelLoader.item)
            panelLoader.item.close();
    }

    function toggle() {
        if (panelLoader.item)
            panelLoader.item.toggle();
    }

    function closeForPopoutSwitch() {
        if (panelLoader.item)
            panelLoader.item.closeForPopoutSwitch();
    }

    function refresh() {
        if (panelLoader.item && panelLoader.item.refresh)
            panelLoader.item.refresh();
    }

    function injectPanel() {
        var target = panelLoader.item;
        if (!target)
            return;
        if ("bar" in target)
            target.bar = root.bar;
        if ("settings" in target)
            target.settings = root.settings;
        if ("anchorItem" in target)
            target.anchorItem = button;
        if ("hostWidget" in target)
            target.hostWidget = root;
    }

    // Open-panel indicator dot, sized like the icon widgets' mark.
    readonly property real openPanelIndicatorWidth: Style.space(6)
    readonly property real openPanelIndicatorHeight: Math.max(Style.space(2), Math.round(Style.bar.iconSlot * 0.2))

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    onBarChanged: injectPanel()
    onSettingsChanged: injectPanel()

    Loader {
        id: panelLoader
        active: true
        source: Qt.resolvedUrl("Panel.qml")
        visible: false
        onLoaded: {
            root.injectPanel();
            Qt.callLater(root.injectPanel);
        }
    }

    IpcHandler {
        target: "wolfs.radar"

        function refresh(): void {
            root.broadcast("refresh");
        }
        function open(): void {
            root.open();
        }
        function close(): void {
            root.close();
        }
        function show(): void {
            root.open();
        }
        function hide(): void {
            root.close();
        }
        function toggle(): void {
            root.toggle();
        }
    }

    BarIconButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: Glyphs.GLYPH_RADAR
        tooltipText: "Radar — OSINT lookups"
        onPressed: function (buttonCode) {
            if (buttonCode === Qt.LeftButton)
                root.toggle();
            else if (buttonCode === Qt.RightButton)
                root.open();
        }
    }
}
