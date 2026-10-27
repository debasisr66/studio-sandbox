/* Pure helpers for the Reads feature and the shared basics (links, limits, versions). No DOM access, so Node can test them (UMD). The podcast, status and Quick add helpers are in js/podcast-lib.js, js/status-lib.js and js/quickadd-lib.js, which add themselves to this interface. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadsLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['article', 'video', 'paper', 'podcast', 'tool'];
  /* The sections a read or book can belong to (SPEC-RC RC-01, RC-09). A closed list: adding a value here is the whole code change.
     Anything missing or unknown is shown as 'other' in the browser (never an error); CI rejects it (rule reads-category). */
  var CATEGORIES = ['technical', 'other'];
  var DEFAULT_NEW_CATEGORY = 'technical';   // what the admin gives a new read until the Section choice ships (RC Phase B)
  function categoryOf(e) {
    var c = e && typeof e === 'object' ? e.category : undefined;
    return typeof c === 'string' && CATEGORIES.indexOf(c) >= 0 ? c : 'other';
  }
  /* Whole-section counts, ignoring any tag or search filter. */
  function categoryCounts(list, cats) {
    var out = {};
    (cats || CATEGORIES).forEach(function (c) { out[c] = 0; });
    (list || []).forEach(function (e) { var c = categoryOf(e); if (c in out) out[c]++; });
    return out;
  }
  /* Section tabs (SPEC-RC RC-02, RC-03). Labels and URL slugs for the closed list; a value added to CATEGORIES works without further edits
     (label = capitalised value, slug = the value itself). */
  var CATEGORY_LABELS = { technical: 'Technical', other: 'Others' };
  var CATEGORY_SLUGS = { technical: 'technical', other: 'others' };
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var isObj = function (v) { return v && typeof v === 'object' && !Array.isArray(v); }, isStr = function (v) { return typeof v === 'string'; };
  var versionMsg = function (f, want, got) { return f + ": schema_version must be " + want + " (this is the version of the file's shape; got " + JSON.stringify(got) + ')'; };
  var URL_HINT = 'a clean http(s) address (no spaces, control characters or login details)';
  function categoryLabel(c) { return own(CATEGORY_LABELS, c) ? CATEGORY_LABELS[c] : String(c).charAt(0).toUpperCase() + String(c).slice(1); }
  function categorySlug(c) { return own(CATEGORY_SLUGS, c) ? CATEGORY_SLUGS[c] : String(c); }
  function categoryFromSlug(s) {
    if (typeof s !== 'string') return '';
    for (var i = 0; i < CATEGORIES.length; i++) if (categorySlug(CATEGORIES[i]) === s) return CATEGORIES[i];
    return '';
  }
  /* '#reads/others' -> 'other'. '' for '#reads', anything unknown, or anything that is not a reads link (never an error). */
  function categoryFromHash(hash) {
    var m = typeof hash === 'string' && hash.length < 200 ? /^#reads\/([^\/?#]*)$/.exec(hash) : null;
    return m ? categoryFromSlug(m[1]) : '';
  }
  function isReadsHash(hash) { return typeof hash === 'string' && /^#reads(\/.*)?$/.test(hash); }
  function categoryHash(c) { return '#reads/' + categorySlug(c); }
  /* One entry per section for the tab list: counts cover the whole section (reads and books), never a filtered view. */
  function categoryTabs(articles, books) {
    var counts = categoryCounts((articles || []).concat(books || []));
    return CATEGORIES.map(function (c) { return { category: c, label: categoryLabel(c), slug: categorySlug(c), count: counts[c] }; });
  }
  /* Technical, or the first section that has entries when Technical is empty; Technical when everything is empty. */
  function defaultCategory(counts) {
    counts = counts || {};
    for (var i = 0; i < CATEGORIES.length; i++) if (counts[CATEGORIES[i]] > 0) return CATEGORIES[i];
    return CATEGORIES[0];
  }
  /* Roving-tabindex keys for a tab list: index to move to, or -1 when the key is not ours. */
  function nextTabIndex(key, current, count) {
    if (!(count > 0)) return -1;
    if (key === 'ArrowRight') return (current + 1) % count;
    if (key === 'ArrowLeft') return (current - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
  }
  var LIMITS = { url: 2048, title: 140, comment: 280, tags: 5, tag: 24 };
  var TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid|igshid)$/i;

  /* Returns a clean http(s) URL string, or null if the input is unusable or unsafe. */
  function normalizeUrl(input) {
    if (typeof input !== 'string') return null;
    var s = input.trim();
    if (!s || s.length > LIMITS.url) return null;
    if (s.indexOf('//') === 0) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (/\s/.test(s) || s.indexOf('.') < 1) return null;
      s = 'https://' + s;
    }
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!u.hostname || u.hostname.indexOf('.') < 1) return null;
    u.hash = '';
    var drop = [];
    u.searchParams.forEach(function (_, k) { if (TRACKING.test(k)) drop.push(k); });
    drop.forEach(function (k) { u.searchParams.delete(k); });
    var out = u.toString();
    if (out.length > LIMITS.url) return null;
    return out.replace(/\?$/, '');
  }

  /* Version of the shape of content/reads.json (SPEC-SH SH-04). The browser tolerates a missing or older version (documented defaults)
     and refuses only a NEWER one, so it never edits or publishes over a file it does not understand. CI requires the key. */
  var READS_SCHEMA_VERSION = 2;   // 2 = every read and book has a category (SPEC-RC RC-05); 1 = before
  function isSupportedReadsVersion(v) {
    return !(typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v > READS_SCHEMA_VERSION);
  }
  /* What the admin writes to reads.json: the version first, then the lists. Always the current version, so a publish never drops the key.
     An entry that somehow has no valid category (hand edit, legacy) gets the admin default, so a publish can never fail the CI category rule. */
  function withCategory(e) {
    if (!e || typeof e !== 'object' || CATEGORIES.indexOf(e.category) >= 0) return e;
    var o = {}; Object.keys(e).forEach(function (k) { o[k] = e[k]; }); o.category = DEFAULT_NEW_CATEGORY; return o;
  }
  function serializeReads(r) {
    r = r || {};
    return { schema_version: READS_SCHEMA_VERSION, books: (Array.isArray(r.books) ? r.books : []).map(withCategory), articles: (Array.isArray(r.articles) ? r.articles : []).map(withCategory) };
  }

  /* Strict check for a URL that is stored or published (CI and the admin screen): http(s) only, no whitespace or control
     characters anywhere (new URL() would silently trim or strip them), no credentials, a host, within the length limit.
     Unlike normalizeUrl it never repairs its input; it only says yes or no. */
  function isPublishableUrl(input) {
    if (typeof input !== 'string' || !input || input.length > LIMITS.url) return false;
    if (/[\u0000-\u0020\u007f-\u009f]/.test(input)) return false;
    if (!/^https?:\/\/[^\/?#\\]/i.test(input)) return false;   // the host must be written out (new URL() reads https:///x as host "x")
    var u;
    try { u = new URL(input); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return !!u.hostname;
  }

  function domainOf(url) {
    var n = normalizeUrl(url);
    if (!n) return null;
    return new URL(n).hostname.replace(/^www\./, '');
  }

  function keyOf(url) {
    var n = normalizeUrl(url);
    if (!n) return null;
    var u = new URL(n);
    var path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
    return u.hostname.replace(/^www\./, '') + path + u.search;
  }

  /* excludeId lets the editor ignore the entry being edited. */
  function isDuplicate(list, url, excludeId) {
    var k = keyOf(url);
    if (!k || !Array.isArray(list)) return false;
    return list.some(function (e) {
      if (!e || (excludeId !== undefined && e.id === excludeId)) return false;
      return keyOf(e.url) === k;
    });
  }

  function parseTags(input) {
    var raw = Array.isArray(input) ? input : String(input == null ? '' : input).split(',');
    var out = [];
    raw.forEach(function (t) {
      t = String(t).trim().toLowerCase().replace(/[^a-z0-9#+._ -]/g, '').replace(/\s+/g, '-').replace(/^#+/, '').slice(0, LIMITS.tag);
      if (t && out.indexOf(t) < 0) out.push(t);
    });
    return out.slice(0, LIMITS.tags);
  }

  /* -> { ok, errors:{field:msg}, value } ; value is only meaningful when ok. */
  function validateEntry(e, opts) {
    e = e || {};
    var errors = {};
    var url = normalizeUrl(e.url);
    if (!url) errors.url = 'Enter a valid web address starting with http:// or https://';
    var title = String(e.title == null ? '' : e.title).trim();
    if (!title) errors.title = 'Add a title';
    else if (title.length > LIMITS.title) errors.title = 'Keep the title under ' + LIMITS.title + ' characters';
    var comment = String(e.comment == null ? '' : e.comment).trim();
    if (comment.length > LIMITS.comment) errors.comment = 'Keep your take under ' + LIMITS.comment + ' characters';
    var kind = e.kind == null || e.kind === '' ? 'article' : String(e.kind);
    if (KINDS.indexOf(kind) < 0) errors.kind = 'Choose a type from the list';
    var hasCat = e.category !== undefined && e.category !== null && e.category !== '';
    if ((hasCat && CATEGORIES.indexOf(e.category) < 0) || (!hasCat && opts && opts.requireCategory)) errors.category = 'Choose a section';
    var ok = Object.keys(errors).length === 0, value = null;
    if (ok) { value = { url: url, title: title, comment: comment, kind: kind, tags: parseTags(e.tags) }; if (hasCat) value.category = e.category; }   // no category given: an edit keeps the entry's own
    return { ok: ok, errors: errors, value: value };
  }

  function shareLinks(url) {
    var n = normalizeUrl(url);
    if (!n) return null;
    return { url: n, linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(n) };
  }

  /* Normalises legacy {title,url,note} and new entries to one shape for rendering. */
  function entryView(e) {
    e = e || {};
    return {
      title: e.title || '',
      url: e.url || '',
      comment: e.comment != null && e.comment !== '' ? e.comment : (e.note || ''),
      kind: KINDS.indexOf(e.kind) >= 0 ? e.kind : 'article',
      tags: Array.isArray(e.tags) ? e.tags : [],
      category: categoryOf(e),
      added: e.added || ''
    };
  }

  function filterReads(list, opts) {
    opts = opts || {};
    var q = String(opts.q || '').trim().toLowerCase();
    return (list || []).filter(function (e) {
      var v = entryView(e);
      if (opts.category && v.category !== opts.category) return false;
      if (opts.tag && v.tags.indexOf(opts.tag) < 0) return false;
      if (!q) return true;
      return (v.title + ' ' + v.comment + ' ' + v.url + ' ' + v.tags.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function allTags(list) {
    var count = Object.create(null);   // no prototype: a tag called "constructor" or "__proto__" counts like any other
    (list || []).forEach(function (e) { entryView(e).tags.forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
    return Object.keys(count).sort(function (a, b) { return count[b] - count[a] || (a < b ? -1 : 1); });
  }

  /* The whole-file rules CI applies to reads.json; validate-site.js delegates here, so the admin check and CI cannot drift apart. */
  function validateReadsFile(reads) {
    var errors = [], warnings = [];
    if (!isObj(reads) || !Array.isArray(reads.articles) || !Array.isArray(reads.books)) return { errors: ['reads.json: needs articles and books arrays'], warnings: warnings };
    if (reads.schema_version !== READS_SCHEMA_VERSION) errors.push(versionMsg('reads.json', READS_SCHEMA_VERSION, reads.schema_version));
    var ids = {}, urls = {};
    reads.articles.forEach(function (a, i) {
      var at = 'reads.json articles[' + i + ']';
      if (!isObj(a)) { errors.push(at + ': must be an object'); return; }
      if (!isStr(a.title) || !a.title.trim()) errors.push(at + ': title is required');
      var clean = isStr(a.url) ? normalizeUrl(a.url) : null;
      if (!clean || !isPublishableUrl(a.url)) errors.push(at + ': url must be ' + URL_HINT);
      else { var k = domainOf(clean) + new URL(clean).pathname.replace(/\/+$/, ''); if (urls[k]) warnings.push(at + ': same link as an earlier read'); urls[k] = true; }
      if (a.kind !== undefined && KINDS.indexOf(a.kind) < 0) errors.push(at + ': kind must be one of ' + KINDS.join(', '));
      if (a.tags !== undefined && (!Array.isArray(a.tags) || a.tags.length > LIMITS.tags || a.tags.some(function (t) { return !isStr(t); }))) errors.push(at + ': tags must be an array of at most ' + LIMITS.tags + ' strings');
      if (a.comment !== undefined && (!isStr(a.comment) || a.comment.length > LIMITS.comment)) errors.push(at + ': comment must be text up to ' + LIMITS.comment + ' characters');
      if (CATEGORIES.indexOf(a.category) < 0) errors.push(at + ': category must be one of ' + CATEGORIES.join(', '));
      if (a.added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.added))) errors.push(at + ': added must be YYYY-MM-DD');
      if (a.id !== undefined) { if (own(ids, String(a.id))) errors.push(at + ': duplicate id ' + a.id); ids[String(a.id)] = true; }
    });
    reads.books.forEach(function (b, i) {
      if (!isObj(b) || !isStr(b.title) || !b.title.trim()) errors.push('reads.json books[' + i + ']: title is required');
      if (isObj(b) && CATEGORIES.indexOf(b.category) < 0) errors.push('reads.json books[' + i + ']: category must be one of ' + CATEGORIES.join(', '));
    });
    return { errors: errors, warnings: warnings };
  }
  /* Chooses the release file for a card's Download button (used by the products grid, not Reads).
     pattern: optional wildcard such as "PennyExpenseManager-*.zip" ('*' = any characters, case-insensitive).
     No pattern -> first asset (previous behavior). Pattern with no match -> null, so the card falls back
     to the release page instead of offering a wrong file. */
  function pickAsset(assets, pattern) {
    var list = Array.isArray(assets) ? assets.filter(function (a) { return a && a.name && a.download_url; }) : [];
    if (typeof pattern !== 'string' || !pattern.trim()) return list[0] || null;
    var re = new RegExp('^' + pattern.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
    return list.filter(function (a) { return re.test(a.name); })[0] || null;
  }

  /* '19 Oct 2026'. Date-only strings (2026-10-19) are calendar dates, so they are formatted in UTC;
     parsing them as local time would show the previous day to visitors west of Greenwich. */
  function formatDate(d) {
    var t = new Date(d);
    if (isNaN(t)) return '';
    var o = { day: 'numeric', month: 'short', year: 'numeric' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) o.timeZone = 'UTC';
    return t.toLocaleDateString('en-GB', o);
  }

  var api = { KINDS: KINDS, CATEGORIES: CATEGORIES, categoryLabel: categoryLabel, categorySlug: categorySlug, categoryFromHash: categoryFromHash, isReadsHash: isReadsHash, categoryHash: categoryHash, categoryTabs: categoryTabs, defaultCategory: defaultCategory, nextTabIndex: nextTabIndex, DEFAULT_NEW_CATEGORY: DEFAULT_NEW_CATEGORY, categoryOf: categoryOf, categoryCounts: categoryCounts, pickAsset: pickAsset, formatDate: formatDate, LIMITS: LIMITS, normalizeUrl: normalizeUrl, isPublishableUrl: isPublishableUrl, READS_SCHEMA_VERSION: READS_SCHEMA_VERSION, validateReadsFile: validateReadsFile, isSupportedReadsVersion: isSupportedReadsVersion, serializeReads: serializeReads, domainOf: domainOf, keyOf: keyOf, isDuplicate: isDuplicate, parseTags: parseTags, validateEntry: validateEntry, shareLinks: shareLinks, entryView: entryView, filterReads: filterReads, allTags: allTags };
  /* Shared helpers for the parts (podcast-lib.js, status-lib.js, quickadd-lib.js); not for the page. */
  api._h = { LIMITS: LIMITS, URL_HINT: URL_HINT, isObj: isObj, isPublishableUrl: isPublishableUrl, isStr: isStr, keyOf: keyOf, normalizeUrl: normalizeUrl, own: own, parseTags: parseTags, versionMsg: versionMsg };
  if (typeof module === 'object' && module.exports) { require('./podcast-lib.js')(api); require('./status-lib.js')(api); require('./quickadd-lib.js')(api); }
  return api;
});
