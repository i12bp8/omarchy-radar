// engine.test.mjs - unit tests for the pure lookup engine.
//
// Run: node tests/engine.test.mjs
// Fixtures under tests/fixtures/ are real responses recorded from the
// public endpoints (see docs/ARCHITECTURE.md for the date and policy).

import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const engine = require("../engine/engine.js");
const md5 = require("../engine/md5.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  fs.readFileSync(path.join(here, "fixtures", name), "utf8");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok  - " + name);
  } catch (err) {
    console.error("FAIL - " + name);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// detection

const detectCases = [
  ["torvalds", "username", "torvalds"],
  ["@torvalds", "username", "torvalds"],
  ["Linus_Torvalds.2", "username", "Linus_Torvalds.2"],
  ["  spaced_handle  ", "username", "spaced_handle"],
  ["SAM@EXAMPLE.COM", "email", "sam@example.com"],
  ["someone@example.com", "email", "someone@example.com"],
  ["8.8.8.8", "ip", "8.8.8.8"],
  ["8.8.8.8.", "username", "8.8.8.8."], // trailing dot is not an address
  ["2001:db8::1", "ip", "2001:db8::1"],
  ["::1", "ip", "::1"],
  ["[2001:db8::2]", "ip", "2001:db8::2"],
  ["EXAMPLE.ORG", "domain", "example.org"],
  ["example.org", "domain", "example.org"],
  ["https://example.org/", "domain", "example.org"],
  ["https://www.example.org/a/b?q=1", "domain", "example.org"],
  ["example.org/en-us/page", "domain", "example.org"],
  ["sub.example.org", "domain", "sub.example.org"],
  ["", "unknown", ""],
  ["hello world", "unknown", "hello world"],
  ["https://", "unknown", "https://"],
];

for (const [input, kind, value] of detectCases) {
  test("detect(" + JSON.stringify(input) + ") -> " + kind, () => {
    const got = engine.detect(input);
    assert.equal(got.kind, kind, "kind mismatch for " + JSON.stringify(input));
    assert.equal(got.value, value, "value mismatch for " + JSON.stringify(input));
  });
}

test("profile URLs classify as usernames", () => {
  for (const url of [
    "https://github.com/torvalds",
    "https://gitlab.com/torvalds",
    "https://codeberg.org/torvalds",
    "https://keybase.io/torvalds",
    "https://mastodon.social/@torvalds",
    "https://www.chess.com/member/torvalds",
    "https://hub.docker.com/u/torvalds",
    "github.com/torvalds",
  ]) {
    const got = engine.detect(url);
    assert.equal(got.kind, "username", url);
    assert.equal(got.value, "torvalds", url);
  }
});

test("project URLs resolve to their owner", () => {
  const got = engine.detect("https://github.com/torvalds/linux");
  assert.equal(got.kind, "username");
  assert.equal(got.value, "torvalds");
});

// ---------------------------------------------------------------------------
// plans

test("username plan covers nine keyless sources", () => {
  const checks = engine.checksFor("username", "torvalds", md5);
  assert.equal(checks.length, 9);
  assert.deepEqual(checks.map((c) => c.source),
    ["github", "codeberg", "gitlab", "mastodon", "keybase", "chess", "dockerhub", "medium", "substack"]);
  for (const check of checks) {
    assert.ok(check.url && check.label && check.host && check.meta.target === "torvalds");
  }
});

test("email plan hits gravatar, MX, SPF, and DMARC", () => {
  const checks = engine.checksFor("email", "test@example.com", md5);
  assert.equal(checks.length, 4);
  assert.equal(checks[0].url, "https://gravatar.com/55502f40dc8b7c769880b10874abc9d0.json");
  assert.equal(checks[1].meta.recordType, "MX");
  assert.equal(checks[2].meta.scope, "spf");
  assert.ok(checks[2].url.indexOf("type=TXT") > 0);
  assert.equal(checks[3].meta.scope, "dmarc");
  assert.ok(checks[3].url.indexOf("_dmarc.") > 0);
});

test("gravatar url degrades to an empty hash without md5 provider", () => {
  const checks = engine.checksFor("email", "a@b.com", null);
  assert.equal(checks[0].url, "https://gravatar.com/.json");
});

test("ip plan covers geo, reverse DNS, registry, exposure, and Tor", () => {
  const checks = engine.checksFor("ip", "8.8.8.8", md5);
  assert.deepEqual(checks.map((c) => c.source),
    ["geoIp", "ptr", "rdapIp", "internetdb", "torExit"]);
  assert.ok(checks[1].url.indexOf("8.8.8.8.in-addr.arpa") > 0);
});

test("ipv6 reverse name expands correctly", () => {
  const checks = engine.checksFor("ip", "2001:db8::1", md5);
  assert.ok(checks[1].url.indexOf(
    "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa") > 0);
});

test("domain plan covers records, policies, web, and CT logs", () => {
  const checks = engine.checksFor("domain", "example.org", md5);
  assert.equal(checks.length, 11);
  assert.deepEqual(checks.slice(0, 5).map((c) => c.meta.recordType),
    ["A", "AAAA", "MX", "NS", "TXT"]);
  assert.equal(checks[5].source, "rdapDomain");
  assert.equal(checks[6].meta.recordType, "CAA");
  assert.equal(checks[7].meta.scope, "spf");
  assert.equal(checks[8].meta.scope, "dmarc");
  assert.equal(checks[9].source, "webFp");
  assert.equal(checks[9].url, "https://example.org");
  assert.ok(checks[10].url.indexOf("crt.sh/?q=%25.example.org") > 0);
});

// ---------------------------------------------------------------------------
// parsing against recorded fixtures

const parses = [
  // [fixture file, source, status, meta, expectations]
  ["ipwho.json", "geoIp", 200, { target: "8.8.8.8" },
    { state: "found", label: "ISP", value: "Google LLC" }],
  ["rdap_ip.json", "rdapIp", 200, { target: "8.8.8.8" },
    { state: "found", label: "Network", value: "GOGL" }],
  ["rdap_domain.json", "rdapDomain", 200, { target: "example.org" },
    { state: "found", label: "Registrar" }],
  ["dns_a.json", "dns", 200, { target: "example.org", recordType: "A" },
    { state: "found" }],
  ["dns_mx.json", "dns", 200, { target: "example.org", recordType: "MX" },
    { state: "none", note: "does not accept email" }],
  ["dns_ns.json", "dns", 200, { target: "example.org", recordType: "NS" },
    { state: "found" }],
  ["dns_ptr.json", "ptr", 200, { target: "8.8.8.8" },
    { state: "found", value: "dns.google" }],
  ["crt_raw.json", "ctLogs", 200, { target: "example.org" },
    { state: "found" }],
  ["gh_user.json", "github", 200, { target: "torvalds" },
    { state: "found", label: "Name", value: "Linus Torvalds" }],
  ["gh_missing.json", "github", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["gl_user2.json", "gitlab", 200, { target: "jack" },
    { state: "found" }],
  ["gl_missing.json", "gitlab", 200, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["cb_user.json", "codeberg", 200, { target: "torvalds" },
    { state: "found" }],
  ["cb_missing.json", "codeberg", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["masto_user.json", "mastodon", 200, { target: "torvalds" },
    { state: "found", label: "Note", tone: "warn" }],
  ["masto_missing.json", "mastodon", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["kb_user.json", "keybase", 200, { target: "torvalds" },
    { state: "found" }],
  ["kb_missing.json", "keybase", 200, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["chess_user.json", "chess", 200, { target: "torvalds" },
    { state: "found", label: "Profile" }],
  ["chess_missing.json", "chess", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["dh_user.json", "dockerhub", 200, { target: "torvalds" },
    { state: "found", label: "Company" }],
  ["dh_missing.json", "dockerhub", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["medium_found.xml", "medium", 200, { target: "ev" },
    { state: "found", label: "Publication" }],
  ["medium_missing.xml", "medium", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["substack_found.xml", "substack", 200, { target: "stratechery" },
    { state: "found", label: "Publication" }],
  ["substack_missing.txt", "substack", 404, { target: "zz_nonexistent_zz_9382" },
    { state: "none" }],
  ["dns_txt_spf.json", "mailPolicy", 200, { target: "test@google.com", scope: "spf" },
    { state: "found", label: "SPF" }],
  ["dns_txt_dmarc.json", "mailPolicy", 200, { target: "test@google.com", scope: "dmarc" },
    { state: "found", label: "DMARC",
      value: "v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com" }],
  ["idb_user.json", "internetdb", 200, { target: "8.8.8.8" },
    { state: "found", label: "Open ports", value: "53, 443" }],
  ["idb_none.json", "internetdb", 404, { target: "192.0.2.1" },
    { state: "none" }],
  ["web_body.html", "webFp", 200,
    { target: "example.org", headers: fixture("web_headers.txt") },
    { state: "found", label: "Page title", value: "Example Domain" }],
  ["gravatar_found.json", "gravatar", 200,
    { target: "205e460b479e2e5b48aec07710c08d50", email: "example@example.com" },
    { state: "found", label: "Profile" }],
  ["gravatar_missing.json", "gravatar", 200,
    { target: "00000000000000000000000000000000", email: "nobody@example.com" },
    { state: "none" }],
];

for (const [file, source, status, meta, expect] of parses) {
  test("parse " + file + " via " + source, () => {
    const result = engine.parse(source, status, fixture(file), meta);
    assert.equal(result.state, expect.state, "state for " + file + ": " + result.note);
    if (expect.label !== undefined) {
      const row = result.rows.find((r) => r.label === expect.label);
      assert.ok(row, "expected row label " + JSON.stringify(expect.label) + " in " + file);
      if (expect.value !== undefined) assert.equal(row.value, expect.value);
      if (expect.tone !== undefined) assert.equal(row.tone, expect.tone);
    }
  });
}

// ---------------------------------------------------------------------------
// behavior-level tests

test("tor exit parser lists a matching address and ignores the rest", () => {
  const sample = fixture("tor_exits_sample.txt");
  const listedIp = /^ExitAddress\s+(\S+)/m.exec(sample)[1];
  const hit = engine.parse("torExit", 200, sample, { target: listedIp });
  assert.equal(hit.state, "found");
  assert.equal(hit.rows[0].tone, undefined);
  const miss = engine.parse("torExit", 200, sample, { target: "8.8.8.8" });
  assert.equal(miss.state, "none");
});

test("dmarc policy and spf fallback rows are parsed", () => {
  const dmarc = engine.parse("mailPolicy", 200, fixture("dns_txt_dmarc.json"),
    { target: "x@google.com", scope: "dmarc" });
  const policy = dmarc.rows.find((r) => r.label === "Policy");
  assert.equal(policy.value, "reject");
  assert.equal(policy.tone, "ok");
  const spf = engine.parse("mailPolicy", 200, fixture("dns_txt_spf.json"),
    { target: "x@google.com", scope: "spf" });
  const fallback = spf.rows.find((r) => r.label === "Fallback");
  assert.equal(fallback.value, "soft fail");
});

test("web fingerprint reads the server header", () => {
  const result = engine.parse("webFp", 200, fixture("web_body.html"),
    { target: "example.org", headers: fixture("web_headers.txt") });
  const server = result.rows.find((r) => r.label === "Server");
  assert.ok(server, "server row missing");
  assert.ok(server.value.length > 0);
  const site = result.rows.find((r) => r.label === "Site");
  assert.equal(site.url, "https://example.org");
});

test("crt log rows dedupe, sort, and cap", () => {
  const result = engine.parse("ctLogs", 200, fixture("crt_raw.json"), { target: "example.org" });
  const values = result.rows.filter((r) => r.label !== "…" && r.label !== "Wildcard").map((r) => r.value);
  assert.equal(new Set(values).size, values.length, "duplicate subdomain values");
  assert.ok(values.every((v) => v === String(v).toLowerCase()));
  const cap = result.rows.find((r) => r.label === "…");
  assert.ok(!cap || result.rows.length <= 25);
});

test("github rate-limit maps to a friendly error", () => {
  const result = engine.parse("github", 403, fixture("gh_missing.json"), { target: "x" });
  assert.equal(result.state, "error");
  assert.ok(result.note.indexOf("rate-limiting") >= 0);
});

test("html garbage never crashes a parser", () => {
  assert.equal(engine.parse("ctLogs", 200, "<html>rate limited</html>", { target: "x" }).state, "error");
  assert.equal(engine.parse("dns", 502, "", { target: "x", recordType: "A" }).state, "error");
  assert.equal(engine.parse("nope", 200, "{}", { target: "x" }).state, "error");
});

test("report builder renders a sweep as markdown", () => {
  const md = engine.reportMarkdown("username", "torvalds", [
    { label: "GitHub", state: "found", note: "", rows: [{ label: "Name", value: "Linus Torvalds", url: "https://github.com/torvalds" }] },
    { label: "Chess.com", state: "none", note: "No Chess.com account for \u201ctorvalds\u201d.", rows: [] }
  ], "2026-09-02T12:00:00Z");
  assert.ok(md.indexOf("# Radar report \u2014 Username: torvalds") === 0);
  assert.ok(md.indexOf("## GitHub \u2014 found") > 0);
  assert.ok(md.indexOf("- Name: Linus Torvalds (https://github.com/torvalds)") > 0);
  assert.ok(md.indexOf("## Chess.com \u2014 absent") > 0);
});

test("md5 matches published vectors", () => {
  assert.equal(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5("test@example.com"), "55502f40dc8b7c769880b10874abc9d0");
  assert.equal(md5("The quick brown fox jumps over the lazy dog"),
    "9e107d9d372bb6826bd81d3542a419d6");
});

console.log("\n" + passed + " tests passed" + (process.exitCode ? " (with failures)" : ""));
