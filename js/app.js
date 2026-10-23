'use strict';
const OWNER = 'debasisr66', HUB = 'studio-sandbox', BRANCH = 'main';
const PAT_KEY = 'studio-admin-pat';
const SEEN_KEY = 'studio-seen-version';
const IDLE_MS = 30 * 60 * 1000;
const RL = window.ReadsLib;
const IL = window.ImageLib;
const LANG = {JavaScript:'#F1E05A',TypeScript:'#3178C6',Swift:'#F05138',Python:'#3572A5',Kotlin:'#A97BFF',Java:'#B07219',Go:'#00ADD8',Rust:'#DEA584',HTML:'#E34C26',CSS:'#563D7C',Dart:'#00B4AB','C#':'#178600',Ruby:'#701516',Shell:'#89E051'};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const fmtDate = RL.formatDate;
const fmtSize = n => n > 1048576 ? (n/1048576).toFixed(1)+' MB' : Math.max(1, Math.round(n/1024))+' KB';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k,v) => { try { localStorage.setItem(k,v); } catch {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };

/* Admin token: sessionStorage (this tab only, forgotten when it closes), memory-only if the browser blocks it.
   See js/token-store.js. Earlier versions kept the token in localStorage; it is deleted here, deliberately not migrated. */
const tokenStore = window.TokenStore.create(() => window.sessionStorage, PAT_KEY);
window.TokenStore.purge(() => window.localStorage, PAT_KEY);
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const NEWTAB = '<span class="sr"> (opens in a new tab)</span>';

/* The CSP forbids style attributes in markup, so the two dynamic values (avatar hue, language dot colour)
   travel as data attributes and are applied through the CSSOM, which the CSP allows. */
function paint(root = document) {
  root.querySelectorAll('[data-h]').forEach(e => e.style.setProperty('--h', e.dataset.h));
  root.querySelectorAll('[data-bg]').forEach(e => e.style.setProperty('background', e.dataset.bg));
}

/* polite announcement for screen readers and sighted users */
let statusTimer;
function say(msg) {
  const el = $('#status'); el.textContent = msg; el.classList.add('show');
  clearTimeout(statusTimer); statusTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* very small, safe markdown subset: paragraphs, "-"/"*" bullets, headings as bold, **bold**, `code` */
function md(text) {
  // links: only explicit http(s) targets become anchors; anything else (e.g. relative paths) keeps just its label
  const link = (m, label, href) => {
    const raw = href.replace(/&amp;/g, '&');
    return /^https?:\/\//i.test(raw) && safeUrl(raw) ? `<a href="${esc(safeUrl(raw))}" rel="noopener noreferrer" target="_blank">${label}</a>` : label;
  };
  const inline = s => esc(s).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, link).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code class="mono">$1</code>');
  let html = '', list = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += '<li>'+inline(li[1])+'</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.*)/);
    html += h ? '<p><strong>'+inline(h[1])+'</strong></p>' : '<p>'+inline(line)+'</p>';
  }
  return html + (list ? '</ul>' : '');
}

/* ---------- state ---------- */
const state = { changelog: null, registry: [], cache: null, podcasts: {podcasts: []}, reads: {books: [], articles: []}, profile: {photo: null, updated: null}, profileDraft: null, profileShown: null, dirty: {podcasts:false, reads:false, profile:false}, filter: {tag:'', q:''}, editing: -1, cat: null, lastSection: null, pfilter: {tag:'', q:''}, pediting: -1, pEntry: null, editEntry: null, podcastsUnsupported: false, podcastsFailed: false, readsFailed: false };
/* the content of reads.json and podcasts.json as this page loaded (or last wrote) it: publish refuses when GitHub's copy is different (another device published, or a stale page) */
const snap = {};

/* time-limited (SafeLib.FETCH_TIMEOUT_MS): a content file that never answers degrades its section instead of holding the page forever */
const loadJson = path => window.SafeLib.fetchJson(fetch, path + '?t=' + Date.now(), { init: { cache: 'no-store' } });

async function boot() {
  $('#yr').textContent = new Date().getFullYear();
  const [reg, cache, podcasts, reads, changelog, profile] = await Promise.allSettled([
    loadJson('content/products.json'), loadJson('content/cache.json'),
    loadJson('content/podcasts.json'), loadJson('content/reads.json'), loadJson('content/changelog.json'), loadJson('content/profile.json')]);
  // a file that loaded as JSON `null` or a bare value must not abort boot: only objects are used
  const obj = r => (r.status === 'fulfilled' && r.value && typeof r.value === 'object') ? r.value : null;
  // 404 = the file does not exist yet (an empty list); any other failure (timeout, 5xx, malformed JSON, a bare `null`) means the content is unknown, so nothing may be published over it
  const notFound = r => r.status === 'rejected' && !!r.reason && r.reason.status === 404;
  const unknown = r => (r.status === 'rejected' && !notFound(r)) || (r.status === 'fulfilled' && !(r.value && typeof r.value === 'object'));
  state.readsFailed = unknown(reads); state.podcastsFailed = unknown(podcasts) || (obj(podcasts) !== null && !Array.isArray(obj(podcasts).podcasts) && RL.isSupportedPodcastsVersion(obj(podcasts).schema_version));
  const vProfile = obj(profile), vCache = obj(cache), vPods = obj(podcasts), vReads = obj(reads), vLog = obj(changelog);
  if (vProfile) state.profile = vProfile;
  if (reg.status === 'fulfilled' && Array.isArray(reg.value)) state.registry = reg.value;
  if (vCache && typeof vCache.products === 'object') state.cache = vCache;
  snap['content/podcasts.json'] = vPods ? JSON.stringify(vPods) : notFound(podcasts) ? 'absent' : undefined;
  snap['content/reads.json'] = vReads ? JSON.stringify(vReads) : notFound(reads) ? 'absent' : undefined;
  if (vPods && !state.podcastsFailed) {
    // same rule as reads: a file newer than this page understands is not shown or edited, and nothing can be published over it
    if (!RL.isSupportedPodcastsVersion(vPods.schema_version)) state.podcastsUnsupported = true;
    else state.podcasts = { podcasts: Array.isArray(vPods.podcasts) ? vPods.podcasts : [] };
  }
  if (vReads) {
    // a file newer than this page understands is not shown or edited (Reads falls back, nothing can be published over it)
    if (!RL.isSupportedReadsVersion(vReads.schema_version)) state.readsUnsupported = true;
    else state.reads = { books: Array.isArray(vReads.books) ? vReads.books : [], articles: Array.isArray(vReads.articles) ? vReads.articles : [] };
  }
  if (vLog && Array.isArray(vLog.releases)) {
    // tolerate bad entries at runtime (CI rejects them before they ship): keep only well-formed releases
    state.changelog = vLog.releases.filter(r => r && typeof r.version === 'string' && typeof r.title === 'string' && Array.isArray(r.items));
    if (!state.changelog.length) state.changelog = null;
  }
  $('#grid').removeAttribute('aria-busy');
  state.cat = RL.categoryFromHash(location.hash) || RL.defaultCategory(RL.categoryCounts(state.reads.articles.concat(state.reads.books)));
  renderAll();
  if (followBlogLink()) showId('podcasts');
  if (RL.isReadsHash(location.hash) && location.hash !== '#reads') showReads();   // '#reads/others' matches no element id, so the browser cannot scroll to it
  if (tokenStore.get()) enableAdmin();   // always reached: renderAll never throws
  if (RL.isAddHash(location.hash)) openAdd();   // the Home Screen entry (QA-08)
}

/* ---------- render: products, updates ---------- */
function productView(e) {
  const live = state.cache && state.cache.products[e.repo];
  const name = e.name || e.repo.split('/')[1];
  return {
    e, live, name,
    tagline: e.tagline || (live && live.description) || '',
    url: (live && live.html_url) || 'https://github.com/' + e.repo,
    rel: live && live.latest_release,
  };
}

