import QtQuick
import Quickshell
import Quickshell.Io

// RadarHistory - recent lookups, persisted under XDG data.
//
// State lives outside the plugin folder on purpose: history survives
// plugin updates, and uninstalling the plugin leaves a plain JSON file
// behind (documented in the README) instead of losing data or touching
// Omarchy's own config.

Item {
    id: root
    visible: false

    property int historySize: 8
    property var entries: []     // newest first: [{ target, kind, at }]
    signal loaded

    readonly property string home: Quickshell.env("HOME") || ""
    readonly property string dataHome: Quickshell.env("XDG_DATA_HOME") || home + "/.local/share"
    readonly property string dataDir: dataHome + "/wolfs.radar"
    readonly property string statePath: dataDir + "/history.json"

    property bool _dirReady: false

    function reload() {
        if (_dirReady)
            stateFile.reload();
        else
            ensureDirProcess.running = true;
    }

    function normalizedEntry(target, kind) {
        var text = String(target || "").trim();
        if (text === "")
            return null;
        return {
            target: text,
            kind: kind,
            at: new Date().toISOString()
        };
    }

    function add(target, kind) {
        var entry = normalizedEntry(target, kind);
        if (!entry)
            return;
        var next = [];
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].target === entry.target && entries[i].kind === entry.kind)
                continue;
            next.push(entries[i]);
        }
        next.unshift(entry);
        if (next.length > Math.max(1, historySize))
            next = next.slice(0, Math.max(1, historySize));
        entries = next;
        persist();
    }

    function removeAt(target, kind) {
        var next = [];
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].target === target && entries[i].kind === kind)
                continue;
            next.push(entries[i]);
        }
        entries = next;
        persist();
    }

    function clear() {
        entries = [];
        persist();
    }

    function persist() {
        stateFile.setText(JSON.stringify({
            version: 1,
            entries: entries
        }, null, 2) + "\n");
    }

    function applyText(raw) {
        _dirReady = true;
        try {
            var parsed = JSON.parse(String(raw || ""));
            if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
                var next = [];
                for (var i = 0; i < parsed.entries.length; i++) {
                    var entry = normalizedEntry(parsed.entries[i].target, parsed.entries[i].kind);
                    if (entry)
                        next.push(entry);
                }
                entries = next;
                loaded();
                return;
            }
        } catch (e) { /* malformed history is discarded, never fatal */ }
        entries = [];
        loaded();
    }

    Process {
        id: ensureDirProcess
        command: ["mkdir", "-p", root.dataDir]
        onExited: stateFile.reload()
    }

    FileView {
        id: stateFile
        path: root.statePath
        watchChanges: false
        atomicWrites: true
        printErrors: false
        onLoaded: root.applyText(text())
        onLoadFailed: root.applyText("")
        onFileChanged: reload()
    }
}
