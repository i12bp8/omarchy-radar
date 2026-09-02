# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-02

### Added

- New keyless sources: Chess.com, Docker Hub, Medium and Substack feeds for
  usernames; SPF and DMARC policy checks for email and domain targets;
  Shodan InternetDB (exposed ports/hostnames/vulns) and the Tor exit-node
  list for IPs; AAAA, CAA and a web fingerprint (title, server, tech
  headers) for domains. The Tor list is fetched at most once per session.
- Profile/project URL detection: pasting `github.com/octocat` or
  `chess.com/member/x` runs a username sweep instead of a domain lookup.
- Result cards are now collapsible and absent/failed checks collapse
  automatically, keeping big sweeps readable.
- **Copy report** action turns the current sweep into a markdown summary.
- **Search the web** card offers DuckDuckGo / Google / Bing / Startpage
  queries for the target.
- Recent lookups gained per-entry removal and clickable example chips on
  the start view; taller result viewport with slim scroll indicators.
- GitHub rate-limit, crt.sh throttling, and source outages degrade to
  inline explanations instead of silent gaps.

### Notes

- Candidate sources verified live and rejected before release: Reddit
  (403 challenge pages), Bitbucket legacy usernames (all 404), Telegram
  previews (indistinguishable for found/missing), npm registry user
  endpoint (401), crates.io user API (404), Wayback availability (429).
  See `docs/ARCHITECTURE.md`.

## [0.1.0] - 2026-09-02

Initial release.

### Added

- Bar widget (`wolfs.radar`) with a popup panel: click the radar icon to
  open, Esc or click-away to close, Enter to look up.
- Target auto-detection: `@handle` / `handle` → username, `a@b.c` → email,
  IPv4/IPv6 → address, `example.org` (or a pasted URL) → domain.
- Keyless source set, run concurrently and streamed into the panel:
  - username: GitHub, Codeberg, GitLab.com, Mastodon.social, Keybase
  - email: Gravatar, mail-server (MX) check via DNS-over-HTTPS
  - IP: geolocation/ASN (ipwho.is), reverse DNS, network registry (RDAP)
  - domain: A/MX/NS/TXT records, registration record (RDAP), certificate
    transparency subdomains (crt.sh)
- Per-check outcome states (found / absent / error / stopped) with an
  explanation for every non-finding, so a sweep reads as a transparent log.
- Recent lookups persisted locally under
  `$XDG_DATA_HOME/wolfs.radar/history.json` (atomic writes), with
  configurable depth via the bar-widget `historySize` setting.
- Copy-any-value (wl-copy) and open-in-browser for every URL row.
- Engine logic as dependency-free JavaScript with a node test-suite over
  recorded endpoint payloads (`tests/engine.test.mjs`).

### Notes

- No account, API key, telemetry, or bundled binary. Queries go directly
  from the user's machine to the public sources listed above.
- The engine was evaluated against the BUIT toolkit (v1.0.4/main) before
  release; that dependency was declined. See `docs/ARCHITECTURE.md` for
  the evidence.
