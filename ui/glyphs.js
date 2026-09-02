// glyphs.js - Nerd Font icon glyphs used by the Radar UI.
//
// Central table so glyph code points live in one place. Every entry was
// verified against JetBrainsMono Nerd Font (the Omarchy fontconfig alias);
// md-* icons live above the BMP and are written as UTF-16 surrogate
// pairs. Fall back to the search glyph for any icon role if a theme's
// font ever lacks one.

var GLYPH_RADAR = "\uDB81\uDC37";        // md-radar
var GLYPH_SEARCH = "\uF002";             // fa-search
var GLYPH_MAGNIFY = "\uDB80\uDF49";      // md-magnify

var GLYPH_USERNAME = "\uDB80\uDC04";     // md-account
var GLYPH_EMAIL = "\uDB80\uDDEE";        // md-email
var GLYPH_IP = "\uDB82\uDE60";           // md-ip_network
var GLYPH_DOMAIN = "\uDB81\uDD9F";       // md-web

var GLYPH_OPEN = "\uDB80\uDFCC";         // md-open_in_new
var GLYPH_COPY = "\uDB80\uDD8F";         // md-content_copy
var GLYPH_HISTORY = "\uDB80\uDEDA";      // md-history
var GLYPH_CLOSE = "\uDB80\uDD56";        // md-close
var GLYPH_CHECK = "\uDB80\uDD2C";        // md-check
var GLYPH_ALERT = "\uDB80\uDC26";        // md-alert
var GLYPH_SPINNER = "\uDB80\uDD10";      // md-progress_clock
var GLYPH_CHEVRON_RIGHT = "\uDB80\uDD42";
var GLYPH_REFRESH = "\uDB81\uDC50";      // md-refresh
var GLYPH_XMARK = "\uF00D";              // fa-xmark

var GLYPH_BY_KIND = {
  username: GLYPH_USERNAME,
  email: GLYPH_EMAIL,
  ip: GLYPH_IP,
  domain: GLYPH_DOMAIN
};