function renderProducts() {
  const list = state.registry.filter(p => p && p.repo && !p.hidden).map(productView)
    .sort((a,b) => (b.e.featured?1:0) - (a.e.featured?1:0));
  const notice = $('#notice');
  notice.innerHTML = '';
  if (!state.cache && list.length) notice.innerHTML = '<div class="notice" role="status">Live data is unavailable right now — showing basic product info.</div>';
  if (!list.length) { $('#grid').innerHTML = '<div class="empty grid-full">No products to show yet.</div>'; return; }
  $('#grid').innerHTML = list.map(p => {
    const l = p.live, lang = l && l.language;
    const site = safeUrl(p.e.url);
    const asset = p.rel ? RL.pickAsset(p.rel.assets, p.e.download_asset) : null;   // registry "download_asset" wildcard picks the app build
    const hasAsset = !!asset;
    const dl = p.rel && safeUrl(hasAsset ? asset.download_url : p.rel.download_url);
    return `<article class="card${p.e.featured ? ' featured' : ''}">
      <div class="row">${p.e.category ? `<span class="tag">${esc(p.e.category)}</span>` : ''}${p.rel ? `<span class="tag ver mono">${esc(p.rel.tag)}</span>` : ''}</div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.tagline)}</p>
      <div class="meta">
        ${lang ? `<span><i class="dot" data-bg="${esc(LANG[lang] || 'var(--muted)')}"></i>${esc(lang)}</span>` : ''}
        ${l ? `<span><span aria-hidden="true">★</span> ${Number(l.stars) || 0}<span class="sr"> stars</span></span>` : ''}
        ${l && l.pushed_at ? `<span>Updated ${esc(fmtDate(l.pushed_at))}</span>` : ''}
      </div>
      <div class="actions">
        ${site ? `<a class="primary" href="${esc(site)}" rel="noopener noreferrer" aria-label="Open ${esc(p.name)} (opens in a new tab)" target="_blank">Open app</a>` : ''}
        ${dl ? `<a class="${site ? '' : 'primary'}" href="${esc(dl)}" rel="noopener noreferrer" target="_blank" aria-label="${hasAsset ? 'Download' : 'Release notes for'} ${esc(p.name)} (opens in a new tab)">${hasAsset ? 'Download' : 'Release'}</a>` : ''}
        <a href="${esc(safeUrl(p.url))}" rel="noopener noreferrer" target="_blank" aria-label="${esc(p.name)} source code (opens in a new tab)">Source</a>
      </div></article>`;
  }).join('');
  paint($('#grid'));
  $('#syncnote').textContent = state.cache ? 'Live from GitHub' : '';
  $('#synced').textContent = state.cache && state.cache.synced_at ? fmtDate(state.cache.synced_at) : 'unavailable';
}

/* long release notes are collapsed (progressive disclosure); short ones show inline */
function notesHtml(body) {
  const html = md(body);
  if (!html) return '';
  return String(body).length > 500
    ? `<details class="notes"><summary>Show release notes</summary><div class="body">${html}</div></details>`
    : `<div class="body">${html}</div>`;
}

function renderUpdates() {
  const items = state.registry.filter(p => p && !p.hidden).map(productView).filter(p => p.rel)
    .sort((a,b) => new Date(b.rel.published_at) - new Date(a.rel.published_at));
  $('#updatesFeed').innerHTML = items.length ? items.map(p => `
    <article class="item">
      <div class="row"><span class="tag ver mono">${esc(p.rel.tag)}</span><span class="when">${esc(fmtDate(p.rel.published_at))}</span></div>
      <h3>${esc(p.name)} — ${esc(p.rel.name)}</h3>
      ${notesHtml(p.rel.body)}
      <div class="row mt10">${(p.rel.assets || []).map(a => safeUrl(a.download_url) ? `<a class="tag mono" href="${esc(safeUrl(a.download_url))}" rel="noopener noreferrer">⬇ ${esc(a.name)} · ${esc(fmtSize(a.size))}</a>` : '').join('')}
      <a class="more" href="${esc(safeUrl(p.rel.download_url))}" rel="noopener noreferrer" target="_blank">Release notes →${NEWTAB}</a></div>
    </article>`).join('') : '<div class="empty">No releases published yet. Release notes will appear here automatically.</div>';
}

const tools = (kind, i, what) => `<span class="tools"><button type="button" data-edit="${kind}:${i}" aria-label="Edit ${esc(what)}">Edit</button><button type="button" data-del="${kind}:${i}" aria-label="Delete ${esc(what)}">Delete</button></span>`;

