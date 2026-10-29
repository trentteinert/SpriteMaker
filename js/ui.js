(function (G) {
  'use strict';
  const SM = G.SM;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ed = (G.editor = new SM.Editor({
    viewport: $('#viewport'), stage: $('#stage'), onion: $('#c-onion'), comp: $('#c-comp'), pre: $('#c-pre'), ui: $('#c-ui'),
  }));

  let toastTimer;
  function msg(t) {
    $('#st-msg').textContent = t;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#st-msg').textContent = ''; }, 3500);
  }

  // ---------------------------------------------------------------- dialogs
  function form(title, fields, okLabel) {
    return new Promise((resolve) => {
      const modal = $('#modal');
      modal.innerHTML = ''; modal.hidden = false;
      const dlg = el('div', 'dlg'), body = el('div', 'body'), inputs = {};
      dlg.appendChild(el('h2', '', esc(title)));
      for (const f of fields) {
        if (f.type === 'info') { body.appendChild(el('p', '', f.text)); continue; }
        const lab = el('label', 'k', esc(f.label));
        body.appendChild(lab);
        let inp;
        if (f.type === 'select') {
          inp = el('select');
          for (const [v, t] of f.options) { const o = el('option', '', esc(t)); o.value = v; inp.appendChild(o); }
          inp.value = f.value;
        } else if (f.type === 'check') {
          inp = el('input'); inp.type = 'checkbox'; inp.checked = !!f.value; inp.style.justifySelf = 'start';
        } else if (f.type === 'anchor') {
          inp = el('div', 'anchor'); inp.value = f.value || [0.5, 0.5];
          for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
            const b = el('button', '', ''); b.type = 'button';
            b.onclick = () => { inp.value = [i / 2, j / 2]; [...inp.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
            if (inp.value[0] === i / 2 && inp.value[1] === j / 2) b.classList.add('on');
            inp.appendChild(b);
          }
        } else {
          inp = el('input'); inp.type = f.type === 'number' ? 'number' : 'text'; inp.value = f.value;
          if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; if (f.step !== undefined) inp.step = f.step;
        }
        inputs[f.key] = { inp, f };
        body.appendChild(inp);
      }
      dlg.appendChild(body);
      const foot = el('div', 'foot'), cancel = el('button', '', 'Cancel'), ok = el('button', 'ok', esc(okLabel || 'OK'));
      foot.append(cancel, ok); dlg.appendChild(foot); modal.appendChild(dlg);

      const close = (v) => { modal.hidden = true; modal.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const read = () => {
        const out = {};
        for (const k in inputs) {
          const { inp, f } = inputs[k];
          out[k] = f.type === 'number' ? (parseFloat(inp.value) || 0) : f.type === 'check' ? inp.checked : inp.value;
          if (f.type === 'number') out[k] = SM.clamp(out[k], f.min !== undefined ? f.min : -1e9, f.max !== undefined ? f.max : 1e9);
        }
        return out;
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); close(read()); }
        e.stopPropagation();
      };
      document.addEventListener('keydown', onKey, true);
      cancel.onclick = () => close(null);
      ok.onclick = () => close(read());
      modal.onmousedown = (e) => { if (e.target === modal) close(null); };
      const first = body.querySelector('input,select'); if (first) first.focus();
    });
  }
  const PIVOTS = [['doc', 'Pivot point (magenta marker)'], ['center', 'Canvas center'], ['selection', 'Selection center']];
  const METHODS = [['rotsprite', 'RotSprite (smooth, crisp)'], ['nearest', 'Nearest neighbour (fast)']];

  // ---------------------------------------------------------------- toolbar
  const ICONS = {
    pencil: '<path d="M3 21l1-5L16 4l4 4L8 20z M14 6l4 4"/>',
    eraser: '<path d="M4 15l9-10 7 6-6 8H9z M8 19h12"/>',
    line: '<path d="M4 20L20 4"/>',
    rect: '<rect x="4" y="6" width="16" height="12"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    fill: '<path d="M5 11l6-6 8 8-6 6z M19 15c1.5 2 1.5 3 0 4"/>',
    picker: '<path d="M14 4l6 6-3 3-6-6z M11 9l-7 7v4h4l7-7"/>',
    select: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>',
    pivot: '<circle cx="12" cy="12" r="5"/><path d="M12 3v18M3 12h18"/>',
    hand: '<path d="M8 12V6a1.5 1.5 0 013 0v5m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14c0 4-2 7-6 7s-5-2-7-5l-1-2a1.5 1.5 0 012-2l2 2"/>',
  };
  const TOOLS = [
    ['pencil', 'Pencil', 'B'], ['eraser', 'Eraser', 'E'], ['line', 'Line', 'L'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'],
    ['fill', 'Fill', 'G'], ['picker', 'Eyedropper (or Alt+click)', 'I'], ['select', 'Select / move', 'M'],
    ['pivot', 'Set rotation pivot', 'P'], ['hand', 'Pan (or hold Space)', 'H'],
  ];
  const tb = $('#toolbar');
  for (const [id, name, key] of TOOLS) {
    const b = el('button', '', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[id]}</svg><kbd>${key}</kbd>`);
    b.title = `${name} (${key})`; b.dataset.tool = id;
    b.onclick = () => ed.setTool(id);
    tb.appendChild(b);
  }
  ed.on('tool', () => {
    tb.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === ed.tool));
    $('#viewport').classList.toggle('pan', ed.tool === 'hand');
    $('#viewport').classList.toggle('cross', ed.tool !== 'hand');
  });

  // ---------------------------------------------------------------- options bar
  const bindOpt = (id, evt, fn) => $(id).addEventListener(evt, () => { fn($(id)); ed.requestDraw(); });
  bindOpt('#o-size', 'input', (e) => { ed.size = SM.clamp(parseInt(e.value) || 1, 1, 32); });
  bindOpt('#o-shape', 'change', (e) => { ed.shape = e.value; });
  bindOpt('#o-fill', 'change', (e) => { ed.fill = e.checked; });
  bindOpt('#o-symx', 'change', (e) => { ed.symX = e.checked; });
  bindOpt('#o-symy', 'change', (e) => { ed.symY = e.checked; });
  bindOpt('#o-grid', 'change', (e) => { ed.grid = e.checked; });
  bindOpt('#o-onion', 'change', (e) => { ed.onion.on = e.checked; });
  bindOpt('#o-onion-n', 'input', (e) => { ed.onion.prev = ed.onion.next = SM.clamp(parseInt(e.value) || 1, 1, 4); });
  $('#b-zoomin').onclick = () => ed.zoomBy(1);
  $('#b-zoomout').onclick = () => ed.zoomBy(-1);
  $('#b-fit').onclick = () => ed.fit();
  ed.on('view', () => { $('#zoomlabel').textContent = ed.view.zoom * 100 + '%'; });
  const syncChecks = () => {
    $('#o-onion').checked = ed.onion.on; $('#o-grid').checked = ed.grid;
  };

  // ---------------------------------------------------------------- colors & palette
  const hex = (c) => SM.rgbaToHex(c);
  function renderColors() {
    $('#p-fg').value = hex(ed.fg); $('#p-bg').value = hex(ed.bg);
    $('#p-hex').value = hex(ed.fg);
    $('#palette').querySelectorAll('.pc').forEach((p) => p.classList.toggle('sel', p.dataset.c === hex(ed.fg)));
  }
  function renderPalette() {
    const pal = $('#palette'); pal.innerHTML = '';
    ed.doc.palette.forEach((c, i) => {
      const d = el('div', 'pc'); d.style.background = c; d.dataset.c = c; d.dataset.i = i; d.title = c + ' — click: foreground, right-click: background, Ctrl+click: remove';
      pal.appendChild(d);
    });
    renderColors();
  }
  $('#palette').addEventListener('click', (e) => {
    const c = e.target.closest('.pc'); if (!c) return;
    if (e.ctrlKey || e.metaKey) { ed.doc.palette.splice(+c.dataset.i, 1); renderPalette(); return; }
    ed.setColor(SM.hexToRgba(c.dataset.c), 'fg');
  });
  $('#palette').addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.pc'); if (!c) return;
    e.preventDefault(); ed.setColor(SM.hexToRgba(c.dataset.c), 'bg');
  });
  $('#p-fg').addEventListener('input', (e) => ed.setColor(SM.hexToRgba(e.target.value), 'fg'));
  $('#p-bg').addEventListener('input', (e) => ed.setColor(SM.hexToRgba(e.target.value), 'bg'));
  $('#p-hex').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) ed.setColor(SM.hexToRgba(v.startsWith('#') ? v : '#' + v), 'fg'); else renderColors();
  });
  const swap = () => { const t = ed.fg; ed.fg = ed.bg; ed.bg = t; ed.emit('color'); };
  $('#p-swap').onclick = swap;
  $('#pal-add').onclick = () => { const h = hex(ed.fg); if (!ed.doc.palette.includes(h)) { ed.doc.palette.push(h); renderPalette(); } };
  $('#pal-preset').onchange = (e) => {
    const v = e.target.value; e.target.value = '';
    if (!v) return;
    ed.doc.palette = v === 'used' ? ed.doc.usedColors().slice(0, 256) : SM[v].slice();
    renderPalette();
  };
  ed.on('color', renderColors);

  // ---------------------------------------------------------------- tags
  async function tagDialog(i) {
    const d = ed.doc, t = i === undefined ? { name: 'tag', from: ed.frame, to: ed.frame } : d.tags[i], n = d.frames.length;
    const r = await form(i === undefined ? 'New tag' : 'Edit tag', [
      { key: 'name', label: 'Name', type: 'text', value: t.name },
      { key: 'from', label: 'From frame', type: 'number', value: t.from + 1, min: 1, max: n },
      { key: 'to', label: 'To frame', type: 'number', value: t.to + 1, min: 1, max: n },
      ...(i === undefined ? [] : [{ key: 'del', label: 'Delete this tag', type: 'check', value: false }]),
    ]);
    if (!r) return;
    ed.commit();
    if (r.del) { d.tags.splice(i, 1); if (ed.playTag === i) ed.playTag = -1; }
    else {
      const nt = { name: r.name || 'tag', from: Math.min(r.from, r.to) - 1, to: Math.max(r.from, r.to) - 1 };
      if (i === undefined) d.tags.push(nt); else d.tags[i] = nt;
    }
    ed.emit('structure');
  }
  $('#tag-add').onclick = () => tagDialog();
  function renderTags() {
    const box = $('#tags'); box.innerHTML = '';
    if (!ed.doc.tags.length) { box.appendChild(el('div', 'hint', 'Tags name frame ranges (idle, walk…). Click one to preview only that range.')); return; }
    ed.doc.tags.forEach((t, i) => {
      const row = el('div', 'tag' + (ed.playTag === i ? ' playing' : ''));
      const nm = el('span', 'nm', `${esc(t.name)} <small>${t.from + 1}–${t.to + 1}</small>`);
      nm.title = 'Click to preview just this tag';
      nm.onclick = () => { ed.playTag = ed.playTag === i ? -1 : i; ed.stop(); if (ed.playTag === i) ed.setFrame(t.from); renderTags(); renderTimelineBar(); };
      const b = el('button', '', '✎'); b.onclick = () => tagDialog(i);
      row.append(nm, b); box.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- preview
  function renderPreview() {
    const c = $('#c-preview'), d = ed.doc, z = parseInt($('#pv-zoom').value);
    if (c.width !== d.w || c.height !== d.h) { c.width = d.w; c.height = d.h; }
    c.style.width = d.w * z + 'px'; c.style.height = d.h * z + 'px';
    c.getContext('2d').putImageData(new ImageData(d.composite(ed.frame), d.w, d.h), 0, 0);
  }
  $('#pv-zoom').onchange = renderPreview;

  // ---------------------------------------------------------------- timeline
  function renderTimelineBar() {
    const bar = $('#tl-bar');
    if (!bar.firstChild) {
      const grp = () => { const g = el('div', 'grp'); bar.appendChild(g); return g; };
      const btn = (g, txt, title, fn, id) => { const b = el('button', '', txt); b.title = title; b.onclick = fn; if (id) b.id = id; g.appendChild(b); return b; };
      let g = grp();
      btn(g, '⏮', 'First frame', () => { ed.stop(); ed.setFrame(0); });
      btn(g, '◀', 'Previous frame (,)', () => { ed.stop(); ed.setFrame(ed.frame - 1); });
      btn(g, '▶', 'Play / pause (Enter)', () => ed.toggle(), 'b-play');
      btn(g, '▶|', 'Next frame (.)', () => { ed.stop(); ed.setFrame(ed.frame + 1); });
      btn(g, '⏭', 'Last frame', () => { ed.stop(); ed.setFrame(ed.doc.frames.length - 1); });
      const mode = el('select', '', '<option value="forward">Loop</option><option value="pingpong">Ping-pong</option><option value="once">Once</option>');
      mode.id = 't-mode'; mode.onchange = () => { ed.playMode = mode.value; }; g.appendChild(mode);
      g = grp();
      btn(g, '+ Frame', 'New blank frame after current (Alt+N)', () => frameOp('new'));
      btn(g, 'Dup', 'Duplicate frame', () => frameOp('dup'));
      btn(g, 'Del', 'Delete frame', () => frameOp('del'));
      btn(g, '◀', 'Move frame left', () => frameOp('left'));
      btn(g, '▶', 'Move frame right', () => frameOp('right'));
      const l = el('label', '', 'ms <input id="t-dur" type="number" min="10" max="5000" step="10" value="100">'); g.appendChild(l);
      l.querySelector('input').onchange = (e) => { ed.commit(); ed.doc.frames[ed.frame].duration = SM.clamp(parseInt(e.target.value) || 100, 10, 5000); };
      g = grp();
      btn(g, '+ Layer', 'New layer', () => layerOp('new'));
      btn(g, 'Dup', 'Duplicate layer', () => layerOp('dup'));
      btn(g, 'Del', 'Delete layer', () => layerOp('del'));
      btn(g, '▲', 'Move layer up', () => layerOp('up'));
      btn(g, '▼', 'Move layer down', () => layerOp('down'));
      const o = el('label', '', 'Opacity <input id="t-op" type="range" min="0" max="255" value="255">'); g.appendChild(o);
      o.querySelector('input').oninput = (e) => { ed.doc.layers[ed.layer].opacity = +e.target.value; ed.touch(); };
      o.querySelector('input').onpointerdown = () => ed.commit();
      g = grp();
      g.style.borderRight = '0';
      const b9 = btn(g, '★ Animate', 'Animation starter: walk, run, jump, attack… from your idle sprite', () => dlgStarter());
      b9.style.cssText = 'border-color: var(--accent); color: var(--accent); font-weight: 600';
      const b0 = btn(g, '⟲ Side turn', 'Spin a side/front-view sprite in 3D', () => dlgTurn());
      const b1 = btn(g, '⟳ Top-down', 'In-plane rotation frames (top-down sprites)', () => dlgTurntable());
      const b2 = btn(g, '≣ Stack', 'Top-down stacked slices rotating', () => dlgStack());
      const b3 = btn(g, '⤳ Tween', 'Tween the selection/layer over several frames', () => dlgTween());
      [b0, b1, b2, b3].forEach((b) => { b.style.borderColor = 'var(--accent2)'; });
    }
    $('#b-play').textContent = ed.playing ? '⏸' : '▶';
    $('#b-play').classList.toggle('on', ed.playing);
    $('#t-mode').value = ed.playMode;
    $('#t-dur').value = ed.doc.frames[ed.frame].duration;
    $('#t-op').value = ed.doc.layers[ed.layer].opacity;
  }

  function frameOp(op) {
    const d = ed.doc, f = ed.frame;
    ed.stop(); ed.commit();
    if (op === 'new') { d.addFrame(f + 1, null, d.frames[f].duration); ed.frame = f + 1; }
    else if (op === 'dup') { d.addFrame(f + 1, f); ed.frame = f + 1; }
    else if (op === 'del') { if (!d.removeFrame(f)) { msg('A sprite needs at least one frame'); return; } }
    else if (op === 'left') ed.frame = d.moveFrame(f, -1);
    else if (op === 'right') ed.frame = d.moveFrame(f, 1);
    ed.clampPos(); ed.emit('structure'); ed.touch();
  }
  function layerOp(op) {
    const d = ed.doc, l = ed.layer;
    ed.commit();
    if (op === 'new') ed.layer = d.addLayer(null, l + 1);
    else if (op === 'dup') { ed.layer = d.addLayer(d.layers[l].name + ' copy', l + 1, l); d.layers[ed.layer].opacity = d.layers[l].opacity; }
    else if (op === 'del') { if (!d.removeLayer(l)) { msg('A sprite needs at least one layer'); return; } }
    else if (op === 'up') ed.layer = d.moveLayer(l, 1);
    else if (op === 'down') ed.layer = d.moveLayer(l, -1);
    ed.clampPos(); ed.emit('structure'); ed.touch();
  }

  let dragLayer = -1;
  function clearDropMarks() { document.querySelectorAll('.drop-above,.drop-below').forEach((e) => e.classList.remove('drop-above', 'drop-below')); }
  // `pos` is the insertion slot among the current layers (0 = below the bottom layer, n = above the top one).
  function moveLayerTo(from, pos) {
    const d = ed.doc, to = from < pos ? pos - 1 : pos;
    if (to === from) return;
    const active = d.layers[ed.layer];
    ed.commit();
    d.reorderLayer(from, to);
    ed.layer = d.layers.indexOf(active);
    ed.emit('structure'); ed.touch();
  }

  function renderTimeline() {
    const g = $('#tl-grid'), d = ed.doc, nf = d.frames.length, nl = d.layers.length;
    g.innerHTML = '';
    g.style.gridTemplateColumns = `170px repeat(${nf}, 28px)`;
    const put = (e, row, col, span) => { e.style.gridRow = row; e.style.gridColumn = span ? `${col} / span ${span}` : col; g.appendChild(e); return e; };
    put(el('div', 'tl-corner'), 1, 1); put(el('div', 'tl-corner'), 2, 1);
    d.tags.forEach((t) => {
      const e = put(el('div', 'tl-tag', esc(t.name)), 1, t.from + 2, t.to - t.from + 1);
      e.title = `${t.name}: frames ${t.from + 1}–${t.to + 1}`;
    });
    for (let f = 0; f < nf; f++) {
      const h = put(el('div', 'tl-fh' + (f === ed.frame ? ' cur' : ''), String(f + 1)), 2, f + 2);
      h.onclick = () => { ed.stop(); ed.setFrame(f); };
    }
    for (let l = nl - 1; l >= 0; l--) {
      const row = 3 + (nl - 1 - l), L = d.layers[l];
      const n = put(el('div', 'tl-lname' + (l === ed.layer ? ' sel' : '')), row, 1);
      const eye = el('span', 'eye' + (L.visible ? '' : ' off'), L.visible ? '👁' : '◌'); eye.title = 'Show / hide layer';
      eye.onclick = (e) => { e.stopPropagation(); ed.commit(); L.visible = !L.visible; ed.emit('structure'); ed.touch(); };
      const nm = el('span', 'nm', esc(L.name) + (L.role ? ` <small style="color:var(--dim)">· ${L.role}</small>` : '')); nm.title = 'Double-click to rename';
      n.append(eye, nm);
      n.onclick = () => ed.setLayer(l);
      n.draggable = true;
      n.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(l)); e.dataTransfer.effectAllowed = 'move'; dragLayer = l; n.style.opacity = '.5'; };
      n.ondragend = () => { dragLayer = -1; clearDropMarks(); n.style.opacity = ''; };
      n.ondragover = (e) => {
        if (dragLayer < 0) return;
        e.preventDefault();
        const above = e.offsetY < n.clientHeight / 2;
        clearDropMarks(); n.classList.add(above ? 'drop-above' : 'drop-below');
      };
      n.ondragleave = () => n.classList.remove('drop-above', 'drop-below');
      n.ondrop = (e) => {
        e.preventDefault();
        const above = e.offsetY < n.clientHeight / 2, from = dragLayer;
        dragLayer = -1; clearDropMarks();
        if (from < 0) return;
        moveLayerTo(from, above ? l + 1 : l); // rows are drawn top layer first
      };
      n.ondblclick = async () => {
        const r = await form('Layer', [{ key: 'name', label: 'Name', type: 'text', value: L.name }]);
        if (r) { ed.commit(); L.name = r.name || L.name; ed.emit('structure'); }
      };
      for (let f = 0; f < nf; f++) {
        const c = put(el('div', 'tl-cell' + (f === ed.frame ? ' curf' : '') + (f === ed.frame && l === ed.layer ? ' cur' : '')), row, f + 2);
        c.dataset.f = f; c.dataset.l = l;
        c.appendChild(el('i', SM.bounds(d.cel(f, l), d.w, d.h) ? '' : 'empty'));
        c.onclick = () => { ed.stop(); ed.frame = f; ed.layer = l; ed.emit('frame'); ed.requestDraw(); };
      }
    }
  }
  function refreshDots() {
    const d = ed.doc;
    document.querySelectorAll('#tl-grid .tl-cell').forEach((c) => {
      if (+c.dataset.f !== ed.frame) return;
      c.firstChild.className = SM.bounds(d.cel(ed.frame, +c.dataset.l), d.w, d.h) ? '' : 'empty';
    });
  }

  // ---------------------------------------------------------------- reactions to editor events
  let dotsQueued = false;
  function onPixels() {
    renderPreview();
    if (!dotsQueued) { dotsQueued = true; requestAnimationFrame(() => { dotsQueued = false; refreshDots(); }); }
    scheduleSave();
  }
  function status() {
    const c = ed.cursor, d = ed.doc;
    $('#st-pos').textContent = (c && ed.inside(c.x, c.y) ? `${c.x}, ${c.y}` : '—') + `   ·   ${d.w}×${d.h}px`;
    $('#docinfo').textContent = `Frame ${ed.frame + 1}/${d.frames.length} · Layer: ${d.layers[ed.layer].name}`;
  }
  ed.on('pixels', onPixels);
  ed.on('status', status);
  ed.on('frame', () => { renderTimeline(); renderTimelineBar(); renderPreview(); status(); });
  ed.on('structure', () => {
    renderTimeline(); renderTimelineBar(); renderPalette(); renderTags(); renderPreview(); status(); syncChecks();
    $('#zoomlabel').textContent = ed.view.zoom * 100 + '%';
    scheduleSave();
  });
  ed.on('play', () => { renderTimelineBar(); });

  // ---------------------------------------------------------------- autosave
  const SAVE_KEY = 'spritemaker.autosave';
  let saveTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(SM.serialize(ed.doc))); } catch (e) { /* storage full or blocked */ }
    }, 800);
  }

  // ---------------------------------------------------------------- dialogs for actions
  async function newDoc() {
    const r = await form('New sprite', [
      { key: 'w', label: 'Width (px)', type: 'number', value: 32, min: 1, max: 512 },
      { key: 'h', label: 'Height (px)', type: 'number', value: 32, min: 1, max: 512 },
    ], 'Create');
    if (!r) return;
    ed.setDoc(new SM.Doc(r.w, r.h));
    renderPalette();
  }
  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = $('#file-open'); inp.accept = accept; inp.value = '';
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
  }
  async function openProject() {
    const f = await pickFile('.json,application/json'); if (!f) return;
    try { ed.setDoc(SM.deserialize(JSON.parse(await SM.io.readFile(f, 'text')))); msg('Opened ' + f.name); }
    catch (e) { msg('Could not open: ' + e.message); }
  }
  const saveProject = () => { SM.io.saveProject(ed.doc, 'sprite'); msg('Project saved'); };

  async function importSheet() {
    const f = await pickFile('image/*'); if (!f) return;
    const img = await SM.io.readImage(f);
    const r = await form('Import image / sprite sheet', [
      { key: 'cols', label: 'Columns', type: 'number', value: 1, min: 1, max: 256 },
      { key: 'rows', label: 'Rows', type: 'number', value: 1, min: 1, max: 256 },
      { type: 'info', text: `Image is ${img.w}×${img.h}px. This replaces the current sprite; each cell becomes one frame.` },
    ], 'Import');
    if (!r) return;
    const tw = Math.floor(img.w / r.cols), th = Math.floor(img.h / r.rows);
    const d = new SM.Doc(tw, th);
    d.frames = [];
    for (let i = 0; i < r.cols * r.rows; i++) {
      const cel = SM.blank(tw, th), ox = (i % r.cols) * tw, oy = Math.floor(i / r.cols) * th;
      for (let y = 0; y < th; y++) cel.set(img.data.subarray(((oy + y) * img.w + ox) * 4, ((oy + y) * img.w + ox + tw) * 4), y * tw * 4);
      d.frames.push({ duration: 100, cels: [cel] });
    }
    d.palette = ed.doc.palette.slice();
    ed.setDoc(d);
  }
  async function importLayer() {
    const f = await pickFile('image/*'); if (!f) return;
    const img = await SM.io.readImage(f), d = ed.doc;
    ed.commit();
    const l = d.addLayer(f.name.replace(/\.[^.]+$/, ''), d.layers.length), cel = d.celW(ed.frame, l);
    for (let y = 0; y < Math.min(img.h, d.h); y++) cel.set(img.data.subarray(y * img.w * 4, (y * img.w + Math.min(img.w, d.w)) * 4), y * d.w * 4);
    ed.layer = l; ed.emit('structure'); ed.touch();
  }

  async function exportDlg() {
    const d = ed.doc;
    const r = await form('Export', [
      { key: 'fmt', label: 'Format', type: 'select', value: 'sheet', options: [['png', 'PNG — current frame'], ['sheet', 'PNG sprite sheet + JSON'], ['gif', 'Animated GIF']] },
      { key: 'scale', label: 'Scale', type: 'select', value: '1', options: [1, 2, 3, 4, 6, 8].map((n) => [n, n + 'x']) },
      { key: 'tag', label: 'Frames', type: 'select', value: -1, options: [[-1, 'All frames'], ...d.tags.map((t, i) => [i, `Tag: ${t.name} (${t.from + 1}–${t.to + 1})`])] },
      { type: 'info', text: 'Sprite sheet options:' },
      { key: 'layout', label: 'Layout', type: 'select', value: 'row', options: [['row', 'Horizontal strip'], ['column', 'Vertical strip'], ['grid', 'Grid']] },
      { key: 'cols', label: 'Grid columns', type: 'number', value: 4, min: 1, max: 64 },
      { key: 'pad', label: 'Padding (px)', type: 'number', value: 0, min: 0, max: 16 },
      { key: 'name', label: 'File name', type: 'text', value: 'sprite' },
    ], 'Export');
    if (!r) return;
    const o = { scale: +r.scale, tag: +r.tag, layout: r.layout, cols: r.cols, pad: r.pad, name: r.name || 'sprite' };
    if (r.fmt === 'png') SM.io.download(await SM.io.png(d, ed.frame, o.scale), o.name + '.png');
    else if (r.fmt === 'gif') SM.io.download(SM.io.gif(d, o), o.name + '.gif');
    else {
      const s = await SM.io.sheet(d, o);
      SM.io.download(s.blob, o.name + '.png');
      SM.io.download(new Blob([JSON.stringify(s.json, null, 2)], { type: 'application/json' }), o.name + '.json');
    }
    msg('Exported');
  }

  async function dlgCanvasSize() {
    const d = ed.doc;
    const r = await form('Canvas size', [
      { key: 'w', label: 'Width (px)', type: 'number', value: d.w, min: 1, max: 1024 },
      { key: 'h', label: 'Height (px)', type: 'number', value: d.h, min: 1, max: 1024 },
      { key: 'a', label: 'Anchor', type: 'anchor', value: [0.5, 0.5] },
    ], 'Resize');
    if (!r) return;
    ed.commit(); ed.doc.resize(r.w, r.h, r.a[0], r.a[1]); ed.sel = null; ed.fit(); ed.emit('structure'); ed.touch();
  }
  function cropContent() {
    const b = ed.doc.contentBounds();
    if (!b) { msg('Nothing to crop to'); return; }
    ed.commit();
    const d = ed.doc, px = d.pivot;
    const ox = b.x, oy = b.y;
    for (const fr of d.frames) fr.cels = fr.cels.map((c) => {
      const n = SM.blank(b.w, b.h);
      for (let y = 0; y < b.h; y++) n.set(c.subarray(((oy + y) * d.w + ox) * 4, ((oy + y) * d.w + ox + b.w) * 4), y * b.w * 4);
      d.owned.add(n); return n;
    });
    d.w = b.w; d.h = b.h; d.pivot = { x: SM.clamp(px.x - ox, 0, b.w - 1), y: SM.clamp(px.y - oy, 0, b.h - 1) };
    ed.sel = null; ed.fit(); ed.emit('structure'); ed.touch();
  }

  async function dlgRotate() {
    const r = await form('Rotate sprite', [
      { type: 'info', text: ed.sel ? 'Rotates the selected pixels.' : 'Rotates whole cels (no selection).' },
      { key: 'angle', label: 'Angle (° clockwise)', type: 'number', value: 15, min: -360, max: 360, step: 1 },
      { key: 'method', label: 'Method', type: 'select', value: 'rotsprite', options: METHODS },
      { key: 'pivot', label: 'Rotate around', type: 'select', value: ed.sel ? 'selection' : 'doc', options: PIVOTS },
      { key: 'scope', label: 'Apply to', type: 'select', value: 'cel', options: [['cel', 'Active layer, this frame'], ['frame', 'All layers, this frame'], ['all', 'All layers, all frames']] },
    ], 'Rotate');
    if (!r) return;
    ed.adopt(SM.gen.rotate(ed.ctx(), r));
  }

  async function dlgTurntable() {
    const r = await form('Top-down rotation frames', [
      { type: 'info', text: 'Rotates the picture <b>in the screen plane</b>, like a top-down ship or car turning. Not suitable for side-view characters (use Side-view turn for those). The current frame is the 0° pose and all layers are rotated; 360° gives a seamless spin.' },
      { key: 'count', label: 'Number of frames', type: 'select', value: 8, options: [4, 6, 8, 12, 16, 24, 32, 36].map((n) => [n, String(n)]) },
      { key: 'total', label: 'Total angle (°)', type: 'number', value: 360, min: 1, max: 360 },
      { key: 'direction', label: 'Direction', type: 'select', value: 'cw', options: [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']] },
      { key: 'method', label: 'Method', type: 'select', value: 'rotsprite', options: METHODS },
      { key: 'pivot', label: 'Rotate around', type: 'select', value: 'doc', options: PIVOTS },
      { key: 'tag', label: 'Add a tag', type: 'check', value: true },
    ], 'Generate');
    if (!r) return;
    ed.stop();
    r.count = +r.count; r.tagName = 'rotate';
    ed.adopt(SM.gen.turntable({ ...ed.ctx(), sel: null }, r));
    msg(`${r.count} rotation frames created`);
  }

  async function dlgStack() {
    const vis = ed.doc.layers.filter((l) => l.visible).length;
    const r = await form('Top-down stack rotation', [
      { type: 'info', text: `Draw your object as <b>top-down slices</b>: each visible layer (${vis} now) is a horizontal cross-section at one height, bottom layer = ground. This spins the stack around its vertical axis into a new “Stack” layer, one frame per angle. Add room above the object first (Sprite ▸ Canvas size).` },
      { key: 'count', label: 'Number of frames', type: 'select', value: 16, options: [8, 12, 16, 24, 32, 36].map((n) => [n, String(n)]) },
      { key: 'total', label: 'Total angle (°)', type: 'number', value: 360, min: 1, max: 360 },
      { key: 'direction', label: 'Direction', type: 'select', value: 'cw', options: [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']] },
      { key: 'spacing', label: 'Slice spacing (px)', type: 'number', value: 1, min: 0, max: 16, step: 0.5 },
      { key: 'squash', label: 'Camera (1 = top-down, lower = side-on)', type: 'number', value: 0.6, min: 0.2, max: 1, step: 0.05 },
      { key: 'hideSlices', label: 'Hide source slices', type: 'check', value: true },
      { key: 'tag', label: 'Add a tag', type: 'check', value: true },
    ], 'Generate');
    if (!r) return;
    ed.stop();
    r.count = +r.count; r.tagName = 'stack';
    const res = SM.gen.stackRotate(ed.ctx(), r);
    if (!res) { msg('No visible layers to stack'); return; }
    ed.adopt(res);
  }

  async function dlgTurn() {
    const vis = ed.doc.layers.filter((l) => l.visible).length;
    const r = await form('Side-view turn (3D)', [
      { type: 'info', text: `Spins a <b>side-view or front-view</b> sprite around its vertical axis. It gives the sprite depth, then renders it at each angle into a new “Turn” layer. With one layer it is inflated into a rounded shape; with several visible layers (${vis} now) each one is a depth slice: <b>bottom layer = farthest, top layer = nearest</b>, e.g. far arm / body / near arm. The pivot's X position is the turning axis.` },
      { key: 'count', label: 'Number of frames', type: 'select', value: 8, options: [4, 6, 8, 12, 16, 24, 32, 36].map((n) => [n, String(n)]) },
      { key: 'total', label: 'Total angle (°)', type: 'number', value: 360, min: 1, max: 360 },
      { key: 'direction', label: 'Front turns toward', type: 'select', value: 'right', options: [['right', 'Viewer’s right'], ['left', 'Viewer’s left']] },
      { key: 'shape', label: 'Depth shape', type: 'select', value: 'rounded', options: [['rounded', 'Rounded (inflated)'], ['flat', 'Flat slab (cut-out)']] },
      { key: 'thickness', label: 'Thickness (px)', type: 'number', value: Math.max(2, Math.round(ed.doc.w / 4)), min: 1, max: 128 },
      { key: 'spacing', label: 'Layer depth gap (px)', type: 'number', value: 2, min: 0, max: 64, step: 0.5 },
      { key: 'pivot', label: 'Turn around', type: 'select', value: 'doc', options: [['doc', 'Pivot point X'], ['center', 'Canvas center']] },
      { key: 'shade', label: 'Darken side faces', type: 'check', value: false },
      { key: 'hideSlices', label: 'Hide source layers', type: 'check', value: true },
      { key: 'tag', label: 'Add a tag', type: 'check', value: true },
    ], 'Generate');
    if (!r) return;
    ed.stop();
    r.count = +r.count; r.tagName = 'turn';
    const res = SM.gen.turn(ed.ctx(), r);
    if (!res) { msg('No visible layers to turn'); return; }
    ed.adopt(res);
  }

  // ---------------------------------------------------------------- animation starter
  async function dlgStarter() {
    const d = ed.doc, src = ed.frame, PRE = SM.anim.PRESETS;
    if (!d.frames[src].cels.some((c) => SM.bounds(c, d.w, d.h))) { msg('Draw your idle sprite on this frame first'); return; }
    ed.stop();
    const rig = SM.anim.rigFor(d, src);
    const st = { id: 'walk', count: PRE.walk.count, ms: PRE.walk.ms, dir: 1, strength: 100, method: 'rotsprite', flash: true };
    const modal = $('#modal');
    modal.innerHTML = ''; modal.hidden = false;
    const dlg = el('div', 'dlg wide');
    dlg.appendChild(el('h2', '', 'Animation starter — build an animation from your idle sprite'));
    const root = el('div', 'starter'), f = el('div', 'fields'), pv = el('div', 'pv');
    root.append(f, pv); dlg.appendChild(root);

    const add = (label, inp) => { f.appendChild(el('label', 'k', label)); f.appendChild(inp); return inp; };
    const sel = (opts, val) => { const x = el('select'); for (const [v, t] of opts) { const o = el('option', '', esc(t)); o.value = v; x.appendChild(o); } x.value = val; return x; };
    const num = (val, min, max, step) => { const x = el('input'); x.type = 'number'; x.value = val; x.min = min; x.max = max; if (step) x.step = step; return x; };

    const info = el('p', '', ''); f.appendChild(info);
    const preset = add('Animation', sel(Object.entries(PRE).map(([k, v]) => [k, v.name]), st.id));
    const count = add('Frames', num(st.count, 2, 24));
    const ms = add('Frame time (ms)', num(st.ms, 20, 1000, 10));
    const dir = add('Character faces', sel([[1, 'Right'], [-1, 'Left']], 1));
    const strength = add('Strength (%)', num(st.strength, 10, 250, 10));
    const method = add('Rotation method', sel(METHODS, st.method));
    const flashRow = el('input'); flashRow.type = 'checkbox'; flashRow.checked = true; flashRow.style.justifySelf = 'start';
    const flashLab = el('label', 'k', 'White flash on hit'); f.append(flashLab, flashRow);
    const warn = el('p', 'warn', ''); f.appendChild(warn);

    f.appendChild(el('h4', '', 'Body parts (one per layer) — each part rotates around its joint'));
    const table = el('table'); f.appendChild(table);
    for (let l = d.layers.length - 1; l >= 0; l--) {
      const tr = el('tr'), role = sel(SM.anim.ROLES, rig.roles[l]), jx = num(rig.joints[l].x, 0, d.w, 0.5), jy = num(rig.joints[l].y, 0, d.h, 0.5);
      role.onchange = () => { rig.roles[l] = role.value; refresh(); };
      jx.oninput = () => { rig.joints[l].x = parseFloat(jx.value) || 0; refresh(); };
      jy.oninput = () => { rig.joints[l].y = parseFloat(jy.value) || 0; refresh(); };
      for (const [x, label] of [[el('span', '', esc(d.layers[l].name)), ''], [role], [jx], [jy]]) { const td = el('td'); td.appendChild(x); tr.appendChild(td); }
      table.appendChild(tr);
    }
    f.appendChild(el('p', 'hint', 'Roles are guessed from the layer names. Joints are in canvas pixels (x, y). Tip: with the Pivot tool, Shift+click sets the active layer’s joint.'));

    pv.appendChild(el('div', 'hint', 'Rig (joints)'));
    const rigBox = el('div', 'pvbox'), rigCv = el('canvas'); rigBox.appendChild(rigCv); pv.appendChild(rigBox);
    pv.appendChild(el('div', 'hint', 'Live preview'));
    const pvBox = el('div', 'pvbox'), pvCv = el('canvas'); pvBox.appendChild(pvCv); pv.appendChild(pvBox);
    const foot = el('div', 'foot'), cancel = el('button', '', 'Cancel'), ok = el('button', 'ok', 'Generate frames');
    foot.append(cancel, ok); dlg.appendChild(foot); modal.appendChild(dlg);

    const zoom = Math.max(1, Math.floor(250 / Math.max(d.w, d.h)));
    for (const c of [rigCv, pvCv]) { c.width = d.w; c.height = d.h; c.style.width = d.w * zoom + 'px'; c.style.height = d.h * zoom + 'px'; }
    const showImg = (cv, data) => cv.getContext('2d').putImageData(new ImageData(data, d.w, d.h), 0, 0);
    const COLORS = { head: '#ffd23b', armN: '#ff5c6c', armF: '#ff9aa5', legN: '#4fd1c5', legF: '#8be8de', weapon: '#c58bff' };

    let frames = [], fi = 0, timer = 0, buildTimer = 0, closed = false;
    const opts = () => ({ count: Math.round(+count.value) || 2, ms: +ms.value || 100, dir: +dir.value, strength: +strength.value, method: method.value, flash: flashRow.checked, rig });
    function drawRig() {
      showImg(rigCv, d.composite(src));
      const g = rigCv.getContext('2d');
      d.layers.forEach((_, l) => {
        const col = COLORS[rig.roles[l]]; if (!col) return;
        g.fillStyle = col; g.fillRect(Math.floor(rig.joints[l].x) - 0, Math.floor(rig.joints[l].y) - 0, 1, 1);
      });
    }
    function build() {
      const o = opts();
      frames = SM.anim.build(d, src, st.id, o, rig).map((fr) => ({ data: SM.anim.flatten(d, fr.cels), duration: fr.duration }));
      fi = 0;
    }
    function tick() {
      clearTimeout(timer);
      if (closed || !frames.length) return;
      showImg(pvCv, frames[fi % frames.length].data);
      timer = setTimeout(() => { fi++; tick(); }, Math.max(30, frames[fi % frames.length].duration));
    }
    function refresh() { drawRig(); clearTimeout(buildTimer); buildTimer = setTimeout(() => { build(); tick(); }, 120); }
    function applyPreset() {
      const p = PRE[st.id = preset.value];
      count.value = p.count; ms.value = p.ms;
      info.innerHTML = esc(p.info);
      const hasFlash = !!p.flash; flashRow.hidden = flashLab.hidden = !hasFlash;
      const limbs = rig.roles.some((r) => /^(arm|leg)/.test(r));
      warn.textContent = (limbs ? '' : 'Only one body part is set up, so the whole sprite moves as one piece. Use the Select tool and J (lift to new layer) to split off the head, arms and legs. ')
        + (/jump|death|attack/.test(st.id) ? 'Leave empty canvas around the sprite — movement is clipped at the edges (Sprite ▸ Canvas size).' : '');
      refresh();
    }
    preset.onchange = applyPreset;
    for (const x of [count, ms, dir, strength, method, flashRow]) { x.oninput = refresh; x.onchange = refresh; }
    applyPreset();

    const result = await new Promise((resolve) => {
      const close = (v) => { closed = true; clearTimeout(timer); clearTimeout(buildTimer); modal.hidden = true; modal.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } e.stopPropagation(); };
      document.addEventListener('keydown', onKey, true);
      cancel.onclick = () => close(null);
      ok.onclick = () => close(opts());
      modal.onmousedown = (e) => { if (e.target === modal) close(null); };
    });
    if (!result) return;
    result.tagName = st.id;
    ed.adopt(SM.gen.animStarter(ed.ctx(), st.id, result));
    msg(`${PRE[st.id].name}: ${result.count} frames added — play them with Enter, then paint over the poses to clean them up`);
    if (!ed.onion.on) { ed.onion.on = true; syncChecks(); ed.requestDraw(); }
  }

  async function liftSelection() {
    if (!ed.sel) { msg('Select an area first (M), then press J to lift it onto its own layer'); return; }
    const r = await form('Lift selection to a new layer', [
      { type: 'info', text: 'Splits a body part (head, arm, leg…) off onto its own layer so the Animation starter can move it.' },
      { key: 'name', label: 'Part name', type: 'text', value: 'part' },
      { key: 'role', label: 'Role', type: 'select', value: '', options: [['', 'Guess from name'], ...SM.anim.ROLES] },
    ], 'Lift');
    if (!r) return;
    if (!ed.liftToLayer(r.name || 'part', r.role || undefined)) msg('Nothing to lift: the selection is empty on the active layer');
  }

  async function dlgTween() {
    const r = await form('Motion tween', [
      { type: 'info', text: ed.sel ? 'Animates the <b>selection</b> (e.g. an arm or a leg) over new frames.' : 'No selection: animates the whole <b>active layer</b> (e.g. a body bob). Make a selection first to animate just one part.' },
      { key: 'count', label: 'Total frames', type: 'number', value: 8, min: 2, max: 64 },
      { key: 'dx', label: 'Move X (px)', type: 'number', value: 0, min: -256, max: 256 },
      { key: 'dy', label: 'Move Y (px)', type: 'number', value: -2, min: -256, max: 256 },
      { key: 'angle', label: 'Rotate (°)', type: 'number', value: 0, min: -360, max: 360 },
      { key: 'ease', label: 'Easing', type: 'select', value: 'sine', options: [['linear', 'Linear'], ['sine', 'Smooth (sine)'], ['inOut', 'Ease in-out'], ['in', 'Ease in'], ['out', 'Ease out']] },
      { key: 'mode', label: 'Mode', type: 'select', value: 'loop', options: [['loop', 'Loop: there and back'], ['oneway', 'One way: ends on target']] },
      { key: 'pivot', label: 'Rotate around', type: 'select', value: ed.sel ? 'selection' : 'doc', options: PIVOTS },
      { key: 'method', label: 'Method', type: 'select', value: 'rotsprite', options: METHODS },
      { key: 'tag', label: 'Add a tag', type: 'check', value: false },
    ], 'Generate');
    if (!r) return;
    ed.stop();
    r.tagName = 'tween';
    ed.adopt(SM.gen.tween(ed.ctx(), r));
  }

  async function dlgDurations() {
    const r = await form('Frame duration', [
      { key: 'ms', label: 'All frames (ms)', type: 'number', value: ed.doc.frames[ed.frame].duration, min: 10, max: 5000, step: 10 },
    ]);
    if (!r) return;
    ed.commit(); ed.doc.frames.forEach((f) => { f.duration = r.ms; }); ed.emit('structure');
  }

  const act = (fn) => () => ed.adopt(fn());
  const SHORTCUTS = [
    ['Tools', 'B pencil · E eraser · L line · R rectangle · O ellipse · G fill · I eyedropper · M select · P pivot (Shift+click = layer joint) · H pan · J lift selection to a new layer'],
    ['Drawing', 'Left button = foreground, right button = background · Alt+click = eyedropper · Shift = straight / square · [ ] brush size'],
    ['View', 'Wheel = zoom · Space+drag or middle mouse = pan · + − zoom · 0 fit'],
    ['Edit', 'Ctrl+Z undo · Ctrl+Shift+Z / Ctrl+Y redo · Ctrl+C/X/V · Ctrl+A select all · Ctrl+D deselect · Delete clears · Arrows nudge selection (or layer)'],
    ['Animation', ', and . previous / next frame · Enter play / pause · Alt+N new frame · Ctrl+S save project · Ctrl+E export'],
  ];
  const MENUS = [
    ['File', [
      ['New…', newDoc], ['Open project…', openProject, 'Ctrl+O'], ['Save project', saveProject, 'Ctrl+S'], '-',
      ['Import image / sprite sheet…', importSheet], ['Import image as layer…', importLayer], '-', ['Export…', exportDlg, 'Ctrl+E'],
    ]],
    ['Edit', [
      ['Undo', () => ed.undo(), 'Ctrl+Z'], ['Redo', () => ed.redo(), 'Ctrl+Y'], '-',
      ['Cut', () => ed.cut(), 'Ctrl+X'], ['Copy', () => ed.copy(), 'Ctrl+C'], ['Paste', () => ed.paste(), 'Ctrl+V'], ['Clear', () => ed.clearSelection(), 'Del'], '-',
      ['Select all', () => ed.selectAll(), 'Ctrl+A'], ['Deselect', () => ed.deselect(), 'Ctrl+D'], '-',
      ['Lift selection to new layer…', liftSelection, 'J'],
    ]],
    ['Sprite', [
      ['Canvas size…', dlgCanvasSize], ['Crop to content', cropContent], '-',
      ['Rotate…', dlgRotate], ['Rotate 90° clockwise', act(() => SM.gen.rotate90(ed.ctx(), true))], ['Rotate 90° counter-clockwise', act(() => SM.gen.rotate90(ed.ctx(), false))], '-',
      ['Flip horizontal (this frame)', act(() => SM.gen.flip(ed.ctx(), true, false))], ['Flip vertical (this frame)', act(() => SM.gen.flip(ed.ctx(), false, false))],
      ['Flip horizontal (all frames)', act(() => SM.gen.flip(ed.ctx(), true, true))], ['Flip vertical (all frames)', act(() => SM.gen.flip(ed.ctx(), false, true))],
    ]],
    ['Animation', [
      ['New frame', () => frameOp('new'), 'Alt+N'], ['Duplicate frame', () => frameOp('dup')], ['Delete frame', () => frameOp('del')], '-',
      ['Reverse frames', act(() => SM.gen.reverse(ed.ctx()))], ['Add ping-pong frames', act(() => SM.gen.pingPong(ed.ctx()))], ['Set all frame durations…', dlgDurations], '-',
      ['New tag…', () => tagDialog()], ['Play / pause', () => ed.toggle(), 'Enter'],
    ]],
    ['Generate', [
      ['Animation starter (walk, run, jump, attack…)…', dlgStarter], '-',
      ['Side-view turn (3D, for side/front sprites)…', dlgTurn], ['Top-down rotation frames (in-plane)…', dlgTurntable], ['Top-down stack rotation (layers as height)…', dlgStack], '-', ['Motion tween (limb / bob)…', dlgTween],
    ]],
    ['View', [
      ['Zoom in', () => ed.zoomBy(1), '+'], ['Zoom out', () => ed.zoomBy(-1), '−'], ['Fit to window', () => ed.fit(), '0'], '-',
      ['Toggle grid', () => { ed.grid = !ed.grid; syncChecks(); ed.requestDraw(); }], ['Toggle onion skin', () => { ed.onion.on = !ed.onion.on; syncChecks(); ed.requestDraw(); }],
    ]],
    ['Help', [
      ['Keyboard shortcuts', () => form('Keyboard shortcuts', SHORTCUTS.flatMap(([k, v]) => [{ key: k, label: k, type: 'info', text: `<b>${k}</b> — ${v}` }]), 'Close')],
    ]],
  ];

  const menus = $('#menus');
  for (const [name, items] of MENUS) {
    const m = el('div', 'menu'), t = el('div', 'mt', name), dd = el('div', 'dd');
    for (const it of items) {
      if (it === '-') { dd.appendChild(el('hr')); continue; }
      const row = el('div', 'it', `<span>${esc(it[0])}</span><small>${it[2] || ''}</small>`);
      row.onclick = () => { closeMenus(); it[1](); };
      dd.appendChild(row);
    }
    t.onclick = () => { const was = m.classList.contains('open'); closeMenus(); if (!was) m.classList.add('open'); };
    m.onmouseenter = () => { if (menus.querySelector('.open') && !m.classList.contains('open')) { closeMenus(); m.classList.add('open'); } };
    m.append(t, dd); menus.appendChild(m);
  }
  function closeMenus() { menus.querySelectorAll('.open').forEach((m) => m.classList.remove('open')); }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

  // ---------------------------------------------------------------- keyboard
  const KEYS = { b: 'pencil', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', g: 'fill', i: 'picker', m: 'select', p: 'pivot', h: 'hand' };
  document.addEventListener('keydown', (e) => {
    if (!$('#modal').hidden) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range' && e.target.type !== 'color') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (k === ' ') { e.preventDefault(); if (!ed.spaceDown) { ed.spaceDown = true; $('#viewport').classList.add('pan'); } return; }
    if (ctrl) {
      const handled = { z: () => (e.shiftKey ? ed.redo() : ed.undo()), y: () => ed.redo(), c: () => ed.copy(), x: () => ed.cut(), v: () => ed.paste(),
        a: () => ed.selectAll(), d: () => ed.deselect(), s: saveProject, o: openProject, e: exportDlg }[k];
      if (handled) { e.preventDefault(); handled(); }
      return;
    }
    if (e.altKey) { if (k === 'n') { e.preventDefault(); frameOp('new'); } return; }
    if (k === 'j') { liftSelection(); return; }
    if (KEYS[k]) { ed.setTool(KEYS[k]); return; }
    switch (e.key) {
      case 'x': case 'X': swap(); break;
      case '[': $('#o-size').value = ed.size = Math.max(1, ed.size - 1); ed.requestDraw(); break;
      case ']': $('#o-size').value = ed.size = Math.min(32, ed.size + 1); ed.requestDraw(); break;
      case '+': case '=': ed.zoomBy(1); break;
      case '-': ed.zoomBy(-1); break;
      case '0': ed.fit(); break;
      case ',': ed.stop(); ed.setFrame(ed.frame - 1); break;
      case '.': ed.stop(); ed.setFrame(ed.frame + 1); break;
      case 'Enter': e.preventDefault(); ed.toggle(); break;
      case 'Escape': ed.deselect(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); ed.clearSelection(); break;
      case 'ArrowLeft': e.preventDefault(); ed.nudge(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); ed.nudge(1, 0); break;
      case 'ArrowUp': e.preventDefault(); ed.nudge(0, -1); break;
      case 'ArrowDown': e.preventDefault(); ed.nudge(0, 1); break;
      default:
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') { ed.spaceDown = false; $('#viewport').classList.toggle('pan', ed.tool === 'hand'); ed.requestDraw(); }
  });

  // ---------------------------------------------------------------- start
  ed.setFrame(0);
  ed.fg = SM.hexToRgba(SM.DB32[0]); ed.bg = SM.hexToRgba(SM.DB32[21]);
  let restored = false;
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) { ed.setDoc(SM.deserialize(JSON.parse(saved))); restored = true; }
  } catch (e) { /* ignore a corrupt autosave */ }
  ed.emit('structure'); ed.emit('tool'); ed.emit('color');
  ed.fit();
  if (restored) msg('Restored your last session');
  G.addEventListener('resize', () => ed.requestDraw());
})(globalThis);
