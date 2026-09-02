// engine.js - Radar lookup plans and response parsing.
//
// Pure logic, no I/O: it decides what to fetch for a target and how to read
// the response back. The QML host owns HTTP, timeouts, and cancellation;
// node tests exercise everything here against recorded payloads.
//
// Every source adapter returns a result of the same shape:
//   { state: "found" | "none" | "error",
//     note:  string,            // short explanation shown under the header
//     rows:  [ row ] }          // row: { label, value, url?, tone?, mono? }
// tone is "ok" | "muted" | "warn" | "err"; default "ok".
//
// Sources are deliberately few and keyless: stable public JSON endpoints
// with a documented free tier. Adding one is an entry in the checks table
// plus a parse function; nothing else changes.

"use strict";

// ---------------------------------------------------------------------------
// small shared helpers

function cleanString(value, limit) {
  var text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (limit > 0 && text.length > limit) text = text.slice(0, limit - 1) + "…";
  return text;
}

function yearOf(iso) {
  var match = /^(\d{4})/.exec(String(iso || ""));
  return match ? match[1] : "";
}

function stripTrailingDot(value) {
  return String(value || "").replace(/\.+$/, "");
}

function uniqueSorted(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var item = cleanString(list[i]);
    if (item === "" || seen[item]) continue;
    seen[item] = true;
    out.push(item);
  }
  out.sort();
  return out;
}

function safeJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (e) {
    return null;
  }
}

function none(note) {
  return { state: "none", note: note, rows: [] };
}

function error(note) {
  return { state: "error", note: note, rows: [] };
}

function vcardName(vcardArray) {
  // RDAP embeds contacts as vCards; find the formatted name (FN).
  try {
    var rows = vcardArray[1] || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i][0] === "fn" && rows[i][3]) return cleanString(rows[i][3], 60);
    }
  } catch (e) { /* a malformed vcard is not worth failing a lookup over */ }
  return "";
}

function rdapOrgName(json) {
  try {
    if (!Array.isArray(json.entities)) return "";
    for (var i = 0; i < json.entities.length; i++) {
      var entity = json.entities[i];
      if (!entity.vcardArray) continue;
      var roles = entity.roles || [];
      if (roles.length === 0 || roles.indexOf("registrant") >= 0) {
        var name = vcardName(entity.vcardArray);
        if (name) return name;
      }
    }
  } catch (e) { /* fall through */ }
  return "";
}

function dnsAnswers(json) {
  // Google DNS-over-HTTPS: { Status, Answer: [{ name, type, data }] }.
  if (!json || json.Status !== 0) return null;
  return Array.isArray(json.Answer) ? json.Answer : [];
}

function isUsableHttp(status) {
  return status >= 200 && status < 300;
}

// ---------------------------------------------------------------------------
// target detection

var KIND_USERNAME = "username";
var KIND_EMAIL = "email";
var KIND_IP = "ip";
var KIND_DOMAIN = "domain";

var EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
var IPV4_RE = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;
var DOMAIN_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
var USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/;

function extractHost(value) {
  // "https://user@example.com:8443/a/b" or "example.com/a" -> "example.com"
  var match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@]+@)?([^/?#:]+)/i.exec(value);
  return match ? stripTrailingDot(match[1]) : "";
}

function looksLikeIpv6(value) {
  var v6 = value;
  if (v6.charAt(0) === "[" && v6.indexOf("]") > 0) v6 = v6.slice(1, v6.indexOf("]"));
  var colonCount = (v6.match(/:/g) || []).length;
  if (colonCount < 2) return false;
  var groups = v6.split(":");
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    if (group === "") continue;
    if (group.indexOf(".") >= 0) {
      if (!IPV4_RE.test(group)) return false;
    } else if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return false;
    }
  }
  return v6.indexOf("::") === v6.lastIndexOf("::");
}

// Profile hosts whose single-segment path is a username this engine can
// actually verify. Pasted profile links (the normie path) resolve to the
// username instead of being treated as a bare domain.
var PROFILE_HOSTS = {
  "github.com": true,
  "gitlab.com": true,
  "codeberg.org": true,
  "keybase.io": true,
  "mastodon.social": true,
  "chess.com": true,
  "hub.docker.com": true
};

