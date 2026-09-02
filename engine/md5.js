// md5.js - dependency-free MD5 for Gravatar lookups.
//
// QML's JS engine does not expose a crypto API and Qt.md5() is not part of
// the stable Quickshell surface, so the engine carries its own copy. This
// is the classic public-domain compact implementation by Joseph Myers,
// adapted to UTF-8 input and ES5 (QML supports neither typed arrays in this
// path nor ES6 module syntax).
//
// Exposes md5(str) -> lowercase hex string. Top-level function so QML can
// import the file directly; node gets it through module.exports.

function toUtf8(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      var next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        var combined = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(
          0xf0 | (combined >> 18),
          0x80 | ((combined >> 12) & 0x3f),
          0x80 | ((combined >> 6) & 0x3f),
          0x80 | (combined & 0x3f)
        );
        i++;
      } else {
        bytes.push(0xef, 0xbf, 0xbd); // replacement char
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function md5(str) {
  var message = toUtf8(String(str));
  var n = message.length;
  var bitLenLow = (n << 3) & 0xffffffff;
  var bitLenHigh = Math.floor(n / 0x20000000);

  var padding = 64 - ((n + 8) % 64);
  if (padding === 64) padding = 0;

  var bytes = message.slice();
  bytes.push(0x80);
  while (padding > 1) {
    bytes.push(0);
    padding--;
  }
  // little-endian 64-bit bit length
  for (var i = 0; i < 4; i++) bytes.push((bitLenLow >>> (8 * i)) & 0xff);
  for (var i = 0; i < 4; i++) bytes.push((bitLenHigh >>> (8 * i)) & 0xff);

  var words = new Array(bytes.length >> 2);
  for (var j = 0; j < words.length; j++) {
    words[j] =
      bytes[j * 4] |
      (bytes[j * 4 + 1] << 8) |
      (bytes[j * 4 + 2] << 16) |
      (bytes[j * 4 + 3] << 24);
  }

  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  var s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
           5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
           4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
           6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

  var K = new Array(64);
  for (var k = 0; k < 64; k++) {
    K[k] = Math.floor(Math.abs(Math.sin(k + 1)) * 0x100000000) & 0xffffffff;
  }

  function rotl(x, c) {
    return ((x << c) | (x >>> (32 - c))) >>> 0;
  }

  for (var chunk = 0; chunk < words.length; chunk += 16) {
    var w = words.slice(chunk, chunk + 16);
    var A = a0, B = b0, C = c0, D = d0;
    for (var i = 0; i < 64; i++) {
      var f, g;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      // Register rotation from the RFC 1321 reference implementation:
      // the step result lands in the slot that held d.
      var t = D;
      D = C;
      C = B;
      B = (B + rotl((A + f + K[i] + w[g]) | 0, s[i])) | 0;
      A = t;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  function toHex(num) {
    var out = "";
    for (var i = 0; i < 4; i++) {
      var byte = (num >>> (8 * i)) & 0xff;
      out += (byte < 16 ? "0" : "") + byte.toString(16);
    }
    return out;
  }

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

if (typeof module !== "undefined" && module.exports) module.exports = md5;
if (typeof this !== "undefined" && typeof this.md5 === "undefined") this.md5 = md5;