/* ---------- render: reads ---------- */
function readCard(entry, index, preview) {
  const v = RL.entryView(entry), url = RL.normalizeUrl(v.url), dom = url ? RL.domainOf(url) : null;
  const meta = [dom, v.kind, v.added ? fmtDate(v.added) : ''].filter(Boolean).map(esc).join(' · ');
  const share = !preview && url ? RL.shareLinks(url) : null;
  const title = v.title ? esc(v.title) : '<em>Untitled</em>';
  return `<article class="item read"${preview ? ' aria-hidden="true"' : ''}>${preview ? '' : tools('article', index, 'read ' + v.title)}
    <div class="read-head"><span class="avatar" aria-hidden="true" data-h="${hue(dom || v.title)}">${esc((dom || v.title || '?').charAt(0))}</span>
      <div>${url && !preview ? `<a class="read-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}${NEWTAB}</a>` : `<span class="read-title">${title}</span>`}
      <div class="when">${meta}</div></div></div>
    ${v.comment ? `<p class="read-comment">${esc(v.comment)}</p>` : ''}
    ${v.tags.length ? `<div class="read-tags">${v.tags.map(t => preview ? `<span class="tag">#${esc(t)}</span>` : `<button type="button" class="chip" data-tag="${esc(t)}" aria-label="Filter by tag ${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
    ${share ? `<div class="share-row">
      <a href="${esc(share.linkedin)}" target="_blank" rel="noopener noreferrer">Share on LinkedIn${NEWTAB}</a>
      <button type="button" data-copy="${index}">Copy link</button>
      ${navigator.share ? `<button type="button" data-share="${index}">Share…</button>` : ''}</div>` : ''}
  </article>`;
}

/* Section shown in Reads (RC-02): state.cat is set from the deep link or the default at boot and changed only by selectCategory. */
const sectionSlug = c => RL.categorySlug(c);
function renderTabs(tabs) {
  $('#readTabs').innerHTML = tabs.map(t => {
    const on = t.category === state.cat;
    return `<button type="button" role="tab" class="tab" id="tab-${esc(t.slug)}" data-cat="${esc(t.category)}" aria-selected="${on}" aria-controls="readsPanel" tabindex="${on ? 0 : -1}">${esc(t.label)} <span class="tab-count">${t.count}</span></button>`;
  }).join('');
  $('#readsPanel').setAttribute('aria-labelledby', 'tab-' + sectionSlug(state.cat));
}
/* '#reads/others' matches no element id, so the browser cannot scroll to it: bring the section into view ourselves, instantly (smooth scrolling is cancelled by layout changes during load). */
const showId = id => $('#' + id).scrollIntoView({behavior: 'instant', block: 'start'});
const showReads = () => showId('reads');
function selectCategory(c, focusTab) {
  if (!RL.CATEGORIES.includes(c)) return;
  state.cat = c; state.filter = {tag: '', q: ''}; $('#readSearch').value = '';
  try { history.replaceState(null, '', RL.categoryHash(c)); } catch {}   // updates the hash without scrolling or adding a history entry
  renderReads();
  if (focusTab) { const t = $('#tab-' + sectionSlug(c)); if (t) t.focus(); }
}

function renderReads() {
  if (state.readsUnsupported) throw new Error('reads.json has a newer schema_version than this page supports');   // guarded: shows the fallback line
  const tabs = RL.categoryTabs(state.reads.articles, state.reads.books);
  if (!RL.CATEGORIES.includes(state.cat)) state.cat = RL.defaultCategory(Object.fromEntries(tabs.map(t => [t.category, t.count])));
  renderTabs(tabs);
  const cat = state.cat, label = RL.categoryLabel(cat);
  const mine = state.reads.articles.map((e, i) => ({e, i})).filter(x => RL.categoryOf(x.e) === cat);
  // newest first: dated entries by date, undated keep their original order after them
  mine.sort((a, b) => { const da = (a.e && a.e.added) || '', db = (b.e && b.e.added) || ''; return da === db ? a.i - b.i : (da < db ? 1 : -1); });
  const shown = new Set(RL.filterReads(mine.map(x => x.e), state.filter));
  const rows = mine.filter(x => shown.has(x.e));

  const tags = RL.allTags(mine.map(x => x.e));
  $('#toolbar').hidden = mine.length < 4;
  $('#tagChips').innerHTML = tags.length ? [['', 'All'], ...tags.map(t => [t, '#' + t])].map(([t, lab]) =>
    `<button type="button" class="chip" data-filter="${esc(t)}" aria-pressed="${state.filter.tag === t}">${esc(lab)}</button>`).join('') : '';
  $('#readCount').textContent = mine.length && (state.filter.tag || state.filter.q) ? `Showing ${rows.length} of ${mine.length}` : '';

  // a search that finds nothing here may find something in another section: say so
  const elsewhere = RL.CATEGORIES.filter(c => c !== cat && RL.filterReads(state.reads.articles.filter(e => RL.categoryOf(e) === c), state.filter).length);
  $('#articlesFeed').innerHTML = rows.length ? rows.map(x => readCard(x.e, x.i, false)).join('')
    : mine.length ? '<div class="empty">No reads match here. <button type="button" class="chip" data-filter="">Clear filters</button>' +
        elsewhere.map(c => ` <button type="button" class="chip" data-cat="${esc(c)}">Try ${esc(RL.categoryLabel(c))}</button>`).join('') + '</div>'
    : tabs.some(t => t.count) ? `<div class="empty">Nothing in ${esc(label)} yet. Check back soon.</div>` : '<div class="empty">Nothing here yet. Check back soon.</div>';
  paint($('#articlesFeed'));

  const b = state.reads.books.map((x, i) => ({x, i})).filter(r => RL.categoryOf(r.x) === cat);
  $('#booksFeed').innerHTML = b.length ? b.map(({x, i}) => `
    <article class="item">${tools('book', i, 'book ' + (x.title || ''))}<h3>${esc(x.title)}</h3><div class="when">${esc(x.author)}${x.year ? ' · ' + esc(x.year) : ''}</div>${x.note ? `<div class="body">${esc(x.note)}</div>` : ''}</article>`).join('') : '<div class="empty">Nothing here yet.</div>';
}

/* ---------- render: podcasts (SPEC-PC PC-02): links only, nothing embedded, no third-party image ---------- */
function podcastCard(entry, index, preview) {
  const v = RL.podcastView(entry), url = RL.normalizeUrl(v.url);
  const meta = [v.show, v.platform, v.added ? fmtDate(v.added) : ''].filter(Boolean).map(esc).join(' · ');
  const share = !preview && url ? RL.shareLinks(url) : null;
  const title = v.title ? esc(v.title) : '<em>Untitled</em>';
  return `<article class="item read podcast"${preview ? ' aria-hidden="true"' : ''}>${preview ? '' : tools('podcast', index, 'podcast ' + v.title)}
    <div class="read-head"><span class="avatar" aria-hidden="true" data-h="${hue(v.platform || v.title)}">${esc((v.show || v.platform || v.title || '?').charAt(0))}</span>
      <div>${url && !preview ? `<a class="read-title podcast-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}${NEWTAB}</a>` : `<span class="read-title podcast-title">${title}</span>`}
      <div class="when podcast-meta">${meta}</div></div></div>
    ${v.comment ? `<p class="read-comment">${esc(v.comment)}</p>` : ''}
    ${v.tags.length ? `<div class="read-tags">${v.tags.map(t => preview ? `<span class="tag">#${esc(t)}</span>` : `<button type="button" class="chip" data-ptag="${esc(t)}" aria-label="Filter by tag ${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
    ${share ? `<div class="share-row">
      <a class="listen" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Listen →${NEWTAB}</a>
      <a href="${esc(share.linkedin)}" target="_blank" rel="noopener noreferrer">Share on LinkedIn${NEWTAB}</a>
      <button type="button" data-pcopy="${index}">Copy link</button>
      ${navigator.share ? `<button type="button" data-pshare="${index}">Share…</button>` : ''}</div>` : ''}
  </article>`;
}

function renderPodcasts() {
  if (state.podcastsFailed) throw new Error('podcasts.json could not be loaded');   // guarded: shows the fallback line
  if (state.podcastsUnsupported) throw new Error('podcasts.json has a newer schema_version than this page supports');   // guarded: shows the fallback line
  const all = state.podcasts.podcasts.map((e, i) => ({e, i}));
  all.sort((a, b) => { const da = (a.e && a.e.added) || '', db = (b.e && b.e.added) || ''; return da === db ? a.i - b.i : (da < db ? 1 : -1); });   // newest first
  const shown = new Set(RL.filterPodcasts(all.map(x => x.e), state.pfilter)), rows = all.filter(x => shown.has(x.e));
  const tags = RL.podcastTags(all.map(x => x.e)), n = all.length;
  $('#podcastToolbar').hidden = n < 4;
  $('#podcastChips').innerHTML = tags.length ? [['', 'All'], ...tags.map(t => [t, '#' + t])].map(([t, lab]) =>
    `<button type="button" class="chip" data-pfilter="${esc(t)}" aria-pressed="${state.pfilter.tag === t}">${esc(lab)}</button>`).join('') : '';
  $('#podcastCount').textContent = n && (state.pfilter.tag || state.pfilter.q) ? `Showing ${rows.length} of ${n}` : '';
  $('#podcastFeed').innerHTML = rows.length ? rows.map(x => podcastCard(x.e, x.i, false)).join('')
    : n ? '<div class="empty">No podcasts match. <button type="button" class="chip" data-pfilter="">Clear filters</button></div>'
    : '<div class="empty">No podcasts yet. Check back soon.</div>';
  paint($('#podcastFeed'));
}

/* Profile photo: shown when the manifest names one (path restricted to content/*.jpg, versioned by its timestamp so a new photo
   is never served stale), or when the owner has a draft. Otherwise the monogram stays. */
function renderProfile() {
  const img = $('#profileImg'), mono = $('#profileMono'), p = state.profile || {};
  let src = null;
  if (state.profileDraft) src = state.profileDraft.dataUrl;
  else if (state.profileShown) src = state.profileShown;   // just published: keep the local copy until the page is reloaded (Pages needs a minute or two)
  else if (typeof p.photo === 'string' && /^content\/[A-Za-z0-9._-]+\.jpg$/.test(p.photo)) src = p.photo + (p.updated ? '?v=' + encodeURIComponent(p.updated) : '');
  if (!src) { img.hidden = true; mono.hidden = false; img.removeAttribute('src'); return; }
  img.onerror = () => { img.hidden = true; mono.hidden = false; };
  if (img.getAttribute('src') !== src) img.src = src;
  img.hidden = false; mono.hidden = true;
}

/* One section failing must never stop another, or the admin unlock (SPEC-SH SH-01). Each renderer runs guarded; a failed one shows the
   fixed fallback line in its content box and logs the real error to the console only. */
const SECTION_BOX = { products: ['#grid'], updates: ['#updatesFeed'], podcasts: ['#podcastFeed'], reads: ['#articlesFeed', '#booksFeed'] };
function renderAll() {
  window.SafeLib.runGuarded([
    { name: 'products', run: renderProducts }, { name: 'updates', run: renderUpdates }, { name: 'reads', run: renderReads }, { name: 'podcasts', run: renderPodcasts }, { name: 'version', run: renderVersion }, { name: 'profile', run: renderProfile },
  ], (name, err) => {
    console.error('Studio: the ' + name + ' section failed to render', err);
    (SECTION_BOX[name] || []).forEach((sel, i) => { const el = $(sel); if (el) el.innerHTML = i === 0 ? window.SafeLib.fallbackHtml() : ''; });
  });
}

/* ---------- version + What's new ---------- */
const storageOk = (() => { try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); return true; } catch { return false; } })();
const latestRelease = () => (state.changelog && state.changelog[0]) || null;
const isUnseen = () => !!latestRelease() && storageOk && lsGet(SEEN_KEY) !== latestRelease().version;

function renderVersion() {
  const r = latestRelease();
  ['#whatsNewBtn', '#versionBtn'].forEach(sel => { $(sel).hidden = !r; });
  if (!r) return;
  $('#versionBtn').textContent = 'Studio v' + r.version;
  $('#versionBtn').setAttribute('aria-label', 'Studio version ' + r.version + ', open What\'s new');
  const unseen = isUnseen();
  $('#wnDot').hidden = !unseen;
  $('#whatsNewBtn').setAttribute('aria-label', unseen ? "What's new, new updates available" : "What's new");
}

function openWhatsNew() {
  const list = state.changelog; if (!list) return;
  modal.open(`<h3 id="modalTitle" tabindex="-1">What's new in Studio</h3>
    <ol class="releases">${list.map((r, i) => `<li class="rel">
      <div class="row"><span class="tag ver mono">v${esc(r.version)}</span>${i === 0 ? '<span class="tag">Latest</span>' : ''}<span class="when">${esc(fmtDate(r.date))}</span></div>
      <h4>${esc(r.title)}</h4>
      <ul>${r.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></li>`).join('')}</ol>
    <div class="btns"><button type="button" class="cta" id="mc">Close</button></div>`, '#modalTitle');
  $('#mc').onclick = modal.close;
  if (storageOk) lsSet(SEEN_KEY, list[0].version);
  renderVersion();
}
$('#whatsNewBtn').onclick = openWhatsNew;
$('#versionBtn').onclick = openWhatsNew;

/* ---------- theme + nav highlight ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t; lsSet('studio-theme', t);
  $('#theme').setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
setTheme(lsGet('studio-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) document.querySelectorAll('nav a').forEach(a => {
    if (a.getAttribute('href') === '#' + e.target.id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
  });
}), {rootMargin:'-40% 0px -55% 0px'});
document.querySelectorAll('section.block').forEach(s => io.observe(s));

/* ---------- admin: GitHub contents API ---------- */
const ghApi = (path, opts = {}) => fetch('https://api.github.com' + path, {...(typeof AbortSignal.timeout === 'function' ? {signal: AbortSignal.timeout(20000)} : {}), ...opts, headers: {
  Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tokenStore.get(), ...(opts.headers || {})}});
const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; b.forEach(x => bin += String.fromCharCode(x)); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

/* GET current sha -> validate -> skip if unchanged -> PUT with sha. One file per commit. */
async function publishFile(path, obj, message, guard) {
  if (guard && snap[path] === undefined) throw new Error(path + ': this page has not finished loading it (or could not), so nothing was written. Reload the page and try again.');   // review QA-A F1: boot sets 'absent' or the loaded text for every known state
  let text;
  try { text = JSON.stringify(JSON.parse(JSON.stringify(obj)), null, 2) + '\n'; }
  catch (e) { throw new Error('Refusing to publish ' + path + ': invalid JSON (' + e.message + ')'); }
  const cur = await ghApi(`/repos/${OWNER}/${HUB}/contents/${path}?ref=${BRANCH}`, {cache: 'no-store'});   // never a browser-cached copy: the guard compares against GitHub's current file
  let sha;
  if (cur.status === 200) {
    const j = await cur.json(); sha = j.sha;
    const remote = b64dec(j.content);
    if (guard) {   // GitHub's copy must be the one this page loaded (or last wrote); anything else would be silently overwritten
      let theirs; try { theirs = JSON.stringify(JSON.parse(remote)); } catch { theirs = null; }
      if (theirs === null || snap[path] === 'absent' || (snap[path] !== undefined && theirs !== snap[path]))
        throw new Error(path + ' has changed on GitHub since this page loaded it (another device or tab published, or its version is newer than this page understands, or the site has not caught up yet). Nothing was written. Wait a minute, reload the page and try again (changes not yet published are lost on reload, so note anything you need first).');
    }
    if (remote === text) { if (guard) snap[path] = JSON.stringify(JSON.parse(text)); return 'unchanged'; }
  } else if (cur.status !== 404) throw new Error('Could not read ' + path + ' (' + cur.status + ')');
  const put = await ghApi(`/repos/${OWNER}/${HUB}/contents/${path}`, {
    method: 'PUT', body: JSON.stringify({message, content: b64enc(text), branch: BRANCH, ...(sha ? {sha} : {})})});
  if (!put.ok) { const t = await put.text(); throw new Error('Publish of ' + path + ' failed (' + put.status + '): ' + t.slice(0, 200)); }
  if (guard) snap[path] = JSON.stringify(JSON.parse(text));
  return 'committed';
}

/* Binary twin of publishFile: GET sha -> skip if identical -> PUT with sha. One file per commit. */
async function publishBinary(path, b64, message) {
  if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) throw new Error('Refusing to publish ' + path + ': not valid base64');
  const cur = await ghApi(`/repos/${OWNER}/${HUB}/contents/${path}?ref=${BRANCH}`, {cache: 'no-store'});   // never a browser-cached copy: the guard compares against GitHub's current file
  let sha;
  if (cur.status === 200) {
    const j = await cur.json(); sha = j.sha;
    if (String(j.content || '').replace(/\s/g, '') === b64) return 'unchanged';
  } else if (cur.status !== 404) throw new Error('Could not read ' + path + ' (' + cur.status + ')');
  const put = await ghApi(`/repos/${OWNER}/${HUB}/contents/${path}`, {
    method: 'PUT', body: JSON.stringify({message, content: b64, branch: BRANCH, ...(sha ? {sha} : {})})});
  if (!put.ok) { const t = await put.text(); throw new Error('Publish of ' + path + ' failed (' + put.status + '): ' + t.slice(0, 200)); }
  return 'committed';
}

/* auto-lock after 30 minutes without interaction; unpublished drafts stay in memory */
const idle = window.TokenStore.createIdleLock(IDLE_MS, () => { lock(); say('Admin locked after 30 minutes of inactivity.'); });
const onActivity = () => { if (document.body.classList.contains('admin')) idle.arm(); };
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, onActivity, {passive: true}));

function enableAdmin() { document.body.classList.add('admin'); updateDirty(); idle.arm(); }
function lock(keepForms) { tokenStore.del(); document.body.classList.remove('admin'); idle.disarm(); if (!keepForms) { closeComposer(); closePodcastComposer(); } }   // after a publish the forms are kept (they are hidden while locked): review QA-A F5
function updateDirty() {
  const LABEL = {podcasts: 'podcasts.json', reads: 'reads.json', profile: 'profile photo'};
  const d = Object.entries(state.dirty).filter(([,v]) => v).map(([k]) => LABEL[k] || k);
  $('#dirtyinfo').innerHTML = d.length ? `<span class="dirty">Unpublished: ${d.join(', ')}</span>` : 'No pending changes';
  $('#publishBtn').disabled = !d.length;
}

/* ---------- modal: focus trap, restore focus, Escape ---------- */
let lastFocus = null;
const modal = {
  open(html, focusSel) {
    lastFocus = document.activeElement;
    $('#modal').innerHTML = html; $('#modalBg').classList.add('open');
    const f = $(focusSel || '#modal input,#modal textarea,#modal button'); f && f.focus();
  },
  close() {
    $('#modalBg').classList.remove('open'); $('#modal').innerHTML = '';
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); lastFocus = null;
  },
  err(m) {
    let e = $('#modal .err');
    if (!e) { e = document.createElement('div'); e.className = 'err'; e.setAttribute('role', 'alert'); $('#modal').appendChild(e); }
    e.textContent = m;
  },
};
$('#modalBg').addEventListener('mousedown', e => { if (e.target.id === 'modalBg') modal.close(); });
document.addEventListener('keydown', e => {
  if (!$('#modalBg').classList.contains('open')) return;
  if (e.key === 'Escape') return modal.close();
  if (e.key !== 'Tab') return;
  const f = [...$('#modal').querySelectorAll('button:not([disabled]),input,textarea,select,a[href]')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* The gear opens the Add to Studio sheet (SPEC-QA QA-01); the token is asked for when something is posted (see askToken below). */
$('#gear').onclick = () => openAdd();
$('#addOpen').onclick = () => openAdd();
$('#lockBtn').onclick = () => {
  if (Object.values(state.dirty).some(Boolean) && !confirm('You have unpublished changes. Sign out anyway? (Changes stay on this page until you reload.)')) return;
  lock(); say('Admin locked.');
};

/* ---------- reads composer (LinkedIn-style "Share a read") ---------- */
const cf = id => $('#cf-' + id);
const COMPOSER_FIELDS = ['url', 'title', 'comment', 'category'];

/* The Section a new read or book starts with: the last one chosen this session, else the section being viewed (RC-04). */
const defaultSection = () => RL.CATEGORIES.includes(state.lastSection) ? state.lastSection : RL.CATEGORIES.includes(state.cat) ? state.cat : RL.DEFAULT_NEW_CATEGORY;
function renderSectionRadios(value) {
  $('#cf-category-opts').innerHTML = RL.CATEGORIES.map(c =>
    `<label class="radio"><input type="radio" name="category" value="${esc(c)}"${c === value ? ' checked' : ''}> ${esc(RL.categoryLabel(c))}</label>`).join('');
}
const chosenSection = () => { const r = $('#cf-category input:checked'); return r ? r.value : ''; };

function openComposer(editIndex = -1) {
  state.editing = editIndex; state.editEntry = editIndex >= 0 ? state.reads.articles[editIndex] : null;
  const e = editIndex >= 0 ? RL.entryView(state.reads.articles[editIndex]) : {url:'', title:'', comment:'', kind:'article', tags:[]};
  cf('url').value = e.url; cf('title').value = e.title; cf('comment').value = e.comment;
  cf('kind').value = e.kind; cf('tags').value = e.tags.join(', ');
  renderSectionRadios(editIndex >= 0 ? RL.categoryOf(state.reads.articles[editIndex]) : defaultSection());
  $('#composerTitle').textContent = editIndex >= 0 ? 'Edit read' : 'Share a read';
  cf('submit').textContent = editIndex >= 0 ? 'Save changes' : 'Post';
  clearErrors(); updateCount(); updatePreview();
  $('#composer').classList.add('open'); $('#composerOpen').setAttribute('aria-expanded', 'true');
  $('#composer').scrollIntoView({block: 'nearest'});
  cf('url').focus();
}
function closeComposer() {
  state.editing = -1; state.editEntry = null; $('#composer').classList.remove('open');
  $('#composerOpen').setAttribute('aria-expanded', 'false'); $('#composerForm').reset();
}
function clearErrors() {
  COMPOSER_FIELDS.forEach(f => { cf(f + '-err').textContent = ''; cf(f).removeAttribute('aria-invalid'); });
}
function showErrors(errors) {
  clearErrors();
  COMPOSER_FIELDS.forEach(f => { if (errors[f]) { cf(f + '-err').textContent = errors[f]; cf(f).setAttribute('aria-invalid', 'true'); } });
  const first = COMPOSER_FIELDS.find(f => errors[f]); if (first) (first === 'category' ? cf(first).querySelector('input') || cf(first) : cf(first)).focus();
}
function composerValue() {
  return {url: cf('url').value, title: cf('title').value, comment: cf('comment').value, kind: cf('kind').value, tags: cf('tags').value, category: chosenSection()};
}
function updateCount() {
  const n = cf('comment').value.length, c = $('#cf-count');
  c.textContent = n; c.parentElement.classList.toggle('bad', n > RL.LIMITS.comment);
}
function updatePreview() {
  const v = composerValue(), n = RL.normalizeUrl(v.url);
  $('#cf-preview-section').textContent = v.category ? 'Will appear under ' + RL.categoryLabel(v.category) + '.' : '';
  $('#cf-preview').innerHTML = (n || v.title) ? readCard({url: n || '', title: v.title.trim(), comment: v.comment.trim(), kind: v.kind, tags: RL.parseTags(v.tags), added: new Date().toISOString().slice(0, 10)}, -1, true)
    : '<div class="empty">Your post will appear here as you type.</div>';
  paint($('#cf-preview'));
}

$('#composerOpen').onclick = () => openComposer(-1);
$('#cf-cancel').onclick = () => { closeComposer(); $('#composerOpen').focus(); };
$('#composerForm').addEventListener('input', () => { updateCount(); updatePreview(); });
$('#composerForm').addEventListener('keydown', e => { if (e.key === 'Escape') { closeComposer(); $('#composerOpen').focus(); } });
$('#composerForm').addEventListener('submit', ev => {
  ev.preventDefault();
  if (!document.body.classList.contains('admin')) return;
  const r = RL.validateEntry(composerValue(), {requireCategory: true});
  const errors = {...r.errors};
  const ei = state.editing >= 0 ? state.reads.articles.indexOf(state.editEntry) : -1;   // where the entry being edited is now
  if (state.editing >= 0 && ei < 0) return showErrors({url: 'That read was deleted while you were editing. Close this form and start again.'});
  if (r.ok && RL.isDuplicate(state.reads.articles, r.value.url, ei >= 0 ? state.reads.articles[ei].id : undefined) &&
      !(ei >= 0 && RL.normalizeUrl(state.reads.articles[ei].url) === r.value.url)) errors.url = 'This link is already in your reading list.';
  if (r.errors.kind) errors.title = errors.title || r.errors.kind;
  if (Object.keys(errors).length) return showErrors(errors);

  if (ei >= 0) {
    const old = state.reads.articles[ei], next = {...old, ...r.value};
    delete next.note;   // legacy field replaced by "comment"
    if (!next.id) next.id = Date.now();
    state.reads.articles[ei] = next;
    say(next.category !== state.cat ? `Changes saved. Moved to ${RL.categoryLabel(next.category)}. Publish to make them public.` : 'Changes saved. Publish to make them public.');
  } else {
    state.reads.articles.unshift({id: Date.now(), added: new Date().toISOString().slice(0, 10), ...r.value});
    say(r.value.category !== state.cat ? `Added to ${RL.categoryLabel(r.value.category)}. Publish to make it public.` : 'Added. Publish to make it public.');
  }
  state.lastSection = r.value.category;
  state.dirty.reads = true; updateDirty(); closeComposer(); renderAll(); $('#composerOpen').focus();
});

/* ---------- podcasts composer (SPEC-PC PC-03): the reads composer's pattern; link and title required, the rest optional ---------- */
const pf = id => $('#pf-' + id);
const PODCAST_FIELDS = ['url', 'title', 'show', 'comment'];
function openPodcastComposer(editIndex = -1) {
  state.pediting = editIndex; state.pEntry = editIndex >= 0 ? state.podcasts.podcasts[editIndex] : null;   // the entry itself, not its position: the list may change while the form is open
  const e = editIndex >= 0 ? RL.podcastView(state.podcasts.podcasts[editIndex]) : {url:'', title:'', show:'', comment:'', tags:[]};
  pf('url').value = e.url; pf('title').value = e.title; pf('show').value = e.show; pf('comment').value = e.comment; pf('tags').value = e.tags.join(', ');
  $('#podcastFormTitle').textContent = editIndex >= 0 ? 'Edit podcast' : 'Share a podcast';
  pf('submit').textContent = editIndex >= 0 ? 'Save changes' : 'Post';
  clearPodcastErrors(); updatePodcastCount(); updatePodcastPreview();
  $('#podcastComposer').classList.add('open'); $('#podcastComposerOpen').setAttribute('aria-expanded', 'true');
  $('#podcastComposer').scrollIntoView({block: 'nearest'});
  pf('url').focus();
}
function closePodcastComposer() {
  state.pediting = -1; state.pEntry = null; $('#podcastComposer').classList.remove('open');
  $('#podcastComposerOpen').setAttribute('aria-expanded', 'false'); $('#podcastForm').reset();
}
function clearPodcastErrors() { PODCAST_FIELDS.forEach(f => { pf(f + '-err').textContent = ''; pf(f).removeAttribute('aria-invalid'); }); }
function showPodcastErrors(errors) {
  clearPodcastErrors();
  PODCAST_FIELDS.forEach(f => { if (errors[f]) { pf(f + '-err').textContent = errors[f]; pf(f).setAttribute('aria-invalid', 'true'); } });
  const first = PODCAST_FIELDS.find(f => errors[f]); if (first) pf(first).focus();
}
const podcastValue = () => ({url: pf('url').value, title: pf('title').value, show: pf('show').value, comment: pf('comment').value, tags: pf('tags').value});
function updatePodcastCount() { const n = pf('comment').value.length, c = $('#pf-count'); c.textContent = n; c.parentElement.classList.toggle('bad', n > RL.LIMITS.comment); }
function updatePodcastPreview() {
  const v = podcastValue(), n = RL.normalizeUrl(v.url);
  $('#pf-preview').innerHTML = (n || v.title) ? podcastCard({url: n || '', title: v.title.trim(), show: v.show.trim(), comment: v.comment.trim(), tags: RL.parseTags(v.tags), added: new Date().toISOString().slice(0, 10)}, -1, true)
    : '<div class="empty">Your post will appear here as you type.</div>';
  paint($('#pf-preview'));
}
$('#podcastComposerOpen').onclick = () => openPodcastComposer(-1);
$('#pf-cancel').onclick = () => { closePodcastComposer(); $('#podcastComposerOpen').focus(); };
$('#podcastForm').addEventListener('input', () => { updatePodcastCount(); updatePodcastPreview(); });
$('#podcastForm').addEventListener('keydown', e => { if (e.key === 'Escape') { closePodcastComposer(); $('#podcastComposerOpen').focus(); } });
$('#podcastForm').addEventListener('submit', ev => {
  ev.preventDefault();
  if (!document.body.classList.contains('admin')) return;
  if (state.podcastsUnsupported || state.podcastsFailed) return showPodcastErrors({url: 'podcasts.json could not be loaded, or is newer than this page understands. Reload the page before adding.'});
  const r = RL.validatePodcastEntry(podcastValue());
  if (!r.ok) return showPodcastErrors(r.errors);
  if (state.pediting >= 0) {
    const at = state.podcasts.podcasts.indexOf(state.pEntry);
    if (at < 0) return showPodcastErrors({url: 'That podcast was deleted while you were editing. Close this form and start again.'});
    const next = {...state.podcasts.podcasts[at], ...r.value};
    if (!next.id) next.id = Date.now();
    state.podcasts.podcasts[at] = next; say('Changes saved. Publish to make them public.');
  } else {
    state.podcasts.podcasts.unshift({id: Date.now(), added: new Date().toISOString().slice(0, 10), ...r.value}); say('Added. Publish to make it public.');
  }
  state.dirty.podcasts = true; updateDirty(); closePodcastComposer(); renderAll(); $('#podcastComposerOpen').focus();
});

/* ---------- generic editor for books (and the delete handler for podcasts) ---------- */
const SCHEMAS = {
  podcast: {title:'Podcast', list:()=>state.podcasts.podcasts, file:'podcasts'},
  article: {title:'Read', list:()=>state.reads.articles, file:'reads'},
  book: {title:'Book', fields:[['title','Title','input',1],['author','Author','input',1],['year','Year','input'],['note','Note','textarea'],['category','Section','select',1]], list:()=>state.reads.books, file:'reads', make:()=>({title:'', author:'', year:'', note:'', category:defaultSection()})},
};
function editItem(kind, idx) {
  if (kind === 'article') return openComposer(idx);
  if (kind === 'podcast') return openPodcastComposer(idx);
  const s = SCHEMAS[kind], list = s.list(), isNew = idx < 0, item = isNew ? s.make() : {...list[idx]};
  modal.open(`<h3 id="modalTitle">${isNew ? 'Add' : 'Edit'} ${s.title.toLowerCase()}</h3>` + s.fields.map(([k,l,t]) =>
    `<label for="f-${k}">${esc(l)}</label>${t === 'select' ? `<select id="f-${k}" data-k="${k}">${RL.CATEGORIES.map(c => `<option value="${esc(c)}"${c === RL.categoryOf(item) ? ' selected' : ''}>${esc(RL.categoryLabel(c))}</option>`).join('')}</select>` : t === 'textarea' ? `<textarea id="f-${k}" data-k="${k}">${esc(item[k])}</textarea>` : `<input id="f-${k}" data-k="${k}" value="${esc(item[k])}">`}`).join('') +
    `<div class="btns"><button type="button" class="cta ghost" id="mc">Cancel</button><button type="button" class="cta" id="ms">Save</button></div>`);
  $('#mc').onclick = modal.close;
  $('#ms').onclick = () => {
    for (const [k,,,req] of s.fields) {
      const v = $(`#modal [data-k="${k}"]`).value.trim();
      if (req && !v) return modal.err('Please fill in: ' + s.fields.find(f => f[0] === k)[1]);
      item[k] = v;
    }
    if (kind === 'book') item.year = item.year && /^\d+$/.test(item.year) ? Number(item.year) : item.year;
    if (kind === 'book') state.lastSection = item.category;
    if (isNew) list.push(item); else list[idx] = item;
    state.dirty[s.file] = true; updateDirty(); renderAll(); modal.close();
  };
}
$('#addBook').onclick = () => editItem('book', -1);

