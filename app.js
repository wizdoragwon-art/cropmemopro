/* Crop Memo Pro — 오프라인 우선 현장 수집 PWA
   저장: IndexedDB(로컬) · 동기화: Google Apps Script(doPost) · 내보내기: CSV */
(function () {
  'use strict';

  // ---------- IndexedDB ----------
  var DB = null, DB_NAME = 'cropmemo', DB_VER = 2;
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('obs')) db.createObjectStore('obs', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = function (e) { res(e.target.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function os(store, mode) { return DB.transaction(store, mode).objectStore(store); }
  function kvGet(k) { return new Promise(function (res) { var r = os('kv', 'readonly').get(k); r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(undefined); }; }); }
  function kvSet(k, v) { return new Promise(function (res) { var r = os('kv', 'readwrite').put(v, k); r.onsuccess = function () { res(true); }; r.onerror = function () { res(false); }; }); }
  function obsPut(rec) { return new Promise(function (res) { var r = os('obs', 'readwrite').put(rec); r.onsuccess = function () { res(true); }; r.onerror = function () { res(false); }; }); }
  function obsAll() { return new Promise(function (res) { var out = [], r = os('obs', 'readonly').openCursor(); r.onsuccess = function (e) { var c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = function () { res(out); }; }); }
  function photoPut(rec) { return new Promise(function (res) { var r = os('photos', 'readwrite').put(rec); r.onsuccess = function () { res(true); }; r.onerror = function () { res(false); }; }); }
  function photoGet(id) { return new Promise(function (res) { var r = os('photos', 'readonly').get(id); r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; }); }
  function photoDelete(id) { return new Promise(function (res) { var r = os('photos', 'readwrite').delete(id); r.onsuccess = function () { res(true); }; r.onerror = function () { res(false); }; }); }
  function photosForLine(genId, lineId) { return new Promise(function (res) { var out = [], r = os('photos', 'readonly').openCursor(); r.onsuccess = function (e) { var c = e.target.result; if (c) { if (c.value.genId === genId && c.value.lineId === lineId) out.push(c.value); c.continue(); } else { out.sort(function (a, b) { return a.createdAt - b.createdAt; }); res(out); } }; r.onerror = function () { res(out); }; }); }
  function fileToScaledDataURL(file, maxDim) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height; var sc = Math.min(1, maxDim / Math.max(w, h || 1)); var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc)); var c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(img, 0, 0, cw, ch); try { res(c.toDataURL('image/jpeg', 0.82)); } catch (e) { rej(e); } };
      img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }

  // ---------- helpers ----------
  function todayStr() { var t = new Date(); return (t.getMonth() + 1) + '/' + t.getDate(); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 1600); }
  function haptic(ms) { try { if (S.settings && S.settings.haptic === false) return; if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} }
  function round(x, d) { if (x == null || !isFinite(x)) return '—'; var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }

  // ---------- statistics ----------
  function gammln(x) { var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; var y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); var ser = 1.000000000190015; for (var j = 0; j < 6; j++) { y++; ser += c[j] / y; } return -tmp + Math.log(2.5066282746310005 * ser / x); }
  function betacf(a, b, x) { var MAXIT = 300, EPS = 3e-12, FPMIN = 1e-300; var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; var h = d; for (var m = 1; m <= MAXIT; m++) { var m2 = 2 * m; var aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c; aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; var del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break; } return h; }
  function betai(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; var bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x)); if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a; else return 1 - bt * betacf(b, a, 1 - x) / b; }
  function fpval(F, df1, df2) { if (F <= 0) return 1; return betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * F)); }
  function erf(x) { var t = 1 / (1 + 0.3275911 * Math.abs(x)); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  function ncdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function prange(q, k) { if (q <= 0) return 0; var lo = -8, hi = 8, n = 240, h = (hi - lo) / n, s = 0; for (var i = 0; i <= n; i++) { var u = lo + i * h; var phi = Math.exp(-u * u / 2) / Math.sqrt(2 * Math.PI); var d = ncdf(u) - ncdf(u - q); if (d < 0) d = 0; var f = k * phi * Math.pow(d, k - 1); var w = (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2); s += w * f; } return s * h / 3; }
  function ptukey(q, k, df) { if (df > 2000) return prange(q, k); var lo = 0.0001, hi = 3.5, n = 160, h = (hi - lo) / n, sum = 0; for (var i = 0; i <= n; i++) { var s = lo + i * h; var x = df * s * s; var logpdf = (df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - gammln(df / 2); var g = Math.exp(logpdf) * 2 * df * s; var f = prange(q * s, k) * g; var w = (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2); sum += w * f; } return sum * h / 3; }
  function qtukey(p, k, df) { var lo = 0.1, hi = 20, mid; for (var it = 0; it < 50; it++) { mid = (lo + hi) / 2; if (ptukey(mid, k, df) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; }
  function anova1(groups) {
    var k = groups.length, N = 0, grand = 0;
    var means = groups.map(function (a) { N += a.length; var s = a.reduce(function (x, y) { return x + y; }, 0); grand += s; return s / a.length; });
    grand /= N; var ssg = 0, sse = 0;
    groups.forEach(function (a, i) { ssg += a.length * Math.pow(means[i] - grand, 2); a.forEach(function (v) { sse += Math.pow(v - means[i], 2); }); });
    var dfg = k - 1, dfe = N - k, msg = ssg / dfg, mse = sse / dfe, F = msg / mse;
    return { k: k, N: N, grand: grand, means: means, dfg: dfg, dfe: dfe, msg: msg, mse: mse, F: F, p: fpval(F, dfg, dfe), cv: Math.sqrt(mse) / grand * 100, h2: (msg - mse) / msg };
  }
  function cldRuns(means, ns, mse, dfe) {
    var k = means.length, res = means.map(function () { return ''; });
    if (k < 2 || dfe < 1 || !(mse > 0)) return res;
    var q = qtukey(0.95, k, dfe);
    function nd(i, j) { return Math.abs(means[i] - means[j]) <= q * Math.sqrt(mse / 2 * (1 / ns[i] + 1 / ns[j])); }
    var letters = 'abcdefghijklmnop', col = 0, lastEnd = -1;
    for (var i = 0; i < k; i++) { var j = i; while (j + 1 < k && nd(i, j + 1)) j++; if (j > lastEnd) { for (var t = i; t <= j; t++) res[t] += letters[col] || '*'; col++; lastEnd = j; } }
    return res;
  }

  function inferSeries(t) {
    if (t.type === 'date' || t.type === 'text' || t.type === 'categorical') return false;
    if (/마커/.test(t.name)) return false;
    if (/과장|과폭|과중|과경|근장|근경|근중|종경|횡경|결구중|결구고|당도/.test(t.name)) return false;
    return true;
  }

  function seedGens() {
    var traits = [
      { id: 't_len', name: '과장', type: 'numeric', unit: 'mm' },
      { id: 't_dia', name: '과경', type: 'numeric', unit: 'mm' },
      { id: 't_wt', name: '과중', type: 'numeric', unit: 'g' },
      { id: 't_downy', name: '노균병', type: 'rating', scale: [1, 3, 5, 7, 9] },
      { id: 't_darea', name: '발병면적률', type: 'ratio', unit: '%' },
      { id: 't_pm', name: '흰가루병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] },
      { id: 't_node', name: '마디수', type: 'counter' },
      { id: 't_shape', name: '과형', type: 'categorical', options: ['직과형', '곡과형', '단과형'] },
      { id: 't_harv', name: '수확일', type: 'date' },
      { id: 't_note', name: '비고', type: 'text' }
    ];
    traits.forEach(function (t) { t.series = inferSeries(t); });
    var lines = [];
    for (var i = 0; i < 24; i++) {
      var n = String(i + 1).padStart(3, '0');
      lines.push({ id: 'L' + n, label: 'CU24-' + n, rep: (i % 3) + 1, block: 'B-' + ((i % 3) + 1), zone: 'A동', row: Math.floor(i / 10) + 1, col: (i % 10) + 1, indivTotal: 10, selected: false });
    }
    return [{ id: 'G1', projName: '오이 내병성 육종', crop: '오이', color: '#4E9A51', label: 'F3', prefix: 'CU', surveyDates: ['6/20', todayStr()], traits: traits, lines: lines }];
  }

  // ---------- state ----------
  var S = { gens: [], genIdx: 0, lineIdx: 0, indiv: 1, date: null, trait: null, showSelOnly: false,
            indivSel: {}, settings: { syncUrl: '', token: '', deviceId: '' }, vals: {}, lastSaved: null,
            lastSync: null, pending: 0, syncing: false, view: 'home', showMap: false, traitEdit: false, editIdx: 0, anTrait: null, bulkIdx: 0, bulkStage: 'idle', bulkRows: null, bulkFileName: '', ocr: null, photos: [], drawId: null, voice: null, write: null };

  function curGen() { return S.gens[S.genIdx]; }
  function curLine() { return curGen().lines[S.lineIdx]; }
  function traitById(id) { var ts = curGen().traits; for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i]; return null; }
  function total() { return curLine().indivTotal; }
  function valKey(lineId, indiv, tid) { var t = traitById(tid), g = curGen(); return g.id + ':' + lineId + ':' + indiv + ':' + tid + (t && t.series ? ('@' + S.date) : ''); }
  function getVal(tid) { return S.vals[valKey(curLine().id, S.indiv, tid)]; }
  function lineHasIndivSel(lineId) { for (var k in S.indivSel) { if (S.indivSel[k] && k.indexOf(lineId + ':') === 0) return true; } return false; }

  async function setVal(tid, value) {
    var g = curGen(), l = curLine(), t = traitById(tid);
    var k = valKey(l.id, S.indiv, tid);
    S.vals[k] = value;
    var rec = { k: k, genId: g.id, lineId: l.id, indiv: S.indiv, traitId: tid, date: (t && t.series ? S.date : null), value: value, updatedAt: Date.now(), dirty: 1 };
    await obsPut(rec);
    S.lastSaved = Date.now();
    updatePending();
  }

  async function loadVals() {
    S.vals = {};
    var all = await obsAll(), g = curGen();
    all.forEach(function (r) { if (r.genId === g.id) S.vals[r.k] = r.value; });
  }
  async function updatePending() {
    var all = await obsAll();
    S.pending = all.filter(function (r) { return r.dirty; }).length;
    var b = document.querySelector('[data-pending]'); if (b) b.textContent = S.pending;
    var sc = $('syncStat'); if (sc) renderSyncStat(sc);
  }

  // ---------- sync (Google Apps Script) ----------
  async function trySync(silent) {
    var url = S.settings.syncUrl;
    if (!url) { if (!silent) toast('설정에서 동기화 URL을 입력하세요'); return; }
    if (!navigator.onLine) { if (!silent) toast('오프라인 상태입니다'); return; }
    var all = await obsAll(), dirty = all.filter(function (r) { return r.dirty; });
    var g = curGen(), batch = [];
    g.lines.forEach(function (l) {
      batch.push({ table: 'line', key: g.id + '|' + l.id, data: { projId: g.id, genId: g.id, label: l.label, zone: l.zone, row: l.row, col: l.col, rep: l.rep, block: l.block, indivTotal: l.indivTotal, selected: !!l.selected }, updatedAt: Date.now() });
    });
    dirty.forEach(function (r) {
      batch.push({ table: 'observation', key: r.genId + '|' + r.lineId + '|' + r.indiv + '|' + r.traitId + (r.date ? ('@' + r.date) : ''), data: { projId: r.genId, genId: r.genId, lineId: r.lineId, indiv: r.indiv, traitId: r.traitId, value: (typeof r.value === 'string' && r.value.indexOf('data:image') === 0) ? '(그림)' : r.value, date: r.date || '' }, updatedAt: r.updatedAt });
    });
    if (!dirty.length) { if (!silent) toast('전송할 변경분이 없습니다'); return; }
    S.syncing = true; renderCurrent();
    try {
      var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ deviceId: S.settings.deviceId, token: S.settings.token || '', batch: batch }) });
      var j = await res.json();
      if (j && j.ok) {
        for (var i = 0; i < dirty.length; i++) { dirty[i].dirty = 0; await obsPut(dirty[i]); }
        S.lastSync = Date.now(); await kvSet('lastSync', S.lastSync);
        if (!silent) toast('동기화 완료 · ' + (j.applied || 0) + '건 반영');
      } else { if (!silent) toast('동기화 실패 · 서버 응답 오류'); }
    } catch (e) {
      if (!silent) toast('동기화 실패 · 연결/URL 확인');
    } finally { S.syncing = false; updatePending(); renderCurrent(); }
  }

  async function pingSync() {
    var url = S.settings.syncUrl; if (!url) { toast('URL을 입력하세요'); return; }
    try { var res = await fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'action=ping'); var j = await res.json(); toast(j && j.ok ? '연결 성공 ✓' : '응답 오류'); }
    catch (e) { toast('연결 실패 · URL 확인'); }
  }

  // ---------- CSV export ----------
  async function exportCSV() {
    var g = curGen(), all = await obsAll(), recs = all.filter(function (r) { return r.genId === g.id; });
    var lineById = {}; g.lines.forEach(function (l) { lineById[l.id] = l; });
    var rows = [['라벨번호', '세대', '반복', '개체', '조사일', '형질', '값', '개체선발', '계통선발']];
    recs.forEach(function (r) {
      var l = lineById[r.lineId] || {}, t = traitById(r.traitId);
      rows.push([l.label || r.lineId, g.label, l.rep || '', r.indiv, r.date || '', (t ? t.name : r.traitId), (typeof r.value === 'string' && r.value.indexOf('data:image') === 0) ? '(그림)' : r.value, (S.indivSel[r.lineId + ':' + r.indiv] ? 'Y' : ''), (l.selected ? 'Y' : '')]);
    });
    if (recs.length === 0) { toast('내보낼 데이터가 없습니다'); return; }
    var csv = rows.map(function (row) { return row.map(function (c) { c = (c == null ? '' : String(c)); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cropmemo_' + g.label + '_' + todayStr().replace('/', '-') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('CSV ' + recs.length + '행 내보냄');
  }

  // ---------- routing ----------
  function go(view) {
    if ((view === 'collect' || view === 'export' || view === 'analysis' || view === 'ocr' || view === 'photo' || view === 'draw' || view === 'voice') && !S.gens.length) view = 'home';
    if (view !== 'collect') S.traitEdit = false;
    S.view = view;
    ['home', 'collect', 'export', 'settings', 'new', 'genedit', 'analysis', 'bulk', 'ocr', 'photo', 'draw', 'voice', 'write'].forEach(function (v) {
      $('view-' + v).classList.toggle('on', v === view);
    });
    document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === view); });
    renderCurrent();
    window.scrollTo(0, 0);
  }
  function renderCurrent() {
    if (S.view === 'home') renderHome();
    else if (S.view === 'collect') renderCollect();
    else if (S.view === 'export') renderExport();
    else if (S.view === 'settings') renderSettings();
    else if (S.view === 'new') renderNew();
    else if (S.view === 'genedit') renderGenEdit();
    else if (S.view === 'analysis') renderAnalysis();
    else if (S.view === 'bulk') renderBulk();
    else if (S.view === 'ocr') renderOCR();
    else if (S.view === 'photo') renderPhoto();
    else if (S.view === 'draw') renderDraw();
    else if (S.view === 'voice') renderVoice();
    else if (S.view === 'write') renderWrite();
  }

  // ---------- NEW PROJECT WIZARD ----------
  var WIZ_CROPS = [
    { name: '토마토', color: '#D64545', prefix: 'TM' }, { name: '고추', color: '#E67E22', prefix: 'PP' },
    { name: '무', color: '#7BA0C4', prefix: 'RD' }, { name: '배추', color: '#7FB069', prefix: 'CB' },
    { name: '수박', color: '#2E7D5B', prefix: 'WM' }, { name: '오이', color: '#4E9A51', prefix: 'CU' }
  ];
  var GEN_ORDER = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
  var TRAITSETS = {
    '토마토': [{ name: '과장', type: 'numeric', unit: 'mm' }, { name: '과중', type: 'numeric', unit: 'g' }, { name: '당도', type: 'numeric', unit: 'Bx' }, { name: '병징', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '발병면적률', type: 'ratio', unit: '%' }, { name: 'TSWV 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '착과수', type: 'counter' }, { name: '과형', type: 'categorical', options: ['원형', '편원형', '장형'] }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }],
    '고추': [{ name: '과장', type: 'numeric', unit: 'mm' }, { name: '과폭', type: 'numeric', unit: 'mm' }, { name: '과중', type: 'numeric', unit: 'g' }, { name: '신미', type: 'categorical', options: ['약', '중', '강'] }, { name: '역병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '탄저병', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '착과수', type: 'counter' }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }],
    '무': [{ name: '근장', type: 'numeric', unit: 'mm' }, { name: '근경', type: 'numeric', unit: 'mm' }, { name: '근중', type: 'numeric', unit: 'g' }, { name: '바람들이', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '무름병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '추대성', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }],
    '배추': [{ name: '결구중', type: 'numeric', unit: 'g' }, { name: '결구고', type: 'numeric', unit: 'mm' }, { name: '결구정도', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '뿌리혹병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '무름병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '추대성', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }],
    '수박': [{ name: '과중', type: 'numeric', unit: 'g' }, { name: '당도', type: 'numeric', unit: 'Bx' }, { name: '육색', type: 'categorical', options: ['적색', '황색', '주황'] }, { name: '공동', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '덩굴쪼김병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '착과수', type: 'counter' }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }],
    '오이': [{ name: '과장', type: 'numeric', unit: 'mm' }, { name: '과경', type: 'numeric', unit: 'mm' }, { name: '과중', type: 'numeric', unit: 'g' }, { name: '노균병', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '발병면적률', type: 'ratio', unit: '%' }, { name: '흰가루병 저항성', type: 'rating', scale: ['R', 'IR', 'S'] }, { name: '마디수', type: 'counter' }, { name: '과형', type: 'categorical', options: ['직과형', '곡과형', '단과형'] }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }]
  };
  var GENERIC_TRAITS = [{ name: '생육 상태', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '초장', type: 'numeric', unit: 'cm' }, { name: '병해', type: 'rating', scale: [1, 3, 5, 7, 9] }, { name: '수확일', type: 'date' }, { name: '비고', type: 'text' }];
  function byGen(a, b) { return GEN_ORDER.indexOf(a) - GEN_ORDER.indexOf(b); }
  function wizCropMeta(name) { var cs = S.wiz.crops; for (var i = 0; i < cs.length; i++) if (cs[i].name === name) return cs[i]; return null; }
  function wizTraitSet(name) { return (TRAITSETS[name] || GENERIC_TRAITS); }
  function startNew() { S.wiz = { step: 1, name: '', crop: '오이', prefix: 'CU', prefixEdited: false, goal: '', gens: ['F3'], lines: 24, indiv: 10, zone: 'A동', rcbd: true, reps: 3, traitOff: {}, crops: WIZ_CROPS.map(function (c) { return { name: c.name, color: c.color, prefix: c.prefix }; }), adding: false, nc: { name: '', prefix: '' } }; go('new'); }

  function renderNew() {
    var w = S.wiz; if (!w) { startNew(); return; }
    var v = $('view-new'), names = ['과제 정보', '세대', '형질세트'];
    var body = w.step === 1 ? stepInfo(w) : (w.step === 2 ? stepGen(w) : stepTraits(w));
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)">' +
        '<button class="btn" id="wClose" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('x', 'var(--text-primary)', 18) + '</button>' +
        '<div style="flex:1"><div style="font-size:15px;font-weight:600">새 과제 생성</div><div style="font-size:11px;color:var(--text-muted)">' + w.step + ' / 3 · ' + names[w.step - 1] + '</div></div></div>' +
      '<div style="display:flex;gap:6px;padding:12px 14px 4px">' + [1, 2, 3].map(function (n) { return '<div style="flex:1;text-align:center"><div style="height:5px;border-radius:3px;background:' + (n <= w.step ? '#639922' : 'var(--border)') + '"></div><div style="font-size:10px;margin-top:5px;color:' + (n === w.step ? '#27500A' : 'var(--text-muted)') + '">' + n + '. ' + names[n - 1] + '</div></div>'; }).join('') + '</div>' +
      '<div style="flex:1;padding:8px 16px 12px;overflow:auto">' + body + '</div>' +
      '<div style="padding:10px 14px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)">' +
        '<div id="wHint" style="font-size:11px;color:#B0721A;margin-bottom:8px;display:none"></div>' +
        '<div style="display:flex;gap:10px">' + (w.step > 1 ? '<button class="btn" id="wPrev" style="flex:0 0 90px;height:48px;font-size:14px">이전</button>' : '') +
          '<button class="btn primary" id="wNext" style="flex:1;height:48px;font-size:15px">' + (w.step < 3 ? '다음' : '과제 생성') + '</button></div></div>';
    wireNew(w);
  }
  function stepInfo(w) {
    var chips = w.crops.map(function (c) { return '<button class="pill wcrop' + (c.name === w.crop ? ' on' : '') + '" data-c="' + esc(c.name) + '"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c.color + ';margin-right:5px"></span>' + esc(c.name) + '</button>'; }).join('');
    chips += '<button class="pill" id="wAddCrop" style="border-style:dashed">' + ico('plus', 'var(--text-secondary)', 13) + ' 작물 추가</button>';
    var addForm = w.adding ? ('<div class="card" style="margin-top:10px"><div style="font-size:12px;font-weight:600;margin-bottom:8px">' + ico('plant-2', '#639922', 14) + ' 작물 추가</div><div style="display:flex;gap:8px"><div style="flex:2"><label style="font-size:11px;color:var(--text-secondary)">작물명</label><input class="ein" id="wNcName" style="margin-top:4px" placeholder="예) 양파" value="' + esc(w.nc.name) + '"></div><div style="flex:1"><label style="font-size:11px;color:var(--text-secondary)">접두어</label><input class="ein" id="wNcPre" style="margin-top:4px;text-transform:uppercase" placeholder="예) ON" value="' + esc(w.nc.prefix) + '"></div></div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="wNcCancel" style="flex:0 0 80px;height:38px;font-size:13px">취소</button><button class="btn primary" id="wNcAdd" style="flex:1;height:38px;font-size:13px">추가하고 선택</button></div></div>') : '';
    return '<label style="font-size:12px;color:var(--text-secondary);font-weight:500">과제명</label>' +
      '<input class="ein" id="wName" style="margin-top:6px" placeholder="예) 오이 내병성 육종" value="' + esc(w.name) + '">' +
      '<div style="font-size:12px;color:var(--text-secondary);font-weight:500;margin:14px 0 6px">작물</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' + chips + '</div>' + addForm +
      '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin:14px 0 6px">라벨 접두어</label>' +
      '<input class="ein" id="wPre" style="text-transform:uppercase" placeholder="예) CU" value="' + esc(w.prefix) + '">' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">' + ico('info-circle', 'var(--text-muted)', 13) + ' 라벨번호 예시: <b id="wPrePrev">' + esc(w.prefix || '??') + '</b>## <span style="color:var(--text-muted)">(## = 라벨·엑셀 값 그대로, 고정 형식 아님)</span></div>' +
      '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin:14px 0 6px">목표 · 설명 (선택)</label>' +
      '<textarea class="ein" id="wGoal" style="height:64px;padding:9px 12px;resize:none" placeholder="예) 노균병·흰가루병 복합저항 계통 육성">' + esc(w.goal) + '</textarea>';
  }
  function stepGen(w) {
    var gc = GEN_ORDER.map(function (g) { var on = w.gens.indexOf(g) >= 0; return '<button class="pill wgen' + (on ? ' on' : '') + '" data-g="' + g + '">' + (on ? ico('check', '#27500A', 13) + ' ' : '') + g + '</button>'; }).join('');
    var reps = w.rcbd ? ('<div style="display:flex;align-items:center;gap:8px;margin-top:12px"><span style="font-size:12px;color:var(--text-secondary)">반복 수</span>' + [2, 3, 4].map(function (n) { return '<button class="btn wrep" data-n="' + n + '" style="width:44px;height:34px;font-size:14px' + (n === w.reps ? ';background:#EAF3DE;border-color:#639922;color:#27500A' : '') + '">' + n + '</button>'; }).join('') + '</div>') : '';
    return '<div style="font-size:12px;color:var(--text-secondary);font-weight:500;margin-bottom:6px">세대 <span style="color:var(--text-muted);font-weight:400">(중복 선택)</span></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' + gc + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><div style="flex:1"><label style="font-size:12px;color:var(--text-secondary)">조합·계통 수</label><input class="ein" id="wLines" type="number" style="margin-top:6px" value="' + w.lines + '"></div><div style="flex:1"><label style="font-size:12px;color:var(--text-secondary)">계통당 개체 수</label><input class="ein" id="wIndiv" type="number" style="margin-top:6px" value="' + w.indiv + '"></div></div>' +
      '<label style="font-size:12px;color:var(--text-secondary);display:block;margin:14px 0 6px">포장 / 구역</label><input class="ein" id="wZone" value="' + esc(w.zone) + '">' +
      '<div class="card" style="margin-top:14px"><div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><div style="font-size:13px;font-weight:500">반복 배치 (RCBD)</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">분산분석·유전력 산출에 필요</div></div><div class="sw' + (w.rcbd ? ' on' : '') + '" id="wRcbd"><div class="knob"></div></div></div>' + reps + '</div>';
  }
  function stepTraits(w) {
    var set = wizTraitSet(w.crop);
    var rows = set.map(function (t, i) {
      var on = !w.traitOff[i];
      var tag = t.unit ? t.unit : (t.scale ? (typeof t.scale[0] === 'number' ? t.scale.join('·') : t.scale.join('/')) : (t.type === 'counter' ? '개수' : t.type === 'date' ? '날짜' : t.type === 'categorical' ? '항목' : ''));
      return '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:0.5px solid var(--border)"><div style="flex:1;font-size:13px;font-weight:500;color:' + (on ? 'var(--text-primary)' : 'var(--text-muted)') + '">' + esc(t.name) + (tag ? ' <span style="font-size:10px;color:var(--text-muted);border:0.5px solid var(--border);border-radius:5px;padding:1px 5px">' + esc(tag) + '</span>' : '') + '</div><div class="sw wtoggle' + (on ? ' on' : '') + '" data-i="' + i + '"><div class="knob"></div></div></div>';
    }).join('');
    var active = set.filter(function (t, i) { return !w.traitOff[i]; }).length;
    var nG = w.gens.length, tot = w.lines * w.indiv * nG, gl = w.gens.slice().sort(byGen).join('·');
    return '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px"><b>' + esc(w.crop) + ' · ' + gl + '</b> 형질세트 · 필요없는 항목은 끄세요</div>' +
      '<div style="max-height:230px;overflow:auto">' + rows + '</div>' +
      '<div class="card" style="margin-top:14px;background:#EAF3DE"><div style="font-size:12px;color:#3B6D11;font-weight:600;margin-bottom:6px">' + ico('checks', '#3B6D11', 14) + ' 생성 요약</div><div style="font-size:13px;color:#27500A;line-height:1.7">과제 <b>' + esc(w.name || '(이름 없음)') + '</b> · <b>' + esc(w.crop) + '</b><br>세대 <b>' + gl + '</b> (' + nG + '개)<br>각 세대: 계통 <b>' + w.lines + '</b> × 개체 <b>' + w.indiv + '</b>' + (w.rcbd ? ' · 반복 <b>' + w.reps + '</b>' : '') + '<br>총 <b>' + tot + '</b>개체 · 형질 <b>' + active + '</b>개 · 라벨 <b>' + esc(w.prefix) + '</b></div></div>';
  }
  function wizBlock(w) {
    if (w.step === 1) { if (!(w.name || '').trim()) return '과제명을 입력하세요.'; if (!w.crop) return '작물을 선택하세요.'; if (!(w.prefix || '').trim()) return '라벨 접두어를 입력하세요.'; }
    if (w.step === 2) { if (!w.gens.length) return '세대를 1개 이상 선택하세요.'; if (!(w.lines > 0)) return '조합·계통 수를 입력하세요.'; if (!(w.indiv > 0)) return '개체 수를 입력하세요.'; if (w.rcbd && !(w.reps > 0)) return '반복 수를 선택하세요.'; }
    return '';
  }
  function wireNew(w) {
    $('wClose').onclick = function () { if (confirm('작성 중인 내용을 취소할까요?')) { S.wiz = null; go('home'); } };
    if ($('wPrev')) $('wPrev').onclick = function () { w.step--; renderNew(); };
    $('wNext').onclick = function () { var r = wizBlock(w); if (r) { var h = $('wHint'); h.textContent = r; h.style.display = 'block'; return; } if (w.step < 3) { w.step++; renderNew(); } else createProject(); };
    if (w.step === 1) {
      $('wName').oninput = function () { w.name = this.value; };
      document.querySelectorAll('.wcrop').forEach(function (b) { b.onclick = function () { w.crop = b.getAttribute('data-c'); var m = wizCropMeta(w.crop); if (!w.prefixEdited && m) w.prefix = m.prefix; w.traitOff = {}; renderNew(); }; });
      $('wAddCrop').onclick = function () { w.adding = true; w.nc = { name: '', prefix: '' }; renderNew(); };
      $('wPre').oninput = function () { w.prefix = this.value.toUpperCase(); w.prefixEdited = true; var p = $('wPrePrev'); if (p) p.textContent = w.prefix || '??'; };
      $('wGoal').oninput = function () { w.goal = this.value; };
      if (w.adding) {
        $('wNcName').oninput = function () { w.nc.name = this.value; };
        $('wNcPre').oninput = function () { w.nc.prefix = this.value.toUpperCase(); };
        $('wNcCancel').onclick = function () { w.adding = false; renderNew(); };
        $('wNcAdd').onclick = function () { var nm = (w.nc.name || '').trim(); if (!nm) { toast('작물명을 입력하세요'); return; } if (!wizCropMeta(nm)) { var pal = ['#8E7CC3', '#C2185B', '#00838F', '#5D8AA8', '#B8860B', '#6D4C41']; w.crops.push({ name: nm, color: pal[(w.crops.length - 6) % pal.length] || '#6D4C41', prefix: (w.nc.prefix || nm.slice(0, 2)).toUpperCase() }); } var m = wizCropMeta(nm); w.crop = nm; w.prefix = m.prefix; w.prefixEdited = true; w.adding = false; w.traitOff = {}; renderNew(); };
      }
    } else if (w.step === 2) {
      document.querySelectorAll('.wgen').forEach(function (b) { b.onclick = function () { var g = b.getAttribute('data-g'), i = w.gens.indexOf(g); if (i >= 0) w.gens.splice(i, 1); else w.gens.push(g); renderNew(); }; });
      $('wLines').oninput = function () { w.lines = parseInt(this.value) || 0; };
      $('wIndiv').oninput = function () { w.indiv = parseInt(this.value) || 0; };
      $('wZone').oninput = function () { w.zone = this.value; };
      $('wRcbd').onclick = function () { w.rcbd = !w.rcbd; renderNew(); };
      document.querySelectorAll('.wrep').forEach(function (b) { b.onclick = function () { w.reps = parseInt(b.getAttribute('data-n')); renderNew(); }; });
    } else {
      document.querySelectorAll('.wtoggle').forEach(function (b) { b.onclick = function () { var i = +b.getAttribute('data-i'); if (w.traitOff[i]) delete w.traitOff[i]; else w.traitOff[i] = 1; renderNew(); }; });
    }
  }
  function createProject() {
    var w = S.wiz, meta = wizCropMeta(w.crop);
    var defs = wizTraitSet(w.crop).filter(function (t, i) { return !w.traitOff[i]; });
    var base = Date.now(), newGens = [];
    w.gens.slice().sort(byGen).forEach(function (gl, gi) {
      var traits = defs.map(function (t, ti) { var o = { id: 't' + (ti + 1), name: t.name, type: t.type }; if (t.unit) o.unit = t.unit; if (t.scale) o.scale = t.scale.slice(); if (t.options) o.options = t.options.slice(); o.series = inferSeries(o); return o; });
      var lines = [];
      for (var i = 0; i < w.lines; i++) { var n = String(i + 1).padStart(3, '0'); lines.push({ id: 'L' + n, label: w.prefix + '-' + n, rep: w.rcbd ? ((i % w.reps) + 1) : 1, block: w.rcbd ? ('B-' + ((i % w.reps) + 1)) : '', zone: w.zone, row: Math.floor(i / 10) + 1, col: (i % 10) + 1, indivTotal: w.indiv, selected: false }); }
      newGens.push({ id: 'G' + base + '_' + gi, projName: w.name, crop: w.crop, color: (meta && meta.color) || '#639922', label: gl, prefix: w.prefix, surveyDates: [todayStr()], traits: traits, lines: lines });
    });
    S.gens = newGens.concat(S.gens);
    S.genIdx = 0; S.lineIdx = 0; S.indiv = 1; S.date = todayStr(); S.trait = S.gens[0].traits[0].id; S.wiz = null;
    kvSet('gens', S.gens).then(function () { return loadVals(); }).then(function () { toast('과제 생성됨 · ' + newGens[0].projName); go('collect'); });
  }

  // ---------- HOME ----------
  function renderSyncStat(el) {
    var online = navigator.onLine;
    if (S.syncing) { el.style.cssText = base('#EAF3DE', '#CFE0BA'); el.innerHTML = ico('cloud-upload', '#3B6D11', 24) + txt('동기화 중…', '#27500A', '전송하고 있습니다'); return; }
    if (!online) { el.style.cssText = base('#FAEEDA', '#EAD6A8'); el.innerHTML = ico('cloud-off', '#B0721A', 24) + txt('오프라인 · 미전송 ' + S.pending + '건', '#8A5A12', '연결되면 자동으로 올라갑니다') + right(S.lastSaved ? tm(S.lastSaved) + ' 저장' : '', '#A67B2E'); return; }
    if (S.pending > 0) { el.style.cssText = base('#FAEEDA', '#EAD6A8'); el.innerHTML = ico('cloud-upload', '#B0721A', 24) + txt('미전송 ' + S.pending + '건', '#8A5A12', '탭하여 지금 동기화') + right('▸', '#A67B2E'); return; }
    el.style.cssText = base('#EAF3DE', '#CFE0BA'); el.innerHTML = ico('cloud-check', '#3B6D11', 24) + txt('동기화됨', '#27500A', S.lastSync ? tm(S.lastSync) + ' · 시트 반영' : '전송할 항목 없음') + right('✓', '#3B6D11');
    function base(bg, bd) { return 'margin:4px 14px 0;padding:12px 13px;border-radius:12px;display:flex;align-items:center;gap:11px;cursor:pointer;background:' + bg + ';border:0.5px solid ' + bd; }
    function txt(a, c, b) { return '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:' + c + '">' + a + '</div><div style="font-size:11px;color:' + c + ';opacity:.8;margin-top:1px">' + b + '</div></div>'; }
    function right(t, c) { return '<span style="font-size:12px;color:' + c + '">' + t + '</span>'; }
  }
  function ico(name, color, size) { return '<i class="ti ti-' + name + '" style="font-size:' + (size || 16) + 'px;color:' + color + '"></i>'; }
  function tm(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function homeEmptyHTML() {
    return '<div style="display:flex;align-items:center;gap:11px;padding:16px 16px 10px"><div style="width:40px;height:40px;border-radius:11px;background:#639922;display:flex;align-items:center;justify-content:center;flex:0 0 auto">' + ico('plant-2', '#fff', 23) + '</div><div style="flex:1"><div style="font-size:18px;font-weight:700">Crop Memo Pro</div><div style="font-size:11px;color:var(--text-muted)">종자연구소 야장 · 오프라인</div></div><button class="btn" id="heGear" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:10px">' + ico('settings', 'var(--text-secondary)', 20) + '</button></div>' +
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;color:var(--text-muted)">' + ico('clipboard-list', 'var(--border-strong)', 48) + '<div style="font-size:14px;margin-top:14px">아직 과제가 없습니다</div><button class="btn primary" id="heNew" style="height:48px;padding:0 22px;font-size:15px;margin-top:18px;display:inline-flex;align-items:center;gap:6px">' + ico('plus', '#fff', 18) + ' 새 과제 만들기</button></div>';
  }
  function selectGen(i) { S.genIdx = i; S.lineIdx = 0; S.indiv = 1; var g = curGen(); S.date = g.surveyDates[g.surveyDates.length - 1]; S.trait = g.traits[0].id; loadVals().then(function () { go('collect'); }); }
  function deleteGen(i) {
    var g = S.gens[i]; if (!g) return;
    if (!confirm('"' + g.projName + ' · ' + g.label + '"을(를) 삭제할까요?\n수집한 데이터도 함께 삭제됩니다.')) return;
    var gid = g.id; S.gens.splice(i, 1);
    if (S.genIdx >= S.gens.length) S.genIdx = S.gens.length - 1; if (S.genIdx < 0) S.genIdx = 0;
    obsAll().then(function (all) { var st = os('obs', 'readwrite'); all.forEach(function (r) { if (r.genId === gid) st.delete(r.k); }); });
    kvSet('gens', S.gens).then(function () {
      if (S.gens.length) { var g2 = curGen(); S.lineIdx = 0; S.indiv = 1; S.date = g2.surveyDates[g2.surveyDates.length - 1]; S.trait = g2.traits[0].id; }
      loadVals().then(function () { updatePending(); go('home'); });
    });
    toast('삭제됨');
  }
  function renderGenEdit() {
    var i = S.editIdx, g = S.gens[i]; if (!g) { go('home'); return; }
    var v = $('view-genedit');
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="geBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">과제 수정</div><div style="font-size:11px;color:var(--text-muted)">' + esc(g.crop) + ' · ' + esc(g.label) + '</div></div></div>' +
      '<div style="flex:1;padding:16px 16px;overflow:auto">' +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500">과제명</label><input class="ein" id="geName" style="margin-top:6px" value="' + esc(g.projName) + '">' +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin-top:14px">세대</label><input class="ein" id="geLabel" style="margin-top:6px" value="' + esc(g.label) + '">' +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin-top:14px">라벨 접두어</label><input class="ein" id="gePrefix" style="margin-top:6px;text-transform:uppercase" value="' + esc(g.prefix || '') + '">' +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin-top:14px">포장 / 구역</label><input class="ein" id="geZone" style="margin-top:6px" value="' + esc((g.lines[0] && g.lines[0].zone) || '') + '">' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:12px">계통 ' + g.lines.length + ' · 형질 ' + g.traits.length + '개 · 형질 편집은 야장 수집의 “형질 수정”에서</div>' +
        '<button class="btn" id="geBulk" style="width:100%;height:46px;font-size:14px;margin-top:16px;display:flex;align-items:center;justify-content:center;gap:6px">' + ico('table', 'var(--text-primary)', 16) + ' 엑셀(CSV) 라벨 일괄등록</button>' +
        '<button class="btn" id="geDel" style="width:100%;height:46px;font-size:14px;margin-top:10px;color:#C0392B;border-color:#E3B4AE;display:flex;align-items:center;justify-content:center;gap:6px">' + ico('trash', '#C0392B', 16) + ' 이 과제 삭제</button>' +
      '</div>' +
      '<div style="padding:10px 14px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)"><button class="btn primary" id="geSave" style="width:100%;height:48px;font-size:15px">저장</button></div>';
    $('geBack').onclick = function () { go('home'); };
    $('geSave').onclick = function () { g.projName = $('geName').value.trim() || g.projName; g.label = $('geLabel').value.trim() || g.label; var pf = $('gePrefix').value.trim().toUpperCase(); if (pf) g.prefix = pf; var zn = $('geZone').value.trim(); if (zn) g.lines.forEach(function (l) { l.zone = zn; }); kvSet('gens', S.gens).then(function () { toast('저장됨'); go('home'); }); };
    $('geDel').onclick = function () { deleteGen(i); };
    $('geBulk').onclick = function () { S.bulkIdx = i; S.bulkStage = 'idle'; S.bulkRows = null; S.bulkFileName = ''; go('bulk'); };
  }

  function renderHome() {
    var v = $('view-home');
    if (!S.gens.length) { v.innerHTML = homeEmptyHTML(); if ($('heGear')) $('heGear').onclick = function () { go('settings'); }; if ($('heNew')) $('heNew').onclick = function () { startNew(); }; return; }
    var g = curGen(), l = curLine();
    var doneToday = Object.keys(S.vals).length; // rough
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:11px;padding:16px 16px 10px">' +
        '<div style="width:40px;height:40px;border-radius:11px;background:#639922;display:flex;align-items:center;justify-content:center;flex:0 0 auto">' + ico('plant-2', '#fff', 23) + '</div>' +
        '<div style="flex:1"><div style="font-size:18px;font-weight:700">Crop Memo Pro</div><div style="font-size:11px;color:var(--text-muted)">종자연구소 야장 · 오프라인</div></div>' +
        '<button class="btn" id="hGear" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:10px">' + ico('settings', 'var(--text-secondary)', 20) + '</button>' +
      '</div>' +
      '<div id="syncStat"></div>' +
      '<div style="margin:14px 14px 0;padding:14px;border-radius:14px;background:#EAF3DE;border:0.5px solid #CFE0BA">' +
        '<div style="font-size:11px;color:#3B6D11;font-weight:600">이어서 수집</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">' +
          '<div style="width:44px;height:44px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto"><span style="font-size:15px;font-weight:700;color:#27500A">' + esc(g.label) + '</span></div>' +
          '<div style="flex:1"><div style="font-size:14px;font-weight:600"><span style="color:' + (g.color || '#639922') + '">' + esc(g.crop) + '</span> ' + esc(g.projName) + '</div><div style="font-size:12px;color:var(--text-secondary);margin-top:1px">' + esc(l.label) + ' · 개체 <b>' + S.indiv + '</b>/' + l.indivTotal + ' · ' + g.lines.length + ' 계통</div></div>' +
        '</div>' +
        '<button class="btn primary" id="hResume" style="width:100%;height:50px;font-size:15px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px">' + ico('clipboard-list', '#fff', 20) + ' 야장 수집 계속</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin:14px 14px 0">' +
        stat(g.lines.length, '계통') + stat(g.lines.filter(function (x) { return x.selected; }).length, '선발 계통') + statP() +
      '</div>' +
      '<div style="margin:16px 14px 0"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px;font-weight:600">과제 · 세대</span><button class="btn" id="hNew" style="padding:5px 10px;font-size:12px;display:inline-flex;align-items:center;gap:4px">' + ico('plus', 'var(--text-primary)', 14) + ' 새 과제</button></div>' +
        S.gens.map(function (gg, i) { return '<div class="hgenrow" style="display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:11px;margin-bottom:8px;border:0.5px solid ' + (i === S.genIdx ? '#639922' : 'var(--border-strong)') + ';background:' + (i === S.genIdx ? '#F7FAF2' : 'var(--surface-2)') + '"><div style="width:4px;height:34px;border-radius:2px;background:' + (gg.color || '#639922') + '"></div><div class="hgenopen" data-i="' + i + '" style="flex:1;min-width:0;cursor:pointer"><div style="font-size:13px;font-weight:500">' + esc(gg.projName) + '</div><div style="font-size:11px;color:var(--text-muted)">' + esc(gg.label) + ' · ' + esc(gg.crop) + ' · ' + gg.lines.length + ' 계통</div></div><button class="btn hgenedit" data-i="' + i + '" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex:0 0 auto">' + ico('pencil', 'var(--text-secondary)', 16) + '</button><button class="btn hgendel" data-i="' + i + '" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;color:#C0392B;border-color:#E3B4AE">' + ico('trash', '#C0392B', 16) + '</button></div>'; }).join('') +
      '</div>' +
      '<div style="height:20px"></div>';
    renderSyncStat($('syncStat'));
    $('syncStat').onclick = function () { trySync(false); };
    $('hGear').onclick = function () { go('settings'); };
    $('hResume').onclick = function () { go('collect'); };
    $('hNew').onclick = function () { startNew(); };
    document.querySelectorAll('.hgenopen').forEach(function (b) { b.onclick = function () { selectGen(+b.getAttribute('data-i')); }; });
    document.querySelectorAll('.hgenedit').forEach(function (b) { b.onclick = function () { S.editIdx = +b.getAttribute('data-i'); go('genedit'); }; });
    document.querySelectorAll('.hgendel').forEach(function (b) { b.onclick = function () { deleteGen(+b.getAttribute('data-i')); }; });
    function stat(n, label) { return '<div style="flex:1;background:var(--surface-1);border-radius:11px;padding:10px 11px"><div style="font-size:19px;font-weight:600">' + n + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:1px">' + label + '</div></div>'; }
    function statP() { return '<div style="flex:1;background:#FAEEDA;border-radius:11px;padding:10px 11px"><div style="font-size:19px;font-weight:600;color:#8A5A12" data-pending>' + S.pending + '</div><div style="font-size:11px;color:#B0721A;margin-top:1px">미동기화</div></div>'; }
  }

  // ---------- COLLECT ----------
  function renderCollect() {
    var g = curGen(), l = curLine();
    if (S.traitEdit) { renderTraitEditor(); return; }
    var v = $('view-collect');
    v.innerHTML =
      // compact header
      '<div style="display:flex;align-items:flex-start;gap:9px;padding:10px 12px 9px;border-bottom:0.5px solid var(--border)">' +
        '<button class="btn" id="cBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex:0 0 auto">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button>' +
        '<div style="flex:1;min-width:0"><div style="font-size:16px;font-weight:600">야장 수집</div>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc(g.crop) + ' ' + esc(g.projName) + ' · ' + esc(g.label) + '</div></div>' +
        '<div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:3px">' +
          '<button class="btn" id="cMap" style="padding:5px 10px;font-size:12px;display:flex;align-items:center;gap:4px">' + ico('map-2', 'var(--text-primary)', 15) + ' 필드맵</button>' +
          '<span style="font-size:10px;color:var(--text-success)">' + ico('device-floppy', 'var(--text-success)', 12) + ' ' + (S.lastSaved ? tm(S.lastSaved) + ' 저장' : '자동저장') + '</span>' +
        '</div>' +
      '</div>' +
      '<div id="cMapWrap" class="hidden" style="margin:10px 14px 0"></div>' +
      // card
      '<div id="cCard" style="margin:12px 14px 0"></div>' +
      // survey date
      '<div id="cDate" style="padding:10px 14px 2px"></div>' +
      // trait pills
      '<div class="scroll-x" id="cPills" style="padding:8px 14px 8px"></div>' +
      // input
      '<div id="cInput" style="padding:2px 14px 8px;min-height:180px"></div>' +
      '<div id="cHist" style="padding:0 14px 10px"></div>' +
      '<div style="display:flex;gap:8px;padding:0 14px 10px">' +
        '<button class="btn" id="qPhoto" style="flex:1;height:44px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('photo', 'var(--text-primary)', 18) + ' 사진<span id="qPhotoN" style="color:#3B6D11;font-weight:600"></span></button>' +
        '<button class="btn" id="qDraw" style="flex:1;height:44px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('brush', 'var(--text-primary)', 18) + ' 그리기</button>' +
        '<button class="btn" id="qVoice" style="flex:1;height:44px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('microphone', 'var(--text-primary)', 18) + ' 음성</button>' +
      '</div>' +
      // line nav
      '<div style="padding:10px 14px 18px;border-top:0.5px solid var(--border);background:var(--surface-1)">' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;color:var(--text-muted);margin-bottom:8px">' + ico('chevron-left', 'var(--text-muted)', 15) + ' 좌우로 밀어 개체 이동 · <span id="cNum">개체</span> ' + ico('chevron-right', 'var(--text-muted)', 15) + '</div>' +
        '<div style="display:flex;gap:10px">' +
          '<button class="btn" id="cPrev" style="flex:1;height:44px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:4px">' + ico('chevron-left', 'var(--text-primary)', 16) + ' 이전 계통</button>' +
          '<button class="btn" id="cNext" style="flex:1;height:44px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:4px">다음 계통 ' + ico('chevron-right', 'var(--text-primary)', 16) + '</button>' +
        '</div>' +
      '</div>';
    renderCard(); renderDate(); renderPills(); renderInput(); renderHist(); renderMap();
    $('cNum').textContent = '개체 ' + S.indiv + '/' + total();
    $('cBack').onclick = function () { go('home'); };
    $('cMap').onclick = function () { S.showMap = !S.showMap; $('cMapWrap').classList.toggle('hidden', !S.showMap); };
    $('cPrev').onclick = function () { S.lineIdx = Math.max(0, S.lineIdx - 1); S.indiv = 1; renderCollect(); };
    $('cNext').onclick = function () { S.lineIdx = Math.min(g.lines.length - 1, S.lineIdx + 1); S.indiv = 1; renderCollect(); };
    $('qPhoto').onclick = function () { openPhotos(); };
    $('qDraw').onclick = function () { openDraw(); };
    $('qVoice').onclick = function () { S.voice = { transcript: '', parsed: [], listening: false }; go('voice'); };
    updatePhotoBadge();
    if (!S.showMap) $('cMapWrap').classList.add('hidden');
    // swipe (touch + mouse) — 좌우로 밀어 개체 이동
    attachSwipe($('cInput'), moveIndiv);
    attachSwipe($('cCard'), moveIndiv);
    attachSwipe($('cHist'), moveIndiv);
  }
  function refreshCollect() {
    if (S.view !== 'collect' || S.traitEdit) return;
    renderCard(); renderInput(); renderHist(); renderMap();
    var n = $('cNum'); if (n) n.textContent = '개체 ' + S.indiv + '/' + total();
  }
  function moveIndiv(d) {
    var nv = Math.max(1, Math.min(total(), S.indiv + d));
    if (nv === S.indiv) return; S.indiv = nv;
    (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () { refreshCollect(); });
  }
  function attachSwipe(el, cb) {
    if (!el) return;
    el.style.touchAction = 'pan-y';
    var x0 = null, y0 = null, t0 = 0, sw = false;
    function trig(dx) { haptic(15); cb(dx < 0 ? 1 : -1); }
    el.addEventListener('touchstart', function (e) { var t = e.touches && e.touches[0]; if (!t) return; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); sw = false; }, { passive: true });
    el.addEventListener('touchmove', function (e) { if (x0 == null) return; var t = e.touches && e.touches[0]; if (!t) return; var dx = t.clientX - x0, dy = t.clientY - y0; if (!sw && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) sw = true; if (sw) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', function (e) { if (x0 == null) return; var t = e.changedTouches && e.changedTouches[0]; var dx = t ? t.clientX - x0 : 0, dy = t ? t.clientY - y0 : 0, dt = Date.now() - t0; x0 = null; if (sw && dt < 800 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { e.preventDefault(); trig(dx); } sw = false; }, { passive: false });
    el.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') return; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); });
    el.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch') return; if (x0 == null) return; var dx = e.clientX - x0, dy = e.clientY - y0, dt = Date.now() - t0; x0 = null; if (dt < 800 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) trig(dx); });
  }

  function renderCard() {
    var g = curGen(), l = curLine(), c = $('cCard'); if (!c) return;
    var isel = !!S.indivSel[l.id + ':' + S.indiv];
    var lsel = !!l.selected;
    var sc = function () { return '<i class="ti ' + (lsel ? 'ti-star-filled' : 'ti-star') + '" style="font-size:9px;color:' + (lsel ? '#639922' : 'var(--text-muted)') + '"></i>'; };
    c.innerHTML = '<div class="card"><div style="display:flex;align-items:flex-start;justify-content:space-between">' +
      '<div style="min-width:0"><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
        '<span id="cLabel" style="font-size:17px;font-weight:600;cursor:pointer;border-bottom:1px dashed var(--border-strong)">' + esc(l.label) + '</span>' +
        '<span style="font-size:10px;color:var(--text-muted)">' + ico('pencil', 'var(--text-muted)', 12) + ' 정보수정</span>' +
        '<button class="btn" id="cScan" style="padding:2px 7px;font-size:10px;display:inline-flex;align-items:center;gap:3px">' + ico('camera', 'var(--text-primary)', 12) + ' 스캔</button>' +
      '</div>' +
      '<div style="font-size:15px;color:var(--text-secondary);margin-top:3px">개체 <b style="color:#27500A">' + S.indiv + '</b>/' + l.indivTotal + ' · ' + esc(l.zone) + ' · ' + l.row + '행 ' + l.col + '열 · 반복 ' + l.rep + '</div></div>' +
      '<div style="display:flex;gap:8px;flex:0 0 auto">' +
        '<button class="btn" id="cIsel" style="width:46px;height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;gap:1px' + (isel ? ';background:#EAF3DE;border-color:#639922' : '') + '"><i class="ti ' + (isel ? 'ti-star-filled' : 'ti-star') + '" style="font-size:20px;color:' + (isel ? '#639922' : 'var(--text-muted)') + '"></i><span style="font-size:8px;color:' + (isel ? '#3B6D11' : 'var(--text-muted)') + '">선발</span></button>' +
        '<button class="btn" id="cLsel" style="width:46px;height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;gap:2px' + (lsel ? ';background:#EAF3DE;border-color:#639922' : '') + '"><span style="display:grid;grid-template-columns:1fr 1fr;gap:1px;line-height:1">' + sc() + sc() + sc() + sc() + '</span><span style="font-size:8px;color:' + (lsel ? '#3B6D11' : 'var(--text-muted)') + '">선발</span></button>' +
      '</div></div></div>';
    $('cLabel').onclick = function () { editLine(); };
    $('cScan').onclick = function () { S.ocr = { stage: 'idle', img: null, text: '', conf: 0, status: '' }; go('ocr'); };
    $('cIsel').onclick = function () { var k = l.id + ':' + S.indiv; S.indivSel[k] = !S.indivSel[k]; kvSet('indivSel', S.indivSel); renderCard(); renderMap(); };
    $('cLsel').onclick = function () { l.selected = !l.selected; kvSet('gens', S.gens); renderCard(); renderMap(); };
  }

  function editLine() {
    var l = curLine();
    var nl = prompt('라벨번호', l.label); if (nl == null) return;
    l.label = nl.trim() || l.label;
    var ni = prompt('개체 수', l.indivTotal); if (ni != null && parseInt(ni) > 0) { l.indivTotal = parseInt(ni); if (S.indiv > l.indivTotal) S.indiv = l.indivTotal; }
    var nr = prompt('반복(rep)', l.rep); if (nr != null && parseInt(nr) > 0) l.rep = parseInt(nr);
    kvSet('gens', S.gens); renderCollect(); toast('저장됨');
  }

  function renderDate() {
    var g = curGen(), bar = $('cDate'); if (!bar) return;
    var html = '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' + ico('calendar-event', '#3B6D11', 13) + ' <span style="font-size:11px;color:var(--text-secondary)">조사일</span>';
    g.surveyDates.forEach(function (d) {
      var act = d === S.date;
      html += '<button class="btn" data-d="' + esc(d) + '" style="padding:5px 11px;font-size:12px;border-radius:16px;display:inline-flex;align-items:center;gap:4px' + (act ? ';background:#EAF3DE;border-color:#639922;color:#27500A;font-weight:600' : '') + '">' + esc(d) + (act ? ' ' + ico('pencil', '#3B6D11', 11) : '') + '</button>';
    });
    html += '<button class="btn" id="cNewDate" style="padding:5px 10px;font-size:12px;border-radius:16px;border-style:dashed;color:var(--text-secondary)">' + ico('plus', 'var(--text-secondary)', 13) + ' 새 조사</button></div>' +
      '<div style="font-size:10px;color:var(--text-muted);margin-top:5px">선택된 조사일을 다시 누르면 날짜를 수정할 수 있어요 · 시계열 형질(' + ico('clock', '#3B6D11', 10) + ')만 조사일마다 저장</div>';
    bar.innerHTML = html;
    bar.querySelectorAll('[data-d]').forEach(function (b) { b.onclick = function () { var d = b.getAttribute('data-d'); if (d === S.date) { editDate(d); } else { S.date = d; loadValsThen(renderCollect); } }; });
    $('cNewDate').onclick = function () { var d = prompt('새 조사일 (예: ' + todayStr() + ')', todayStr()); if (d == null) return; d = d.trim(); if (!d) return; if (g.surveyDates.indexOf(d) < 0) { g.surveyDates.push(d); kvSet('gens', S.gens); } S.date = d; loadValsThen(renderCollect); toast(d + ' 조사 시작'); };
  }
  function loadValsThen(cb) { loadVals().then(cb); }
  function editDate(d) { var nv = prompt('조사일 수정 (예: ' + d + ')', d); if (nv == null) return; nv = nv.trim(); if (!nv || nv === d) return; renameSurveyDate(d, nv); }
  function renameSurveyDate(oldD, newD) {
    var g = curGen(), idx = g.surveyDates.indexOf(oldD); if (idx < 0) return;
    if (g.surveyDates.indexOf(newD) >= 0) { toast('이미 있는 조사일입니다'); return; }
    g.surveyDates[idx] = newD; if (S.date === oldD) S.date = newD;
    obsAll().then(function (all) {
      return new Promise(function (res) {
        var tx = DB.transaction('obs', 'readwrite'), st = tx.objectStore('obs');
        all.forEach(function (r) { if (r.genId === g.id && r.date === oldD) { st.delete(r.k); r.k = r.k.replace('@' + oldD, '@' + newD); r.date = newD; r.dirty = 1; r.updatedAt = Date.now(); st.put(r); } });
        tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
      });
    }).then(function () { return kvSet('gens', S.gens); }).then(function () { return loadVals(); }).then(function () { updatePending(); renderCollect(); toast('조사일 수정됨 · ' + newD); });
  }

  function renderPills() {
    var g = curGen(), p = $('cPills'); if (!p) return; p.innerHTML = '';
    g.traits.forEach(function (t) {
      var has = getValFor(t.id) != null && getValFor(t.id) !== '';
      var b = document.createElement('button');
      b.className = 'pill' + (t.id === S.trait ? ' on' : '');
      b.innerHTML = (has ? '<i class="ti ti-check" style="font-size:13px"></i>' : '') + esc(t.name) + (t.series ? ' <i class="ti ti-clock" style="font-size:11px;color:#3B6D11"></i>' : '');
      b.onclick = function () { S.trait = t.id; renderPills(); renderInput(); renderHist(); };
      p.appendChild(b);
    });
    var eb = document.createElement('button'); eb.className = 'btn'; eb.style.cssText = 'border-radius:18px;padding:6px 12px;font-size:12px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;color:var(--text-secondary);flex:0 0 auto'; eb.innerHTML = ico('adjustments', 'var(--text-secondary)', 14) + ' 형질 수정'; eb.onclick = function () { S.traitEdit = true; renderCollect(); }; p.appendChild(eb);
  }
  function getValFor(tid) { return S.vals[valKey(curLine().id, S.indiv, tid)]; }

  function renderInput() {
    var t = traitById(S.trait), area = $('cInput'); if (!area) return; area.innerHTML = '';
    var v = getValFor(t.id);
    var head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px';
    head.innerHTML = '<div style="font-size:15px;font-weight:600">' + esc(t.name) + (t.unit ? ' <span style="font-size:12px;color:var(--text-muted);font-weight:400">(' + t.unit + ')</span>' : '') + (t.series ? ' <span style="font-size:11px;color:#3B6D11">· ' + S.date + '</span>' : '') + '</div><div id="cAvg" style="font-size:11px;color:var(--text-muted)"></div>';
    area.appendChild(head);

    if (t.type === 'numeric' || t.type === 'counter' || t.type === 'ratio') {
      var disp = document.createElement('div');
      disp.style.cssText = 'height:54px;border:0.5px solid var(--border-strong);border-radius:12px;display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:0 16px;font-size:28px;font-weight:500;color:' + ((v == null || v === '') ? 'var(--text-muted)' : 'var(--text-primary)');
      disp.innerHTML = '<span>' + ((v == null || v === '') ? '—' : esc(v)) + '</span>' + (t.type === 'ratio' ? '<span style="font-size:17px;color:var(--text-secondary)">%</span>' : '');
      area.appendChild(disp);
      var pad = document.createElement('div'); pad.className = 'grid'; pad.style.cssText = 'grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px';
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].forEach(function (kk) {
        var b = document.createElement('button'); b.className = 'key';
        b.innerHTML = kk === 'del' ? '<i class="ti ti-backspace" style="font-size:22px"></i>' : kk;
        b.onclick = function () {
          var cur = (getValFor(t.id) || '').toString();
          if (kk === 'del') cur = cur.slice(0, -1);
          else if (kk === '.') { if (cur.indexOf('.') < 0 && cur !== '') cur += '.'; }
          else cur += kk;
          if (t.type === 'ratio' && parseFloat(cur) > 100) cur = '100';
          setVal(t.id, cur).then(function () { renderInput(); renderPills(); renderHist(); renderMap(); });
        };
        pad.appendChild(b);
      });
      area.appendChild(pad);
      renderAvg(t);
    } else if (t.type === 'rating' || t.type === 'categorical') {
      var opts = t.type === 'rating' ? t.scale : t.options;
      var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:2px';
      opts.forEach(function (o) {
        var on = String(v) === String(o);
        var b = document.createElement('button'); b.className = 'btn'; b.style.cssText = 'min-width:52px;height:48px;font-size:16px;font-weight:600;border-radius:12px' + (on ? ';background:#639922;border-color:#3B6D11;color:#fff' : '');
        b.textContent = o;
        b.onclick = function () { var cur = getValFor(t.id); var nv = (String(cur) === String(o)) ? '' : String(o); setVal(t.id, nv).then(function () { renderInput(); renderPills(); renderHist(); renderMap(); }); };
        wrap.appendChild(b);
      });
      area.appendChild(wrap);
      if (t.type === 'rating') { var note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:10px'; note.textContent = (typeof t.scale[0] === 'number') ? '척도 ' + t.scale.join('·') + ' · 평균 집계' : '표현형/유전형 등급 · 분포 집계'; area.appendChild(note); }
    } else if (t.type === 'date') {
      var inp = document.createElement('input'); inp.type = 'date'; inp.className = 'ein'; if (v) inp.value = v;
      inp.onchange = function () { setVal(t.id, inp.value).then(function () { renderPills(); }); };
      area.appendChild(inp);
    } else { // text
      var isImg = typeof v === 'string' && v.indexOf('data:image') === 0;
      if (isImg) {
        var box = document.createElement('div');
        box.innerHTML = '<img src="' + v + '" style="width:100%;max-height:200px;object-fit:contain;border:0.5px solid var(--border-strong);border-radius:10px;background:#fff">' +
          '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="txDraw" style="flex:1;height:44px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('pencil', 'var(--text-primary)', 16) + ' 다시 그리기</button><button class="btn" id="txText" style="flex:1;height:44px;font-size:13px">글자로 입력</button></div>';
        area.appendChild(box);
        $('txDraw').onclick = function () { S.write = { tid: t.id }; go('write'); };
        $('txText').onclick = function () { setVal(t.id, '').then(function () { renderInput(); renderPills(); renderHist(); }); };
      } else {
        var ta = document.createElement('textarea'); ta.className = 'ein'; ta.style.height = '84px'; ta.style.padding = '10px 12px'; ta.style.resize = 'none'; if (v) ta.value = v;
        ta.oninput = function () { setVal(t.id, ta.value); };
        ta.onblur = function () { renderPills(); };
        area.appendChild(ta);
        var db = document.createElement('button'); db.className = 'btn'; db.style.cssText = 'width:100%;height:44px;font-size:13px;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:6px';
        db.innerHTML = ico('pencil', 'var(--text-primary)', 16) + ' 손글씨 · 그리기';
        db.onclick = function () { S.write = { tid: t.id }; go('write'); };
        area.appendChild(db);
        var note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:8px'; note.textContent = '사용자가 쓰거나 그릴 수 있습니다.'; area.appendChild(note);
      }
    }
  }
  function renderAvg(t) {
    var el = $('cAvg'); if (!el) return;
    var g = curGen(), l = curLine(), vals = [];
    for (var iv = 1; iv <= l.indivTotal; iv++) { var val = S.vals[valKey(l.id, iv, t.id)]; if (val != null && val !== '' && !isNaN(parseFloat(val))) vals.push(parseFloat(val)); }
    if ((t.type === 'numeric' || t.type === 'ratio' || t.type === 'counter') && vals.length) {
      var m = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      el.textContent = '계통 평균 ' + (Math.round(m * 10) / 10) + (t.unit || '') + ' (n=' + vals.length + ')';
    } else el.textContent = '';
  }

  function renderHist() {
    var h = $('cHist'); if (!h) return; h.innerHTML = '';
    var t = traitById(S.trait), g = curGen(), l = curLine();
    if (!t || !t.series) return;
    var parts = g.surveyDates.map(function (d) { var vv = S.vals[g.id + ':' + l.id + ':' + S.indiv + ':' + t.id + '@' + d]; return '<span style="' + (d === S.date ? 'color:#27500A;font-weight:600' : 'color:var(--text-secondary)') + '">' + d + ' ' + ((vv == null || vv === '') ? '—' : esc(vv)) + '</span>'; });
    h.innerHTML = '<div class="card" style="font-size:11px;color:var(--text-secondary)">' + ico('history', '#3B6D11', 12) + ' 이 개체 ' + esc(t.name) + ' 추이 · ' + parts.join(' → ') + '</div>';
  }

  function parseScale(s) { var parts = String(s).split(/[\s,·]+/).filter(function (x) { return x !== ''; }); if (!parts.length) return [1, 3, 5, 7, 9]; var allNum = parts.every(function (x) { return /^-?\d+(\.\d+)?$/.test(x); }); return allNum ? parts.map(Number) : parts; }
  function teConfig(t, i) {
    if (t.type === 'numeric') {
      var units = ['mm', 'cm', 'm', 'g', 'kg', 'mg', 'SHU', 'Brix', '°', '점'];
      var chips = units.map(function (u) { return '<button class="btn tE-uchip" data-i="' + i + '" data-u="' + u + '" style="padding:4px 9px;font-size:12px;border-radius:14px' + (t.unit === u ? ';background:#EAF3DE;border-color:#639922;color:#27500A' : '') + '">' + u + '</button>'; }).join('');
      return '<div style="margin-top:9px"><div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px">측정 단위</div><div style="display:flex;flex-wrap:wrap;gap:6px">' + chips + '</div><input class="ein tE-unit" data-i="' + i + '" placeholder="직접 입력 (예: mmol/L)" style="height:36px;margin-top:6px;font-size:13px" value="' + esc(t.unit || '') + '"></div>';
    }
    if (t.type === 'rating') {
      return '<div style="margin-top:9px"><div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px">척도 · 공백이나 콤마로 구분</div><input class="ein tE-scale" data-i="' + i + '" placeholder="예: 1 3 5 7 9  또는  R IR S" style="height:38px;font-size:14px" value="' + esc((t.scale || [1, 3, 5, 7, 9]).join(' ')) + '"><div style="font-size:10px;color:var(--text-muted);margin-top:4px">숫자만 입력하면 평균·분산분석, 문자는 분포로 집계됩니다.</div></div>';
    }
    if (t.type === 'categorical') {
      var items = (t.options || []).map(function (o, oi) { return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px"><input class="ein tE-opt" data-i="' + i + '" data-oi="' + oi + '" style="flex:1;height:36px;font-size:13px" value="' + esc(o) + '"><button class="btn tE-optdel" data-i="' + i + '" data-oi="' + oi + '" style="width:36px;height:36px;flex:0 0 auto;color:#C0392B;border-color:#E3B4AE;display:flex;align-items:center;justify-content:center">' + ico('circle-x', '#C0392B', 15) + '</button></div>'; }).join('');
      return '<div style="margin-top:9px"><div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px">항목 · 추가·이름 변경</div>' + items + '<button class="btn tE-optadd" data-i="' + i + '" style="width:100%;height:38px;font-size:13px;border-style:dashed;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;gap:5px">' + ico('plus', 'var(--text-secondary)', 15) + ' 항목 추가</button></div>';
    }
    if (t.type === 'text') {
      return '<div style="margin-top:9px;font-size:12px;color:#3B6D11;background:#EAF3DE;border-radius:8px;padding:8px 10px">' + ico('pencil', '#3B6D11', 13) + ' 사용자가 쓰거나 그릴 수 있습니다.</div>';
    }
    return '';
  }
  function syncTE() {
    var g = curGen();
    document.querySelectorAll('.tE-name').forEach(function (inp) { var t = g.traits[+inp.getAttribute('data-i')]; if (t) t.name = inp.value.trim() || t.name; });
    document.querySelectorAll('.tE-unit').forEach(function (inp) { var t = g.traits[+inp.getAttribute('data-i')]; if (t) t.unit = inp.value.trim(); });
    document.querySelectorAll('.tE-scale').forEach(function (inp) { var t = g.traits[+inp.getAttribute('data-i')]; if (t) t.scale = parseScale(inp.value); });
    g.traits.forEach(function (t, i) { if (t.type === 'categorical') { var arr = []; document.querySelectorAll('.tE-opt[data-i="' + i + '"]').forEach(function (inp) { var val = inp.value.trim(); if (val) arr.push(val); }); t.options = arr.length ? arr : ['항목1']; } });
  }
  function renderTraitEditor() {
    var g = curGen(), v = $('view-collect');
    var types = [['numeric', '수치형'], ['ratio', '비율(%)'], ['rating', '등급'], ['counter', '카운터'], ['categorical', '항목형'], ['date', '날짜형'], ['text', '문자형']];
    var rows = g.traits.map(function (t, i) {
      var opts = types.map(function (tp) { return '<option value="' + tp[0] + '"' + (t.type === tp[0] ? ' selected' : '') + '>' + tp[1] + '</option>'; }).join('');
      return '<div class="card" style="margin-bottom:8px"><div style="display:flex;gap:8px;align-items:center"><input class="ein tE-name" data-i="' + i + '" style="flex:1;height:40px" value="' + esc(t.name) + '"><button class="btn tE-del" data-i="' + i + '" style="width:40px;height:40px;flex:0 0 auto;color:#C0392B;border-color:#E3B4AE;display:flex;align-items:center;justify-content:center">' + ico('trash', '#C0392B', 16) + '</button></div><div style="display:flex;gap:10px;align-items:center;margin-top:8px"><select class="ein tE-type" data-i="' + i + '" style="flex:1;height:40px">' + opts + '</select><div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--text-secondary)">시계열</span><div class="sw tE-series' + (t.series ? ' on' : '') + '" data-i="' + i + '"><div class="knob"></div></div></div></div>' + teConfig(t, i) + '</div>';
    }).join('');
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="tEBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">형질세트 편집</div><div style="font-size:11px;color:var(--text-muted)">' + esc(g.crop) + ' · ' + esc(g.label) + ' · ' + g.traits.length + '개 형질</div></div></div>' +
      '<div style="flex:1;padding:14px 14px;overflow:auto">' + rows +
        '<button class="btn" id="tEAdd" style="width:100%;height:46px;font-size:14px;margin-top:6px;display:flex;align-items:center;justify-content:center;gap:6px;border-style:dashed;color:var(--text-secondary)">' + ico('plus', 'var(--text-secondary)', 18) + ' 형질 추가</button>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;line-height:1.6">종류마다 아래 칸에서 단위·척도·항목을 직접 설정할 수 있습니다. 이름·종류 변경 시 기존 입력값은 유지됩니다.</div>' +
      '</div>' +
      '<div style="padding:10px 14px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)"><button class="btn primary" id="tEDone" style="width:100%;height:48px;font-size:15px">완료</button></div>';
    function done() { syncTE(); S.traitEdit = false; kvSet('gens', S.gens).then(function () { return loadVals(); }).then(function () { if (!traitById(S.trait)) S.trait = g.traits[0] ? g.traits[0].id : null; renderCollect(); }); }
    $('tEBack').onclick = done; $('tEDone').onclick = done;
    v.querySelectorAll('.tE-name').forEach(function (inp) { inp.onchange = function () { var t = g.traits[+inp.getAttribute('data-i')]; t.name = inp.value.trim() || t.name; }; });
    v.querySelectorAll('.tE-type').forEach(function (sel) { sel.onchange = function () { syncTE(); var t = g.traits[+sel.getAttribute('data-i')]; t.type = sel.value; if (t.type === 'rating' && !t.scale) t.scale = [1, 3, 5, 7, 9]; if (t.type === 'ratio' && !t.unit) t.unit = '%'; if (t.type === 'categorical' && (!t.options || !t.options.length)) t.options = ['항목1', '항목2', '항목3']; if (t.type === 'numeric' && t.unit === '%') t.unit = ''; t.series = inferSeries(t); renderTraitEditor(); }; });
    v.querySelectorAll('.tE-series').forEach(function (sw) { sw.onclick = function () { syncTE(); var t = g.traits[+sw.getAttribute('data-i')]; t.series = !t.series; renderTraitEditor(); }; });
    v.querySelectorAll('.tE-del').forEach(function (b) { b.onclick = function () { var i = +b.getAttribute('data-i'); if (g.traits.length <= 1) { toast('형질은 최소 1개 필요합니다'); return; } if (!confirm('"' + g.traits[i].name + '" 형질을 삭제할까요?')) return; syncTE(); var tid = g.traits[i].id; g.traits.splice(i, 1); obsAll().then(function (all) { var st = os('obs', 'readwrite'); all.forEach(function (r) { if (r.genId === g.id && r.traitId === tid) st.delete(r.k); }); }); renderTraitEditor(); }; });
    v.querySelectorAll('.tE-unit').forEach(function (inp) { inp.oninput = function () { g.traits[+inp.getAttribute('data-i')].unit = inp.value.trim(); }; });
    v.querySelectorAll('.tE-uchip').forEach(function (b) { b.onclick = function () { syncTE(); g.traits[+b.getAttribute('data-i')].unit = b.getAttribute('data-u'); renderTraitEditor(); }; });
    v.querySelectorAll('.tE-scale').forEach(function (inp) { inp.oninput = function () { g.traits[+inp.getAttribute('data-i')].scale = parseScale(inp.value); }; });
    v.querySelectorAll('.tE-opt').forEach(function (inp) { inp.oninput = function () { var t = g.traits[+inp.getAttribute('data-i')], oi = +inp.getAttribute('data-oi'); if (t.options) t.options[oi] = inp.value; }; });
    v.querySelectorAll('.tE-optdel').forEach(function (b) { b.onclick = function () { syncTE(); var t = g.traits[+b.getAttribute('data-i')], oi = +b.getAttribute('data-oi'); t.options.splice(oi, 1); if (!t.options.length) t.options = ['항목1']; renderTraitEditor(); }; });
    v.querySelectorAll('.tE-optadd').forEach(function (b) { b.onclick = function () { syncTE(); var t = g.traits[+b.getAttribute('data-i')]; t.options = t.options || []; t.options.push('항목' + (t.options.length + 1)); renderTraitEditor(); }; });
    $('tEAdd').onclick = function () { syncTE(); var nt = { id: 't' + Date.now(), name: '새 형질', type: 'numeric', unit: '' }; nt.series = inferSeries(nt); g.traits.push(nt); renderTraitEditor(); };
  }

  // ---------- FIELD MAP ----------
  function renderMap() {
    var wrap = $('cMapWrap'); if (!wrap) return;
    var g = curGen(), l = curLine();
    wrap.innerHTML =
      '<div class="card">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<span style="font-size:12px;font-weight:600">' + ico('map-2', '#639922', 14) + ' 필드맵</span>' +
          '<button class="btn" id="mFilter" style="padding:5px 11px;font-size:12px;border-radius:16px' + (S.showSelOnly ? ';background:#EAF3DE;border-color:#639922;color:#27500A' : '') + '">' + ico('star', S.showSelOnly ? '#639922' : 'var(--text-secondary)', 13) + ' 선발만 보기</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-secondary);margin-bottom:6px"><span>' + ico('seeding', '#639922', 13) + ' 개체 순번 (탭 이동)</span><span><span style="color:#C08A2B">★</span> 선발 · <span id="mIhint"></span></span></div>' +
        '<div class="grid" id="mIndiv" style="gap:4px"></div>' +
        '<div id="mIfoot" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>' +
        '<div style="height:1px;background:var(--border);margin:12px 0"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-secondary);margin-bottom:6px"><span>' + ico('layout-grid', '#639922', 12) + ' 조합·계통 순번 (탭 이동)</span><span><span style="color:#E8B84B">★</span> 계통 · <span style="color:#C08A2B;font-size:8px">★</span> 개체</span></div>' +
        '<div id="mLineScroll" style="overflow:auto"><div class="grid" id="mLine" style="gap:4px"></div></div>' +
        '<div id="mLfoot" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>' +
      '</div>';
    $('mFilter').onclick = function () { S.showSelOnly = !S.showSelOnly; renderMap(); };
    var cols = 10, cell = Math.max(24, Math.floor((wrap.clientWidth - 24 - 4 * 9) / 10));

    // individual map
    var gi = $('mIndiv'); gi.style.gridTemplateColumns = 'repeat(' + Math.min(cols, total()) + ',' + cell + 'px)';
    var ish = 0;
    for (var iv = 1; iv <= total(); iv++) (function (iv) {
      if (S.showSelOnly && !S.indivSel[l.id + ':' + iv]) return;
      var b = document.createElement('button'); b.className = 'mm'; b.style.width = cell + 'px'; b.style.height = cell + 'px';
      if (iv === S.indiv) { b.style.background = '#639922'; b.style.color = '#fff'; b.style.borderColor = '#3B6D11'; }
      else if (indivEntered(l.id, iv)) { b.style.background = '#F1F6E8'; }
      b.textContent = iv;
      if (S.indivSel[l.id + ':' + iv]) { var st = document.createElement('span'); st.textContent = '★'; st.style.cssText = 'position:absolute;top:-2px;right:0;font-size:9px;color:' + (iv === S.indiv ? '#fff' : '#C08A2B'); b.appendChild(st); }
      b.onclick = function () { S.indiv = iv; renderCollect(); };
      gi.appendChild(b); ish++;
    })(iv);
    if (S.showSelOnly && ish === 0) gi.innerHTML = '<div style="grid-column:1/-1;font-size:11px;color:var(--text-muted);text-align:center;padding:6px 0">선발된 개체가 없습니다</div>';
    var iselN = 0; for (var q = 1; q <= total(); q++) if (S.indivSel[l.id + ':' + q]) iselN++;
    $('mIfoot').textContent = l.label + ' · ' + (S.showSelOnly ? '선발 ' + iselN + '개체' : '총 ' + total() + '개체 · 선발 ' + iselN);
    $('mIhint').textContent = '현재 ' + S.indiv + '/' + total();

    // line map
    var gl2 = $('mLine'); gl2.style.gridTemplateColumns = 'repeat(' + cols + ',' + cell + 'px)';
    var lineEntered = {};
    var lsh = 0, lselN = 0, lselI = 0;
    g.lines.forEach(function (ln, i) {
      if (ln.selected) lselN++; else if (lineHasIndivSel(ln.id)) lselI++;
      if (S.showSelOnly && !ln.selected && !lineHasIndivSel(ln.id)) return;
      var b = document.createElement('button'); b.className = 'mm'; b.style.width = cell + 'px'; b.style.height = cell + 'px';
      var isCur = i === S.lineIdx;
      if (isCur) { b.style.background = '#639922'; b.style.color = '#fff'; b.style.borderColor = '#3B6D11'; }
      else if (lineEntered[ln.id]) { b.style.background = '#F1F6E8'; }
      if (ln.selected) {
        b.innerHTML = '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:' + Math.round(cell * 0.98) + 'px;color:' + (isCur ? '#E0B94F' : '#EBCB78') + ';pointer-events:none">★</span><span style="position:relative;z-index:1;font-weight:600">' + (i + 1) + '</span>';
      } else {
        b.textContent = (i + 1);
        if (lineHasIndivSel(ln.id)) { var stq = document.createElement('span'); stq.textContent = '★'; stq.style.cssText = 'position:absolute;top:-2px;right:0;font-size:9px;color:' + (isCur ? '#fff' : '#C08A2B'); b.appendChild(stq); }
      }
      b.onclick = function () { S.lineIdx = i; S.indiv = 1; renderCollect(); };
      gl2.appendChild(b); lsh++;
    });
    if (S.showSelOnly && lsh === 0) gl2.innerHTML = '<div style="grid-column:1/-1;font-size:11px;color:var(--text-muted);text-align:center;padding:6px 0">선발된 항목이 없습니다</div>';
    $('mLfoot').textContent = S.showSelOnly ? ('계통선발 ' + lselN + ' · 개체선발 있는 계통 ' + lselI) : ('총 ' + g.lines.length + ' 계통 · 선발 ' + lselN);
  }
  function indivEntered(lineId, iv) { var g = curGen(); for (var i = 0; i < g.traits.length; i++) { var t = g.traits[i]; var k = g.id + ':' + lineId + ':' + iv + ':' + t.id + (t.series ? ('@' + S.date) : ''); if (S.vals[k] != null && S.vals[k] !== '') return true; } return false; }

  // ---------- ANALYSIS ----------
  function isMeasure(t) { return t.type === 'numeric' || t.type === 'ratio' || t.type === 'counter' || (t.type === 'rating' && t.scale && typeof t.scale[0] === 'number'); }
  function renderAnalysis() {
    var g = curGen(), v = $('view-analysis');
    if (!traitById(S.anTrait)) S.anTrait = g.traits[0].id;
    var t = traitById(S.anTrait);
    v.innerHTML =
      '<div style="padding:14px 16px 8px;border-bottom:0.5px solid var(--border)"><div style="font-size:18px;font-weight:700">분석</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc(g.projName) + ' · ' + esc(g.label) + ' · ' + esc(g.crop) + '</div></div>' +
      '<div class="scroll-x" id="anPills" style="padding:10px 14px 6px"></div>' +
      '<div id="anDate" style="padding:0 14px 4px"></div>' +
      '<div id="anBody" style="flex:1;padding:8px 14px 16px;overflow:auto"></div>';
    renderAnPills(); renderAnDate(); renderAnBody();
  }
  function renderAnPills() {
    var g = curGen(), p = $('anPills'); p.innerHTML = '';
    g.traits.forEach(function (t) {
      var b = document.createElement('button'); b.className = 'pill' + (t.id === S.anTrait ? ' on' : '');
      b.innerHTML = esc(t.name) + (isMeasure(t) ? ' <i class="ti ti-chart-bar" style="font-size:11px;color:#3B6D11"></i>' : '') + (t.series ? ' <i class="ti ti-clock" style="font-size:11px;color:#3B6D11"></i>' : '');
      b.onclick = function () { S.anTrait = t.id; renderAnPills(); renderAnDate(); renderAnBody(); };
      p.appendChild(b);
    });
  }
  function renderAnDate() {
    var g = curGen(), t = traitById(S.anTrait), bar = $('anDate'); bar.innerHTML = '';
    if (!t.series) return;
    var html = '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' + ico('calendar-event', '#3B6D11', 13) + ' <span style="font-size:11px;color:var(--text-secondary)">조사일</span>';
    g.surveyDates.forEach(function (d) { html += '<button class="btn anD" data-d="' + d + '" style="padding:4px 10px;font-size:12px;border-radius:16px' + (d === S.date ? ';background:#EAF3DE;border-color:#639922;color:#27500A;font-weight:600' : '') + '">' + d + '</button>'; });
    html += '</div>'; bar.innerHTML = html;
    bar.querySelectorAll('.anD').forEach(function (b) { b.onclick = function () { S.date = b.getAttribute('data-d'); renderAnDate(); renderAnBody(); }; });
  }
  function anGather(t) {
    var g = curGen(), out = [];
    g.lines.forEach(function (l) { var vals = []; for (var iv = 1; iv <= l.indivTotal; iv++) { var k = g.id + ':' + l.id + ':' + iv + ':' + t.id + (t.series ? ('@' + S.date) : ''); var raw = S.vals[k]; if (raw != null && raw !== '') vals.push(raw); } if (vals.length) out.push({ line: l, vals: vals }); });
    return out;
  }
  function renderAnBody() {
    var t = traitById(S.anTrait), body = $('anBody');
    var byLine = anGather(t);
    var total = byLine.reduce(function (a, b) { return a + b.vals.length; }, 0);
    if (total === 0) { body.innerHTML = '<div style="padding:30px 10px;text-align:center;color:var(--text-muted)">이 형질의 입력값이 없습니다' + (t.series ? ' (' + S.date + ' 조사)' : '') + '<br><span style="font-size:12px">조사 탭에서 값을 입력하면 여기에 통계가 나타납니다.</span></div>'; return; }
    if (isMeasure(t)) renderMeasure(body, t, byLine); else renderCategory(body, t, byLine);
  }
  function stcell(l, val) { return '<div style="flex:1;min-width:66px;background:var(--surface-1);border-radius:9px;padding:8px 9px"><div style="font-size:15px;font-weight:600">' + val + '</div><div style="font-size:10px;color:var(--text-muted)">' + l + '</div></div>'; }
  function renderMeasure(body, t, byLine) {
    byLine.forEach(function (o) { o.nvals = o.vals.map(parseFloat).filter(function (x) { return !isNaN(x); }); o.mean = o.nvals.length ? o.nvals.reduce(function (a, b) { return a + b; }, 0) / o.nvals.length : 0; });
    byLine = byLine.filter(function (o) { return o.nvals.length; });
    var nums = []; byLine.forEach(function (o) { nums = nums.concat(o.nvals); });
    var n = nums.length, mean = nums.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = Math.sqrt(nums.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (n > 1 ? n - 1 : 1));
    var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums), cv = mean ? sd / mean * 100 : 0;
    var groups = byLine.map(function (o) { return o.nvals; });
    var an = (groups.length >= 2 && (n - groups.length) >= 1) ? anova1(groups) : null;
    var ranked = byLine.slice().sort(function (a, b) { return b.mean - a.mean; });
    var maxM = ranked[0].mean, minM = ranked[ranked.length - 1].mean;
    var letters = ranked.map(function () { return ''; });
    if (an && an.mse > 0 && ranked.length <= 16) letters = cldRuns(ranked.map(function (o) { return o.mean; }), ranked.map(function (o) { return o.nvals.length; }), an.mse, an.dfe);
    var html = '<div class="card" style="margin:0 0 10px"><div style="display:flex;gap:6px;flex-wrap:wrap">' +
      stcell('개체 수', n) + stcell('평균', round(mean, 2) + (t.unit && t.unit !== '%' ? '' : (t.unit || ''))) + stcell('표준편차', round(sd, 2)) + stcell('범위', round(mn, 1) + '–' + round(mx, 1)) + stcell('CV%', round(cv, 1)) + '</div></div>';
    if (an) {
      html += '<div class="card" style="margin:0 0 10px"><div style="font-size:12px;font-weight:600;margin-bottom:8px">' + ico('chart-bar', '#639922', 14) + ' 분산분석 · 유전력 <span style="font-size:10px;color:var(--text-muted);font-weight:400">(계통 효과 · 개체 반복)</span></div><div style="font-size:13px;line-height:2;color:var(--text-secondary)">F = <b style="color:var(--text-primary)">' + round(an.F, 2) + '</b> · p = <b style="color:' + (an.p < 0.05 ? '#3B6D11' : 'var(--text-primary)') + '">' + (an.p < 0.001 ? '<0.001' : round(an.p, 3)) + '</b>' + (an.p < 0.05 ? ' <span style="color:#3B6D11">계통 간 유의차</span>' : ' <span style="color:var(--text-muted)">유의차 없음</span>') + '<br>오차 MSe = ' + round(an.mse, 2) + ' · CV% = ' + round(an.cv, 1) + '<br>유전력 H² <span style="font-size:10px;color:var(--text-muted)">(개체평균 기준)</span> = <b style="color:#27500A">' + round(Math.max(0, Math.min(1, an.h2)), 2) + '</b></div></div>';
    } else {
      html += '<div class="card" style="margin:0 0 10px;font-size:12px;color:var(--text-muted);line-height:1.6">계통당 개체(반복)가 부족해 분산분석·유전력은 계산할 수 없습니다. 계통당 2개 이상 개체를 입력하면 F·p·H²·Tukey가 표시됩니다.</div>';
    }
    html += '<div style="font-size:12px;font-weight:600;margin:4px 0 8px">계통 순위 <span style="font-size:10px;color:var(--text-muted);font-weight:400">평균 내림차순' + (letters.some(function (x) { return x; }) ? ' · 같은 문자=Tukey 유의차 없음' : '') + '</span></div>';
    html += ranked.map(function (o, i) {
      var w = maxM > minM ? ((o.mean - minM) / (maxM - minM) * 94 + 6) : 100; var sel = o.line.selected;
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:74px;flex:0 0 auto;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (sel ? 'color:#27500A;font-weight:600' : '') + '">' + (sel ? '<i class="ti ti-star-filled" style="font-size:11px;color:#C08A2B"></i> ' : '') + esc(o.line.label) + '</div><div style="flex:1;height:20px;background:var(--surface-1);border-radius:5px;overflow:hidden"><div style="width:' + w + '%;height:100%;background:' + (sel ? '#C08A2B' : '#639922') + '"></div></div><div style="width:78px;flex:0 0 auto;text-align:right;font-size:12px">' + round(o.mean, 1) + ' <b style="color:#3B6D11">' + letters[i] + '</b></div></div>';
    }).join('');
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:10px">계통 ' + ranked.length + '개 · 선발 ' + ranked.filter(function (o) { return o.line.selected; }).length + '개 · 결측·복잡한 설계는 CSV로 내보내 R에서 분석 권장</div>';
    body.innerHTML = html;
  }
  function renderCategory(body, t, byLine) {
    var counts = {}, total = 0;
    byLine.forEach(function (o) { o.vals.forEach(function (val) { counts[val] = (counts[val] || 0) + 1; total++; }); });
    var cats = (t.options || (t.scale ? t.scale.map(String) : [])).slice();
    Object.keys(counts).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
    var html = '<div class="card" style="margin:0 0 10px;font-size:12px;font-weight:600">' + esc(t.name) + ' 분포 <span style="color:var(--text-muted);font-weight:400">· 총 ' + total + '</span></div>';
    html += cats.map(function (c) {
      var nn = counts[c] || 0, pct = total ? nn / total * 100 : 0;
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:90px;flex:0 0 auto;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c) + '</div><div style="flex:1;height:20px;background:var(--surface-1);border-radius:5px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:#639922"></div></div><div style="width:66px;text-align:right;font-size:12px">' + nn + ' (' + Math.round(pct) + '%)</div></div>';
    }).join('');
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:10px">항목형·등급(문자) 형질은 빈도 분포로 표시됩니다. 범주 연관성은 카이제곱 검정을 권장합니다.</div>';
    body.innerHTML = html;
  }

  // ---------- BULK LABEL REGISTRATION ----------
  function csvSplit(ln, delim) { var out = [], cur = '', q = false; for (var i = 0; i < ln.length; i++) { var c = ln[i]; if (q) { if (c === '"') { if (ln[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else { if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c; } } out.push(cur); return out; }
  function mapRows(rows) {
    rows = (rows || []).filter(function (r) { return r && r.some(function (c) { return String(c == null ? '' : c).trim() !== ''; }); });
    if (!rows.length) return [];
    var header = rows[0].map(function (s) { return String(s == null ? '' : s).trim(); });
    var hasHeader = header.some(function (h) { return /라벨|label|반복|rep|개체|indiv|세대|gen/i.test(h); });
    var li = 0, ri = -1, ii = -1, start = 0;
    if (hasHeader) { start = 1; header.forEach(function (h, idx) { if (/라벨|label/i.test(h) && li === 0) li = idx; if (/반복|rep|block/i.test(h)) ri = idx; if (/개체|indiv/i.test(h)) ii = idx; }); }
    var out = [];
    for (var r = start; r < rows.length; r++) { var row = rows[r]; var label = String(row[li] == null ? '' : row[li]).trim(); if (!label) continue; var rec = { label: label }; if (ri >= 0 && row[ri] != null && String(row[ri]).trim() !== '') rec.rep = parseInt(row[ri]) || null; if (ii >= 0 && row[ii] != null && String(row[ii]).trim() !== '') rec.indiv = parseInt(row[ii]) || null; out.push(rec); }
    return out;
  }
  function parseLabels(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return [];
    var delim = (lines[0].indexOf('\t') >= 0 && (lines[0].indexOf(',') < 0 || lines[0].indexOf('\t') < lines[0].indexOf(','))) ? '\t' : ',';
    return mapRows(lines.map(function (l) { return csvSplit(l, delim); }));
  }
  function parseXlsx(buf) {
    try { var wb = XLSX.read(new Uint8Array(buf), { type: 'array' }); var ws = wb.Sheets[wb.SheetNames[0]]; if (!ws) return []; return mapRows(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false })); } catch (e) { return []; }
  }
  function ensureXLSX(cb) {
    if (typeof XLSX !== 'undefined') { cb(true); return; }
    if (window.__xlsxCbs) { window.__xlsxCbs.push(cb); return; }
    window.__xlsxCbs = [cb];
    var s = document.createElement('script'); s.src = 'xlsx.min.js';
    s.onload = function () { var ok = typeof XLSX !== 'undefined'; window.__xlsxCbs.forEach(function (f) { f(ok); }); window.__xlsxCbs = null; };
    s.onerror = function () { window.__xlsxCbs.forEach(function (f) { f(false); }); window.__xlsxCbs = null; };
    document.head.appendChild(s);
  }
  function bulkTemplate() {
    var g = S.gens[S.bulkIdx] || S.gens[0]; var pf = (g && g.prefix) || 'CU';
    var csv = '라벨번호,반복,개체수\r\n' + pf + '-001,1,10\r\n' + pf + '-002,1,10\r\n' + pf + '-003,2,10\r\n';
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'label_template.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); toast('빈 양식 CSV 내려받음');
  }
  function applyBulk() {
    var g = S.gens[S.bulkIdx], rows = S.bulkRows || []; if (!g || !rows.length) return;
    var base = Date.now();
    rows.forEach(function (rec, i) {
      var l = g.lines[i];
      if (l) { l.label = rec.label; if (rec.rep) { l.rep = rec.rep; l.block = 'B-' + rec.rep; } if (rec.indiv) l.indivTotal = rec.indiv; }
      else { var rep = rec.rep || ((i % 3) + 1); g.lines.push({ id: 'L' + base + '_' + i, label: rec.label, rep: rep, block: 'B-' + rep, zone: (g.lines[0] && g.lines[0].zone) || 'A동', row: Math.floor(i / 10) + 1, col: (i % 10) + 1, indivTotal: rec.indiv || (g.lines[0] ? g.lines[0].indivTotal : 10), selected: false }); }
    });
    kvSet('gens', S.gens).then(function () { toast(rows.length + '개 라벨 등록됨'); S.bulkStage = 'idle'; S.bulkRows = null; S.bulkFileName = ''; S.editIdx = S.bulkIdx; go('genedit'); });
  }
  function renderBulk() {
    var g = S.gens[S.bulkIdx]; if (!g) { go('home'); return; }
    var v = $('view-bulk');
    var head = '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="bBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">라벨 일괄등록</div><div style="font-size:11px;color:var(--text-muted)">' + esc(g.crop) + ' · ' + esc(g.label) + ' · 계통 ' + g.lines.length + '</div></div></div>';
    if (S.bulkStage === 'parsed' && S.bulkRows) {
      var rows = S.bulkRows, prev = rows.slice(0, 20);
      var table = '<div style="overflow:auto;border:0.5px solid var(--border);border-radius:10px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface-1)"><th style="text-align:left;padding:7px 9px">#</th><th style="text-align:left;padding:7px 9px">라벨번호</th><th style="text-align:center;padding:7px 9px">반복</th><th style="text-align:center;padding:7px 9px">개체수</th></tr></thead><tbody>' +
        prev.map(function (r, i) { return '<tr style="border-top:0.5px solid var(--border)"><td style="padding:6px 9px;color:var(--text-muted)">' + (i + 1) + '</td><td style="padding:6px 9px;font-weight:500">' + esc(r.label) + '</td><td style="padding:6px 9px;text-align:center">' + (r.rep || '-') + '</td><td style="padding:6px 9px;text-align:center">' + (r.indiv || '-') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      v.innerHTML = head + '<div style="flex:1;padding:14px 14px;overflow:auto"><div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">' + esc(S.bulkFileName) + ' · <b style="color:var(--text-primary)">' + rows.length + '개</b> 라벨 인식' + (rows.length > 20 ? ' (앞 20개 미리보기)' : '') + '</div>' + table +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.6">순서대로 기존 계통에 라벨이 채워지고, 초과분은 계통으로 추가됩니다. 반복·개체수가 있으면 함께 반영됩니다. 기존 수집값은 유지됩니다.</div></div>' +
        '<div style="padding:10px 14px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)"><div style="display:flex;gap:10px"><button class="btn" id="bReset" style="flex:0 0 100px;height:48px;font-size:14px">다시 선택</button><button class="btn primary" id="bApply" style="flex:1;height:48px;font-size:15px">' + esc(g.label) + ' 세대에 ' + rows.length + '개 등록</button></div></div>';
      $('bReset').onclick = function () { S.bulkStage = 'idle'; S.bulkRows = null; renderBulk(); };
      $('bApply').onclick = applyBulk;
    } else {
      v.innerHTML = head + '<div style="flex:1;padding:14px 14px;overflow:auto"><div class="card"><div style="font-size:12px;font-weight:600;margin-bottom:8px">' + ico('table', '#639922', 14) + ' 파일 형식 (엑셀 .xlsx · CSV)</div><div style="font-size:12px;color:var(--text-secondary);line-height:1.7">첫 줄은 머리글, 이후 한 줄에 한 계통. <b>라벨번호</b>만 있으면 되고, 반복·개체수는 선택입니다.</div>' +
        '<div style="margin-top:10px;font-family:ui-monospace,monospace;font-size:11px;background:var(--surface-2);border:0.5px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text-secondary);white-space:pre">라벨번호,반복,개체수\n' + esc(g.prefix || 'CU') + '-001,1,10\n' + esc(g.prefix || 'CU') + '-002,1,10</div></div>' +
        '<button class="btn" id="bTpl" style="width:100%;height:46px;font-size:14px;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px">' + ico('file-download', 'var(--text-primary)', 16) + ' 빈 양식 내려받기</button>' +
        '<button class="btn primary" id="bPick" style="width:100%;height:52px;font-size:15px;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:7px">' + ico('file-spreadsheet', '#fff', 18) + ' 엑셀·CSV 파일 선택</button>' +
        '<input type="file" id="bFile" accept=".xlsx,.xls,.csv,.tsv,.txt" style="display:none">' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;line-height:1.6">엑셀(.xlsx) 파일을 그대로 선택하면 됩니다. 첫 시트의 라벨번호 열을 읽습니다. CSV·TSV도 지원합니다.</div></div>';
      $('bTpl').onclick = bulkTemplate;
      $('bPick').onclick = function () { $('bFile').click(); };
      $('bFile').onchange = function () {
        var f = this.files && this.files[0]; if (!f) return; var name = f.name.toLowerCase();
        function finish(rows) { if (!rows || !rows.length) { toast('라벨을 인식하지 못했습니다'); return; } S.bulkRows = rows; S.bulkFileName = f.name; S.bulkStage = 'parsed'; renderBulk(); }
        function fail() { toast('파일을 읽지 못했습니다'); }
        if (/\.(xlsx|xls)$/.test(name)) {
          ensureXLSX(function (ok) { if (!ok) { toast('엑셀 파서를 불러오지 못했습니다. 온라인에서 한 번 실행한 뒤 다시 시도하세요.'); return; } var rd = new FileReader(); rd.onload = function () { finish(parseXlsx(rd.result)); }; rd.onerror = fail; rd.readAsArrayBuffer(f); });
        } else { var rd = new FileReader(); rd.onload = function () { finish(parseLabels(rd.result)); }; rd.onerror = fail; rd.readAsText(f, 'utf-8'); }
      };
    }
    $('bBack').onclick = function () { if (S.bulkStage === 'parsed') { S.bulkStage = 'idle'; S.bulkRows = null; renderBulk(); } else { S.editIdx = S.bulkIdx; go('genedit'); } };
  }

  // ---------- LABEL OCR (card scan) ----------
  function ensureTesseract() {
    return new Promise(function (res) {
      if (window.Tesseract) { res(true); return; }
      if (window.__tessCbs) { window.__tessCbs.push(res); return; }
      window.__tessCbs = [res];
      var s = document.createElement('script'); s.src = './ocr/tesseract.min.js';
      s.onload = function () { var ok = !!window.Tesseract; window.__tessCbs.forEach(function (f) { f(ok); }); window.__tessCbs = null; };
      s.onerror = function () { window.__tessCbs.forEach(function (f) { f(false); }); window.__tessCbs = null; };
      document.head.appendChild(s);
    });
  }
  function runOCR(file, onp) {
    return ensureTesseract().then(function (ok) {
      if (!ok) throw new Error('no-engine');
      return window.Tesseract.createWorker('eng', 1, { workerPath: './ocr/worker.min.js', corePath: './ocr/tesseract-core-lstm.wasm.js', langPath: './ocr/', logger: onp });
    }).then(function (worker) {
      return worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-. ', tessedit_pageseg_mode: '7' })
        .then(function () { return worker.recognize(file); })
        .then(function (r) { return worker.terminate().then(function () { return { text: (r.data.text || '').replace(/\s+/g, '').trim(), conf: Math.round(r.data.confidence || 0) }; }); });
    });
  }
  function renderOCR() {
    var g = curGen(), l = curLine(), v = $('view-ocr'), o = S.ocr || (S.ocr = { stage: 'idle' });
    var head = '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="oBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">라벨 스캔 (OCR)</div><div style="font-size:11px;color:var(--text-muted)">' + esc(g.label) + ' · 현재 계통 ' + esc(l.label) + '</div></div></div>';
    var bodyInner = '';
    if (o.stage === 'idle') {
      bodyInner =
        '<div class="card" style="text-align:center;padding:26px 16px"><div style="width:64px;height:64px;border-radius:16px;background:#EAF3DE;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">' + ico('camera', '#639922', 32) + '</div><div style="font-size:14px;font-weight:500">라벨을 촬영하세요</div><div style="font-size:12px;color:var(--text-muted);margin-top:6px;line-height:1.6">인쇄된 영문·숫자 라벨(예: ' + esc(g.prefix || 'CU') + '24-001) 인식에 최적화되어 있습니다. 밝고 반듯하게, 라벨이 화면을 꽉 채우도록 찍으면 정확합니다.</div></div>' +
        '<button class="btn primary" id="oShot" style="width:100%;height:52px;font-size:15px;margin-top:14px;display:flex;align-items:center;justify-content:center;gap:7px">' + ico('camera', '#fff', 20) + ' 촬영 / 사진 선택</button>' +
        '<input type="file" id="oFile" accept="image/*" capture="environment" style="display:none">' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;line-height:1.6">손글씨 라벨은 인식률이 낮을 수 있어 결과를 확인·수정한 뒤 적용하세요. 첫 사용 시 엔진을 내려받으므로 온라인에서 한 번 실행해두면 이후 오프라인에서도 됩니다.</div>';
    } else if (o.stage === 'running') {
      bodyInner =
        (o.img ? '<img src="' + o.img + '" style="width:100%;max-height:220px;object-fit:contain;border-radius:12px;border:0.5px solid var(--border);background:#000">' : '') +
        '<div class="card" style="margin-top:12px;text-align:center;padding:22px 16px"><div style="font-size:14px;font-weight:500">인식 중…</div><div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden;margin-top:12px"><div style="width:' + Math.round((o.prog || 0) * 100) + '%;height:100%;background:#639922;transition:width .2s"></div></div><div style="font-size:11px;color:var(--text-muted);margin-top:8px">' + esc(o.status || '준비 중') + '</div></div>';
    } else { // done
      bodyInner =
        (o.img ? '<img src="' + o.img + '" style="width:100%;max-height:200px;object-fit:contain;border-radius:12px;border:0.5px solid var(--border);background:#000">' : '') +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin-top:14px">인식된 라벨번호 <span style="color:var(--text-muted);font-weight:400">· 신뢰도 ' + (o.conf || 0) + '%</span></label>' +
        '<input class="ein" id="oText" style="margin-top:6px;font-size:18px;font-weight:600;letter-spacing:.5px" value="' + esc(o.text || '') + '">' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">글자가 틀리면 직접 고친 뒤 적용하세요. (예: O↔0, I↔1, B↔8 혼동 주의)</div>' +
        '<div style="display:flex;gap:10px;margin-top:16px"><button class="btn" id="oRetry" style="flex:0 0 96px;height:48px;font-size:14px">다시 촬영</button><button class="btn primary" id="oApply" style="flex:1;height:48px;font-size:15px">이 라벨로 적용</button></div>';
    }
    v.innerHTML = head + '<div style="flex:1;padding:14px 14px;overflow:auto">' + bodyInner + '</div>';
    $('oBack').onclick = function () { go('collect'); };
    if (o.stage === 'idle') {
      $('oShot').onclick = function () { $('oFile').click(); };
      $('oFile').onchange = function () {
        var f = this.files && this.files[0]; if (!f) return;
        try { o.img = URL.createObjectURL(f); } catch (e) { o.img = null; }
        o.stage = 'running'; o.prog = 0; o.status = '엔진 불러오는 중…'; renderOCR();
        runOCR(f, function (m) { if (m && m.status) { o.status = m.status + (m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''); if (m.status.indexOf('recognizing') >= 0) o.prog = m.progress || 0; if ($('view-ocr').classList.contains('on') && S.ocr === o && o.stage === 'running') renderOCR(); } })
          .then(function (r) { if (S.ocr !== o) return; o.text = r.text || ''; o.conf = r.conf || 0; o.stage = 'done'; renderOCR(); })
          .catch(function () { if (S.ocr !== o) return; o.stage = 'done'; o.text = ''; o.conf = 0; renderOCR(); toast('인식 엔진을 불러오지 못했습니다. 라벨을 직접 입력하세요.'); });
      };
    } else if (o.stage === 'done') {
      $('oText').oninput = function () { o.text = this.value; };
      $('oRetry').onclick = function () { o.stage = 'idle'; o.text = ''; o.conf = 0; renderOCR(); };
      $('oApply').onclick = function () { var val = ($('oText').value || '').trim(); if (!val) { toast('라벨을 입력하세요'); return; } curLine().label = val; kvSet('gens', S.gens).then(function () { toast('라벨 적용됨 · ' + val); go('collect'); }); };
    }
  }

  // ---------- PHOTO · DRAW · VOICE ----------
  function updatePhotoBadge() { var g = curGen(), l = curLine(); photosForLine(g.id, l.id).then(function (ps) { var b = $('qPhotoN'); if (b) b.textContent = ps.length ? ' ' + ps.length : ''; }); }
  function openPhotos() { var g = curGen(), l = curLine(); photosForLine(g.id, l.id).then(function (ps) { S.photos = ps; go('photo'); }); }
  function openDraw() { var g = curGen(), l = curLine(); photosForLine(g.id, l.id).then(function (ps) { S.photos = ps; if (ps.length) { S.drawId = ps[ps.length - 1].id; go('draw'); } else { go('photo'); toast('먼저 사진을 촬영하세요'); } }); }
  function renderPhoto() {
    var g = curGen(), l = curLine(), v = $('view-photo'), ps = S.photos || [];
    var grid = ps.length ? ('<div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">' + ps.map(function (p) { return '<div style="position:relative;border-radius:10px;overflow:hidden;border:0.5px solid var(--border)"><img class="pThumb" data-id="' + p.id + '" src="' + (p.anno || p.orig) + '" style="width:100%;height:120px;object-fit:cover;display:block;cursor:pointer">' + (p.anno ? '<span style="position:absolute;left:5px;top:5px;background:#27500A;color:#fff;font-size:9px;padding:1px 6px;border-radius:10px">주석</span>' : '') + '<button class="btn pDel" data-id="' + p.id + '" style="position:absolute;right:5px;top:5px;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#C0392B;padding:0">' + ico('trash', '#C0392B', 14) + '</button></div>'; }).join('') + '</div>') : '<div style="text-align:center;color:var(--text-muted);padding:40px 10px">' + ico('photo', 'var(--border-strong)', 44) + '<div style="font-size:13px;margin-top:12px">이 계통의 사진이 없습니다</div></div>';
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="phBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">사진</div><div style="font-size:11px;color:var(--text-muted)">' + esc(g.label) + ' · ' + esc(l.label) + ' · ' + ps.length + '장</div></div></div>' +
      '<div style="flex:1;padding:14px 14px;overflow:auto">' + grid + '<div style="font-size:11px;color:var(--text-muted);margin-top:14px">사진을 탭하면 그리기(주석)로 편집됩니다. 사진은 기기에 저장되며 계통에 연결됩니다.</div></div>' +
      '<div style="padding:10px 14px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)"><button class="btn primary" id="phShot" style="width:100%;height:52px;font-size:15px;display:flex;align-items:center;justify-content:center;gap:7px">' + ico('camera', '#fff', 20) + ' 촬영 / 사진 추가</button><input type="file" id="phFile" accept="image/*" capture="environment" style="display:none"></div>';
    $('phBack').onclick = function () { go('collect'); };
    $('phShot').onclick = function () { $('phFile').click(); };
    $('phFile').onchange = function () { var f = this.files && this.files[0]; if (!f) return; toast('사진 저장 중…'); fileToScaledDataURL(f, 1400).then(function (url) { return photoPut({ id: 'ph' + Date.now(), genId: g.id, lineId: l.id, indiv: S.indiv, orig: url, anno: null, createdAt: Date.now() }); }).then(function () { return photosForLine(g.id, l.id); }).then(function (ps2) { S.photos = ps2; renderPhoto(); toast('사진 저장됨'); }).catch(function () { toast('사진 처리 실패'); }); };
    v.querySelectorAll('.pThumb').forEach(function (im) { im.onclick = function () { S.drawId = im.getAttribute('data-id'); go('draw'); }; });
    v.querySelectorAll('.pDel').forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-id'); if (!confirm('사진을 삭제할까요?')) return; photoDelete(id).then(function () { return photosForLine(g.id, l.id); }).then(function (ps2) { S.photos = ps2; renderPhoto(); }); }; });
  }
  function renderDraw() {
    var l = curLine(), v = $('view-draw');
    photoGet(S.drawId).then(function (p) {
      if (!p) { go('photo'); return; }
      v.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="drBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">그리기 (주석)</div><div style="font-size:11px;color:var(--text-muted)">' + esc(l.label) + '</div></div><button class="btn primary" id="drSave" style="height:38px;padding:0 16px;font-size:14px">저장</button></div>' +
        '<div id="drCanvasWrap" style="position:relative;flex:1;display:flex;align-items:center;justify-content:center;background:#111;overflow:hidden;min-height:240px"><canvas id="drBg" style="position:absolute"></canvas><canvas id="drFg" style="position:absolute;touch-action:none"></canvas></div>' +
        '<div style="padding:10px 12px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          ['#D64545', '#E0A82E', '#2E7D5B', '#2f6fb0', '#111111', '#ffffff'].map(function (c) { return '<button class="btn drColor" data-c="' + c + '" style="width:30px;height:30px;border-radius:50%;padding:0;background:' + c + '"></button>'; }).join('') +
          '<div style="flex:1"></div><button class="btn drSize" data-s="3" style="width:38px;height:34px;padding:0;font-size:12px">가늘</button><button class="btn drSize" data-s="7" style="width:38px;height:34px;padding:0;font-size:12px">중</button><button class="btn drSize" data-s="14" style="width:38px;height:34px;padding:0;font-size:12px">굵</button></div>' +
          '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="drErase" style="flex:1;height:42px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('eraser', 'var(--text-primary)', 16) + ' 지우개</button><button class="btn" id="drUndo" style="flex:1;height:42px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('arrow-back-up', 'var(--text-primary)', 16) + ' 되돌리기</button><button class="btn" id="drClear" style="flex:1;height:42px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px;color:#C0392B;border-color:#E3B4AE">' + ico('circle-x', '#C0392B', 16) + ' 전체지우기</button></div></div>';
      setupDraw(p);
    });
  }
  function setupDraw(p) {
    var wrap = $('drCanvasWrap'), bg = $('drBg'), fg = $('drFg');
    var st = { color: '#D64545', size: 7, erase: false, strokes: [], cur: null };
    var img = new Image();
    img.onload = function () {
      var maxW = wrap.clientWidth || 320, maxH = wrap.clientHeight || Math.round((window.innerHeight || 600) * 0.5);
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height; var sc = Math.min(maxW / iw, maxH / ih) || 1; var cw = Math.max(1, Math.round(iw * sc)), ch = Math.max(1, Math.round(ih * sc));
      [bg, fg].forEach(function (cv) { cv.width = cw; cv.height = ch; cv.style.width = cw + 'px'; cv.style.height = ch + 'px'; });
      var bctx = bg.getContext('2d'), ctx = fg.getContext('2d');
      bctx.drawImage(img, 0, 0, cw, ch);
      function wire() {
        function pos(e) { var r = fg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
        function drawStroke(s) { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.size; if (s.erase) { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; } else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; } ctx.beginPath(); s.points.forEach(function (pt, i) { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); }); if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1); ctx.stroke(); ctx.restore(); }
        function redraw() { ctx.clearRect(0, 0, cw, ch); st.strokes.forEach(drawStroke); }
        fg.addEventListener('pointerdown', function (e) { e.preventDefault(); if (fg.setPointerCapture) try { fg.setPointerCapture(e.pointerId); } catch (x) {} st.cur = { color: st.color, size: st.size, erase: st.erase, points: [pos(e)] }; st.strokes.push(st.cur); drawStroke(st.cur); });
        fg.addEventListener('pointermove', function (e) { if (!st.cur) return; e.preventDefault(); st.cur.points.push(pos(e)); redraw(); });
        var endfn = function () { st.cur = null; }; fg.addEventListener('pointerup', endfn); fg.addEventListener('pointercancel', endfn);
        function markSel() { document.querySelectorAll('.drColor').forEach(function (b) { b.style.outline = (b.getAttribute('data-c') === st.color && !st.erase) ? '3px solid #27500A' : 'none'; }); document.querySelectorAll('.drSize').forEach(function (b) { var on = parseInt(b.getAttribute('data-s')) === st.size; b.style.background = on ? '#EAF3DE' : ''; b.style.borderColor = on ? '#639922' : ''; }); $('drErase').style.background = st.erase ? '#EAF3DE' : ''; }
        document.querySelectorAll('.drColor').forEach(function (b) { b.onclick = function () { st.color = b.getAttribute('data-c'); st.erase = false; markSel(); }; });
        document.querySelectorAll('.drSize').forEach(function (b) { b.onclick = function () { st.size = parseInt(b.getAttribute('data-s')); markSel(); }; });
        $('drErase').onclick = function () { st.erase = !st.erase; markSel(); };
        $('drUndo').onclick = function () { st.strokes.pop(); redraw(); };
        $('drClear').onclick = function () { st.strokes = []; redraw(); };
        $('drBack').onclick = function () { go('photo'); };
        $('drSave').onclick = function () { var out = document.createElement('canvas'); out.width = cw; out.height = ch; var octx = out.getContext('2d'); octx.drawImage(bg, 0, 0); octx.drawImage(fg, 0, 0); p.anno = out.toDataURL('image/jpeg', 0.85); photoPut(p).then(function () { toast('주석 저장됨'); openPhotos(); }); };
        markSel();
      }
      if (p.anno) { var ai = new Image(); ai.onload = function () { bctx.drawImage(ai, 0, 0, cw, ch); wire(); }; ai.onerror = wire; ai.src = p.anno; } else wire();
    };
    img.src = p.orig;
  }
  function renderWrite() {
    var l = curLine(), t = traitById(S.write && S.write.tid), v = $('view-write');
    if (!t) { go('collect'); return; }
    var cur = getValFor(t.id), hasImg = typeof cur === 'string' && cur.indexOf('data:image') === 0;
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="wrBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">' + esc(t.name) + ' · 손글씨</div><div style="font-size:11px;color:var(--text-muted)">' + esc(l.label) + ' · 개체 ' + S.indiv + '</div></div><button class="btn primary" id="wrSave" style="height:38px;padding:0 16px;font-size:14px">저장</button></div>' +
      '<div id="wrCanvasWrap" style="position:relative;flex:1;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;min-height:260px"><canvas id="wrFg" style="position:absolute;touch-action:none;background:#fff"></canvas></div>' +
      '<div style="padding:10px 12px 16px;border-top:0.5px solid var(--border);background:var(--surface-1)"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        ['#111111', '#D64545', '#2f6fb0', '#2E7D5B'].map(function (c) { return '<button class="btn wrColor" data-c="' + c + '" style="width:30px;height:30px;border-radius:50%;padding:0;background:' + c + '"></button>'; }).join('') +
        '<div style="flex:1"></div><button class="btn wrSize" data-s="3" style="width:38px;height:34px;padding:0;font-size:12px">가늘</button><button class="btn wrSize" data-s="6" style="width:38px;height:34px;padding:0;font-size:12px">중</button><button class="btn wrSize" data-s="12" style="width:38px;height:34px;padding:0;font-size:12px">굵</button></div>' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="wrErase" style="flex:1;height:42px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('eraser', 'var(--text-primary)', 16) + ' 지우개</button><button class="btn" id="wrUndo" style="flex:1;height:42px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px">' + ico('arrow-back-up', 'var(--text-primary)', 16) + ' 되돌리기</button><button class="btn" id="wrClear" style="flex:1;height:42px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:5px;color:#C0392B;border-color:#E3B4AE">' + ico('circle-x', '#C0392B', 16) + ' 전체지우기</button></div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">사용자가 쓰거나 그릴 수 있습니다.</div></div>';
    setupWrite(hasImg ? cur : null);
  }
  function setupWrite(bgDataUrl) {
    var wrap = $('wrCanvasWrap'), fg = $('wrFg');
    var st = { color: '#111111', size: 6, erase: false, strokes: [] };
    function init(bgImg) {
      var cw = Math.max(1, wrap.clientWidth || 320), ch = Math.max(1, wrap.clientHeight || Math.round((window.innerHeight || 600) * 0.5));
      fg.width = cw; fg.height = ch; fg.style.width = cw + 'px'; fg.style.height = ch + 'px';
      var ctx = fg.getContext('2d');
      function redrawAll() { ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.restore(); if (bgImg) ctx.drawImage(bgImg, 0, 0, cw, ch); st.strokes.forEach(drawStroke); }
      function drawStroke(s) { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (s.erase) { ctx.strokeStyle = '#fff'; ctx.lineWidth = s.size * 3; } else { ctx.strokeStyle = s.color; ctx.lineWidth = s.size; } ctx.beginPath(); s.points.forEach(function (pt, i) { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); }); if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1); ctx.stroke(); ctx.restore(); }
      redrawAll();
      function pos(e) { var r = fg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      var cur = null;
      fg.addEventListener('pointerdown', function (e) { e.preventDefault(); if (fg.setPointerCapture) try { fg.setPointerCapture(e.pointerId); } catch (x) {} cur = { color: st.color, size: st.size, erase: st.erase, points: [pos(e)] }; st.strokes.push(cur); drawStroke(cur); });
      fg.addEventListener('pointermove', function (e) { if (!cur) return; e.preventDefault(); cur.points.push(pos(e)); drawStroke(cur); });
      var end = function () { cur = null; }; fg.addEventListener('pointerup', end); fg.addEventListener('pointercancel', end);
      function markSel() { document.querySelectorAll('.wrColor').forEach(function (b) { b.style.outline = (b.getAttribute('data-c') === st.color && !st.erase) ? '3px solid #27500A' : 'none'; }); document.querySelectorAll('.wrSize').forEach(function (b) { var on = parseInt(b.getAttribute('data-s')) === st.size; b.style.background = on ? '#EAF3DE' : ''; b.style.borderColor = on ? '#639922' : ''; }); $('wrErase').style.background = st.erase ? '#EAF3DE' : ''; }
      document.querySelectorAll('.wrColor').forEach(function (b) { b.onclick = function () { st.color = b.getAttribute('data-c'); st.erase = false; markSel(); }; });
      document.querySelectorAll('.wrSize').forEach(function (b) { b.onclick = function () { st.size = parseInt(b.getAttribute('data-s')); markSel(); }; });
      $('wrErase').onclick = function () { st.erase = !st.erase; markSel(); };
      $('wrUndo').onclick = function () { st.strokes.pop(); redrawAll(); };
      $('wrClear').onclick = function () { st.strokes = []; redrawAll(); };
      $('wrBack').onclick = function () { go('collect'); };
      $('wrSave').onclick = function () { var tt = traitById(S.write.tid); var url = fg.toDataURL('image/jpeg', 0.8); setVal(tt.id, url).then(function () { toast('저장됨'); go('collect'); }); };
      markSel();
    }
    if (bgDataUrl) { var im = new Image(); im.onload = function () { init(im); }; im.onerror = function () { init(null); }; im.src = bgDataUrl; } else { init(null); }
  }
  function traitByName(nm) { var ts = curGen().traits; for (var i = 0; i < ts.length; i++) if (ts[i].name === nm) return ts[i]; return null; }
  function parseVoice(text) {
    if (!text) return []; var g = curGen(), out = [];
    g.traits.forEach(function (t) {
      if (t.type === 'numeric' || t.type === 'ratio' || t.type === 'counter' || (t.type === 'rating' && t.scale && typeof t.scale[0] === 'number')) {
        var re = new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:은|는|이|가|:|=)?\\s*([0-9]+(?:\\.[0-9]+)?)');
        var m = text.match(re); if (m) out.push({ traitId: t.id, name: t.name, value: m[1] });
      } else if (t.type === 'rating' || t.type === 'categorical') {
        var opts = (t.type === 'rating' ? t.scale : t.options) || [];
        for (var i = 0; i < opts.length; i++) { var o = String(opts[i]); if (text.indexOf(t.name) >= 0 && text.indexOf(o) >= 0) { out.push({ traitId: t.id, name: t.name, value: o }); break; } }
      }
    });
    return out;
  }
  function renderVoice() {
    var l = curLine(), v = $('view-voice'), vo = S.voice || (S.voice = { transcript: '', parsed: [], listening: false });
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition, supported = !!SR;
    var parsedHtml = (vo.parsed && vo.parsed.length) ? ('<div style="font-size:12px;font-weight:600;margin:14px 0 8px">인식된 형질 값</div>' + vo.parsed.map(function (pp, i) { return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="flex:1;font-size:13px"><b>' + esc(pp.name) + '</b> → ' + esc(pp.value) + '</div><button class="btn vApply" data-i="' + i + '" style="height:34px;padding:0 12px;font-size:12px">적용</button></div>'; }).join('')) : '';
    v.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 12px;border-bottom:0.5px solid var(--border)"><button class="btn" id="voBack" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center">' + ico('arrow-left', 'var(--text-primary)', 18) + '</button><div style="flex:1"><div style="font-size:15px;font-weight:600">음성 입력</div><div style="font-size:11px;color:var(--text-muted)">' + esc(l.label) + ' · 개체 ' + S.indiv + '</div></div></div>' +
      '<div style="flex:1;padding:16px 16px;overflow:auto">' +
      (supported ? (
        '<div style="text-align:center;padding:10px 0"><button class="btn ' + (vo.listening ? '' : 'primary') + '" id="voMic" style="width:88px;height:88px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center' + (vo.listening ? ';background:#C0392B;border-color:#8f2b20;color:#fff' : '') + '">' + ico(vo.listening ? 'player-stop' : 'microphone', '#fff', 36) + '</button><div style="font-size:12px;color:var(--text-secondary);margin-top:10px">' + (vo.listening ? '듣는 중… 다시 누르면 정지' : '마이크를 눌러 말하세요') + '</div></div>' +
        '<div class="card voT" style="margin-top:14px;min-height:70px;font-size:14px;line-height:1.6">' + (vo.transcript ? esc(vo.transcript) : '<span style="color:var(--text-muted)">예: “병징 5 발병면적률 30 마디수 12”처럼 형질 이름과 값을 말하면 자동 인식됩니다.</span>') + '</div>' +
        parsedHtml +
        (vo.transcript ? '<button class="btn" id="voNote" style="width:100%;height:44px;font-size:13px;margin-top:12px">비고에 문장 저장</button>' : '')
      ) : (
        '<div class="card" style="line-height:1.7;font-size:13px;color:var(--text-secondary)">이 브라우저는 음성 인식을 지원하지 않습니다(아이폰·아이패드 Safari 미지원). 안드로이드 Chrome에서 쓰거나, 아래에 직접 입력해 비고로 저장하세요.</div>' +
        '<textarea class="ein" id="voManual" style="height:100px;margin-top:12px;padding:10px 12px;resize:none" placeholder="관찰 메모"></textarea>' +
        '<button class="btn primary" id="voManualSave" style="width:100%;height:46px;font-size:14px;margin-top:10px">비고에 저장</button>'
      )) +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:14px;line-height:1.6">음성 인식은 보통 인터넷 연결이 필요합니다(브라우저가 처리). 결과는 반드시 확인 후 적용하세요.</div></div>';
    $('voBack').onclick = function () { if (vo._rec) { try { vo._rec.stop(); } catch (e) {} } go('collect'); };
    if (supported) {
      $('voMic').onclick = function () {
        if (vo.listening) { if (vo._rec) { try { vo._rec.stop(); } catch (e) {} } return; }
        var rec = new SR(); vo._rec = rec; rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
        var finalT = '';
        rec.onresult = function (e) { var interim = ''; for (var i = e.resultIndex; i < e.results.length; i++) { var r = e.results[i]; if (r.isFinal) finalT += r[0].transcript; else interim += r[0].transcript; } vo.transcript = (finalT + ' ' + interim).trim(); var c = v.querySelector('.voT'); if (c) c.textContent = vo.transcript; };
        rec.onerror = function () { vo.listening = false; renderVoice(); };
        rec.onend = function () { vo.listening = false; vo.transcript = (finalT || vo.transcript || '').trim(); vo.parsed = parseVoice(vo.transcript); renderVoice(); };
        vo.listening = true; renderVoice(); try { rec.start(); } catch (e) { vo.listening = false; renderVoice(); }
      };
      v.querySelectorAll('.vApply').forEach(function (b) { b.onclick = function () { var pp = vo.parsed[+b.getAttribute('data-i')]; if (!pp) return; setVal(pp.traitId, pp.value).then(function () { toast(pp.name + ' = ' + pp.value + ' 적용'); }); }; });
      if ($('voNote')) $('voNote').onclick = function () { var nt = traitByName('비고'); if (!nt) { toast('비고 형질이 없습니다'); return; } setVal(nt.id, vo.transcript).then(function () { toast('비고 저장됨'); }); };
    } else {
      $('voManualSave').onclick = function () { var nt = traitByName('비고'); var txt = ($('voManual').value || '').trim(); if (!txt) { toast('내용을 입력하세요'); return; } if (!nt) { toast('비고 형질이 없습니다'); return; } setVal(nt.id, txt).then(function () { toast('비고 저장됨'); go('collect'); }); };
    }
  }

  // ---------- EXPORT ----------
  function renderExport() {
    var g = curGen(), v = $('view-export');
    v.innerHTML =
      '<div style="padding:16px 16px 10px;border-bottom:0.5px solid var(--border)"><div style="font-size:18px;font-weight:700">내보내기</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc(g.projName) + ' · ' + esc(g.label) + '</div></div>' +
      '<div style="padding:16px 16px">' +
        '<div class="card" style="line-height:1.8;font-size:13px;color:var(--text-secondary)">CSV(UTF-8 BOM · 엑셀 호환) 롱포맷으로 내보냅니다.<br>열: 라벨번호 · 세대 · 반복 · 개체 · <b>조사일</b> · 형질 · 값 · <b>개체선발</b> · <b>계통선발</b></div>' +
        '<button class="btn primary" id="eCsv" style="width:100%;height:52px;font-size:15px;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px">' + ico('file-export', '#fff', 20) + ' CSV 내보내기 (다운로드)</button>' +
        '<button class="btn" id="eSync" style="width:100%;height:48px;font-size:14px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:10px">' + ico('cloud-upload', 'var(--text-primary)', 18) + ' 지금 동기화 (시트로 전송)</button>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:12px">동기화는 설정에서 Apps Script URL을 입력해야 동작합니다. CSV는 오프라인에서도 바로 저장됩니다.</div>' +
      '</div>';
    $('eCsv').onclick = function () { exportCSV(); };
    $('eSync').onclick = function () { trySync(false); };
  }

  // ---------- SETTINGS ----------
  function renderSettings() {
    var v = $('view-settings'), st = S.settings;
    v.innerHTML =
      '<div style="padding:16px 16px 10px;border-bottom:0.5px solid var(--border)"><div style="font-size:18px;font-weight:700">설정</div></div>' +
      '<div style="padding:16px 16px">' +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500">동기화 URL <span style="color:var(--text-muted);font-weight:400">(Apps Script 웹앱 /exec)</span></label>' +
        '<input class="ein" id="sUrl" style="margin-top:6px" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(st.syncUrl) + '">' +
        '<label style="font-size:12px;color:var(--text-secondary);font-weight:500;display:block;margin-top:14px">공유 토큰 <span style="color:var(--text-muted);font-weight:400">(선택 · SYNC_TOKEN과 일치)</span></label>' +
        '<input class="ein" id="sTok" style="margin-top:6px" placeholder="(선택)" value="' + esc(st.token) + '">' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">기기 ID: ' + esc(st.deviceId) + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:16px"><div style="flex:1"><div style="font-size:13px;font-weight:500">진동 피드백</div><div style="font-size:11px;color:var(--text-muted)">버튼·스와이프 시 짧게 진동 (안드로이드)</div></div><div class="sw' + (st.haptic !== false ? ' on' : '') + '" id="sHaptic"><div class="knob"></div></div></div>' +
        '<div style="display:flex;gap:10px;margin-top:16px">' +
          '<button class="btn" id="sPing" style="flex:1;height:46px;font-size:14px">연결 테스트</button>' +
          '<button class="btn primary" id="sSave" style="flex:1;height:46px;font-size:14px">저장</button>' +
        '</div>' +
        '<div style="height:1px;background:var(--border);margin:20px 0"></div>' +
        '<div style="font-size:13px;font-weight:600;margin-bottom:6px">데이터</div>' +
        '<div style="font-size:12px;color:var(--text-secondary)">미동기화 <b data-pending>' + S.pending + '</b>건 · 마지막 동기화 ' + (S.lastSync ? tm(S.lastSync) : '없음') + '</div>' +
        '<button class="btn" id="sReset" style="width:100%;height:44px;font-size:13px;margin-top:12px;color:#C0392B;border-color:#E3B4AE">모든 로컬 데이터 삭제 (초기화)</button>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:18px;line-height:1.7">Crop Memo Pro · 오프라인 우선 PWA<br>현장에서 인터넷 없이 저장되고, 연결되면 Google Sheets로 동기화됩니다.</div>' +
      '</div>';
    $('sSave').onclick = function () { st.syncUrl = $('sUrl').value.trim(); st.token = $('sTok').value.trim(); kvSet('settings', st).then(function () { toast('저장됨'); if (navigator.onLine && st.syncUrl) trySync(true); }); };
    $('sPing').onclick = function () { S.settings.syncUrl = $('sUrl').value.trim(); pingSync(); };
    $('sHaptic').onclick = function () { st.haptic = (st.haptic === false); this.classList.toggle('on', st.haptic !== false); kvSet('settings', st); if (st.haptic !== false) haptic(25); };
    $('sReset').onclick = async function () {
      if (!confirm('모든 로컬 데이터를 삭제할까요? (되돌릴 수 없습니다)')) return;
      indexedDB.deleteDatabase(DB_NAME);
      setTimeout(function () { location.reload(); }, 300);
    };
  }

  // ---------- net ----------
  function onNet() { if (S.view === 'home') renderHome(); if (navigator.onLine && S.settings.syncUrl && S.pending > 0) trySync(true); }

  // ---------- boot ----------
  async function boot() {
    try {
      DB = await idb();
      var gens = await kvGet('gens'); if (!gens) { gens = seedGens(); await kvSet('gens', gens); }
      S.gens = gens;
      S.settings = await kvGet('settings') || { syncUrl: '', token: '', deviceId: 'dev-' + Math.random().toString(36).slice(2, 8), haptic: true };
      if (!S.settings.deviceId) S.settings.deviceId = 'dev-' + Math.random().toString(36).slice(2, 8);
      S.indivSel = await kvGet('indivSel') || {};
      S.lastSync = await kvGet('lastSync') || null;
      if (S.genIdx >= S.gens.length) S.genIdx = 0;
      var g = curGen();
      if (g) { S.date = (g.surveyDates && g.surveyDates[g.surveyDates.length - 1]) || todayStr(); S.trait = (g.traits && g.traits[0]) ? g.traits[0].id : null; }
      await loadVals();
      await updatePending();
      document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-view')); }; });
      window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
      document.addEventListener('pointerdown', function (e) { var t = e.target; if (t && t.closest && t.closest('button,.btn,.key,.pill,.sw,.tab,.mm')) haptic(12); }, { passive: true });
      go('home');
      if (navigator.onLine && S.settings.syncUrl) trySync(true);
    } catch (err) { showBootError(err); }
  }
  function showBootError(err) {
    var v = document.getElementById('view-home'); if (!v) return;
    ['collect', 'export', 'settings', 'new', 'genedit', 'analysis', 'bulk', 'ocr', 'photo', 'draw', 'voice', 'write'].forEach(function (x) { var s = document.getElementById('view-' + x); if (s) s.classList.remove('on'); });
    v.classList.add('on');
    var msg = (err && (err.stack || err.message)) || String(err);
    msg = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    v.innerHTML = '<div style="padding:22px 18px"><div style="font-size:16px;font-weight:700;margin-bottom:10px">앱을 시작하지 못했어요</div><div style="font-size:12px;color:#8a5a12;background:#FAEEDA;border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto">' + msg + '</div>' +
      '<button id="beReload" style="width:100%;height:48px;margin-top:14px;border:0.5px solid #C9CFC3;border-radius:10px;background:#fff;font-size:15px">새로고침</button>' +
      '<button id="beReset" style="width:100%;height:48px;margin-top:10px;border:0.5px solid #E3B4AE;border-radius:10px;background:#fff;color:#C0392B;font-size:14px">데이터 초기화 후 재시작</button>' +
      '<div style="font-size:11px;color:#8C9583;margin-top:10px;line-height:1.5">먼저 새로고침을 눌러보고, 그래도 안 되면 초기화하세요. 초기화는 이 기기의 로컬 데이터만 지웁니다.</div></div>';
    var r = document.getElementById('beReload'); if (r) r.onclick = function () { location.reload(); };
    var z = document.getElementById('beReset'); if (z) z.onclick = function () { try { indexedDB.deleteDatabase(DB_NAME); } catch (x) {} setTimeout(function () { location.reload(); }, 300); };
  }

  boot();
})();
