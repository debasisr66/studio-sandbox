/* Rules for the owner's profile photo. No DOM access, so Node can test them (UMD).
   The page decodes the chosen file, crops a centred square, re-encodes it as a small JPEG (which drops all metadata, including
   location) and publishes it as content/profile.jpg. These helpers hold the decisions; the browser does the pixel work. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImageLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    maxBytes: 10 * 1024 * 1024,            // chosen file
    maxPixels: 50 * 1000 * 1000,           // decoded size (guards against decompression bombs)
    minSide: 128,
    outSide: 512,
    outMaxBytes: 150 * 1024,
    qualities: [0.86, 0.8, 0.74, 0.68, 0.6]
  };
  var ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
  var TYPE_MSG = 'Choose a PNG, JPEG or WebP image up to 10 MB.';

  function checkFile(f) {
    if (!f || typeof f.size !== 'number') return { ok: false, error: TYPE_MSG };
    if (/\.svg$/i.test(String(f.name || ''))) return { ok: false, error: TYPE_MSG };   // SVG can carry script
    if (ALLOWED.indexOf(f.type) < 0) return { ok: false, error: TYPE_MSG };
    if (f.size <= 0) return { ok: false, error: 'That file is empty.' };
    if (f.size > LIMITS.maxBytes) return { ok: false, error: 'That image is larger than 10 MB. ' + TYPE_MSG };
    return { ok: true };
  }

  function checkDimensions(w, h) {
    if (!(isFinite(w) && isFinite(h) && w > 0 && h > 0 && Math.floor(w) === w && Math.floor(h) === h)) return { ok: false, error: 'That file isn\'t a usable image.' };
    if (w < LIMITS.minSide || h < LIMITS.minSide) return { ok: false, error: 'That image is too small. Use one at least ' + LIMITS.minSide + ' px on each side.' };
    if (w * h > LIMITS.maxPixels) return { ok: false, error: 'That image has too many pixels. Use one under 50 megapixels.' };
    return { ok: true };
  }

  function cropSquare(w, h) {
    var side = Math.min(w, h);
    return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side: side };
  }

  function dataUrlToBase64(url) {
    var m = typeof url === 'string' && /^data:image\/jpeg;base64,([A-Za-z0-9+\/]+={0,2})$/.exec(url);
    return m ? m[1] : null;
  }

  function base64Bytes(b64) {
    if (!b64) return 0;
    var pad = /=+$/.exec(b64);
    return Math.floor(b64.length * 3 / 4) - (pad ? pad[0].length : 0);
  }

  /* encodeFn(quality) -> bytes. Highest quality that fits; if none fits, the lowest tried, with ok:false. */
  function chooseQuality(encodeFn, limitBytes, qualities) {
    var qs = qualities || LIMITS.qualities, last = null;
    for (var i = 0; i < qs.length; i++) {
      var bytes = encodeFn(qs[i]);
      last = { quality: qs[i], bytes: bytes };
      if (bytes <= limitBytes) return { ok: true, quality: qs[i], bytes: bytes };
    }
    return { ok: false, quality: last.quality, bytes: last.bytes };
  }

  /* Reads the pixel size from a JPEG's frame header (used by CI on content/profile.jpg). bytes: Buffer or Uint8Array. */
  function jpegInfo(bytes) {
    var bad = { ok: false };
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bad;
    var i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xFF) return bad;
      while (bytes[i] === 0xFF && i < bytes.length) i++;                      // fill bytes
      var marker = bytes[i]; i++;
      if (marker === 0xD9 || marker === 0xDA) return bad;                      // end of image / start of scan before any frame header
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;     // markers without a length
      if (i + 1 >= bytes.length) return bad;
      var len = (bytes[i] << 8) | bytes[i + 1];
      var isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSof) {
        if (i + 6 >= bytes.length) return bad;
        var height = (bytes[i + 3] << 8) | bytes[i + 4], width = (bytes[i + 5] << 8) | bytes[i + 6];
        return width > 0 && height > 0 ? { ok: true, width: width, height: height } : bad;
      }
      if (len < 2) return bad;
      i += len;
    }
    return bad;
  }

  return { LIMITS: LIMITS, ALLOWED: ALLOWED, checkFile: checkFile, checkDimensions: checkDimensions, cropSquare: cropSquare,
    dataUrlToBase64: dataUrlToBase64, base64Bytes: base64Bytes, chooseQuality: chooseQuality, jpegInfo: jpegInfo };
});