function profileNameFromUrl(input) {
  var m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@]+@)?([^/?#:]+)(?:\/([^?#]*))?/i.exec(input);
  if (!m) return "";
  var host = String(m[1]).toLowerCase().replace(/^www\./, "");
  var segs = String(m[2] || "").split("/").filter(function (seg) { return seg !== ""; });
  if (!PROFILE_HOSTS[host] || segs.length === 0) return "";
  var name = "";
  if (host === "chess.com") {
    if (segs[0].toLowerCase() !== "member" || segs.length < 2) return "";
    name = segs[1];
  } else if (host === "hub.docker.com") {
    if (segs[0].toLowerCase() !== "u" || segs.length < 2) return "";
    name = segs[1];
  } else if (host === "mastodon.social") {
    name = segs[0].charAt(0) === "@" ? segs[0].slice(1) : "";
  } else {
    // owner segment of a profile or project URL (github.com/user/repo)
    name = segs[0];
  }
  return name.split("#")[0].split("?")[0];
}

function detect(raw) {
  // Returns { kind, value } for a supported target, or
  // { kind: "unknown", value: raw, hint } otherwise.
  var input = cleanString(raw, 300);
  if (input === "") return { kind: "unknown", value: "", hint: "Type something first." };
  var lower = input.toLowerCase();

  // Pasted URLs (with or without scheme) count as their host; profile
  // links on covered hosts resolve to the username they point at.
  if (input.indexOf("/") >= 0) {
    var profile = profileNameFromUrl(input);
    if (profile && USERNAME_RE.test(profile)) return { kind: KIND_USERNAME, value: profile };
    var host = extractHost(input);
    if (host !== "") {
      host = host.replace(/^www\./, "");
      if (IPV4_RE.test(host)) return { kind: KIND_IP, value: host };
      if (looksLikeIpv6(host)) return { kind: KIND_IP, value: host };
      if (DOMAIN_RE.test(host)) return { kind: KIND_DOMAIN, value: host };
    }
    return { kind: "unknown", value: raw, hint: "Enter a @username, email, IP address, or domain." };
  }

  if (EMAIL_RE.test(lower)) return { kind: KIND_EMAIL, value: lower };
  if (IPV4_RE.test(input)) return { kind: KIND_IP, value: input };
  if (looksLikeIpv6(lower)) {
    var v6 = lower;
    if (v6.charAt(0) === "[" && v6.indexOf("]") > 0) v6 = v6.slice(1, v6.indexOf("]"));
    return { kind: KIND_IP, value: v6 };
  }

  var candidate = input;
  if (candidate.charAt(0) === "@") candidate = candidate.slice(1);
  if (candidate.indexOf("@") < 0) {
    var candLower = candidate.toLowerCase();
    if (DOMAIN_RE.test(candLower)) return { kind: KIND_DOMAIN, value: candLower };
    if (USERNAME_RE.test(candidate)) return { kind: KIND_USERNAME, value: candidate };
  }

  return { kind: "unknown", value: raw, hint: "Enter a @username, email, IP address, or domain." };
}

// ---------------------------------------------------------------------------
// checks per target kind. A check is
//   { source, label, host, url, meta }
// The host runs all checks of a plan in parallel and merges responses back
// by source id. meta carries the target plus per-check extras for parse().

function baseCheck(source, label, host, url, target, extra) {
  var meta = { target: target };
  for (var key in (extra || {})) meta[key] = extra[key];
  return { source: source, label: label, host: host, url: url, meta: meta };
}

function dnsCheck(recordType, domain, target) {
  var label = { A: "A records", AAAA: "AAAA records", MX: "Mail (MX)", NS: "Nameservers", TXT: "TXT records", CAA: "CAA records" }[recordType];
  return baseCheck("dns", label, "dns.google",
    "https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=" + encodeURIComponent(recordType),
    target, { recordType: recordType });
}

function checksFor(kind, value, md5Fn) {
  var out = [];
  if (kind === KIND_USERNAME) {
    out.push(baseCheck("github", "GitHub", "github.com",
      "https://api.github.com/users/" + encodeURIComponent(value), value));
    out.push(baseCheck("codeberg", "Codeberg", "codeberg.org",
      "https://codeberg.org/api/v1/users/" + encodeURIComponent(value), value));
    out.push(baseCheck("gitlab", "GitLab.com", "gitlab.com",
      "https://gitlab.com/api/v4/users?username=" + encodeURIComponent(value), value));
    out.push(baseCheck("mastodon", "Mastodon.social", "mastodon.social",
      "https://mastodon.social/api/v1/accounts/lookup?acct=" + encodeURIComponent(value), value));
    out.push(baseCheck("keybase", "Keybase", "keybase.io",
      "https://keybase.io/_/api/1.0/user/lookup.json?usernames=" + encodeURIComponent(value) +
      "&fields=basics", value));
    out.push(baseCheck("chess", "Chess.com", "chess.com",
      "https://api.chess.com/pub/player/" + encodeURIComponent(value), value));
    out.push(baseCheck("dockerhub", "Docker Hub", "hub.docker.com",
      "https://hub.docker.com/v2/users/" + encodeURIComponent(value), value));
    out.push(baseCheck("medium", "Medium", "medium.com",
      "https://medium.com/feed/@" + encodeURIComponent(value), value));
    out.push(baseCheck("substack", "Substack", "substack.com",
      "https://" + encodeURIComponent(value) + ".substack.com/feed.xml", value));
  } else if (kind === KIND_EMAIL) {
    var domain = String(value).split("@")[1] || "";
    var hash = typeof md5Fn === "function" ? md5Fn(value) : "";
    out.push(baseCheck("gravatar", "Gravatar", "gravatar.com",
      "https://gravatar.com/" + hash + ".json", value, { email: value }));
    out.push(baseCheck("dns", "Mail (MX)", "dns.google",
      "https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=MX", value,
      { recordType: "MX" }));
    out.push(baseCheck("mailPolicy", "SPF policy", "dns.google",
      "https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=TXT", value,
      { scope: "spf" }));
    out.push(baseCheck("mailPolicy", "DMARC policy", "dns.google",
      "https://dns.google/resolve?name=" + encodeURIComponent("_dmarc." + domain) + "&type=TXT", value,
      { scope: "dmarc" }));
  } else if (kind === KIND_IP) {
    out.push(baseCheck("geoIp", "Geolocation", "ipwho.is",
      "https://ipwho.is/" + encodeURIComponent(value), value));
    out.push(baseCheck("ptr", "Reverse DNS", "dns.google",
      "https://dns.google/resolve?name=" + encodeURIComponent(reverseDnsName(value)) + "&type=PTR",
      value));
    out.push(baseCheck("rdapIp", "Network registry", "rdap.org",
      "https://rdap.org/ip/" + encodeURIComponent(value), value));
    out.push(baseCheck("internetdb", "Exposed services", "internetdb.shodan.io",
      "https://internetdb.shodan.io/" + encodeURIComponent(value), value));
    out.push(baseCheck("torExit", "Tor exit", "check.torproject.org",
      "https://check.torproject.org/exit-addresses", value));
  } else if (kind === KIND_DOMAIN) {
    out.push(dnsCheck("A", value, value));
    out.push(dnsCheck("AAAA", value, value));
    out.push(dnsCheck("MX", value, value));
    out.push(dnsCheck("NS", value, value));
    out.push(dnsCheck("TXT", value, value));
    out.push(baseCheck("rdapDomain", "Registration", "rdap.org",
      "https://rdap.org/domain/" + encodeURIComponent(value), value));
    out.push(dnsCheck("CAA", value, value));
    out.push(baseCheck("mailPolicy", "SPF policy", "dns.google",
      "https://dns.google/resolve?name=" + encodeURIComponent(value) + "&type=TXT", value,
      { scope: "spf" }));
    out.push(baseCheck("mailPolicy", "DMARC policy", "dns.google",
      "https://dns.google/resolve?name=" + encodeURIComponent("_dmarc." + value) + "&type=TXT", value,
      { scope: "dmarc" }));
    out.push(baseCheck("webFp", "Web server", value,
      "https://" + value, value));
    out.push(baseCheck("ctLogs", "Subdomains (CT logs)", "crt.sh",
      "https://crt.sh/?q=%25." + encodeURIComponent(value) + "&output=json", value));
  }
  return out;
}

function reverseDnsName(ip) {
  if (ip.indexOf(":") >= 0) {
    // RFC 3596: nibbles of the expanded address, reversed, under ip6.arpa.
    var hextets = String(ip).toLowerCase().split("::");
    var head = hextets[0] ? hextets[0].split(":") : [];
    var tail = hextets.length > 1 && hextets[1] ? hextets[1].split(":") : [];
    // Note: all aliases head, so the missing-hextet count must be captured
    // before the padding loop or its bound keeps moving as head grows.
    var all = head;
    var missing = 8 - head.length - tail.length;
    for (var pad = 0; pad < missing; pad++) all.push("0");
    all = all.concat(tail);
    if (all.length !== 8) return "";
    var nibbles = "";
    for (var h = 7; h >= 0; h--) {
      var hex = ("000" + all[h]).slice(-4);
      for (var n = 3; n >= 0; n--) nibbles += hex.charAt(n) + ".";
    }
    return nibbles + "ip6.arpa";
  }
  var octets = String(ip).split(".");
  if (octets.length !== 4) return "";
  return octets.reverse().join(".") + ".in-addr.arpa";
}

// ---------------------------------------------------------------------------
// response parsing, one function per source id. Receives (status, text, meta).

function parseGithub(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No GitHub account for “" + meta.target + "”.");
  if (status === 403 || status === 429) {
    return error("GitHub is rate-limiting anonymous requests from this IP. Try again later.");
  }
  if (!isUsableHttp(status)) return error("GitHub responded HTTP " + status + ".");
  if (!json || typeof json.login !== "string") return error("GitHub returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Name", value: cleanString(json.name, 60) || json.login });
  if (cleanString(json.bio)) rows.push({ label: "Bio", value: cleanString(json.bio, 140), tone: "muted" });
  if (cleanString(json.location)) rows.push({ label: "Location", value: cleanString(json.location, 60) });
  if (cleanString(json.company)) rows.push({ label: "Company", value: cleanString(json.company, 60) });
  var blog = cleanString(json.blog);
  if (blog) rows.push({ label: "Website", value: blog, url: blog.indexOf("://") >= 0 ? blog : "https://" + blog });
  var joined = yearOf(json.created_at);
  if (joined) rows.push({ label: "Joined", value: joined, tone: "muted" });
  rows.push({ label: "Repos", value: String(json.public_repos || 0) });
  rows.push({ label: "Followers", value: String(json.followers || 0) });
  var profile = json.html_url || ("https://github.com/" + meta.target);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseCodeberg(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No Codeberg account for “" + meta.target + "”.");
  if (!isUsableHttp(status)) return error("Codeberg responded HTTP " + status + ".");
  if (!json || typeof json.username !== "string") return error("Codeberg returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Username", value: json.username });
  if (cleanString(json.full_name)) rows.push({ label: "Name", value: cleanString(json.full_name, 60) });
  if (cleanString(json.description)) rows.push({ label: "Bio", value: cleanString(json.description, 140), tone: "muted" });
  var website = cleanString(json.website);
  if (website) rows.push({ label: "Website", value: website, url: website.indexOf("://") >= 0 ? website : "https://" + website });
  var joined = yearOf(json.created);
  if (joined) rows.push({ label: "Joined", value: joined, tone: "muted" });
  var profile = json.html_url || ("https://codeberg.org/" + meta.target);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseGitlab(status, text, meta) {
  var json = safeJson(text);
  if (!isUsableHttp(status)) return error("GitLab responded HTTP " + status + ".");
  if (!Array.isArray(json)) return error("GitLab returned an unexpected response.");
  if (json.length === 0) return none("No GitLab.com account for “" + meta.target + "”.");
  var user = json[0] || {};
  var rows = [];
  rows.push({ label: "Username", value: cleanString(user.username, 60) });
  if (cleanString(user.name)) rows.push({ label: "Name", value: cleanString(user.name, 60) });
  var profile = user.web_url || ("https://gitlab.com/" + meta.target);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseMastodon(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No account for “" + meta.target + "” on mastodon.social.");
  if (!isUsableHttp(status)) return error("Mastodon responded HTTP " + status + ".");
  if (!json || typeof json.username !== "string") return error("Mastodon returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Name", value: cleanString(json.display_name, 60) || json.username });
  rows.push({ label: "Handle", value: "@" + json.acct, tone: "muted" });
  if (json.suspended) rows.push({ label: "Note", value: "Account is suspended on this server.", tone: "warn" });
  if (typeof json.followers_count === "number") rows.push({ label: "Followers", value: String(json.followers_count) });
  if (typeof json.statuses_count === "number") rows.push({ label: "Posts", value: String(json.statuses_count) });
  var joined = yearOf(json.created_at);
  if (joined) rows.push({ label: "Joined", value: joined, tone: "muted" });
  var profile = json.url || ("https://mastodon.social/@" + meta.target);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseKeybase(status, text, meta) {
  var json = safeJson(text);
  if (!isUsableHttp(status)) return error("Keybase responded HTTP " + status + ".");
  if (!json || !json.status) return error("Keybase returned an unexpected response.");
  if (json.status.code !== 0) {
    return error("Keybase lookup failed (" +
      cleanString(json.status.desc || json.status.name, 80) + ").");
  }
  var user = (json.them && json.them[0]) || null;
  if (!user || !user.basics || !user.basics.username) {
    return none("No Keybase account for “" + meta.target + "”.");
  }
  var rows = [];
  rows.push({ label: "Username", value: user.basics.username });
  var created = yearOf(new Date((user.basics.ctime || 0) * 1000).toISOString());
  if (created) rows.push({ label: "Joined", value: created, tone: "muted" });
  var profile = "https://keybase.io/" + encodeURIComponent(user.basics.username);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseGravatar(status, text, meta) {
  var body = String(text || "").trim();
  var json = body.charAt(0) === "{" ? safeJson(text) : null;
  var entry = json && json.entry && json.entry[0];
  if (!entry || !cleanString(entry.profileUrl)) return none("No Gravatar profile for “" + meta.email + "”.");
  var rows = [];
  if (cleanString(entry.displayName)) rows.push({ label: "Name", value: cleanString(entry.displayName, 60) });
  if (cleanString(entry.currentLocation)) rows.push({ label: "Location", value: cleanString(entry.currentLocation, 60) });
  if (cleanString(entry.job_title)) rows.push({ label: "Role", value: cleanString(entry.job_title, 60) });
  if (cleanString(entry.company)) rows.push({ label: "Company", value: cleanString(entry.company, 60) });
  if (cleanString(entry.aboutMe)) rows.push({ label: "About", value: cleanString(entry.aboutMe, 220), tone: "muted" });
  var profile = cleanString(entry.profileUrl);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseDns(status, text, meta) {
  var json = safeJson(text);
  if (json && json.Status === 3) return none("The domain does not exist in DNS.");
  var answers = dnsAnswers(json);
  if (!answers) {
    if (!isUsableHttp(status)) return error("dns.google responded HTTP " + status + ".");
    var comment = cleanString(json && json.Comment, 80);
    return error(comment ? "DNS lookup failed: " + comment + "." : "DNS lookup failed.");
  }
  var type = (meta && meta.recordType) || "";
  var typeName = { A: "A record", MX: "Mail server", NS: "Nameserver", TXT: "TXT record", CAA: "CAA record" }[type] || "Record";
  var pluralName = { A: "A records", MX: "Mail servers", NS: "Nameservers", TXT: "TXT records", CAA: "CAA records" }[type] || typeName + "s";
  var rows = [];
  var found = false;
  for (var i = 0; i < answers.length; i++) {
    var data = String(answers[i].data || "");
    if (data === "." || data === "") continue; // null MX and friends
    var label = i === 0 ? pluralName : "";
    if (type === "MX") {
      var parts = data.split(/\s+/);
      var preference = parts.shift();
      var host = stripTrailingDot(parts.join(" "));
      if (host === "") continue; // null MX ("0 ."): domain accepts no mail
      found = true;
      rows.push({
        label: label + (preference && i === 0 ? " (pri " + preference + ")" : ""),
        value: host,
        mono: true
      });
    } else {
      found = true;
      rows.push({ label: label, value: stripTrailingDot(data), mono: true });
    }
  }
  if (!found) {
    return {
      state: "none",
      note: type === "MX" ? "No mail servers — the domain does not accept email."
                          : "No " + pluralName.toLowerCase() + " published.",
      rows: []
    };
  }
  if (rows.length > 8) {
    var more = rows.length - 8;
    rows = rows.slice(0, 8);
    rows.push({ label: "…", value: more + " more", tone: "muted" });
  }
  return { state: "found", rows: rows };
}

function parseGeoIp(status, text, meta) {
  var json = safeJson(text);
  if (!isUsableHttp(status)) return error("ipwho.is responded HTTP " + status + ".");
  if (!json || json.success !== true) {
    return error("Geolocation failed: " + cleanString(json && json.message, 80));
  }
  var rows = [];
  var place = [cleanString(json.city), cleanString(json.region), cleanString(json.country)].filter(function (v) { return v !== ""; }).join(", ");
  if (place) rows.push({ label: "Location", value: place });
  var connection = json.connection || {};
  if (cleanString(connection.isp)) rows.push({ label: "ISP", value: cleanString(connection.isp, 60) });
  if (connection.asn) rows.push({ label: "ASN", value: "AS" + connection.asn, tone: "muted" });
  if (typeof json.latitude === "number" && typeof json.longitude === "number") {
    var lat = json.latitude, lon = json.longitude;
    var coords = lat.toFixed(4) + ", " + lon.toFixed(4);
    rows.push({ label: "Coordinates", value: coords,
      url: "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon + "#map=10/" + lat + "/" + lon });
  }
  if (json.timezone && cleanString(json.timezone.id)) rows.push({ label: "Timezone", value: json.timezone.id, tone: "muted" });
  return { state: "found", rows: rows };
}

function parsePtr(status, text, meta) {
  var answers = dnsAnswers(safeJson(text));
  if (!answers || answers.length === 0) {
    if (!isUsableHttp(status)) return error("Reverse DNS failed (HTTP " + status + ").");
    return { state: "none", note: "No PTR record — nothing resolves back to this address.", rows: [] };
  }
  var name = stripTrailingDot(String(answers[0].data || ""));
  return { state: "found", rows: [{ label: "Hostname", value: name, mono: true }] };
}

function parseRdapIp(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No RDAP registration for this address.");
  if (!isUsableHttp(status)) return error("RDAP responded HTTP " + status + ".");
  if (!json || !json.handle) return error("RDAP returned an unexpected response.");
  var rows = [];
  if (cleanString(json.name)) rows.push({ label: "Network", value: cleanString(json.name, 60) });
  rows.push({ label: "Handle", value: cleanString(json.handle, 60), tone: "muted" });
  var range = [cleanString(json.startAddress), cleanString(json.endAddress)].filter(function (v) { return v !== ""; }).join(" – ");
  if (range) rows.push({ label: "Range", value: range, mono: true, tone: "muted" });
  var org = rdapOrgName(json);
  if (org) rows.push({ label: "Organization", value: org });
  var link = json.links && json.links[0] && json.links[0].href;
  if (link) rows.push({ label: "Registry record", value: link, url: link });
  return { state: "found", rows: rows };
}

function parseRdapDomain(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No registration record for this domain.");
  if (!isUsableHttp(status)) return error("RDAP responded HTTP " + status + ".");
  if (!json || !json.ldhName) return error("RDAP returned an unexpected response.");
  var rows = [];
  var created = "", expires = "";
  if (Array.isArray(json.events)) {
    for (var e = 0; e < json.events.length; e++) {
      var event = json.events[e];
      if (event.eventAction === "registration") created = cleanString(event.eventDate, 10);
      if (event.eventAction === "expiration") expires = cleanString(event.eventDate, 10);
    }
  }
  var registrar = "";
  if (Array.isArray(json.entities)) {
    for (var ent = 0; ent < json.entities.length; ent++) {
      var entity = json.entities[ent];
      if (entity.vcardArray && entity.roles && entity.roles.indexOf("registrar") >= 0) {
        registrar = vcardName(entity.vcardArray);
        break;
      }
    }
  }
  if (registrar) rows.push({ label: "Registrar", value: registrar });
  if (created) rows.push({ label: "Registered", value: created });
  if (expires) rows.push({ label: "Expires", value: expires });
  if (Array.isArray(json.nameservers) && json.nameservers.length > 0) {
    var servers = [];
    for (var ns = 0; ns < json.nameservers.length; ns++) {
      var nsName = cleanString(json.nameservers[ns].ldhName);
      if (nsName) servers.push(stripTrailingDot(nsName));
    }
    if (servers.length > 0) rows.push({ label: "Nameservers", value: servers.slice(0, 4).join(" · "), tone: "muted" });
  }
  if (json.secureDNS && typeof json.secureDNS.delegationSigned === "boolean") {
    rows.push({ label: "DNSSEC", value: json.secureDNS.delegationSigned ? "Signed" : "Not signed", tone: "muted" });
  }
  var recordUrl = "https://rdap.org/domain/" + encodeURIComponent(meta.target);
  rows.push({ label: "Registry record", value: recordUrl, url: recordUrl });
  return { state: "found", rows: rows };
}

function parseCtLogs(status, text, meta) {
  var json = safeJson(text);
  if (!isUsableHttp(status)) return error("crt.sh responded HTTP " + status + ".");
  if (!Array.isArray(json)) {
    if (String(text).indexOf("<html") >= 0) {
      return error("crt.sh rate-limited the request. Wait a moment and retry.");
    }
    return error("crt.sh returned an unexpected response.");
  }
  var names = [];
  for (var i = 0; i < json.length; i++) {
    var block = json[i] && json[i].name_value;
    if (typeof block === "string") {
      var lines = block.split(/\r?\n/);
      for (var l = 0; l < lines.length; l++) names.push(lines[l]);
    }
  }
  if (names.length === 0) return none("No certificates found in public CT logs.");
  var wildcards = 0;
  var plain = [];
  for (var n = 0; n < names.length; n++) {
    var name = cleanString(names[n]);
    if (name === "") continue;
    if (name.indexOf("*.") === 0) wildcards++;
    else plain.push(name);
  }
  var all = uniqueSorted(plain);
  var rows = [];
  var total = all.length;
  var max = 24;
  for (var r = 0; r < Math.min(total, max); r++) {
    rows.push({ label: all[r] === meta.target ? "Main domain" : "Subdomain", value: all[r], mono: true });
  }
  if (total > max) rows.push({ label: "…", value: (total - max) + " more subdomains", tone: "muted" });
  if (wildcards > 0) {
    rows.push({ label: "Wildcard", value: "*." + meta.target + (wildcards > 1 ? " · " + (wildcards - 1) + " more wildcards" : ""), tone: "muted" });
  }
  if (total === 0 && wildcards > 0) return { state: "found", rows: rows, note: "Only wildcard certificates found." };
  if (rows.length === 0) return none("No certificates found in public CT logs.");
  return { state: "found", rows: rows };
}

function parseChess(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No Chess.com account for \u201c" + meta.target + "\u201d.");
  if (!isUsableHttp(status)) return error("Chess.com responded HTTP " + status + ".");
  if (!json || !json.username) return error("Chess.com returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Username", value: json.username });
  if (json.verified === true) rows.push({ label: "Verified", value: "Yes", tone: "muted" });
  if (json.title) rows.push({ label: "Title", value: cleanString(json.title, 40) });
  if (cleanString(json.joined)) rows.push({ label: "Joined", value: cleanString(json.joined, 10), tone: "muted" });
  if (typeof json.followers === "number") rows.push({ label: "Followers", value: String(json.followers) });
  var countryId = /\/country\/([A-Z]{2})$/i.exec(cleanString(json.country));
  if (countryId) rows.push({ label: "Country", value: countryId[1], tone: "muted" });
  if (typeof json.last_online === "number" && json.last_online > 0) {
    var stamp = new Date(json.last_online * 1000).toISOString().slice(0, 10);
    rows.push({ label: "Last online", value: stamp, tone: "muted" });
  }
  var profile = json.url || ("https://www.chess.com/member/" + meta.target);
  rows.push({ label: "Profile", value: profile, url: profile });
  return { state: "found", rows: rows };
}

function parseMailPolicy(status, text, meta) {
  // TXT answers at the domain (SPF) or _dmarc.<domain> (DMARC).
  var json = safeJson(text);
  var answers = dnsAnswers(json);
  if (!answers) {
    if (!isUsableHttp(status)) return error("dns.google responded HTTP " + status + ".");
    return error("DNS lookup failed (" + cleanString(json && json.Comment, 80) + ").");
  }
  var scope = (meta && meta.scope) || "spf";
  var want = scope === "dmarc" ? "v=dmarc1" : "v=spf1";
  var record = "";
  for (var i = 0; i < answers.length; i++) {
    var data = String(answers[i].data || "");
    if (data.toLowerCase().indexOf(want) === 0) { record = data; break; }
  }
  if (record === "") {
    return {
      state: "none",
      note: scope === "dmarc"
        ? "No DMARC record — mailbox providers decide what happens to forged mail."
        : "No SPF record — anyone can send mail as this domain.",
      rows: []
    };
  }
  var rows = [{ label: scope === "dmarc" ? "DMARC" : "SPF", value: cleanString(record, 110), mono: true }];
  if (scope === "dmarc") {
    var policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(record);
    if (policy) {
      rows.push({ label: "Policy", value: policy[1] === "none" ? "none (monitor only)" : policy[1],
        tone: policy[1] === "reject" ? "ok" : (policy[1] === "quarantine" ? "warn" : "muted") });
    }
  } else {
    var verdict = /(?:^|\s)([-~+]all)\s*$/i.exec(record);
    if (verdict) {
      var v = verdict[1];
      rows.push({ label: "Fallback", value: v === "-all" ? "hard fail" : (v === "~all" ? "soft fail" : "neutral"),
        tone: v === "-all" ? "ok" : "muted" });
    }
  }
  return { state: "found", rows: rows };
}

function parseInternetDb(status, text, meta) {
  var json = safeJson(text);
  if (status === 404 || (json && json.detail)) {
    return { state: "none", note: "No exposed services recorded (Shodan InternetDB).", rows: [] };
  }
  if (!isUsableHttp(status)) return error("Shodan InternetDB responded HTTP " + status + ".");
  if (!json || typeof json.ip !== "string") return error("InternetDB returned an unexpected response.");
  var ports = json.ports || [];
  var hostnames = json.hostnames || [];
  var vulns = json.vulns || [];
  var rows = [];
  if (ports.length > 0) rows.push({ label: "Open ports", value: ports.join(", "), mono: true });
  if (hostnames.length > 0) rows.push({ label: "Hostnames", value: hostnames.slice(0, 5).join(" \u00b7 "), mono: true });
  for (var v = 0; v < vulns.length; v++) {
    rows.push({ label: "Vulnerability", value: vulns[v], mono: true,
      url: "https://cve.org/CVERecord?id=" + vulns[v] });
  }
  if (rows.length === 0) {
    return { state: "none", note: "No exposed services recorded (Shodan InternetDB).", rows: [] };
  }
  return { state: "found", rows: rows };
}

function parseWebFingerprint(status, text, meta) {
  if (!isUsableHttp(status)) {
    if (status === 0) return error("The site did not answer (HTTPS).");
    return error("The site answered HTTP " + status + " over HTTPS.");
  }
  var rows = [];
  var title = /<title[^>]*>([^<]*)<\/title>/i.exec(String(text || ""));
  var titleText = title ? cleanString(title[1], 120) : "";
  if (titleText !== "") rows.push({ label: "Page title", value: titleText });
  var headers = String((meta && meta.headers) || "").toLowerCase();
  function headerValue(name) {
    var match = new RegExp("^" + name + ":\\s*(.+)$", "m").exec(headers);
    return match ? cleanString(match[1], 60) : "";
  }
  var server = headerValue("server");
  var poweredBy = headerValue("x-powered-by");
  if (server !== "") rows.push({ label: "Server", value: server, mono: true });
  if (poweredBy !== "") rows.push({ label: "Powered by", value: poweredBy, mono: true, tone: "muted" });
  if (rows.length === 0) rows.push({ label: "Response", value: "HTTPS " + status, tone: "muted" });
  rows.push({ label: "Site", value: "https://" + meta.target, url: "https://" + meta.target });
  return { state: "found", rows: rows };
}

function parseDockerHub(status, text, meta) {
  var json = safeJson(text);
  if (status === 404) return none("No Docker Hub account for \u201c" + meta.target + "\u201d.");
  if (!isUsableHttp(status)) return error("Docker Hub responded HTTP " + status + ".");
  if (!json || !json.username) return error("Docker Hub returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Username", value: json.username });
  if (cleanString(json.full_name)) rows.push({ label: "Name", value: cleanString(json.full_name, 60) });
  if (cleanString(json.location)) rows.push({ label: "Location", value: cleanString(json.location, 60) });
  if (cleanString(json.company)) rows.push({ label: "Company", value: cleanString(json.company, 60) });
  if (cleanString(json.profile_url)) {
    var site = cleanString(json.profile_url);
    rows.push({ label: "Website", value: site, url: site.indexOf("://") >= 0 ? site : "https://" + site });
  }
  var joined = cleanString(json.date_joined, 10);
  if (joined) rows.push({ label: "Joined", value: joined, tone: "muted" });
  rows.push({ label: "Profile", value: "https://hub.docker.com/u/" + meta.target,
    url: "https://hub.docker.com/u/" + meta.target });
  return { state: "found", rows: rows };
}

function feedTitle(text) {
  // RSS/Atom feed: root <title>; the first item title follows the feed title.
  var all = [];
  var re = /<title(?:[^>]*)>([^<]*)<\/title>/gi;
  var match;
  while ((match = re.exec(String(text || ""))) !== null && all.length < 3) {
    all.push(cleanString(match[1], 120));
  }
  return all;
}

function parseMedium(status, text, meta) {
  if (status === 404) return none("No Medium publication for @\u201c" + meta.target + "\u201d.");
  if (!isUsableHttp(status)) return error("Medium responded HTTP " + status + ".");
  var titles = feedTitle(text);
  if (titles.length === 0) return error("Medium returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Publication", value: titles[0] });
  if (titles[1]) rows.push({ label: "Latest post", value: titles[1], tone: "muted" });
  rows.push({ label: "Feed", value: "https://medium.com/feed/@" + meta.target,
    url: "https://medium.com/feed/@" + meta.target });
  return { state: "found", rows: rows };
}

function parseSubstack(status, text, meta) {
  if (status === 404) return none("No Substack publication at " + meta.target + ".substack.com.");
  if (!isUsableHttp(status)) return error("Substack responded HTTP " + status + ".");
  var titles = feedTitle(text);
  if (titles.length === 0) return error("Substack returned an unexpected response.");
  var rows = [];
  rows.push({ label: "Publication", value: titles[0] });
  if (titles[1]) rows.push({ label: "Latest post", value: titles[1], tone: "muted" });
  rows.push({ label: "Feed", value: "https://" + meta.target + ".substack.com/feed.xml",
    url: "https://" + meta.target + ".substack.com/feed.xml" });
  return { state: "found", rows: rows };
}

function parseTorExit(status, text, meta) {
  if (!isUsableHttp(status)) return error("check.torproject.org responded HTTP " + status + ".");
  var lines = String(text || "").split(/\r?\n/);
  var listed = false;
  var latest = "";
  for (var i = 0; i < lines.length; i++) {
    var match = /^ExitAddress\s+(\S+)\s+(\S+)/.exec(lines[i]);
    if (!match) continue;
    if (match[1] === meta.target) {
      listed = true;
      latest = match[2];
    }
  }
  if (!listed) {
    return { state: "none", note: "Not listed as a Tor exit node right now.", rows: [] };
  }
  return {
    state: "found",
    rows: [
      { label: "Tor exit", value: meta.target + " (since " + latest + ")", mono: true },
      { label: "Note", value: "Traffic from this address can look like it comes from the Tor network.", tone: "warn" }
    ]
  };
}

// ---------------------------------------------------------------------------
// dispatch

var PARSERS = {
  github: parseGithub,
  codeberg: parseCodeberg,
  gitlab: parseGitlab,
  mastodon: parseMastodon,
  keybase: parseKeybase,
  chess: parseChess,
  dockerhub: parseDockerHub,
  medium: parseMedium,
  substack: parseSubstack,
  gravatar: parseGravatar,
  dns: parseDns,
  mailPolicy: parseMailPolicy,
  geoIp: parseGeoIp,
  ptr: parsePtr,
  rdapIp: parseRdapIp,
  rdapDomain: parseRdapDomain,
  internetdb: parseInternetDb,
  torExit: parseTorExit,
  webFp: parseWebFingerprint,
  ctLogs: parseCtLogs
};

function parse(sourceId, status, text, meta) {
  var parser = PARSERS[sourceId];
  if (!parser) return error("Unknown source " + sourceId + ".");
  try {
    return parser(status, text, meta);
  } catch (e) {
    return error("Could not read the response.");
  }
}

function reportMarkdown(kind, value, checks, generatedAt) {
  // Renders a sweep as a flat, copy-paste friendly text report.
  var lines = [];
  lines.push("# Radar report \u2014 " + kindLabel(kind) + ": " + value);
  lines.push("");
  lines.push("Generated " + String(generatedAt || "").slice(0, 19).replace("T", " ") + " \u00b7 keyless public sources");
  lines.push("");
  for (var i = 0; i < checks.length; i++) {
    var check = checks[i];
    var stateWord = { found: "found", none: "absent", error: "failed", canceled: "stopped" }[check.state] || check.state;
    lines.push("## " + check.label + " \u2014 " + stateWord);
    if (check.note) lines.push("> " + check.note);
    var rows = check.rows || [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.value === undefined) continue;
      var prefix = row.label && row.label !== "" ? row.label + ": " : "- ";
      lines.push("- " + prefix + row.value + (row.url ? " (" + row.url + ")" : ""));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function kindLabel(kind) {
  return {
    username: "Username",
    email: "Email",
    ip: "IP address",
    domain: "Domain"
  }[kind] || kind;
}

// ---------------------------------------------------------------------------
// export for node; QML reaches the top-level functions through the import.

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    detect: detect,
    checksFor: checksFor,
    parse: parse,
    kindLabel: kindLabel,
    reportMarkdown: reportMarkdown,
    reverseDnsName: reverseDnsName,
    extractHost: extractHost
  };
}
