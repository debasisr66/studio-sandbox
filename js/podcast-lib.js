/* Podcasts (SPEC-PC): platform labels, entry checks, the whole-file rules CI applies to podcasts.json, filters, and the retired #blog redirect. Part of the ReadsLib interface: loaded after js/reads-lib.js (in Node, reads-lib.js installs it). No DOM access, so Node can test it. */
(function (root) {
  'use strict';
  var install = function (L) {
    var H = L._h;
    var LIMITS = H.LIMITS, URL_HINT = H.URL_HINT, isObj = H.isObj, isPublishableUrl = H.isPublishableUrl, isStr = H.isStr, keyOf = H.keyOf, normalizeUrl = H.normalizeUrl, own = H.own, parseTags = H.parseTags, versionMsg = H.versionMsg;

    /* Podcasts (SPEC-PC PC-01). Version of the shape of content/podcasts.json; same tolerance rule as reads (missing or older is fine, newer is refused). */
    var PODCASTS_SCHEMA_VERSION = 1;
    var PODCAST_LIMITS = { show: 80 };   // title, comment and tags share LIMITS with Reads
    function isSupportedPodcastsVersion(v) {
      return !(typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v > PODCASTS_SCHEMA_VERSION);
    }
    /* Closed list keyed on the host: the host itself or a subdomain of it (never a substring, so evilspotify.com is not Spotify). */
    var PLATFORMS = [['spotify.com', 'Spotify'], ['podcasts.apple.com', 'Apple Podcasts'], ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube']];
    /* Label for a card: a platform name, else the plain domain (text only, escaped by the page). '' when the URL is unusable. */
    function platformOf(url) {
      var n = normalizeUrl(url);
      if (!n) return '';
      var host = new URL(n).hostname.toLowerCase();
      for (var i = 0; i < PLATFORMS.length; i++) {
        var d = PLATFORMS[i][0];
        if (host === d || host.slice(-d.length - 1) === '.' + d) return PLATFORMS[i][1];
      }
      return host.replace(/^www\./, '');
    }
    /* One shape for rendering, whatever optional fields are missing. */
    function podcastView(e) {
      e = e && typeof e === 'object' ? e : {};
      var s = function (v) { return typeof v === 'string' ? v : ''; };
      return { title: s(e.title), url: s(e.url), show: s(e.show), comment: s(e.comment), tags: Array.isArray(e.tags) ? e.tags : [], added: s(e.added), platform: platformOf(e.url) };
    }

    /* What the owner may publish for a podcast (SPEC-PC PC-03): link and title required; show, take and tags optional. Same strict link rule as Reads. */
    function validatePodcastEntry(e) {
      e = e || {};
      var errors = {}, url = normalizeUrl(e.url);
      if (!url) errors.url = 'Enter a valid web address starting with http:// or https://';
      var title = String(e.title == null ? '' : e.title).trim();
      if (!title) errors.title = 'Add a title';
      else if (title.length > LIMITS.title) errors.title = 'Keep the title under ' + LIMITS.title + ' characters';
      var show = String(e.show == null ? '' : e.show).trim();
      if (show.length > PODCAST_LIMITS.show) errors.show = 'Keep the show name under ' + PODCAST_LIMITS.show + ' characters';
      var comment = String(e.comment == null ? '' : e.comment).trim();
      if (comment.length > LIMITS.comment) errors.comment = 'Keep your take under ' + LIMITS.comment + ' characters';
      var ok = Object.keys(errors).length === 0;
      return { ok: ok, errors: errors, value: ok ? { url: url, title: title, show: show, comment: comment, tags: parseTags(e.tags) } : null };
    }
    /* The whole-file rules CI applies to podcasts.json (SPEC-PC PC-04), kept here so the admin screen runs the very same check before every publish
       (review PC-B). Returns { errors, warnings }; the messages are the rule texts in scripts/validate-site.js RULES. */
    function validatePodcastsFile(file) {
      var errors = [], warnings = [];
      if (!isObj(file) || !Array.isArray(file.podcasts)) return { errors: ['podcasts.json: needs a podcasts array'], warnings: warnings };
      if (file.schema_version !== PODCASTS_SCHEMA_VERSION) errors.push(versionMsg('podcasts.json', PODCASTS_SCHEMA_VERSION, file.schema_version));
      var ids = {}, links = {};
      file.podcasts.forEach(function (p, i) {
        var at = 'podcasts.json podcasts[' + i + ']';
        if (!isObj(p)) { errors.push(at + ': must be an object'); return; }
        if (!isStr(p.title) || !p.title.trim() || p.title.length > LIMITS.title) errors.push(at + ': podcast title is required, 1 to ' + LIMITS.title + ' characters');
        if (!isStr(p.url) || !isPublishableUrl(p.url) || !normalizeUrl(p.url)) errors.push(at + ': podcast url must be ' + URL_HINT);
        else { var k = keyOf(p.url); if (links[k]) warnings.push(at + ': same link as an earlier podcast'); links[k] = true; }
        if (p.show !== undefined && (!isStr(p.show) || p.show.length > PODCAST_LIMITS.show)) errors.push(at + ': podcast show must be text up to ' + PODCAST_LIMITS.show + ' characters');
        if (p.comment !== undefined && (!isStr(p.comment) || p.comment.length > LIMITS.comment)) errors.push(at + ': podcast comment must be text up to ' + LIMITS.comment + ' characters');
        if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length > LIMITS.tags || p.tags.some(function (t) { return !isStr(t) || t.length > LIMITS.tag; }))) errors.push(at + ': podcast tags must be an array of at most ' + LIMITS.tags + ' strings, each up to ' + LIMITS.tag + ' characters');
        if (p.added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.added))) errors.push(at + ': added must be YYYY-MM-DD');
        if (p.id !== undefined) { if (own(ids, String(p.id))) errors.push(at + ': podcast duplicate id ' + p.id); ids[String(p.id)] = true; }
      });
      return { errors: errors, warnings: warnings };
    }
    /* What the admin writes to podcasts.json: the version first, then the list; always the current version (a publish never drops the key). */
    function serializePodcasts(p) {
      return { schema_version: PODCASTS_SCHEMA_VERSION, podcasts: p && Array.isArray(p.podcasts) ? p.podcasts : [] };
    }
    function filterPodcasts(list, opts) {
      opts = opts || {};
      var q = String(opts.q || '').trim().toLowerCase();
      return (list || []).filter(function (e) {
        var v = podcastView(e);
        if (opts.tag && v.tags.indexOf(opts.tag) < 0) return false;
        if (!q) return true;
        return (v.title + ' ' + v.show + ' ' + v.comment + ' ' + v.url + ' ' + v.platform + ' ' + v.tags.join(' ')).toLowerCase().indexOf(q) >= 0;
      });
    }
    function podcastTags(list) {
      var count = Object.create(null);
      (list || []).forEach(function (e) { podcastView(e).tags.forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
      return Object.keys(count).sort(function (a, b) { return count[b] - count[a] || (a < b ? -1 : 1); });
    }
    /* The retired blog's links: '#blog' and '#blog/anything' go to '#podcasts' (SPEC-PC PC-05). '' for any other hash. */
    function redirectHash(hash) { return typeof hash === 'string' && /^#blog(\/.*)?$/.test(hash) ? '#podcasts' : ''; }

    L.PODCASTS_SCHEMA_VERSION = PODCASTS_SCHEMA_VERSION;
    L.PODCAST_LIMITS = PODCAST_LIMITS;
    L.isSupportedPodcastsVersion = isSupportedPodcastsVersion;
    L.platformOf = platformOf;
    L.podcastView = podcastView;
    L.validatePodcastEntry = validatePodcastEntry;
    L.serializePodcasts = serializePodcasts;
    L.validatePodcastsFile = validatePodcastsFile;
    L.filterPodcasts = filterPodcasts;
    L.podcastTags = podcastTags;
    L.redirectHash = redirectHash;
  };
  if (typeof module === 'object' && module.exports) module.exports = install;
  else install(root.ReadsLib);
})(typeof self !== 'undefined' ? self : this);