/* ---------- delegated clicks: edit, delete, filter, share ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok;
}
document.addEventListener('click', async e => {
  const sec = e.target.closest('[data-cat]');
  if (sec) { selectCategory(sec.dataset.cat); return; }
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (ed) { const [k,i] = ed.dataset.edit.split(':'); editItem(k, +i); return; }
  if (del) {
    const [k,i] = del.dataset.del.split(':'), s = SCHEMAS[k];
    if (confirm('Delete this ' + s.title.toLowerCase() + '? (Takes effect when you publish.)')) { s.list().splice(+i, 1); state.dirty[s.file] = true; updateDirty(); renderAll(); say('Deleted. Publish to make it public.'); }
    return;
  }
  const flt = e.target.closest('[data-filter]'), tag = e.target.closest('[data-tag]');
  if (flt || tag) {
    state.filter.tag = flt ? flt.dataset.filter : (state.filter.tag === tag.dataset.tag ? '' : tag.dataset.tag);
    if (flt && flt.dataset.filter === '') { state.filter.q = ''; $('#readSearch').value = ''; }
    renderReads(); return;
  }
  const pflt = e.target.closest('[data-pfilter]'), ptag = e.target.closest('[data-ptag]');
  if (pflt || ptag) {
    state.pfilter.tag = pflt ? pflt.dataset.pfilter : (state.pfilter.tag === ptag.dataset.ptag ? '' : ptag.dataset.ptag);
    if (pflt && pflt.dataset.pfilter === '') { state.pfilter.q = ''; $('#podcastSearch').value = ''; }
    renderPodcasts(); return;
  }
  const pcp = e.target.closest('[data-pcopy]'), psh = e.target.closest('[data-pshare]');
  if (pcp || psh) {
    const entry = state.podcasts.podcasts[+(pcp || psh).dataset[pcp ? 'pcopy' : 'pshare']], links = entry && RL.shareLinks(entry.url);
    if (!links) return;
    if (pcp) say(await copyText(links.url) ? 'Link copied.' : 'Could not copy. Select the link and copy it manually.');
    else { try { await navigator.share({title: entry.title, url: links.url}); } catch {} }
    return;
  }
  const cp = e.target.closest('[data-copy]'), sh = e.target.closest('[data-share]');
  if (cp || sh) {
    const entry = state.reads.articles[+(cp || sh).dataset[cp ? 'copy' : 'share']], links = entry && RL.shareLinks(entry.url);
    if (!links) return;
    if (cp) say(await copyText(links.url) ? 'Link copied.' : 'Could not copy. Select the link and copy it manually.');
    else { try { await navigator.share({title: entry.title, url: links.url}); } catch {} }
  }
});
$('#readSearch').addEventListener('input', e => { state.filter.q = e.target.value; renderReads(); });
$('#podcastSearch').addEventListener('input', e => { state.pfilter.q = e.target.value; renderPodcasts(); });

/* Every write of reads.json or podcasts.json goes through here (Publish changes and Quick add): the same refusals, then the guarded publishFile. Throws Error(message). */
const CONTENT_FILES = { podcasts: ['content/podcasts.json', 'podcasts'], reads: ['content/reads.json', 'reading list'] };
async function publishContent(key, data) {
  const [path, label] = CONTENT_FILES[key];
  if ((key === 'podcasts' && state.podcastsFailed) || (key === 'reads' && state.readsFailed)) throw new Error('not published: it could not be loaded when this page opened, so its content is unknown (reload the page)');
  if (key === 'podcasts') {   // the same rules CI applies, before anything is written: a bad entry already in the file blocks the publish
    const bad = RL.validatePodcastsFile(data).errors;
    if (bad.length) throw new Error('not published: ' + bad[0] + (bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''));
  }
  if ((key === 'podcasts' && state.podcastsUnsupported) || (key === 'reads' && state.readsUnsupported)) throw new Error('not published: this file is newer than the page understands (reload the page)');
  return publishFile(path, data, `cms: update ${label}`, true);
}
$('#publishBtn').onclick = async () => {
  const files = [['podcasts', () => RL.serializePodcasts(state.podcasts)], ['reads', () => RL.serializeReads(state.reads)]];
  const todo = files.filter(f => state.dirty[f[0]]);
  const hasPhoto = !!(state.dirty.profile && state.profileDraft);
  if (!todo.length && !hasPhoto) return;
  $('#publishBtn').disabled = true;
  const out = []; let failed = false;
  for (const [key, get] of todo) {   // one file per commit; a failure leaves the others untouched
    const path = CONTENT_FILES[key][0];
    try { const r = await publishContent(key, get()); state.dirty[key] = false; out.push(path + ': ' + r); }
    catch (e) { failed = true; out.push(path + ': ' + e.message); }
  }
  if (hasPhoto) {   // photo first, then the manifest that shows it, so the manifest never points at a missing file
    try {
      const r1 = await publishBinary('content/profile.jpg', state.profileDraft.base64, 'cms: update profile photo');
      let updated = state.profile && state.profile.updated;
      if (r1 === 'committed' || !(state.profile && state.profile.photo)) updated = new Date().toISOString();
      const r2 = await publishFile('content/profile.json', {photo: 'content/profile.jpg', updated}, 'cms: show profile photo');
      state.profile = {photo: 'content/profile.jpg', updated}; state.profileShown = state.profileDraft.dataUrl; state.profileDraft = null; state.dirty.profile = false;
      out.push('content/profile.jpg: ' + r1, 'content/profile.json: ' + r2);
    } catch (e) { failed = true; out.push('profile photo: ' + e.message); }
  }
  updateDirty();
  modal.open('<h3 id="modalTitle">Publish result</h3><pre class="mono pre-result">' + esc(out.join('\n')) + '</pre><p class="muted-xs">GitHub Pages usually reflects changes within a minute or two.' + (failed ? '' : ' Admin locked again (SPEC-QA QA-06).') + '</p><div class="btns"><button type="button" class="cta" id="mc">Close</button></div>');
  $('#mc').onclick = modal.close;
  if (!failed) { lock(true); say('Published and locked.'); }   // QA-06: the admin never stays open after a successful publish; a failure keeps it open with the error
};
window.addEventListener('beforeunload', e => { if (Object.values(state.dirty).some(Boolean)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- profile photo: choose, crop, re-encode, preview ---------- */
async function processPhoto(file) {
  const chk = IL.checkFile(file); if (!chk.ok) throw new Error(chk.error);
  let bmp;
  try { bmp = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
  catch { try { bmp = await createImageBitmap(file); } catch { throw new Error("That file isn't a usable image."); } }
  const dim = IL.checkDimensions(bmp.width, bmp.height);
  if (!dim.ok) { bmp.close(); throw new Error(dim.error); }
  const {sx, sy, side} = IL.cropSquare(bmp.width, bmp.height), S = IL.LIMITS.outSide;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);   // transparent PNGs become white, not black
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, S, S); bmp.close();
  const bytesAt = q => IL.base64Bytes(IL.dataUrlToBase64(canvas.toDataURL('image/jpeg', q)) || '');
  const pick = IL.chooseQuality(bytesAt, IL.LIMITS.outMaxBytes);
  if (!pick.ok) throw new Error('That photo could not be made small enough. Try a simpler image.');
  const dataUrl = canvas.toDataURL('image/jpeg', pick.quality), base64 = IL.dataUrlToBase64(dataUrl);
  if (!base64) throw new Error("That file isn't a usable image.");
  return {dataUrl, base64, bytes: IL.base64Bytes(base64), quality: pick.quality};
}
function showPhotoError(msg) {
  modal.open(`<h3 id="modalTitle" tabindex="-1">Can't use that photo</h3><p class="muted-sm">${esc(msg)}</p><div class="btns"><button type="button" class="cta" id="mc">Close</button></div>`, '#modalTitle');
  $('#mc').onclick = modal.close;
}
function openPhotoPreview(res) {
  modal.open(`<h3 id="modalTitle" tabindex="-1">Use this photo?</h3>
    <img class="photo-preview" src="${esc(res.dataUrl)}" alt="Preview of your profile photo">
    <p class="muted-sm">${IL.LIMITS.outSide} × ${IL.LIMITS.outSide} px, ${Math.max(1, Math.round(res.bytes / 1024))} KB. The photo will be public once published. Location and camera details are removed.</p>
    <div class="btns"><button type="button" class="cta ghost" id="mc">Cancel</button><button type="button" class="cta" id="mu">Use this photo</button></div>`, '#modalTitle');
  $('#mc').onclick = modal.close;
  $('#mu').onclick = () => {
    state.profileDraft = res; state.dirty.profile = true; updateDirty(); renderProfile(); modal.close();
    say('Photo ready. Publish to make it public.');
  };
}
$('#changePhoto').onclick = () => $('#photoFile').click();
$('#photoFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { openPhotoPreview(await processPhoto(f)); } catch (err) { showPhotoError(err.message); }
});

/* ---------- Quick add (SPEC-QA QA-01 … QA-08): paste first, unlock when needed, post and publish, lock ---------- */
/* The one owner-only draft key (QA-07): this tab's sessionStorage (memory-only if blocked), five text fields, never the token (RL.serializeDraft). */
const DRAFT_KEY = 'studio-quick-draft';
const draftStore = window.TokenStore.create(() => window.sessionStorage, DRAFT_KEY);
const qa = { busy: false, kindTouched: false, back: null, tokBack: null, tokDone: null };
const qf = id => $('#qa-' + id);
const QA_FIELDS = ['url', 'title', 'show', 'comment', 'category'];
const today = () => new Date().toISOString().slice(0, 10);
const qaKind = () => { const r = $('#qa-kind input:checked'); return r ? r.value : 'read'; };
const qaSection = () => { const r = $('#qa-section-opts input:checked'); return r ? r.value : ''; };
function qaRenderSections(value) {
  $('#qa-section-opts').innerHTML = RL.CATEGORIES.map(c => `<label class="radio"><input type="radio" name="qa-section" value="${esc(c)}"${c === value ? ' checked' : ''}> ${esc(RL.categoryLabel(c))}</label>`).join('');
}
function qaSetKind(k) { $('#qa-kind input[value="' + (k === 'podcast' ? 'podcast' : 'read') + '"]').checked = true; qaShowKind(); }
function qaShowKind() { const k = qaKind(); $('#qa-read-fields').hidden = k !== 'read'; $('#qa-pod-fields').hidden = k !== 'podcast'; }
function qaDest() { const n = RL.normalizeUrl(qf('url').value); $('#qa-dest').textContent = n ? 'Destination: ' + RL.domainOf(n) : ''; return n; }
function qaCount() { const n = qf('comment').value.length, c = $('#qa-count'); c.textContent = n; c.parentElement.classList.toggle('bad', n > RL.LIMITS.comment); }
function qaSave() {
  const s = RL.serializeDraft({url: qf('url').value, title: qf('title').value, comment: qf('comment').value, tags: qf('tags').value, kind: qaKind()});
  if (s) draftStore.set(s); else draftStore.del();
}
function qaClearErrors() {
  QA_FIELDS.forEach(f => { const e = $('#qa-' + f + '-err'); if (e) e.textContent = ''; const i = qf(f); if (i) i.removeAttribute('aria-invalid'); });
  $('#qa-msg').textContent = ''; $('#qa-note').textContent = '';
}
function qaShowErrors(errors) {
  qaClearErrors();
  QA_FIELDS.forEach(f => { if (errors[f]) { $('#qa-' + f + '-err').textContent = errors[f]; const i = qf(f); if (i) i.setAttribute('aria-invalid', 'true'); } });
  const first = QA_FIELDS.find(f => errors[f]);
  if (first) (first === 'category' ? $('#qa-section-opts input') : qf(first)).focus();
}
function qaBusy(on) {
  qa.busy = on; $('#addSheet').setAttribute('aria-busy', String(on));
  if (on) $('#addTitle').focus();   // the focused button is about to be disabled: keep the focus inside the dialog (review QA-A F7)
  ['qa-paste', 'qa-draft', 'qa-publish', 'qa-cancel', 'qa-unlock'].forEach(id => { $('#' + id).disabled = on; });
  if (!on && $('#addBg').classList.contains('open') && document.activeElement === $('#addTitle')) $('#qa-publish').focus();
}
function openAdd() {
  if ($('#addBg').classList.contains('open')) { qf('url').focus(); return; }
  qa.warned = '';
  qa.back = document.activeElement;
  const d = RL.parseDraft(draftStore.get());
  qf('url').value = d ? d.url : ''; qf('title').value = d ? d.title : ''; qf('comment').value = d ? d.comment : ''; qf('tags').value = d ? d.tags : ''; qf('show').value = ''; qf('type').value = 'article';
  qa.kindTouched = !!(d && d.kind);
  qaRenderSections(defaultSection());
  qaSetKind(d && d.kind ? d.kind : RL.suggestKind(RL.normalizeUrl(qf('url').value)));
  qaClearErrors(); qaCount(); qaDest(); qaBusy(false);
  $('#qa-unlock').parentElement.hidden = document.body.classList.contains('admin');
  $('#addBg').classList.add('open'); qf('url').focus();
}
/* clear = true for Cancel, Escape and success (the draft is dropped); false to keep it (unlock-only) */
function closeAdd(clear) {
  $('#addBg').classList.remove('open');
  if (clear) draftStore.del();
  if (RL.isAddHash(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch {} }   // so a reload does not reopen it, and a later #add is a change the page sees
  if (qa.back && document.contains(qa.back)) qa.back.focus(); qa.back = null;
}
/* a link arrived from the clipboard (the Paste button, or a paste into the field): normalised link, destination, suggested kind, and a title when there is none yet */
function qaTake(text) {
  const link = RL.extractLink(text);
  if (!link) { qaShowErrors({url: 'Enter a valid web address starting with http:// or https://'}); return false; }
  qaClearErrors(); qf('url').value = link; qa.kindTouched = false; qaDest(); qaSetKind(RL.suggestKind(link));
  if (!qf('title').value.trim()) qf('title').value = RL.extractTitle(text);
  qaSave(); return true;
}
$('#qa-paste').onclick = async () => {   // the ONLY place the clipboard is read: inside the tap, so the browser's own paste confirmation applies
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch { return qaShowErrors({url: 'Could not read the clipboard. Press and hold in the Link field and choose Paste.'}); }
  qaTake(t);
};
qf('url').addEventListener('paste', e => {   // a paste by hand: share text with a link is handled like the button; anything else is typed in as it comes
  const t = e.clipboardData && e.clipboardData.getData('text/plain');
  if (t && RL.extractLink(t) && qaTake(t)) e.preventDefault();
});
$('#addForm').addEventListener('input', e => {
  if (e.target.id === 'qa-url') { qaDest(); if (!qa.kindTouched) { const n = RL.normalizeUrl(qf('url').value); if (n) qaSetKind(RL.suggestKind(n)); } }
  if (e.target.id === 'qa-comment') qaCount();
  qaSave();
});
$('#qa-kind').addEventListener('change', () => { qa.kindTouched = true; qaShowKind(); qaSave(); });
$('#addForm').addEventListener('submit', e => e.preventDefault());   // posting is always an explicit tap on one of the two buttons
$('#qa-cancel').onclick = () => { if (!qa.busy) closeAdd(true); };

/* The token prompt over the sheet (QA-04): a real login form. Resolves true once the token is accepted and the admin is on, false on Cancel. */
function askToken(back) {   // back: the control to give the focus to afterwards (a tapped button does not always hold the focus on iOS)
  return new Promise(resolve => {
    qa.tokBack = back || document.activeElement; $('#addSheet').inert = true;
    $('#tok-err').textContent = ''; $('#pat').value = ''; $('#tok-go').disabled = false;
    $('#tokBg').classList.add('open'); $('#pat').focus();
    qa.tokDone = ok => {
      $('#tokBg').classList.remove('open'); $('#addSheet').inert = false; $('#pat').value = ''; $('#tok-go').disabled = false; qa.tokDone = null;
      if (qa.tokBack && document.contains(qa.tokBack)) qa.tokBack.focus(); resolve(ok);
    };
  });
}
$('#tok-cancel').onclick = () => { if (qa.tokDone) qa.tokDone(false); };
$('#tokForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (!qa.tokDone) return;
  const done = qa.tokDone;
  const pat = $('#pat').value.trim(), err = m => { $('#tok-err').textContent = m; };
  if (!pat) return err('Paste your token to continue.');
  $('#tok-go').disabled = true;
  try {
    const r = await fetch('https://api.github.com/user', {headers: {Authorization: 'Bearer ' + pat, Accept: 'application/vnd.github+json'}});
    if (qa.tokDone !== done) return;   // Cancel (or a newer prompt) arrived while GitHub was answering: this result is stale, nothing is stored (review QA-A F2)
    if (!r.ok) throw new Error('GitHub rejected the token (' + r.status + '). Check it has not expired.');
    const u = await r.json();
    if (qa.tokDone !== done) return;
    if (u.login !== OWNER) throw new Error('This token belongs to "' + u.login + '", but admin is limited to "' + OWNER + '".');
    tokenStore.set(pat); enableAdmin(); done(true);
  } catch (e) { if (qa.tokDone === done) { err(e.message); $('#tok-go').disabled = false; } }
});
$('#qa-unlock').onclick = async () => {   // unlock without posting (to edit or delete); the draft stays
  if (qa.busy) return;
  if (await askToken($('#qa-unlock'))) { closeAdd(false); say('Admin unlocked.'); }
};

/* Post and publish / Post as draft. The entry is validated by the very same functions as the two composers; a publish writes the one affected file through
   publishContent (the PC-B guards) and only then adds the entry to the page's lists, so a failed or refused publish leaves everything as it was. */
async function qaPost(mode) {
  if (qa.busy) return;
  const kind = qaKind(), key = kind === 'podcast' ? 'podcasts' : 'reads';
  qaClearErrors();
  let entry;
  if (kind === 'read') {
    const r = RL.validateEntry({url: qf('url').value, title: qf('title').value, comment: qf('comment').value, kind: qf('type').value, tags: qf('tags').value, category: qaSection()}, {requireCategory: true});
    const errors = {...r.errors};
    if (r.ok && RL.isDuplicate(state.reads.articles, r.value.url)) errors.url = 'This link is already in your reading list.';
    if (r.errors.kind) errors.title = errors.title || r.errors.kind;
    if (Object.keys(errors).length) return qaShowErrors(errors);
    entry = {id: Date.now(), added: today(), ...r.value};
  } else {
    if (state.podcastsUnsupported || state.podcastsFailed) return qaShowErrors({url: 'podcasts.json could not be loaded, or is newer than this page understands. Reload the page before adding.'});
    const r = RL.validatePodcastEntry({url: qf('url').value, title: qf('title').value, show: qf('show').value, comment: qf('comment').value, tags: qf('tags').value});
    if (!r.ok) return qaShowErrors(r.errors);
    entry = {id: Date.now(), added: today(), ...r.value};
  }
  if (snap[CONTENT_FILES[key][0]] === undefined) { $('#qa-msg').textContent = CONTENT_FILES[key][0] + ': this page has not finished loading it, or it could not be loaded, so nothing was added. Reload the page and try again.'; return; }   // review QA-A N1: boot would replace the lists and the entry would vanish
  const add = () => { if (key === 'reads') { state.reads.articles.unshift(entry); state.lastSection = entry.category; } else state.podcasts.podcasts.unshift(entry); };
  if (!document.body.classList.contains('admin') && !(await askToken($(mode === 'draft' ? '#qa-draft' : '#qa-publish')))) return;   // QA-04: the token is asked for now; Cancel leaves the draft as it was
  if (mode === 'draft') {
    add(); state.dirty[key] = true; updateDirty(); closeAdd(true); renderAll(); say('Added as a draft. Use Publish changes to make it public.');
    return;
  }
  if (state.dirty[key] && qa.warned !== key) {   // review QA-A F3: the file is written whole, so pending inline changes to it go public too: say so first
    qa.warned = key; $('#qa-msg').textContent = 'This also publishes your other unpublished changes to ' + CONTENT_FILES[key][0] + ' (for example a deleted or edited item). Press Post and publish again to continue, or Post as draft.';
    return;
  }
  qaBusy(true); $('#qa-note').textContent = 'Publishing…';
  try {
    const data = key === 'reads' ? RL.serializeReads({books: state.reads.books, articles: [entry, ...state.reads.articles]}) : RL.serializePodcasts({podcasts: [entry, ...state.podcasts.podcasts]});
    await publishContent(key, data);
  } catch (e) {   // stays unlocked, the sheet and the draft stay, the owner can retry
    qaBusy(false); $('#qa-note').textContent = '';
    $('#qa-msg').textContent = e.message + (/\((401)\)/.test(e.message) && document.body.classList.contains('admin') ? '\nGitHub did not accept the token. Use "Lock & sign out" and unlock again with a fresh one.' : '');
    return;
  }
  add(); state.dirty[key] = false; updateDirty(); qaBusy(false);
  const others = Object.values(state.dirty).some(Boolean);
  closeAdd(true); lock(true); renderAll(); $('#gear').focus();   // QA-06: published, so the admin locks at once
  say('Published and locked. It appears on the site in about a minute.' + (others ? ' Other unpublished changes stay on this page until you reload.' : ''));
}
$('#qa-publish').onclick = () => qaPost('publish');
$('#qa-draft').onclick = () => qaPost('draft');

/* focus trap and Escape for the two dialogs (the prompt sits over the sheet) */
document.addEventListener('keydown', e => {
  const tok = $('#tokBg').classList.contains('open'), add = $('#addBg').classList.contains('open');
  if (!tok && !add) return;
  if (e.key === 'Escape') { if (tok) { if (qa.tokDone) qa.tokDone(false); } else if (!qa.busy) closeAdd(true); return; }
  if (e.key !== 'Tab') return;
  const f = [...$(tok ? '#tokPrompt' : '#addSheet').querySelectorAll((qa.busy ? 'h3[tabindex],' : '') + 'button:not([disabled]),input,textarea,select,a[href]')].filter(x => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
window.addEventListener('hashchange', () => { if (RL.isAddHash(location.hash)) openAdd(); });

boot();

/* ---------- reads sections: keyboard and deep links (RC-02, RC-03) ---------- */
$('#readTabs').addEventListener('keydown', e => {
  const tabs = [...$('#readTabs').querySelectorAll('[role=tab]')], cur = e.target.closest('[role=tab]');
  const n = RL.nextTabIndex(e.key, tabs.indexOf(cur), tabs.length);
  if (n < 0) return;
  e.preventDefault(); selectCategory(tabs[n].dataset.cat, true);
});
/* the retired blog's links (PC-05): #blog and #blog/... land on Podcasts */
function followBlogLink() { const to = RL.redirectHash(location.hash); if (to) location.replace(to); return !!to; }
window.addEventListener('hashchange', () => { if (followBlogLink()) showId('podcasts'); });
window.addEventListener('hashchange', () => {
  if (!RL.isReadsHash(location.hash) || state.readsUnsupported) return;
  const c = RL.categoryFromHash(location.hash);
  if (c && c !== state.cat) selectCategory(c);
  if (location.hash !== '#reads') showReads();
});
