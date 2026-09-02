import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui

// RadarOverlay - a centered, full-screen popup surface for the panel.
//
// Replaces the bar-anchored KeyboardPanel: the card floats in the middle
// of the screen instead of hanging off the bar, with the same outside-
// click dismissal, Escape-through-focus, and keyboard-focus priming that
// the shell's own popups use. The window claims pointer input only while
// it is open; clicking the bar closes it (clicking the radar button again
// reopens it).
PanelWindow {
    id: root

    required property Item anchorItem
    required property QtObject bar
    property Item focusTarget: null
    // The widget/panel that owns this surface. Outside-click dismissal goes
    // through owner.close() so the `open` binding survives; assigning to a
    // bound property from JS would silently drop the binding and strand the
    // popup closed forever.
    property QtObject owner: null

    property int margin: Style.gapsOut
    property int padding: Style.spacing.popupPadding
    property int contentWidth: Style.space(620)
    property int contentHeight: Style.space(480)
    property var borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
    property bool open: false
    property bool focusPrimed: false

    default property alias contentItem: contentHolder.children

    readonly property var anchorWindow: anchorItem ? anchorItem.QsWindow.window : null
    readonly property real screenW: screen ? screen.width : 0
    readonly property real screenH: screen ? screen.height : 0
    readonly property real availableCardWidth: screenW > 0 ? Math.max(120, screenW - margin * 2) : 0
    readonly property real availableCardHeight: screenH > 0 ? Math.max(120, screenH - margin * 2) : 0
    readonly property real verticalContentInset: padding * 2 + Border.top(borderSpec) + Border.bottom(borderSpec)

    function fittedContentWidth(width, cap) {
        var desired = Math.max(1, Number(width) || 1);
        var maxWidth = root.availableCardWidth > 0 ? root.availableCardWidth : desired;
        if (cap !== undefined && Number(cap) > 0)
            maxWidth = Math.min(maxWidth, Number(cap));
        return Math.round(Math.min(desired, maxWidth));
    }

    function fittedContentHeight(implicitHeight, cap) {
        var desired = Math.max(root.verticalContentInset, (Number(implicitHeight) || 0) + root.verticalContentInset);
        var maxHeight = root.availableCardHeight > 0 ? root.availableCardHeight : desired;
        if (cap !== undefined && Number(cap) > 0)
            maxHeight = Math.min(maxHeight, Number(cap));
        return Math.round(Math.min(desired, maxHeight));
    }

    // Screen-centered card origin (the whole point of this surface).
    readonly property point cardOrigin: {
        var x = Math.round((root.screenW - root.contentWidth) / 2);
        var y = Math.round((root.screenH - root.contentHeight) / 2);
        x = Math.max(root.margin, Math.min(x, root.screenW - root.contentWidth - root.margin));
        y = Math.max(root.margin, Math.min(y, root.screenH - root.contentHeight - root.margin));
        return Qt.point(x, y);
    }

    screen: anchorWindow ? anchorWindow.screen : null
    visible: open || card.opacity > 0
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore

    WlrLayershell.namespace: "omarchy-radar"
    WlrLayershell.layer: WlrLayer.Overlay
    // Prime with Exclusive on every open, then settle on OnDemand (see the
    // KeyboardPanel notes for why the brief prime matters).
    WlrLayershell.keyboardFocus: open ? (focusPrimed ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive) : WlrKeyboardFocus.None

    anchors {
        top: true
        bottom: true
        left: true
        right: true
    }

    mask: Region {
        width: root.open ? root.width : 0
        height: root.open ? root.height : 0
    }

    onOpenChanged: {
        if (root.open) {
            focusPrimed = false;
            beginFocusPrime();
            if (focusTarget)
                Qt.callLater(function () {
                    if (root.open && root.focusTarget)
                        root.focusTarget.forceActiveFocus();
                });
        } else {
            focusPrimeTimer.stop();
            focusPrimed = false;
        }
    }

    onBackingWindowVisibleChanged: beginFocusPrime()

    function beginFocusPrime() {
        if (open && backingWindowVisible)
            focusPrimeTimer.restart();
    }

    Timer {
        id: focusPrimeTimer
        interval: 75
        onTriggered: if (root.open)
            root.focusPrimed = true
    }

    // Outside-click dismissal.
    MouseArea {
        anchors.fill: parent
        enabled: root.open
        acceptedButtons: Qt.AllButtons
        onClicked: {
            if (root.owner && typeof root.owner.close === "function")
                root.owner.close();
            else
                root.open = false;
        }
    }

    // The card itself.
    BorderSurface {
        id: card
        x: root.cardOrigin.x
        y: root.cardOrigin.y
        width: root.contentWidth
        height: root.contentHeight
        color: Color.popups.background
        borderSpec: root.borderSpec
        padding: root.padding
        radius: Style.cornerRadius
        opacity: root.open ? 1.0 : 0

        Behavior on opacity {
            NumberAnimation {
                duration: 140
                easing.type: Easing.OutCubic
            }
        }

        // Swallow clicks on the card.
        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.AllButtons
        }

        Item {
            id: contentHolder
            anchors.fill: parent
            anchors.topMargin: card.contentTopInset
            anchors.rightMargin: card.contentRightInset
            anchors.bottomMargin: card.contentBottomInset
            anchors.leftMargin: card.contentLeftInset
        }
    }
}
