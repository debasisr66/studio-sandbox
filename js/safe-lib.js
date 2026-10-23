/* Pure helpers that keep one failure from becoming a page-wide failure (SPEC-SH SH-01, SH-08). No DOM access, so Node can test them (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafeLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FETCH_TIMEOUT_MS = 8000;
  /* The only text a visitor ever sees when a section fails. A constant on purpose: an exception message must never reach the page. */
  var FALLBACK_TEXT = 'This section could not load. The rest of the page is unaffected.';

  function fallbackHtml() {
    return '<div class="empty" role="status">' + FALLBACK_TEXT + '</div>';
  }

  /* Runs every step even if earlier ones throw. steps: [{name, run}]. onFail(name, error) is called for each failure;
     if it throws too, that is swallowed. Returns the names of the steps that failed. Never throws. */
  function runGuarded(steps, onFail) {
    var failed = [];
    (steps || []).forEach(function (s) {
      try { s.run(); }
      catch (err) {
        failed.push(s.name);
        try { if (typeof onFail === 'function') onFail(s.name, err); } catch (e) { /* the handler must not break the page either */ }
      }
    });
    return failed;
  }

  /* fetch + JSON with a time limit. fetchImpl is injected so tests need no network.
     Rejects on timeout (and aborts the request), on a non-OK status (naming the path), and on a body that is not JSON. */
  function fetchJson(fetchImpl, url, opts) {
    opts = opts || {};
    var ms = opts.timeoutMs || FETCH_TIMEOUT_MS;
    var ctrl = new AbortController();
    var timer;
    var limit = new Promise(function (_, reject) {
      timer = setTimeout(function () { ctrl.abort(); reject(new Error(url + ' timed out after ' + ms + ' ms')); }, ms);
    });
    var init = Object.assign({}, opts.init || {}, { signal: ctrl.signal });
    var work = Promise.resolve(fetchImpl(url, init)).then(function (r) {
      if (!r.ok) { var err = new Error(url + ' ' + r.status); err.status = r.status; throw err; }   // the status is for callers that must tell 'no such file' from 'unknown'
      return r.json();
    });
    return Promise.race([work, limit]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  return { FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS, FALLBACK_TEXT: FALLBACK_TEXT, fallbackHtml: fallbackHtml, runGuarded: runGuarded, fetchJson: fetchJson };
});
