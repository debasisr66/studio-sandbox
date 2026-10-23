/* Where the admin token lives, and when it is given up (idle lock). No DOM access, so Node can test it (UMD).
   create(getStorage, key): token in the given storage (the page passes sessionStorage: this tab only, forgotten when
   the tab closes). If that storage is blocked or full, the token is held in memory only, so a reload simply locks.
   purge(getStorage, key): deletes a token that an earlier version left in persistent storage (never migrated). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TokenStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function probe(getStorage) {
    try {
      var s = getStorage();
      s.setItem('__probe', '1');
      s.removeItem('__probe');
      return s;
    } catch (e) { return null; }
  }

  function create(getStorage, key) {
    var storage = probe(getStorage), mem = null;
    return {
      get: function () {
        if (storage) { try { var v = storage.getItem(key); if (v !== null) return v; } catch (e) {} }
        return mem;
      },
      set: function (v) {
        if (storage) { try { storage.setItem(key, v); mem = null; return; } catch (e) {} }
        mem = v;
      },
      del: function () {
        mem = null;
        if (storage) { try { storage.removeItem(key); } catch (e) {} }
      }
    };
  }

  function purge(getStorage, key) {
    try {
      var s = getStorage();
      var had = s.getItem(key) !== null;
      s.removeItem(key);
      return had;
    } catch (e) { return false; }
  }

  /* createIdleLock(ms, onIdle[, timers]): arm() (re)starts a countdown, so calling it on every user action means onIdle runs
     only after `ms` of inactivity; disarm() cancels. `timers` ({set, clear}) is injectable so the logic can be tested without waiting. */
  function createIdleLock(ms, onIdle, timers) {
    var t = timers || { set: function (f, d) { return setTimeout(f, d); }, clear: function (h) { clearTimeout(h); } };
    var handle = null;
    function disarm() { if (handle !== null) { t.clear(handle); handle = null; } }
    return {
      arm: function () { disarm(); handle = t.set(function () { handle = null; onIdle(); }, ms); },
      disarm: disarm,
      isArmed: function () { return handle !== null; }
    };
  }

  return { create: create, purge: purge, createIdleLock: createIdleLock };
});
