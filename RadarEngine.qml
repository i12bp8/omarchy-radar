import QtQuick
import "engine/engine.js" as Engine
import "engine/md5.js" as Md5Util

// RadarEngine - lookup host for the panel.
//
// Owns HTTP transport for one lookup: takes a classified target, fans the
// plan's checks out over XMLHttpRequest, and publishes per-check outcomes
// into checksModel as they land so the UI streams results instead of
// waiting for the slowest source.
//
// Transport is deliberately isolated here: every request goes through
// fetch() and parsing happens in engine.js, so swapping in another
// transport (or dropping a source) never touches the UI.
Item {
    id: root
    visible: false

    property bool busy: false
    property int totalChecks: 0
    property int doneChecks: 0
    property int foundChecks: 0
    property var checksModel: []

    signal resultsStreamed        // one check changed or finished
    signal lookupFinished         // all checks settled

    property var _active: []        // in-flight { index, request, source }
    property int _generation: 0
    property var _torList: ({
            text: "",
            at: 0
        })

    function timeoutMsFor(source) {
        // crt.sh is the one source that can genuinely take a while; the rest
        // are fast public JSON APIs that should answer in a couple of seconds.
        if (source === "ctLogs")
            return 20000;
        return 10000;
    }

    function startLookup(kind, value) {
        cancelAll();
        var generation = ++_generation;
        var checks = Engine.checksFor(kind, value, function (text) {
            return Md5Util.md5(text);
        });
        var model = [];
        for (var i = 0; i < checks.length; i++) {
            model.push({
                index: i,
                source: checks[i].source,
                label: checks[i].label,
                host: checks[i].host,
                state: "running",
                note: "",
                rows: []
            });
        }
        checksModel = model;
        totalChecks = model.length;
        doneChecks = 0;
        foundChecks = 0;
        busy = true;

        for (var c = 0; c < checks.length; c++) {
            var check = checks[c];
            if (generation !== _generation)
                break;
            var request = makeRequest(generation, c, check);
            if (request)
                _active.push({
                    index: c,
                    source: check.source,
                    request: request
                });
        }
        resultsStreamed();
    }

    function cancelAll() {
        _generation++;
        for (var i = 0; i < _active.length; i++) {
            try {
                _active[i].request.abort();
            } catch (e) { /* already dead */ }
        }
        _active = [];
        busy = false;
    }

    // User-facing stop: settle whatever is still pending as canceled so the
    // result view is left in a coherent state.
    function cancelRun() {
        if (!busy)
            return;
        _generation++;
        for (var i = 0; i < _active.length; i++) {
            try {
                _active[i].request.abort();
            } catch (e) { /* already dead */ }
        }
        _active = [];
        var model = [];
        for (var c = 0; c < checksModel.length; c++) {
            var item = checksModel[c];
            if (item.state === "running") {
                item = {
                    index: item.index,
                    source: item.source,
                    label: item.label,
                    host: item.host,
                    state: "canceled",
                    note: "Stopped.",
                    rows: []
                };
            }
            model.push(item);
        }
        checksModel = model;
        doneChecks = totalChecks;
        busy = false;
        resultsStreamed();
        lookupFinished();
    }

    function makeRequest(generation, index, check) {
        // The Tor exit list is one plain-text file refreshed upstream roughly
        // every hour; fetch it at most once per ten minutes per session.
        if (check.source === "torExit" && _torList.text !== "" && (Date.now() - _torList.at) < 10 * 60 * 1000) {
            settle(generation, index, check, 200, _torList.text, false);
            return null;
        }
        var xhr = new XMLHttpRequest();
        var settled = false;
        xhr.open("GET", check.url);
        xhr.timeout = timeoutMsFor(check.source);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE || settled)
                return;
            if (generation !== _generation)
                // superseded by a newer lookup
                return;
            settled = true;
            var body = String(xhr.responseText || "");
            if (check.source === "torExit" && xhr.status >= 200 && xhr.status < 300 && body !== "") {
                _torList.text = body;
                _torList.at = Date.now();
            }
            settle(generation, index, check, xhr.status, body, false, typeof xhr.getAllResponseHeaders === "function" ? String(xhr.getAllResponseHeaders() || "") : "");
        };
        xhr.ontimeout = function () {
            if (settled || generation !== _generation)
                return;
            settled = true;
            settle(generation, index, check, 0, "", true);
        };
        xhr.send();
        return xhr;
    }

    function settle(generation, index, check, status, body, timedOut, headersText) {
        var result;
        if (timedOut) {
            result = {
                state: "error",
                note: "The source took too long to answer.",
                rows: []
            };
        } else if (status === 0) {
            result = {
                state: "error",
                note: "Could not reach the source.",
                rows: []
            };
        } else {
            if (check.source === "webFp" && body.length > 65536)
                body = body.slice(0, 65536);
            var meta = {};
            for (var key in check.meta)
                meta[key] = check.meta[key];
            if (headersText !== undefined)
                meta.headers = headersText;
            result = Engine.parse(check.source, status, body, meta);
        }

        var model = [];
        for (var i = 0; i < checksModel.length; i++) {
            var item = checksModel[i];
            if (item.index === index) {
                item = {
                    index: item.index,
                    source: item.source,
                    label: item.label,
                    host: item.host,
                    state: result.state,
                    note: result.note || "",
                    rows: result.rows || []
                };
                if (result.state === "found")
                    foundChecks++;
            }
            model.push(item);
        }
        checksModel = model;
        doneChecks++;

        removeActive(index);
        resultsStreamed();
        if (generation === _generation && doneChecks >= totalChecks && _active.length === 0) {
            busy = false;
            lookupFinished();
        }
    }

    function removeActive(index) {
        var next = [];
        for (var i = 0; i < _active.length; i++) {
            if (_active[i].index !== index)
                next.push(_active[i]);
        }
        _active = next;
    }
}
