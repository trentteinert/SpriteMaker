(function (G) {
  'use strict';
  const SM = G.SM;

  // Constrains the drag end point: 45-degree steps for lines, squares for shapes.
  function constrain(a, b, square) {
    let dx = b.x - a.x, dy = b.y - a.y;
    if (square) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
    }
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ay < ax / 2) dy = 0; else if (ax < ay / 2) dx = 0; else { const m = Math.max(ax, ay); dx = Math.sign(dx) * m; dy = Math.sign(dy) * m; }
    return { x: a.x + dx, y: a.y + dy };
  }

  function freehand(erase) {
    return {
      down(ed, p, btn) {
        ed.commit();
        const d = ed.drag;
        d.cel = ed.celW();
        d.col = erase ? null : ed.colorFor(btn);
        ed.brush(p.x, p.y, d.col);
        ed.touch();
      },
      move(ed, p) {
        const d = ed.drag;
        SM.line(d.last.x, d.last.y, p.x, p.y, (x, y) => ed.brush(x, y, d.col));
        ed.touch();
      },
      up() {},
    };
  }

  // line / rect / ellipse share a drag-to-preview, release-to-apply flow.
  function shape(kind) {
    const build = (ed, a, b0, shift) => {
      const m = ed.newMask();
      const b = shift ? constrain(a, b0, kind !== 'line') : b0;
      if (kind === 'line') SM.line(a.x, a.y, b.x, b.y, (x, y) => ed.maskPoint(m, x, y));
      else {
        const pts = kind === 'rect' ? SM.rectPoints : SM.ellipsePoints;
        pts(a.x, a.y, b.x, b.y, ed.fill, (x, y) => ed.maskPoint(m, x, y, ed.fill));
      }
      return m;
    };
    const previewColor = (ed, d) => (d.erase ? [255, 255, 255, 140] : ed.colorFor(d.btn));
    return {
      down(ed, p, btn) { ed.drag.erase = false; ed.setPreview(build(ed, p, p, false), previewColor(ed, ed.drag)); },
      move(ed, p) { const d = ed.drag; ed.setPreview(build(ed, d.start, p, d.shift), previewColor(ed, d)); },
      up(ed, p) {
        const d = ed.drag;
        const m = build(ed, d.start, p, d.shift);
        ed.clearPreview();
        ed.applyMask(m, ed.colorFor(d.btn));
      },
    };
  }

  SM.Tools = {
    pencil: freehand(false),
    eraser: freehand(true),
    line: shape('line'),
    rect: shape('rect'),
    ellipse: shape('ellipse'),

    fill: {
      down(ed, p, btn) { ed.floodFill(p.x, p.y, ed.colorFor(btn)); },
      move() {}, up() {},
    },

    picker: {
      down(ed, p, btn) { ed.pick(p.x, p.y, btn); },
      move(ed, p, btn) { ed.pick(p.x, p.y, btn); },
      up() {},
    },

    // Click sets the sprite pivot; Shift+click sets the joint of the active layer (used by the animation starter).
    pivot: {
      set(ed, p, final) {
        if (!ed.inside(p.x, p.y)) return;
        if (final) ed.commit();
        if (ed.drag.shift) ed.doc.layers[ed.layer].joint = { x: p.x + 0.5, y: p.y + 0.5 };
        else ed.doc.pivot = { x: p.x, y: p.y };
        ed.touch();
      },
      down(ed, p) { this.set(ed, p, true); },
      move(ed, p) { this.set(ed, p, false); },
      up() {},
    },

    hand: { down() {}, move() {}, up() {} },

    // Drag outside the selection to make a new one; drag inside to move its pixels.
    select: {
      down(ed, p) {
        const s = ed.sel, d = ed.drag;
        if (s && p.x >= s.x && p.y >= s.y && p.x < s.x + s.w && p.y < s.y + s.h) {
          d.mode = 'move'; d.moved = false; d.origin = { ...s };
        } else {
          d.mode = 'new';
          ed.sel = null;
        }
        ed.emit('sel');
      },
      move(ed, p) {
        const d = ed.drag, W = ed.doc.w, H = ed.doc.h;
        if (d.mode === 'new') {
          const x0 = SM.clamp(Math.min(d.start.x, p.x), 0, W - 1), x1 = SM.clamp(Math.max(d.start.x, p.x), 0, W - 1);
          const y0 = SM.clamp(Math.min(d.start.y, p.y), 0, H - 1), y1 = SM.clamp(Math.max(d.start.y, p.y), 0, H - 1);
          ed.sel = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
          return;
        }
        const dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (!d.moved) {
          if (!dx && !dy) return;
          d.moved = true;
          ed.commit();
          // Lift the pixels once; later moves restamp them from this snapshot.
          const cel = ed.cel(), o = d.origin, patch = SM.blank(W, H), base = new Uint8ClampedArray(cel);
          for (let y = Math.max(0, o.y); y < Math.min(H, o.y + o.h); y++) {
            for (let x = Math.max(0, o.x); x < Math.min(W, o.x + o.w); x++) {
              const i = (y * W + x) * 4;
              patch.set(cel.subarray(i, i + 4), i);
              base.fill(0, i, i + 4);
            }
          }
          d.base = base; d.patch = patch;
        }
        const moved = SM.translate(d.patch, W, H, dx, dy), out = new Uint8ClampedArray(d.base);
        SM.blend(out, moved, 1);
        ed.doc.setCel(ed.frame, ed.layer, out);
        ed.sel = { x: d.origin.x + dx, y: d.origin.y + dy, w: d.origin.w, h: d.origin.h };
        ed.touch();
      },
      up(ed) {
        const d = ed.drag;
        if (d.mode === 'new' && ed.sel && ed.sel.w === 1 && ed.sel.h === 1 && d.start.x === d.last.x && d.start.y === d.last.y) ed.sel = null;
        ed.emit('sel');
      },
    },
  };
})(globalThis);
