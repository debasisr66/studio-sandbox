/* Quick add (SPEC-QA): pasted-link and title extraction, kind suggestion, the #add address and the owner-only draft. Part of the ReadsLib interface: loaded after js/reads-lib.js (in Node, reads-lib.js installs it). No DOM access, so Node can test it. */
(function (root) {
  'use strict';
  var install = function (L) {
    var H = L._h;
    var LIMITS = H.LIMITS, normalizeUrl = H.normalizeUrl, own = H.own;
    var platformOf = L.platformOf;

    /* Quick add (SPEC-QA QA-02, QA-03, QA-07, QA-08): helpers for the Add to Studio sheet. Pure, bounded, never throw. */
    var SCAN_MAX = 20000;   // only this much of a pasted text is looked at
    /* trailing punctuation is not part of a link; a closing bracket stays only when its opener is inside the link (Wikipedia-style addresses) */
    function trimLink(s) {
      var pair = { ')': '(', ']': '[', '}': '{' }, n = { '(': 0, '[': 0, '{': 0, ')': 0, ']': 0, '}': 0 }, i;
      for (i = 0; i < s.length; i++) { var c = s.charAt(i); if (own(n, c)) n[c]++; }   // counted once, so trimming stays linear
      for (;;) {
        var last = s.charAt(s.length - 1);
        if (last && '.,;:!?\'"*_>'.indexOf(last) >= 0) { s = s.slice(0, -1); continue; }
        if (own(pair, last) && n[last] > n[pair[last]]) { n[last]--; s = s.slice(0, -1); continue; }
        return s;
      }
    }
    /* The first usable http(s) link in whatever was pasted (share text, a bare link, Markdown), normalised exactly as a typed link is; null when there is none. */
    function extractLink(text) {
      if (typeof text !== 'string' || !text) return null;
      var s = text.length > SCAN_MAX ? text.slice(0, SCAN_MAX) : text, re = /https?:\/\/[^\s<>"'`\u0000-\u001f\u007f-\u009f]+/gi, m;
      while ((m = re.exec(s)) !== null) { var n = normalizeUrl(trimLink(m[0])); if (n) return n; }
      return null;
    }
    /* The title line of share text ("Title", newline, link): the first line that is more than the link, cleaned; '' when there is none or no link. */
    function extractTitle(text) {
      if (typeof text !== 'string' || !text) return '';
      var s = text.length > SCAN_MAX ? text.slice(0, SCAN_MAX) : text;
      if (!/https?:\/\//i.test(s)) return '';
      var lines = s.split(/\r\n|\r|\n/);
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].replace(/https?:\/\/\S*/gi, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
        l = l.replace(/^[\s"'“”‘’*|:•–—-]+|[\s"'“”‘’*|:•–—-]+$/g, '');
        if (l) return l.length > LIMITS.title ? l.slice(0, LIMITS.title).trim() : l;
      }
      return '';
    }
    /* 'podcast' for Spotify and Apple Podcasts links (by host, never by substring), 'read' for everything else, including unusable input. */
    function suggestKind(url) {
      var p = platformOf(url);
      return p === 'Spotify' || p === 'Apple Podcasts' ? 'podcast' : 'read';
    }
    /* The address that opens the sheet: exactly '#add'. ('#add=...' is Phase B.) */
    function isAddHash(hash) { return hash === '#add'; }
    /* The owner-only draft (QA-07): five text fields and nothing else, so a token can never ride along. */
    var DRAFT_MAX = { url: LIMITS.url, title: 2 * LIMITS.title, comment: 2 * LIMITS.comment, tags: 200 };
    function clampDraft(o) {
      var out = { url: '', title: '', comment: '', tags: '', kind: '' };
      if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
      Object.keys(DRAFT_MAX).forEach(function (k) { var v = own(o, k) ? o[k] : undefined; if (typeof v === 'string') out[k] = v.slice(0, DRAFT_MAX[k]); });
      if (own(o, 'kind') && (o.kind === 'read' || o.kind === 'podcast')) out.kind = o.kind;
      return out;
    }
    function serializeDraft(o) {
      var d = clampDraft(o);
      var any = ['url', 'title', 'comment', 'tags'].some(function (k) { return d[k].trim() !== ''; });
      return any ? JSON.stringify(d) : '';
    }
    function parseDraft(raw) {
      if (typeof raw !== 'string' || !raw || raw.length > 20000) return null;
      var o; try { o = JSON.parse(raw); } catch (e) { return null; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      var d = clampDraft(o);
      return ['url', 'title', 'comment', 'tags'].some(function (k) { return d[k].trim() !== ''; }) ? d : null;
    }

    L.extractLink = extractLink;
    L.extractTitle = extractTitle;
    L.suggestKind = suggestKind;
    L.isAddHash = isAddHash;
    L.serializeDraft = serializeDraft;
    L.parseDraft = parseDraft;
  };
  if (typeof module === 'object' && module.exports) module.exports = install;
  else install(root.ReadsLib);
})(typeof self !== 'undefined' ? self : this);
