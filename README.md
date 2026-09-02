# Radar

An OSINT lookup widget for the Omarchy bar. Type a username, an email, an
IP address, or a domain; Radar sweeps several public sources in parallel
and shows you what is publicly attached to that target — in a few seconds,
from your machine, with no account and no API key.

![Radar sweep](assets/icon.svg)

## What it checks

The input is classified automatically (`@gossip`, `a@b.com`, `8.8.8.8`,
`example.org` — pasted URLs work too), then these sources are queried
concurrently:

| Target  | Sources |
|---------|---------|
| Username | GitHub, Codeberg, GitLab.com, Mastodon.social, Keybase, Chess.com, Docker Hub, Medium, Substack |
| Email    | Gravatar, mail-server (MX), SPF and DMARC policy via DNS-over-HTTPS |
| IP       | ipwho.is (geo/ASN/ISP), reverse DNS, RDAP network registry, Shodan InternetDB (exposed services), Tor exit list |
| Domain   | A / AAAA / MX / NS / TXT / CAA records, SPF + DMARC policy, RDAP registration, web fingerprint, crt.sh certificate-transparency subdomains |

Paste a profile or project link (github.com/user, chess.com/member/x, …) and
Radar figures out the username itself. Every sweep ends with one-click web
search links and a copy-as-report action.

Each check reports `found`, `absent`, or `error` with a plain-English
explanation, so a finished sweep is a transparent log of what was asked and
what came back. Values copy on click; URL rows open in your browser.

## Install

Requires Omarchy 4 (manifest schema 1) with Quickshell plugin support.

```bash
omarchy plugin add https://github.com/i12bp8/omarchy-radar.git --enable
```

Or from the marketplace page on <https://plugins.omarchy.org/> once listed.
Enable places the radar icon in the bar (right section by default); you can
move it with `omarchy bar move wolfs.radar --section left`.

Plugins run unsandboxed inside the long-lived shell with your user
permissions. Review and trust the source before enabling it.

## Use

1. Click the radar icon (or summon with `omarchy-shell shell summon wolfs.radar '{}'`).
2. Type a target and press Enter.
3. Click any value to copy it; click rows with a link to open them.
4. Enter a new target to run another sweep; recent lookups stay one click away.

The lookups themselves are read-only HTTP requests to the sources shown in
the UI. Nothing you query is stored online, and history never leaves this
machine (`~/.local/share/wolfs.radar/history.json`, plain JSON, removable
by deleting the file or using **clear history** in the panel).

Be sensible about who you point this at: these are public records, not
licenses to harass.

## Privacy and fair use

- No accounts, no keys, no telemetry, no bundled binaries.
- History is local-only, capped (default 8 entries, configurable via the
  widget's *historySize* setting) and written atomically.
- Public sources have rate limits: GitHub's anonymous API is 60
  requests/hour per IP; crt.sh throttles aggressively when busy. Radar
  caches nothing across runs yet, so repeated sweeps of the same target
  hit the sources again — space them out or the sources will do it for you.

## Development

```bash
tests/validate.sh          # manifest schema + engine unit tests + qmllint
omarchy plugin add "$PWD"  # load a working copy into the shell (dev)
```

Layout:

```
manifest.json      plugin contract (schema v1, kinds, entry points)
BarWidget.qml      bar button + popup host (shell IPC, open/close contract)
Panel.qml          the panel UI (search, sweep view, recents)
RadarGroup.qml     one check header + its findings
RadarRow.qml       one key/value row with copy/open actions
RadarEngine.qml    HTTP transport: fan-out, timeouts, cancellation
RadarHistory.qml   recent-lookup persistence (XDG data, atomic writes)
engine/            pure lookup logic (detection, plans, parsers)
ui/glyphs.js       icon glyph table (single source of truth)
tests/             node unit tests over recorded payloads; validate.sh
docs/              ARCHITECTURE.md (design decisions and evidence)
```

`engine/` is dependency-free JavaScript shared by QML and the node test
suite; the QML side never parses or plans anything itself. Adding a source
is one plan entry plus one parser in `engine/engine.js`.

## Publishing checklist

- [ ] `tests/validate.sh` passes on a machine with qmllint
- [ ] manifest id is not under the reserved `omarchy.*` namespace
- [ ] `manifest.json` at the repository root, README and LICENSE present
- [ ] tag releases as `vX.Y.Z`; keep `CHANGELOG.md` current

## License

MIT. Radar is an independent community project, not affiliated with or
endorsed by Omarchy, Basecamp, or 37signals.
