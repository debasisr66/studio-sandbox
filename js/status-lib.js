/* The owner status line (SPEC-ST): the rules CI applies to content/status.json and the view the page may show. Part of the ReadsLib interface: loaded after js/reads-lib.js (in Node, reads-lib.js installs it). No DOM access, so Node can test it. */
(function (root) {
  'use strict';
  var install = function (L) {
    var H = L._h;
    var isObj = H.isObj, isStr = H.isStr, versionMsg = H.versionMsg;

    /* The owner status line (SPEC-ST): the rules CI applies to content/status.json, and the same rules decide what the page may show. now is a time in ms. */
    var STATUS_LIMITS = { items: 4, label: 20, value: 40 };
    function validateStatusFile(file, now) {
      var errors = [], plain = function (s) { return !/[<>]|https?:|www\./i.test(s); };
      if (!isObj(file)) return { errors: ['status.json: must be an object'], warnings: [] };
      if (file.schema_version !== 1) errors.push(versionMsg('status.json', 1, file.schema_version));
      var u = file.updated, d = isStr(u) ? new Date(u + 'T00:00:00Z') : null, ok = !!d && !isNaN(d) && /^\d{4}-\d{2}-\d{2}$/.test(u) && d.toISOString().slice(0, 10) === u;
      if (!ok) errors.push('status.json: updated must be a real date, YYYY-MM-DD');
      else if (Date.parse(u + 'T00:00:00Z') > now + 864e5) errors.push('status.json: updated (' + u + ') is in the future');
      if (!Array.isArray(file.items) || file.items.length < 1 || file.items.length > STATUS_LIMITS.items) errors.push('status.json: items must be a list of 1 to ' + STATUS_LIMITS.items + ' entries');
      else file.items.forEach(function (it, i) {
        var at = 'status.json items[' + i + ']';
        if (!isObj(it)) { errors.push(at + ': must be an object'); return; }
        ['label', 'value'].forEach(function (k) {
          var v = it[k];
          if (!isStr(v) || !v.trim() || v.trim().length > STATUS_LIMITS[k]) errors.push(at + ': ' + k + ' must be text of 1 to ' + STATUS_LIMITS[k] + ' characters');
          else if (!plain(v)) errors.push(at + ': ' + k + ' must be plain text (no markup, links or www)');
        });
      });
      return { errors: errors, warnings: [] };
    }
    /* What the page may show: null for anything CI would refuse, otherwise trimmed items and the date. */
    function statusView(file) {
      if (validateStatusFile(file, Date.now()).errors.length) return null;
      return { items: file.items.map(function (it) { return { label: it.label.trim(), value: it.value.trim() }; }), updated: file.updated };
    }

    L.validateStatusFile = validateStatusFile;
    L.statusView = statusView;
  };
  if (typeof module === 'object' && module.exports) module.exports = install;
  else install(root.ReadsLib);
})(typeof self !== 'undefined' ? self : this);
