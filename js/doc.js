(function (G) {
  'use strict';
  const SM = G.SM;

  class Doc {
    constructor(w, h) {
      this.w = w || 32;
      this.h = h || 32;
      this.layers = [{ name: 'Layer 1', visible: true, opacity: 255 }];
      this.frames = [{ duration: 100, cels: [SM.blank(this.w, this.h)] }];
      this.tags = []; // { name, from, to }
      this.pivot = { x: this.w >> 1, y: this.h >> 1 };
      this.palette = SM.DB32.slice();
      this.owned = new WeakSet();
    }

    cel(f, l) { return this.frames[f].cels[l]; }

    // Returns a cel that is safe to mutate. Cels referenced by an undo snapshot
    // are copied on first write after the snapshot was taken.
    celW(f, l) {
      const fr = this.frames[f];
      let c = fr.cels[l];
      if (!this.owned.has(c)) {
        c = new Uint8ClampedArray(c);
        fr.cels[l] = c;
        this.owned.add(c);
      }
      return c;
    }

    setCel(f, l, data) {
      this.frames[f].cels[l] = data;
      this.owned.add(data);
    }

    snapshot() {
      return {
        w: this.w, h: this.h,
        layers: this.layers.map((l) => ({ ...l })),
        frames: this.frames.map((f) => ({ duration: f.duration, cels: f.cels.slice() })),
        tags: this.tags.map((t) => ({ ...t })),
        pivot: { ...this.pivot },
        palette: this.palette.slice(),
      };
    }

    restore(s) {
      this.w = s.w; this.h = s.h;
      this.layers = s.layers.map((l) => ({ ...l }));
      this.frames = s.frames.map((f) => ({ duration: f.duration, cels: f.cels.slice() }));
      this.tags = s.tags.map((t) => ({ ...t }));
      this.pivot = { ...s.pivot };
      this.palette = s.palette.slice();
      this.owned = new WeakSet();
    }

    addLayer(name, at, copyFrom) {
      if (at === undefined || at === null) at = this.layers.length;
      this.layers.splice(at, 0, { name: name || 'Layer ' + (this.layers.length + 1), visible: true, opacity: 255 });
      for (const fr of this.frames) {
        const cel = copyFrom === undefined || copyFrom === null
          ? SM.blank(this.w, this.h) : new Uint8ClampedArray(fr.cels[copyFrom]);
        fr.cels.splice(at, 0, cel);
        this.owned.add(cel);
      }
      return at;
    }

    removeLayer(i) {
      if (this.layers.length <= 1) return false;
      this.layers.splice(i, 1);
      for (const fr of this.frames) fr.cels.splice(i, 1);
      return true;
    }

    moveLayer(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= this.layers.length) return i;
      [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
      for (const fr of this.frames) [fr.cels[i], fr.cels[j]] = [fr.cels[j], fr.cels[i]];
      return j;
    }

    // Inserts a frame at index `at`. copyFrom = index of a frame to duplicate, or null for a blank one.
    addFrame(at, copyFrom, duration) {
      const src = copyFrom === null || copyFrom === undefined ? null : this.frames[copyFrom];
      const cels = this.layers.map((_, l) => {
        const c = src ? new Uint8ClampedArray(src.cels[l]) : SM.blank(this.w, this.h);
        this.owned.add(c);
        return c;
      });
      this.frames.splice(at, 0, { duration: duration || (src ? src.duration : 100), cels });
      for (const t of this.tags) {
        if (at <= t.from) { t.from++; t.to++; } else if (at <= t.to) t.to++;
      }
      return at;
    }

    removeFrame(i) {
      if (this.frames.length <= 1) return false;
      this.frames.splice(i, 1);
      this.tags = this.tags.filter((t) => !(t.from === i && t.to === i));
      for (const t of this.tags) {
        if (i < t.from) { t.from--; t.to--; } else if (i <= t.to) t.to--;
      }
      return true;
    }

    moveFrame(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= this.frames.length) return i;
      [this.frames[i], this.frames[j]] = [this.frames[j], this.frames[i]];
      return j;
    }

    reverseFrames() {
      const n = this.frames.length;
      this.frames.reverse();
      for (const t of this.tags) { const f = n - 1 - t.to, to = n - 1 - t.from; t.from = f; t.to = to; }
    }

    // Changes the canvas size; (ax, ay) in [0,1] is where the old content is anchored.
    resize(nw, nh, ax, ay) {
      const ox = Math.round((nw - this.w) * ax), oy = Math.round((nh - this.h) * ay);
      for (const fr of this.frames) {
        fr.cels = fr.cels.map((c) => {
          const n = SM.blank(nw, nh);
          for (let y = 0; y < this.h; y++) {
            const ny = y + oy;
            if (ny < 0 || ny >= nh) continue;
            for (let x = 0; x < this.w; x++) {
              const nx = x + ox;
              if (nx < 0 || nx >= nw) continue;
              const s = (y * this.w + x) * 4, d = (ny * nw + nx) * 4;
              n[d] = c[s]; n[d + 1] = c[s + 1]; n[d + 2] = c[s + 2]; n[d + 3] = c[s + 3];
            }
          }
          this.owned.add(n);
          return n;
        });
      }
      this.pivot = { x: SM.clamp(this.pivot.x + ox, 0, nw - 1), y: SM.clamp(this.pivot.y + oy, 0, nh - 1) };
      this.w = nw; this.h = nh;
    }

    // Bounding box of everything drawn on any cel, or null.
    contentBounds() {
      let r = null;
      for (const fr of this.frames) {
        for (const c of fr.cels) {
          const b = SM.bounds(c, this.w, this.h);
          if (!b) continue;
          if (!r) { r = { ...b }; continue; }
          const x1 = Math.max(r.x + r.w, b.x + b.w), y1 = Math.max(r.y + r.h, b.y + b.h);
          r.x = Math.min(r.x, b.x); r.y = Math.min(r.y, b.y); r.w = x1 - r.x; r.h = y1 - r.y;
        }
      }
      return r;
    }

    // Flattened RGBA of frame f. Hidden layers are skipped unless opts.all.
    composite(f, opts) {
      const out = SM.blank(this.w, this.h), fr = this.frames[f];
      for (let l = 0; l < this.layers.length; l++) {
        const L = this.layers[l];
        if (!L.visible && !(opts && opts.all)) continue;
        SM.blend(out, fr.cels[l], L.opacity / 255);
      }
      return out;
    }

    // Sorted list of distinct opaque colours used anywhere (as #rrggbb), most used first.
    usedColors() {
      const counts = new Map();
      for (const fr of this.frames) {
        for (const c of fr.cels) {
          for (let i = 0; i < c.length; i += 4) {
            if (c[i + 3] < 128) continue;
            const k = (c[i] << 16) | (c[i + 1] << 8) | c[i + 2];
            counts.set(k, (counts.get(k) || 0) + 1);
          }
        }
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])
        .map(([k]) => '#' + k.toString(16).padStart(6, '0'));
    }
  }

  // Undo/redo. Snapshots are shallow (cels are shared and copied on write), so they are cheap.
  class History {
    constructor(doc) { this.doc = doc; this.undoS = []; this.redoS = []; this.limit = 200; }
    commit() {
      this.undoS.push(this.doc.snapshot());
      if (this.undoS.length > this.limit) this.undoS.shift();
      this.redoS.length = 0;
      this.doc.owned = new WeakSet();
    }
    undo() {
      if (!this.undoS.length) return false;
      this.redoS.push(this.doc.snapshot());
      this.doc.restore(this.undoS.pop());
      return true;
    }
    redo() {
      if (!this.redoS.length) return false;
      this.undoS.push(this.doc.snapshot());
      this.doc.restore(this.redoS.pop());
      return true;
    }
  }

  SM.serialize = function (doc) {
    return {
      format: 'spritemaker', version: 1, w: doc.w, h: doc.h, pivot: doc.pivot,
      palette: doc.palette, tags: doc.tags, layers: doc.layers,
      frames: doc.frames.map((f) => ({
        duration: f.duration,
        cels: f.cels.map((c) => (SM.bounds(c, doc.w, doc.h) ? SM.b64encode(c) : null)),
      })),
    };
  };

  SM.deserialize = function (o) {
    if (!o || o.format !== 'spritemaker') throw new Error('Not a SpriteMaker project');
    const d = new Doc(o.w, o.h);
    d.layers = o.layers.map((l) => ({ name: l.name, visible: l.visible !== false, opacity: l.opacity === undefined ? 255 : l.opacity }));
    d.frames = o.frames.map((f) => ({
      duration: f.duration || 100,
      cels: f.cels.map((c) => (c ? SM.b64decode(c) : SM.blank(o.w, o.h))),
    }));
    d.tags = (o.tags || []).map((t) => ({ ...t }));
    d.pivot = o.pivot || { x: o.w >> 1, y: o.h >> 1 };
    if (o.palette && o.palette.length) d.palette = o.palette.slice();
    return d;
  };

  SM.Doc = Doc;
  SM.History = History;
})(globalThis);
