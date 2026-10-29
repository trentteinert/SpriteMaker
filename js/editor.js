(function (G) {
  'use strict';
  const SM = G.SM;
  const ZOOMS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

  class Editor {
    constructor(refs) {
      this.refs = refs; // { viewport, stage, onion, comp, pre, ui }
      this.listeners = {};
      this.tool = 'pencil';
      this.size = 1; this.shape = 'square'; this.fill = false;
      this.symX = false; this.symY = false; this.grid = true;
      this.onion = { on: false, prev: 1, next: 1 };
      this.fg = [0, 0, 0, 255]; this.bg = [255, 255, 255, 255];
      this.sel = null; this.clip = null;
      this.view = { zoom: 8, ox: 0, oy: 0 };
      this.cursor = null; this.drag = null; this.pan = null; this.spaceDown = false;
      this.previewMask = null; this.previewColor = null;
      this.playing = false; this.playMode = 'forward'; this.playTag = -1; this.playDir = 1; this.playTimer = null;
      this.dirty = false;
      this.tmp = document.createElement('canvas');
      this.setDoc(new SM.Doc(32, 32));
      this.bind();
    }

    on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
    emit(evt, a) { (this.listeners[evt] || []).forEach((f) => f(a)); }

    // ---- document ----
    setDoc(doc) {
      this.stop();
      this.doc = doc;
      this.hist = new SM.History(doc);
      this.frame = 0; this.layer = 0; this.sel = null;
      this.fit();
      this.emit('structure');
      this.touch();
    }
    ctx() { return { doc: this.doc, hist: this.hist, frame: this.frame, layer: this.layer, sel: this.sel }; }
    cel() { return this.doc.cel(this.frame, this.layer); }
    celW() { return this.doc.celW(this.frame, this.layer); }
    commit() { this.hist.commit(); }
    touch() { this.emit('pixels'); this.requestDraw(); }
    clampPos() {
      this.frame = SM.clamp(this.frame, 0, this.doc.frames.length - 1);
      this.layer = SM.clamp(this.layer, 0, this.doc.layers.length - 1);
      if (this.sel && (this.sel.x >= this.doc.w || this.sel.y >= this.doc.h)) this.sel = null;
    }
    // Adopts the { frame, layer, sel } a generator returned.
    adopt(r) {
      if (!r) return;
      this.frame = r.frame; this.layer = r.layer; this.sel = r.sel;
      this.clampPos();
      this.emit('structure'); this.touch();
    }
    undo() { if (this.hist.undo()) { this.clampPos(); this.emit('structure'); this.touch(); } }
    redo() { if (this.hist.redo()) { this.clampPos(); this.emit('structure'); this.touch(); } }
    setFrame(f) {
      f = SM.clamp(f, 0, this.doc.frames.length - 1);
      if (f === this.frame) return;
      this.frame = f; this.emit('frame'); this.requestDraw();
    }
    setLayer(l) {
      l = SM.clamp(l, 0, this.doc.layers.length - 1);
      if (l === this.layer) return;
      this.layer = l; this.emit('frame'); this.requestDraw();
    }
    setTool(t) {
      if (this.drag) return;
      this.tool = t; this.emit('tool'); this.requestDraw();
    }
    setColor(rgba, which) {
      if (which === 'bg') this.bg = rgba; else this.fg = rgba;
      this.emit('color');
    }
    colorFor(btn) { return btn === 2 ? this.bg : this.fg; }
    pivotPoint(mode) { return SM.gen.pivotPoint(this.ctx(), mode); }

    // ---- view ----
    fit() {
      const vp = this.refs.viewport, W = vp.clientWidth || 600, H = vp.clientHeight || 400;
      let z = 1;
      for (const c of ZOOMS) if (this.doc.w * c <= W * 0.85 && this.doc.h * c <= H * 0.85) z = c;
      this.view.zoom = z;
      this.view.ox = Math.round((W - this.doc.w * z) / 2);
      this.view.oy = Math.round((H - this.doc.h * z) / 2);
      this.emit('view'); this.requestDraw();
    }
    zoomBy(dir, cx, cy) {
      const vp = this.refs.viewport;
      if (cx === undefined) { cx = vp.clientWidth / 2; cy = vp.clientHeight / 2; }
      const v = this.view;
      let i = ZOOMS.indexOf(v.zoom);
      if (i < 0) i = ZOOMS.findIndex((z) => z >= v.zoom);
      const nz = ZOOMS[SM.clamp(i + dir, 0, ZOOMS.length - 1)];
      if (nz === v.zoom) return;
      const px = (cx - v.ox) / v.zoom, py = (cy - v.oy) / v.zoom;
      v.zoom = nz; v.ox = Math.round(cx - px * nz); v.oy = Math.round(cy - py * nz);
      this.emit('view'); this.requestDraw();
    }
    toPixel(e) {
      const r = this.refs.viewport.getBoundingClientRect(), v = this.view;
      return { x: Math.floor((e.clientX - r.left - v.ox) / v.zoom), y: Math.floor((e.clientY - r.top - v.oy) / v.zoom) };
    }
    inside(x, y) { return x >= 0 && y >= 0 && x < this.doc.w && y < this.doc.h; }

    // ---- brush / masks ----
    brushOffsets() {
      const s = this.size, lo = -Math.floor((s - 1) / 2), pts = [];
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          if (this.shape === 'round' && s > 2 && Math.hypot(i - (s - 1) / 2, j - (s - 1) / 2) > s / 2 - 0.25) continue;
          pts.push([lo + i, lo + j]);
        }
      }
      return pts;
    }
    mirrors(x, y) {
      const w = this.doc.w, h = this.doc.h, r = [[x, y]];
      if (this.symX) r.push([w - 1 - x, y]);
      if (this.symY) r.push([x, h - 1 - y]);
      if (this.symX && this.symY) r.push([w - 1 - x, h - 1 - y]);
      return r;
    }
    // Stamps the brush (and its mirrors) into fn(x, y).
    eachBrushPixel(x, y, fn, noBrush) {
      const offs = noBrush ? [[0, 0]] : this.brushOffsets();
      for (const [mx, my] of this.mirrors(x, y)) for (const [ox, oy] of offs) fn(mx + ox, my + oy);
    }
    brush(x, y, col) {
      const cel = this.drag.cel, w = this.doc.w;
      this.eachBrushPixel(x, y, (px, py) => {
        if (!this.inside(px, py)) return;
        const i = (py * w + px) * 4;
        if (col) { cel[i] = col[0]; cel[i + 1] = col[1]; cel[i + 2] = col[2]; cel[i + 3] = col[3]; }
        else cel[i] = cel[i + 1] = cel[i + 2] = cel[i + 3] = 0;
      });
    }
    newMask() { return new Uint8Array(this.doc.w * this.doc.h); }
    maskPoint(m, x, y, noBrush) {
      this.eachBrushPixel(x, y, (px, py) => { if (this.inside(px, py)) m[py * this.doc.w + px] = 1; }, noBrush);
    }
    setPreview(mask, col) { this.previewMask = mask; this.previewColor = col; this.requestDraw(); }
    clearPreview() { this.previewMask = null; this.requestDraw(); }
    applyMask(mask, col) {
      this.commit();
      const cel = this.celW();
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        if (col) { cel[i] = col[0]; cel[i + 1] = col[1]; cel[i + 2] = col[2]; cel[i + 3] = col[3]; }
        else cel[i] = cel[i + 1] = cel[i + 2] = cel[i + 3] = 0;
      }
      this.touch();
    }
    floodFill(x, y, col) {
      if (!this.inside(x, y)) return;
      const w = this.doc.w, h = this.doc.h;
      const peek = SM.u32(this.cel()), target = peek[y * w + x];
      const c = new Uint8ClampedArray(col), cv = SM.u32(c)[0];
      if (target === cv || ((target >>> 24) === 0 && col[3] === 0)) return;
      this.commit();
      const u = SM.u32(this.celW()), stack = [y * w + x];
      while (stack.length) {
        const p = stack.pop();
        if (u[p] !== target) continue;
        u[p] = cv;
        const px = p % w;
        if (px > 0) stack.push(p - 1);
        if (px < w - 1) stack.push(p + 1);
        if (p >= w) stack.push(p - w);
        if (p < w * (h - 1)) stack.push(p + w);
      }
      this.touch();
    }
    pick(x, y, btn) {
      if (!this.inside(x, y)) return;
      const c = this.doc.composite(this.frame), i = (y * this.doc.w + x) * 4;
      if (!c[i + 3]) return;
      this.setColor([c[i], c[i + 1], c[i + 2], 255], btn === 2 ? 'bg' : 'fg');
    }

    // ---- selection ----
    selectAll() { this.sel = { x: 0, y: 0, w: this.doc.w, h: this.doc.h }; this.emit('sel'); this.requestDraw(); }
    deselect() { this.sel = null; this.emit('sel'); this.requestDraw(); }
    region() { return this.sel || { x: 0, y: 0, w: this.doc.w, h: this.doc.h }; }
    clearSelection() {
      this.commit();
      const r = this.region(), w = this.doc.w, cel = this.celW();
      for (let y = Math.max(0, r.y); y < Math.min(this.doc.h, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) cel.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
      }
      this.touch();
    }
    copy() {
      const r = this.region(), w = this.doc.w, cel = this.cel();
      const out = SM.blank(r.w, r.h), src = cel;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const sx = r.x + x, sy = r.y + y;
          if (!this.inside(sx, sy)) continue;
          out.set(src.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * r.w + x) * 4);
        }
      }
      this.clip = { w: r.w, h: r.h, data: out };
    }
    cut() { this.copy(); this.clearSelection(); }
    paste(x, y) {
      if (!this.clip) return;
      const { w, h, data } = this.clip;
      if (x === undefined) { x = this.sel ? this.sel.x : 0; y = this.sel ? this.sel.y : 0; }
      this.commit();
      const cel = this.celW(), W = this.doc.w;
      const patch = SM.blank(this.doc.w, this.doc.h);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (!this.inside(x + i, y + j)) continue;
          patch.set(data.subarray((j * w + i) * 4, (j * w + i) * 4 + 4), ((y + j) * W + x + i) * 4);
        }
      }
      SM.blend(cel, patch, 1);
      this.sel = { x, y, w, h };
      this.emit('sel'); this.touch();
    }
    // Shift the selection (or the whole cel) by whole pixels.
    nudge(dx, dy) {
      this.commit();
      const r = SM.transformRegion(this.cel(), this.doc.w, this.doc.h, this.sel, { dx, dy });
      this.doc.setCel(this.frame, this.layer, r.data);
      if (this.sel) this.sel = { ...this.sel, x: this.sel.x + dx, y: this.sel.y + dy };
      this.touch();
    }

    // ---- playback ----
    playRange() {
      const t = this.doc.tags[this.playTag];
      return t ? [t.from, t.to] : [0, this.doc.frames.length - 1];
    }
    play() {
      if (this.playing) return;
      this.playing = true; this.playDir = 1;
      const [a, b] = this.playRange();
      if (this.frame < a || this.frame > b) this.setFrame(a);
      this.emit('play'); this.schedule();
    }
    stop() {
      if (!this.playing) return;
      this.playing = false; clearTimeout(this.playTimer); this.emit('play');
    }
    toggle() { if (this.playing) this.stop(); else this.play(); }
    schedule() {
      clearTimeout(this.playTimer);
      const d = this.doc.frames[this.frame] ? this.doc.frames[this.frame].duration : 100;
      this.playTimer = setTimeout(() => this.step(), Math.max(10, d));
    }
    step() {
      if (!this.playing) return;
      const [a, b] = this.playRange();
      let n = this.frame + this.playDir;
      if (this.playMode === 'pingpong' && b > a) {
        if (n > b) { this.playDir = -1; n = b - 1; } else if (n < a) { this.playDir = 1; n = a + 1; }
      } else if (this.playMode === 'once' && n > b) { this.stop(); return; }
      else if (n > b) n = a; else if (n < a) n = b;
      this.setFrame(n);
      this.schedule();
    }

    // ---- input ----
    bind() {
      const vp = this.refs.viewport;
      vp.addEventListener('pointerdown', (e) => this.onDown(e));
      vp.addEventListener('pointermove', (e) => this.onMove(e));
      vp.addEventListener('pointerup', (e) => this.onUp(e));
      vp.addEventListener('pointercancel', (e) => this.onUp(e));
      vp.addEventListener('pointerleave', () => { this.cursor = null; this.emit('status'); this.requestDraw(); });
      vp.addEventListener('contextmenu', (e) => e.preventDefault());
      vp.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = vp.getBoundingClientRect();
        if (e.shiftKey) { this.view.ox -= Math.sign(e.deltaY) * 40; this.view.oy -= 0; this.requestDraw(); return; }
        this.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      new ResizeObserver(() => this.requestDraw()).observe(vp);
    }
    onDown(e) {
      e.preventDefault();
      if (this.drag || this.pan) return;
      this.refs.viewport.setPointerCapture(e.pointerId);
      if (e.button === 1 || this.spaceDown || this.tool === 'hand') {
        this.pan = { sx: e.clientX, sy: e.clientY, ox: this.view.ox, oy: this.view.oy };
        return;
      }
      if (e.button > 2) return;
      this.stop();
      const p = this.toPixel(e), btn = e.button === 2 ? 2 : 0;
      if (e.altKey && this.tool !== 'select') { this.pick(p.x, p.y, btn); return; }
      this.drag = { btn, start: p, last: p, tool: this.tool, shift: e.shiftKey };
      SM.Tools[this.tool].down(this, p, btn, e);
    }
    onMove(e) {
      if (this.pan) {
        this.view.ox = this.pan.ox + e.clientX - this.pan.sx;
        this.view.oy = this.pan.oy + e.clientY - this.pan.sy;
        this.requestDraw();
        return;
      }
      const p = this.toPixel(e);
      this.cursor = p;
      if (this.drag) {
        this.drag.shift = e.shiftKey;
        SM.Tools[this.drag.tool].move(this, p, this.drag.btn, e);
        this.drag.last = p;
      }
      this.emit('status'); this.requestDraw();
    }
    onUp(e) {
      if (this.pan) { this.pan = null; return; }
      if (!this.drag) return;
      const t = this.drag.tool, btn = this.drag.btn;
      SM.Tools[t].up(this, this.toPixel(e), btn, e);
      this.drag = null;
      this.requestDraw();
    }

    // ---- drawing ----
    requestDraw() {
      if (this.dirty) return;
      this.dirty = true;
      requestAnimationFrame(() => this.draw());
    }
    tinted(f, rgb, alpha) {
      const d = this.doc, src = d.composite(f), out = new Uint8ClampedArray(src.length);
      for (let i = 0; i < src.length; i += 4) {
        if (!src[i + 3]) continue;
        out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = src[i + 3] * alpha;
      }
      return out;
    }
    draw() {
      this.dirty = false;
      const { doc, view } = this, W = doc.w, H = doc.h, z = view.zoom, r = this.refs;
      for (const c of [r.comp, r.onion, r.pre]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      Object.assign(r.stage.style, { width: W * z + 'px', height: H * z + 'px', left: view.ox + 'px', top: view.oy + 'px' });

      r.comp.getContext('2d').putImageData(new ImageData(doc.composite(this.frame), W, H), 0, 0);

      const octx = r.onion.getContext('2d');
      octx.clearRect(0, 0, W, H);
      if (this.onion.on) {
        if (this.tmp.width !== W || this.tmp.height !== H) { this.tmp.width = W; this.tmp.height = H; }
        const tctx = this.tmp.getContext('2d');
        const ghost = (f, rgb, a) => {
          tctx.putImageData(new ImageData(this.tinted(f, rgb, a), W, H), 0, 0);
          octx.drawImage(this.tmp, 0, 0);
        };
        for (let k = this.onion.prev; k >= 1; k--) if (this.frame - k >= 0) ghost(this.frame - k, [255, 70, 70], 0.55 / k);
        for (let k = this.onion.next; k >= 1; k--) if (this.frame + k < doc.frames.length) ghost(this.frame + k, [70, 140, 255], 0.55 / k);
      }

      const pctx = r.pre.getContext('2d');
      pctx.clearRect(0, 0, W, H);
      if (this.previewMask) {
        const img = new ImageData(W, H), c = this.previewColor || [255, 255, 255, 150];
        for (let p = 0; p < this.previewMask.length; p++) {
          if (!this.previewMask[p]) continue;
          img.data[p * 4] = c[0]; img.data[p * 4 + 1] = c[1]; img.data[p * 4 + 2] = c[2]; img.data[p * 4 + 3] = c[3];
        }
        pctx.putImageData(img, 0, 0);
      }
      this.drawUI();
    }
    drawUI() {
      const ui = this.refs.ui, vp = this.refs.viewport, { doc, view } = this, z = view.zoom;
      if (ui.width !== vp.clientWidth || ui.height !== vp.clientHeight) { ui.width = vp.clientWidth; ui.height = vp.clientHeight; }
      const g = ui.getContext('2d'), ox = view.ox, oy = view.oy, W = doc.w * z, H = doc.h * z;
      g.clearRect(0, 0, ui.width, ui.height);
      if (this.grid && z >= 6) {
        g.strokeStyle = 'rgba(128,128,128,0.35)'; g.lineWidth = 1; g.beginPath();
        for (let x = 1; x < doc.w; x++) { g.moveTo(ox + x * z + 0.5, oy); g.lineTo(ox + x * z + 0.5, oy + H); }
        for (let y = 1; y < doc.h; y++) { g.moveTo(ox, oy + y * z + 0.5); g.lineTo(ox + W, oy + y * z + 0.5); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      g.strokeRect(ox - 0.5, oy - 0.5, W + 1, H + 1);
      g.setLineDash([6, 4]); g.strokeStyle = 'rgba(0,200,255,0.8)';
      if (this.symX) { g.beginPath(); g.moveTo(ox + W / 2, oy - 8); g.lineTo(ox + W / 2, oy + H + 8); g.stroke(); }
      if (this.symY) { g.beginPath(); g.moveTo(ox - 8, oy + H / 2); g.lineTo(ox + W + 8, oy + H / 2); g.stroke(); }
      g.setLineDash([]);

      const s = this.sel;
      if (s) {
        const x = ox + s.x * z + 0.5, y = oy + s.y * z + 0.5, w = s.w * z - 1, h = s.h * z - 1;
        g.strokeStyle = '#000'; g.strokeRect(x, y, w, h);
        g.setLineDash([5, 5]); g.strokeStyle = '#fff'; g.strokeRect(x, y, w, h); g.setLineDash([]);
      }
      // pivot
      const px = ox + (doc.pivot.x + 0.5) * z, py = oy + (doc.pivot.y + 0.5) * z, pr = Math.max(4, Math.min(z * 0.6, 10));
      g.strokeStyle = '#ff2bd6'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.moveTo(px - pr * 1.6, py); g.lineTo(px + pr * 1.6, py);
      g.moveTo(px, py - pr * 1.6); g.lineTo(px, py + pr * 1.6); g.stroke();

      const c = this.cursor;
      if (c && !this.pan && !this.spaceDown && this.inside(c.x, c.y)) {
        const brushy = ['pencil', 'eraser', 'line', 'rect', 'ellipse'].includes(this.tool);
        g.lineWidth = 1;
        const drawn = new Set();
        const cells = brushy ? this.mirrors(c.x, c.y).flatMap(([mx, my]) => this.brushOffsets().map(([a, b]) => [mx + a, my + b])) : [[c.x, c.y]];
        for (const [x, y] of cells) {
          const k = x + ',' + y;
          if (drawn.has(k) || !this.inside(x, y)) continue;
          drawn.add(k);
          g.strokeStyle = '#000'; g.strokeRect(ox + x * z + 0.5, oy + y * z + 0.5, z - 1, z - 1);
          g.strokeStyle = '#fff'; g.strokeRect(ox + x * z + 1.5, oy + y * z + 1.5, z - 3, z - 3);
        }
      }
    }
  }

  SM.Editor = Editor;
  SM.ZOOMS = ZOOMS;
})(globalThis);
