# Architecture

Radar is a bar-widget plugin for Omarchy 4 (Quickshell). This document
explains the pieces, the contracts they honor, and the decisions that got
made along the way — including one that was deliberately reversed.

## Runtime contract

The shell loads `manifest.json` (schema v1) and instantiates
`entryPoints.barWidget` (`BarWidget.qml`) per bar surface. Third-party ids
must not use the reserved `omarchy.*` namespace; folders must not contain
symlinks. `omarchy plugin validate` mirrors the registry checks.

- `BarWidget.qml` — widget root. Exposes the `open/close/opened` shape the
  bar's popout coordinator and `omarchy-shell shell summon/hide` routes on,
  plus an `IpcHandler` for the `wolfs.radar` target. The panel is loaded
  through a `Loader` and *injected* with `bar`, `settings`, `anchorItem`,
  and `hostWidget` (same pattern as the built-in clock plugin).
- `Panel.qml` — one `Panel`-derived popup per monitor, anchored with
  `KeyboardPanel` to the button (centered on the bar). Focus enters the
  search field on open; `PanelKeyCatcher` is blocked while the field has
  focus so typing works, and unblocked keys (Esc/Tab/Enter) keep their
  panel meanings.
- Radar is not a `service`, so it consumes nothing while closed except the
  QML of the two loaded files. All HTTP happens only during a sweep, all
  state lives in the panel instance, and `keepLoaded` is not set.

## Layering

```
engine/engine.js        pure: detection, plan building, response parsing
RadarEngine.qml         transport: XHR fan-out, per-source timeouts, cancel
engine/md5.js           gravatar hash (QML has no crypto API)
RadarHistory.qml        local history persistence (FileView, atomic writes)
RadarRow/Group.qml      stateless rendering of the result model
Panel.qml               state machine + actions (copy/open/toast)
```

The engine files are plain ES5 JavaScript with no QML imports and no I/O:
node imports them for the unit suite, QML imports them by path. Responses
recorded from the live endpoints on 2026-09-02 live in `tests/fixtures/`
and pin the parsers to real payload shapes — a source changing its schema
shows up as a test failure, not a mystery in the UI.

The transport is deliberately thin and contained in one file. Every check
is `GET` + JSON; timeouts are per source (10 s, 20 s for crt.sh); a lookup
is one generation, and stale callbacks are discarded by generation guard
rather than by race-prone shared state.

## Result model

A check produces `{ state, note, rows }` where state is `found` | `none` |
`error` (plus `canceled` added by the host). Rows are
`{ label, value, url?, tone? }`. The UI renders this generically — there is
no view code per source. The panel keeps the last sweep in memory only;
reopening starts fresh, recent lookups being the memory that persists.

## Source selection

All sources are keyless public JSON endpoints chosen for stability and
their documented free tiers. The plan is intentionally small; each source
is one named entry in `engine/engine.js` with its own parse function.

| Source | Endpoint | Note |
|--------|----------|------|
| GitHub | `api.github.com/users/{u}` | 60 req/h per IP anonymous; 404 = none |
| Codeberg | `codeberg.org/api/v1/users/{u}` | 404 = none |
| GitLab | `gitlab.com/api/v4/users?username=` | `[]` = none |
| Mastodon.social | `/api/v1/accounts/lookup?acct=` | 404 = none; suspended flag surfaced |
| Keybase | `/_/api/1.0/user/lookup.json` | `them: [null]` = none |
| Chess.com | `api.chess.com/pub/player/{u}` | 404 = none |
| Docker Hub | `hub.docker.com/v2/users/{u}` | 404 = none; public profile fields |
| Medium | `medium.com/feed/@{u}` | 404 = none; feed title read from RSS |
| Substack | `{u}.substack.com/feed.xml` | 404 = none |
| Gravatar | `gravatar.com/{md5}.json` | md5 is computed locally |
| dns.google | `/resolve?name=&type=` | DoH JSON; `Status:3` = NXDOMAIN; used for A/AAAA/MX/NS/TXT/CAA/PTR and mail policy |
| ipwho.is | `/ip/{ip}` | geo, ISP, ASN |
| rdap.org | `/ip/` `/domain/` | RFC 7480 redirects to the right registry |
| InternetDB | `internetdb.shodan.io/{ip}` | Shodan, unauthenticated; 404 JSON = none |
| Tor | `check.torproject.org/exit-addresses` | plain-text list; session-cached 10 min |
| crt.sh | `/?q=%25.{d}&output=json` | slowest source; throttles |
| web fingerprint | `https://{domain}` | title + server/x-powered-by headers, 64 kB cap |

Candidate sources that were verified live and *rejected*: Reddit
(`about.json` answered with 403 challenge HTML), Bitbucket 2.0 username
lookup (404 for every account probed, legacy nicknames retired), Telegram
preview pages (indistinguishable HTML for found and missing), npm registry
user endpoint (401), crates.io user API (404), archive.org Wayback
availability (persistent 429 from the probe network). Each one failed a
dependability bar the plugin's other sources pass; the rejection reasons
are recorded here so future contributors do not re-litigate them.

Detection order matters: emails are matched before usernames (both contain
`@`), pasted URLs collapse to their host, IPv6 is accepted with or without
brackets, and a trailing-dot hostname is treated as a (probably mistyped)
username rather than a domain.

## Why there is no Rust engine — yet

The plugin was originally planned around the
[BUIT](https://github.com/BuuDevOff/BUIT) Rust toolkit, with an in-app
installer. Verification against the real artifact and source (September
2026) stopped that:

1. **Broken release assets.** The `v1.0.4` "linux-x64" tarballs contain a
   Windows PE binary (`file` identifies them as `PE32+`). The `v1.0.3`
   linux asset ships a stale `1.0.2` binary next to a working copy buried
   in a `buit-main-linux-x64/` subdirectory.
2. **The v1.0.4 source tag does not compile** (borrow error in
   `src/setup.rs`); only `main` (version 1.0.5) builds.
3. **Structured output is decorative.** In `--json` mode the `ip` module
   guards every network lookup behind `output::is_console()` and returns an
   empty envelope; `email`, `domain`, `whois`, and `subdomain` refuse
   structured mode outright (`guard_structured_output` → exit 1). The API
   server returns real data only for `/ip` and `/username`; other handlers
   return stub messages.
4. **Speed.** A 30-platform username sweep of a real account took 21 s and
   found nothing, and the project has been dormant since October 2025.

A GUI that silently returns empty results for its headline lookups is not
shippable, so the engine for v1 is the plugin's own keyless HTTP layer: no
install step, ~1–2 s sweeps, every byte the UI shows produced by code in
this repository. A future deep-scan integration against a *fixed* BUIT
(the `--json` paths made to do real work) remains the natural extension
point; it would slot in behind the same check model as one more source.

## Fair-use posture

History is local, capped, and plain JSON. There is deliberately no
cross-run cache yet — see the rate-limit notes in the README. The plugin
collects nothing, phones nothing, and stores nothing outside
`$XDG_DATA_HOME/wolfs.radar/`.

## Out of scope (v1)

- Phone numbers, breach databases (both need keys or paid sources).
- Bulk or automated sweeps; use the sources' own terms as the ceiling.
- Keyboard cursor navigation of result rows (mouse-first, Esc-to-close).
