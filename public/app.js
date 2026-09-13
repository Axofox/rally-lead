/* Rally timing — everything runs in the browser, nothing is uploaded. */
(function () {
  'use strict';

  var STORAGE_KEY = 'rally-timing-v1';
  var MONO_PAD = 2;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    clock: $('clock'),
    target: $('target-time'),
    gap: $('gap'),
    body: $('rally-body'),
    schedule: $('schedule'),
    tableError: $('table-error'),
    tableWarn: $('table-warn'),
    ocrDebug: $('ocr-debug'),
    ocrRaw: $('ocr-raw'),
    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    ocrStatus: $('ocr-status'),
    ocrBar: $('ocr-bar'),
    ocrText: $('ocr-text'),
    btnScreenshot: $('btn-screenshot'),
    btnBrowse: $('btn-browse'),
    btnAdd: $('btn-add'),
    btnClear: $('btn-clear'),
    btnCopy: $('btn-copy')
  };

  var state = load() || {
    v: 2,
    target: '',
    gap: 1,
    tz: 'utc',
    rallies: [
      { id: uid(), name: '', march: '' },
      { id: uid(), name: '', march: '' },
      { id: uid(), name: '', march: '' }
    ]
  };

  /* ---------- persistence ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.rallies)) return null;
      s.rallies.forEach(function (r) { if (!r.id) r.id = uid(); });
      // Game time only. A target saved while the old "Local" clock was selected
      // is in the wrong zone, so drop it rather than show a misleading time.
      if (s.tz !== 'utc' || s.v !== 2) s.target = '';
      s.tz = 'utc';
      s.v = 2;
      return s;
    } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  /* ---------- time parsing / formatting ---------- */

  // "00:04:32", "4:32", "1:02:03", "4m 32s", "1h 2m", "45s" -> seconds, else null.
  function parseDuration(str) {
    if (!str) return null;
    var s = String(str).trim().toLowerCase();
    if (!s) return null;
    var m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
      if (m[3] !== undefined) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      return (+m[1]) * 60 + (+m[2]);
    }
    m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/);
    if (m && (m[1] || m[2] || m[3])) {
      return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
    }
    if (/^\d+$/.test(s)) return +s; // plain seconds
    return null;
  }

  function pad(n) { n = String(n); while (n.length < MONO_PAD) n = '0' + n; return n; }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }
  function fmtOffset(sec) {
    sec = Math.round(sec);
    if (sec === 0) return '+0s';
    var sign = sec < 0 ? '−' : '+';
    sec = Math.abs(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return sign + (m ? m + 'm ' : '') + s + 's';
  }

  // "20:00:00", "20:00", "200000", "2000" (in the chosen clock) -> {h,m,s} or null.
  function parseClock(str) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{1,2})[:.]?(\d{2})(?:[:.]?(\d{2}))?$/);
    if (!m) return null;
    var h = +m[1], mi = +m[2], se = +(m[3] || 0);
    if (h > 23 || mi > 59 || se > 59) return null;
    return { h: h, m: mi, s: se };
  }

  function tzParts(date) {
    if (state.tz === 'utc') {
      return { y: date.getUTCFullYear(), mo: date.getUTCMonth(), d: date.getUTCDate(),
               h: date.getUTCHours(), m: date.getUTCMinutes(), s: date.getUTCSeconds() };
    }
    return { y: date.getFullYear(), mo: date.getMonth(), d: date.getDate(),
             h: date.getHours(), m: date.getMinutes(), s: date.getSeconds() };
  }
  function makeDate(y, mo, d, h, m, s) {
    return state.tz === 'utc' ? new Date(Date.UTC(y, mo, d, h, m, s)) : new Date(y, mo, d, h, m, s);
  }
  function fmtClock(date) {
    var p = tzParts(date);
    return pad(p.h) + ':' + pad(p.m) + ':' + pad(p.s);
  }
  function dayKey(date) { var p = tzParts(date); return p.y + '-' + p.mo + '-' + p.d; }

  // Target = today's date at the entered clock time. If that is already more than
  // 6 h in the past we assume the user means tomorrow.
  function targetDate() {
    var c = parseClock(state.target);
    if (!c) return null;
    var now = new Date(), p = tzParts(now);
    var t = makeDate(p.y, p.mo, p.d, c.h, c.m, c.s);
    if (t.getTime() < now.getTime() - 6 * 3600 * 1000) t = new Date(t.getTime() + 86400000);
    return t;
  }

  /* ---------- schedule maths ---------- */

  // Returns rows with computed fields, in table order.
  function compute() {
    var target = targetDate();
    var gap = Math.max(0, parseInt(state.gap, 10) || 0);
    var rows = state.rallies.map(function (r, i) {
      var march = parseDuration(r.march);
      var out = { id: r.id, index: i, name: r.name, marchText: r.march, march: march,
                  hit: null, launch: null, offset: null };
      if (target && march !== null) {
        out.hit = new Date(target.getTime() + i * gap * 1000);
        out.launch = new Date(out.hit.getTime() - march * 1000);
      }
      return out;
    });
    var first = null;
    rows.forEach(function (r) { if (r.launch && (first === null || r.launch < first)) first = r.launch; });
    rows.forEach(function (r) { if (r.launch) r.offset = (r.launch - first) / 1000; });
    return { target: target, gap: gap, rows: rows, firstLaunch: first };
  }

  /* ---------- rendering ---------- */

  function renderControls() {
    els.target.value = state.target;
    els.gap.value = state.gap;
  }

  function renderRows() {
    els.body.innerHTML = '';
    if (!state.rallies.length) {
      var tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="7">No rallies yet — add one or read them from a screenshot.</td>';
      els.body.appendChild(tr);
      return;
    }
    state.rallies.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.dataset.id = r.id;
      tr.innerHTML =
        '<td class="col-order">' + (i + 1) + '</td>' +
        '<td class="name-cell"><input type="text" data-field="name" placeholder="Leader ' + (i + 1) + '" autocomplete="off" spellcheck="false"></td>' +
        '<td class="march-cell"><input type="text" data-field="march" inputmode="numeric" autocomplete="off" spellcheck="false"></td>' +
        '<td class="col-num launch">—</td>' +
        '<td class="col-num col-hit hit">—</td>' +
        '<td class="col-num col-offset offset">—</td>' +
        '<td class="col-tools">' +
          '<button type="button" class="icon-btn" data-act="up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button> ' +
          '<button type="button" class="icon-btn" data-act="down" title="Move down"' + (i === state.rallies.length - 1 ? ' disabled' : '') + '>↓</button> ' +
          '<button type="button" class="icon-btn danger" data-act="del" title="Remove">✕</button>' +
        '</td>';
      tr.querySelector('[data-field="name"]').value = r.name;
      tr.querySelector('[data-field="march"]').value = r.march;
      els.body.appendChild(tr);
    });
    renderComputed();
  }

  function renderComputed() {
    var c = compute();
    var now = Date.now();
    var badMarch = false;
    c.rows.forEach(function (r) {
      var tr = els.body.querySelector('tr[data-id="' + r.id + '"]');
      if (!tr) return;
      var marchInput = tr.querySelector('[data-field="march"]');
      var invalid = r.marchText.trim() !== '' && r.march === null;
      marchInput.classList.toggle('bad', invalid);
      if (invalid) badMarch = true;

      var launchTd = tr.querySelector('.launch');
      var hitTd = tr.querySelector('.hit');
      var offTd = tr.querySelector('.offset');
      if (r.launch) {
        var suffix = dayKey(r.launch) !== dayKey(c.target) ? ' (−1d)' : '';
        launchTd.textContent = fmtClock(r.launch) + suffix;
        hitTd.textContent = fmtClock(r.hit);
        offTd.textContent = fmtOffset(r.offset);
        var dt = (r.launch.getTime() - now) / 1000;
        launchTd.classList.toggle('past', dt < 0);
        launchTd.classList.toggle('soon', dt >= 0 && dt <= 60);
        launchTd.title = dt < 0 ? 'Launch time already passed' : 'Launch in ' + fmtDuration(dt);
      } else {
        launchTd.textContent = hitTd.textContent = offTd.textContent = '—';
        launchTd.className = 'col-num launch';
        launchTd.title = '';
      }
    });
    els.target.classList.toggle('bad', state.target.trim() !== '' && !parseClock(state.target));
    els.tableError.classList.toggle('hidden', !badMarch);
    if (badMarch) els.tableError.textContent = 'A march time could not be read. Use mm:ss, hh:mm:ss or e.g. 4m 32s.';
    updatePastWarning(c, now);
    renderSchedule(c);
  }

  function updatePastWarning(c, now) {
    var late = c.rows.filter(function (r) { return r.launch && r.launch.getTime() < now; });
    els.tableWarn.classList.toggle('hidden', !late.length);
    if (!late.length) return;
    var names = late.map(function (r) { return r.name || ('Rally ' + (r.index + 1)); });
    els.tableWarn.textContent = (names.length === 1 ? names[0] + ' would have had to launch already' : names.join(', ') + ' would have had to launch already') +
      ' — pick a later target time (the longest march needs at least ' + fmtDuration(Math.max.apply(null, late.map(function (r) { return r.march; }))) + ').';
  }

  function renderSchedule(c) {
    var ready = c.rows.filter(function (r) { return r.launch; });
    if (!c.target) {
      els.schedule.textContent = state.rallies.length
        ? 'Enter the time the first rally should hit to see the schedule.'
        : 'Add rallies and a target time to see the schedule.';
      return;
    }
    if (!ready.length) {
      els.schedule.textContent = 'Enter a march time for at least one rally.';
      return;
    }
    var sorted = ready.slice().sort(function (a, b) { return a.launch - b.launch; });
    var lines = [];
    sorted.forEach(function (r) {
      var name = r.name || ('Rally ' + (r.index + 1));
      var suffix = dayKey(r.launch) !== dayKey(c.target) ? ' (−1d)' : '';
      lines.push(fmtClock(r.launch) + suffix + '  ' + name);
    });
    els.schedule.textContent = lines.join('\n');
  }

  /* ---------- events ---------- */

  els.target.addEventListener('input', function () { state.target = els.target.value; save(); renderComputed(); });
  els.target.addEventListener('blur', function () {
    var c = parseClock(state.target);
    if (c) { state.target = pad(c.h) + ':' + pad(c.m) + ':' + pad(c.s); els.target.value = state.target; save(); renderComputed(); }
  });
  els.gap.addEventListener('input', function () { state.gap = Math.max(0, parseInt(els.gap.value, 10) || 0); save(); renderComputed(); });
  document.querySelectorAll('.chip[data-plus]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = new Date(Date.now() + (+b.dataset.plus) * 60000);
      var p = tzParts(t);
      state.target = pad(p.h) + ':' + pad(p.m) + ':' + pad(p.s);
      save(); renderControls(); renderComputed();
    });
  });

  els.body.addEventListener('input', function (e) {
    var inp = e.target.closest('input[data-field]');
    if (!inp) return;
    var r = rowById(inp.closest('tr').dataset.id);
    if (!r) return;
    r[inp.dataset.field] = inp.value;
    save(); renderComputed();
  });
  els.body.addEventListener('keydown', function (e) {
    // Enter in the last row's march field adds a new rally.
    if (e.key !== 'Enter') return;
    var inp = e.target.closest('input[data-field="march"]');
    if (!inp) return;
    var tr = inp.closest('tr');
    if (tr === els.body.lastElementChild) { addRally(); focusRow(state.rallies.length - 1, 'name'); }
    else { var next = tr.nextElementSibling; if (next) next.querySelector('[data-field="name"]').focus(); }
    e.preventDefault();
  });
  els.body.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.closest('tr').dataset.id;
    var i = state.rallies.findIndex(function (r) { return r.id === id; });
    if (i < 0) return;
    if (b.dataset.act === 'del') state.rallies.splice(i, 1);
    else if (b.dataset.act === 'up' && i > 0) swap(i, i - 1);
    else if (b.dataset.act === 'down' && i < state.rallies.length - 1) swap(i, i + 1);
    save(); renderRows();
  });
  function swap(a, b) { var t = state.rallies[a]; state.rallies[a] = state.rallies[b]; state.rallies[b] = t; }
  function rowById(id) { return state.rallies.find(function (r) { return r.id === id; }); }
  function focusRow(i, field) {
    var tr = els.body.children[i];
    if (tr) { var inp = tr.querySelector('[data-field="' + field + '"]'); if (inp) inp.focus(); }
  }
  function addRally(name, march) {
    state.rallies.push({ id: uid(), name: name || '', march: march || '' });
  }

  els.btnAdd.addEventListener('click', function () { addRally(); save(); renderRows(); focusRow(state.rallies.length - 1, 'name'); });
  els.btnClear.addEventListener('click', function () {
    if (!state.rallies.length) return;
    if (!confirm('Remove all rallies?')) return;
    state.rallies = []; save(); renderRows();
  });

  els.btnCopy.addEventListener('click', function () {
    var text = els.schedule.textContent;
    var done = function () { var old = els.btnCopy.textContent; els.btnCopy.textContent = 'Copied ✓'; setTimeout(function () { els.btnCopy.textContent = old; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  });
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ---------- clock ---------- */
  function tick() {
    var now = new Date();
    els.clock.textContent = fmtClock(now) + ' UTC';
    // Only the coloured "past / soon" flags depend on the clock; refresh them cheaply.
    var c = compute();
    c.rows.forEach(function (r) {
      if (!r.launch) return;
      var tr = els.body.querySelector('tr[data-id="' + r.id + '"]');
      if (!tr) return;
      var td = tr.querySelector('.launch');
      var dt = (r.launch.getTime() - now.getTime()) / 1000;
      td.classList.toggle('past', dt < 0);
      td.classList.toggle('soon', dt >= 0 && dt <= 60);
      td.title = dt < 0 ? 'Launch time already passed' : 'Launch in ' + fmtDuration(dt);
    });
    updatePastWarning(c, now.getTime());
  }
  setInterval(tick, 1000);

  /* ---------- screenshot OCR ---------- */

  els.btnScreenshot.addEventListener('click', function () { els.fileInput.click(); });
  els.btnBrowse.addEventListener('click', function () { els.fileInput.click(); });
  els.fileInput.addEventListener('change', function () {
    handleFiles(Array.prototype.slice.call(els.fileInput.files));
    els.fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); els.dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) els.dropzone.classList.remove('dragover'); });
  });
  document.addEventListener('drop', function (e) {
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (files.length) handleFiles(files);
  });
  document.addEventListener('paste', function (e) {
    if (e.target && e.target.tagName === 'INPUT' && e.target.dataset.field) return; // pasting text into a cell
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
    }
    if (files.length) { e.preventDefault(); handleFiles(files); }
  });

  var worker = null, workerPromise = null;
  function getWorker() {
    if (workerPromise) return workerPromise;
    if (typeof Tesseract === 'undefined') return Promise.reject(new Error('OCR library did not load. Check your connection and reload.'));
    workerPromise = Tesseract.createWorker('eng', 1, {
      logger: function (m) {
        if (m.status === 'recognizing text') setOcr('Reading image…', m.progress);
        else if (m.status) setOcr(prettyStatus(m.status), typeof m.progress === 'number' ? m.progress : null);
      }
    }).then(function (w) { worker = w; return w; }, function (err) { workerPromise = null; throw err; });
    return workerPromise;
  }
  var currentPsm = null;
  function withPsm(w, psm) {
    if (currentPsm === psm) return Promise.resolve(w);
    return w.setParameters({ tessedit_pageseg_mode: String(psm) }).then(function () { currentPsm = psm; return w; });
  }
  function prettyStatus(s) {
    return { 'loading tesseract core': 'Loading OCR engine…', 'initializing tesseract': 'Starting OCR engine…',
             'loading language traineddata': 'Loading language data…', 'initializing api': 'Preparing OCR…' }[s] || (s.charAt(0).toUpperCase() + s.slice(1) + '…');
  }
  function setOcr(text, progress) {
    els.ocrStatus.classList.remove('hidden');
    els.ocrText.textContent = text;
    els.ocrBar.style.width = (progress === null || progress === undefined ? 0 : Math.round(progress * 100)) + '%';
  }
  function hideOcr() { els.ocrStatus.classList.add('hidden'); }

  var busy = false;
  function handleFiles(files) {
    if (busy || !files.length) return;
    busy = true;
    els.btnScreenshot.disabled = true;
    els.tableError.classList.add('hidden');
    var added = 0, debugLines = [];
    setOcr('Loading OCR…', null);
    getWorker().then(function (w) {
      return files.reduce(function (p, file, idx) {
        return p.then(function () {
          setOcr('Reading image ' + (idx + 1) + ' of ' + files.length + '…', 0);
          return loadImage(file).then(function (img) {
            var bubbles = findBubbles(img);
            if (bubbles.length) return readBubbles(w, img, bubbles);
            return readWholeImage(w, img);
          }).then(function (r) {
            debugLines = debugLines.concat(r.debug);
            var found = extractTimes(r.lines);
            found.forEach(function (f) { addRally(f.name, f.time); added++; });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      // Drop the untouched blank starter rows once real data arrives.
      if (added) state.rallies = state.rallies.filter(function (r) { return r.name.trim() || r.march.trim(); });
      save(); renderRows(); hideOcr();
      els.ocrRaw.textContent = debugLines.length ? debugLines.join('\n') : '(nothing recognised)';
      els.ocrDebug.classList.remove('hidden');
      if (!added) showTableError('No times found in ' + (files.length === 1 ? 'that image' : 'those images') + '. Try a sharper screenshot, or type the times in manually.');
    }).catch(function (err) {
      hideOcr();
      showTableError('Could not read the screenshot: ' + (err && err.message ? err.message : err));
    }).then(function () { busy = false; els.btnScreenshot.disabled = false; });
  }
  function showTableError(msg) { els.tableError.textContent = msg; els.tableError.classList.remove('hidden'); }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not open ' + file.name)); };
      img.src = url;
    });
  }

  /* ---- Kingshot chat: find the cream speech bubbles and OCR each one ---- */

  // Cream bubbles on the beige chat background. Returns [{x0,y0,x1,y1,w,h}] top to bottom.
  function findBubbles(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var step = Math.max(1, Math.round(w / 400));            // ~400px-wide grid is plenty
    var gw = Math.floor(w / step), gh = Math.floor(h / step);
    var c = document.createElement('canvas'); c.width = gw; c.height = gh;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, gw, gh);
    var px = ctx.getImageData(0, 0, gw, gh).data;
    var mask = new Uint8Array(gw * gh);
    for (var p = 0; p < gw * gh; p++) {
      var r = px[p * 4], g = px[p * 4 + 1], b = px[p * 4 + 2];
      var mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      mask[p] = (mn > 224 && r > 240 && mx - mn < 40) ? 1 : 0;
    }
    var label = new Int32Array(gw * gh); for (var i = 0; i < label.length; i++) label[i] = -1;
    var comps = [], stack = [];
    for (var q = 0; q < gw * gh; q++) {
      if (!mask[q] || label[q] >= 0) continue;
      var id = comps.length, comp = { x0: gw, y0: gh, x1: 0, y1: 0, area: 0 };
      comps.push(comp); stack.push(q); label[q] = id;
      while (stack.length) {
        var cur = stack.pop(), x = cur % gw, y = (cur / gw) | 0;
        comp.area++;
        if (x < comp.x0) comp.x0 = x; if (x > comp.x1) comp.x1 = x;
        if (y < comp.y0) comp.y0 = y; if (y > comp.y1) comp.y1 = y;
        var nb = [cur + 1, cur - 1, cur + gw, cur - gw];
        for (var k = 0; k < 4; k++) {
          var n = nb[k];
          if (n < 0 || n >= gw * gh) continue;
          if ((k === 0 && x === gw - 1) || (k === 1 && x === 0)) continue;
          if (mask[n] && label[n] < 0) { label[n] = id; stack.push(n); }
        }
      }
    }
    return comps.map(function (cc) {
      var o = { x0: cc.x0 * step, y0: cc.y0 * step, x1: (cc.x1 + 1) * step, y1: (cc.y1 + 1) * step, area: cc.area * step * step };
      o.w = o.x1 - o.x0; o.h = o.y1 - o.y0; return o;
    }).filter(function (o) {
      var ar = o.w / o.h, fill = o.area / (o.w * o.h);
      return o.w >= w * 0.08 && o.h >= w * 0.035 && ar >= 1 && ar <= 10 && fill >= 0.75;
    }).sort(function (a, b) { return a.y0 - b.y0; });
  }

  // Greyscale crop of the image, upscaled by `scale`, with a contrast boost.
  function cropGrey(img, x0, y0, x1, y1, scale, contrast) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(img.naturalWidth, Math.round(x1)); y1 = Math.min(img.naturalHeight, Math.round(y1));
    var cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
    var c = document.createElement('canvas');
    c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x0, y0, cw, ch, 0, 0, c.width, c.height);
    var d = ctx.getImageData(0, 0, c.width, c.height), px = d.data;
    for (var i = 0; i < px.length; i += 4) {
      var v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      v = (v - 128) * contrast + 128;
      px[i] = px[i + 1] = px[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v; px[i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  function readBubbles(w, img, bubbles) {
    var W = img.naturalWidth;
    var lines = [], debug = ['Found ' + bubbles.length + ' chat bubble' + (bubbles.length === 1 ? '' : 's')];
    return withPsm(w, 7).then(function () {
      return bubbles.reduce(function (p, b, i) {
        return p.then(function () {
          setOcr('Reading bubble ' + (i + 1) + ' of ' + bubbles.length + '…', (i + 1) / bubbles.length);
          var side = (b.x0 + b.x1) / 2 > W * 0.55 ? 'right' : 'left';
          var inset = b.h * 0.12;
          var text = w.recognize(cropGrey(img, b.x0 + inset, b.y0 + inset, b.x1 - inset, b.y1 - inset, Math.max(1, 90 / b.h), 1.3));
          var name = side === 'left'
            ? w.recognize(cropGrey(img, b.x0, b.y0 - W * 0.06, b.x0 + W * 0.45, b.y0 - W * 0.018, 2.5, 1.6))
            : Promise.resolve(null);
          return Promise.all([text, name]).then(function (r) {
            var t = r[0].data.text.trim();
            if (r[1]) {
              var n = r[1].data.text.trim();
              debug.push('  name    ' + Math.round(r[1].data.confidence) + '%  ' + n + '  → ' + cleanName(n));
              if (n) lines.push({ text: n, side: 'left', conf: 100 });
            }
            debug.push('  [' + side + ']  ' + Math.round(r[0].data.confidence) + '%  ' + t);
            if (t) lines.push({ text: t, side: side, conf: 100 });
          });
        });
      }, Promise.resolve());
    }).then(function () { return { lines: lines, debug: debug }; });
  }

  // Fallback for screenshots that aren't Kingshot chat: OCR the whole image
  // in "sparse text" mode and keep only confident lines.
  function readWholeImage(w, img) {
    var scale = Math.min(3, Math.max(1, 1800 / img.naturalWidth));
    var canvas = cropGrey(img, 0, 0, img.naturalWidth, img.naturalHeight, scale, 1.4);
    return withPsm(w, 11).then(function () { return w.recognize(canvas); }).then(function (res) {
      var all = ocrLines(res.data, true);
      var debug = ['No chat bubbles found, read the whole image'].concat(all.map(function (l) {
        return (l.conf < MIN_LINE_CONF ? '  (dropped) ' : l.side === 'right' ? '  [right]   ' : '  [left]    ') + Math.round(l.conf) + '%  ' + l.text.trim();
      }));
      return { lines: all.filter(function (l) { return l.conf >= MIN_LINE_CONF; }), debug: debug };
    });
  }

  var MIN_LINE_CONF = 60;  // below this it's avatar / icon noise, not text
  var MIN_NAME_CONF = 70;  // a line must be this clean to be used as a name
  function ocrLines(data, keepAll) {
    var width = 0, lines = [];
    (data.blocks || []).forEach(function (b) {
      width = Math.max(width, b.bbox.x1);
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          lines.push({ text: l.text, x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, conf: l.confidence });
        });
      });
    });
    if (!lines.length) return String(data.text || '').split(/\r?\n/).map(function (t) { return { text: t, side: 'left', conf: 100 }; });
    lines.sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
    return lines.filter(function (l) { return keepAll || l.conf >= MIN_LINE_CONF; }).map(function (l) {
      var mid = (l.x0 + l.x1) / 2;
      return { text: l.text, conf: l.conf, side: width && mid > width * 0.55 && l.x0 > width * 0.3 ? 'right' : 'left' };
    });
  }

  // Pull "name + time" pairs out of OCR lines. Handles 00:04:32 / 4:32 / 52 :43 /
  // 4m 32s / 1min / 1 min 30 / 90s, a bare number on its own line (= minutes), and
  // the usual OCR slips (O for 0, l/I for 1, ; or . for :).
  var TIME_RE = /(?:^|[^\d:])((?:[0-9OoIl]{1,2}\s?[:;.]\s?)?[0-9OoIl]{1,2}\s?[:;.]\s?[0-9OoIl]{2}|\d{1,2}\s*h(?:ours?|rs?)?\s*(?:\d{1,2}\s*m(?:in(?:ute)?s?)?)?\s*(?:\d{1,2}\s*s(?:ec(?:ond)?s?)?)?|\d{1,2}\s*m(?:in(?:ute)?s?)?(?:\s*(?:and\s*)?\d{1,2}\s*s?(?:ec(?:ond)?s?)?)?|\d{1,3}\s*s(?:ec(?:ond)?s?)?)(?![\d:a-z])/gi;
  var BARE_NUMBER_RE = /^\s*(\d{1,2})(?:[.,](\d))?\s*$/;
  function fixDigits(s) { return s.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/[;.]/g, ':').replace(/\s*:\s*/g, ':'); }

  // "4m32s", "1min", "1 min 30", "90s", "1h 5m" -> seconds
  function parseLoose(raw) {
    var t = raw.toLowerCase().replace(/\s+/g, '');
    if (/^[\d:]+$/.test(t)) return parseDuration(t);
    var m = t.match(/^(?:(\d{1,2})h(?:ours?|rs?)?)?(?:(\d{1,2})m(?:in(?:ute)?s?)?)?(?:and)?(?:(\d{1,3})s?(?:ec(?:ond)?s?)?)?$/);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  }

  function extractTimes(rawLines) {
    var parsed = rawLines.map(function (l) {
      var line = String(l.text || '').replace(/\s+/g, ' ').trim();
      return { line: line, side: l.side || 'left', conf: l.conf === undefined ? 100 : l.conf, times: [] };
    }).filter(function (p) { return p.line; });

    parsed.forEach(function (p) {
      var line = p.line;
      if (/\bhits?\s+at\b/i.test(line)) return; // "I should hit at 34:00" is a target, not a march
      var matches = [], m;
      TIME_RE.lastIndex = 0;
      while ((m = TIME_RE.exec(line)) !== null) {
        var idx = m.index + m[0].length - m[1].length;
        matches.push({ raw: m[1], index: idx, end: idx + m[1].length });
      }
      p.times = matches.map(function (x) {
        var secs = parseLoose(fixDigits(x.raw));
        return { raw: x.raw, index: x.index, end: x.end, secs: secs };
      }).filter(function (x) { return x.secs !== null && x.secs > 0 && x.secs < 6 * 3600; });
      // A bubble that is just "1" or "1.5" means minutes.
      var bare = line.match(BARE_NUMBER_RE);
      if (!p.times.length && bare) {
        var secs = (+bare[1]) * 60 + (bare[2] ? Math.round((+bare[2]) * 6) : 0);
        if (secs > 0) p.times.push({ raw: line, index: 0, end: line.length, secs: secs });
      }
    });

    var out = [];
    var pendingName = '';
    parsed.forEach(function (p, i) {
      var line = p.line, times = p.times;
      if (!times.length) {
        if (p.side === 'left' && p.conf >= MIN_NAME_CONF && /\p{L}{2,}/u.test(line)) pendingName = cleanName(line);
        return;
      }
      // Chat header line: "Name        21:16" — a name followed by a clock stamp at the
      // very end, with the actual message (holding a time) on one of the next lines.
      var last = times[times.length - 1];
      var head = cleanName(line.slice(0, last.index));
      var trailing = line.slice(last.end).trim() === '';
      var next = parsed[i + 1], next2 = parsed[i + 2];
      var msgFollows = (next && next.times.length) || (next && !next.times.length && next2 && next2.times.length);
      if (times.length === 1 && trailing && head.length >= 2 && msgFollows && /^\d{1,2}:\d{2}$/.test(fixDigits(last.raw))) {
        pendingName = head;
        return;
      }
      times.forEach(function (v, k) {
        var before = cleanName(line.slice(k === 0 ? 0 : times[k - 1].end, v.index));
        var name;
        if (p.side === 'right') name = 'You';                     // own bubble
        else if (pendingName && before.split(' ').length > 1) name = pendingName; // "this is mine 1:00" under a name line
        else name = before.length >= 2 ? before : pendingName;   // "Alice 4:32" list style
        out.push({ name: name, time: canonicalDuration(v.secs) });
      });
      pendingName = '';
    });
    return out;
  }
  var FILLER_RE = /\b(?:my|is|are|it|its|the|a|i|im|to|at|in|on|of|for|and|march|marching|time|times|rally|target|castle|mins?|minutes?|secs?|seconds?|s|m|h|hit|hits|go|ok|here|should|about|takes?|need|needs|this|that|mine|me|yours|you|one|have|got|be|will|would|can|from|with|so|now|tonight|ready)\b/gi;
  function cleanName(s) {
    return s.replace(/^\s*V[Il1]P\S*\s*/i, ' ')        // "VIP8" rank badge (often misread as VIPS / V1P8)
            .replace(/\bVIP\s?\d+\b/gi, ' ')
            .replace(/[\[({][A-Za-z0-9]{2,5}[\])}JIl1|]/g, ' ') // "[AWU]" alliance tag, closing bracket may be misread
            .replace(/\[[^\]]{1,6}\]|\([^)]{1,6}\)/g, ' ')
            .replace(/[^\p{L}\p{N} _\-'.]/gu, ' ').replace(FILLER_RE, ' ')
            .replace(/\s+/g, ' ').trim()
            .replace(/(?:\s+[\d:;.]+)+$/, '') // stray clock-stamp fragments after the name
            .trim().slice(0, 24);
  }
  function canonicalDuration(secs) {
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h ? pad(h) + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  /* ---------- boot ---------- */
  renderControls();
  renderRows();
  tick();
})();
