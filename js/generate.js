(function (G) {
  'use strict';
  const SM = G.SM;
  const gen = (SM.gen = {});

  // ctx = { doc, hist, frame, layer, sel }. Every generator takes one undo
  // snapshot up front and returns { frame, layer, sel } for the editor to adopt.

  // Continuous pivot coordinates for the three pivot modes used by the dialogs.
  gen.pivotPoint = function (ctx, mode) {
    const d = ctx.doc;
    if (mode === 'center') return { cx: d.w / 2, cy: d.h / 2 };
    if (mode === 'selection' && ctx.sel) return { cx: ctx.sel.x + ctx.sel.w / 2, cy: ctx.sel.y + ctx.sel.h / 2 };
    return { cx: d.pivot.x + 0.5, cy: d.pivot.y + 0.5 };
  };

  // Rotate (and optionally shift) the selection, or whole cels, by an arbitrary angle.
  // scope: 'cel' | 'frame' | 'all'
  gen.rotate = function (ctx, o) {
    const d = ctx.doc, p = gen.pivotPoint(ctx, o.pivot);
    ctx.hist.commit();
    const frames = o.scope === 'all' ? d.frames.map((_, i) => i) : [ctx.frame];
    const layers = o.scope === 'cel' ? [ctx.layer] : d.layers.map((_, i) => i);
    let bounds = null;
    for (const f of frames) {
      for (const l of layers) {
        const r = SM.transformRegion(d.cel(f, l), d.w, d.h, ctx.sel, {
          angle: o.angle, dx: o.dx || 0, dy: o.dy || 0, cx: p.cx, cy: p.cy, method: o.method,
        });
        d.setCel(f, l, r.data);
        if (f === ctx.frame && l === ctx.layer) bounds = r.bounds;
      }
    }
    return { frame: ctx.frame, layer: ctx.layer, sel: ctx.sel && bounds ? bounds : ctx.sel };
  };

  // Rotation frames: the current frame is angle 0 and `count - 1` rotated copies follow it.
  // total = 360 gives a seamless loop (step = total / count); otherwise the last frame lands on `total`.
  gen.turntable = function (ctx, o) {
    const d = ctx.doc, p = gen.pivotPoint(ctx, o.pivot), src = ctx.frame;
    const count = Math.max(2, o.count | 0);
    const step = (o.total >= 360 ? o.total / count : o.total / (count - 1)) * (o.direction === 'ccw' ? -1 : 1);
    ctx.hist.commit();
    for (let k = 1; k < count; k++) {
      const idx = d.addFrame(src + k, src);
      for (let l = 0; l < d.layers.length; l++) {
        d.setCel(idx, l, SM.rotate(d.cel(src, l), d.w, d.h, k * step, p.cx, p.cy, o.method));
      }
    }
    if (o.tag) d.tags.push({ name: o.tagName || 'rotate', from: src, to: src + count - 1 });
    return { frame: src, layer: ctx.layer, sel: null };
  };

  // Treats the visible layers (bottom to top) as height slices of an object and
  // renders it spinning around its vertical axis, like a stacked sprite.
  gen.stackRotate = function (ctx, o) {
    const d = ctx.doc, src = ctx.frame;
    const count = Math.max(2, o.count | 0);
    const sliceIdx = d.layers.map((l, i) => (l.visible ? i : -1)).filter((i) => i >= 0);
    if (!sliceIdx.length) return null;
    const slices = sliceIdx.map((l) => d.cel(src, l));
    ctx.hist.commit();
    const out = d.addLayer('Stack', d.layers.length);
    const step = (o.total >= 360 ? o.total / count : o.total / (count - 1)) * (o.direction === 'ccw' ? -1 : 1);
    for (let k = 1; k < count; k++) d.addFrame(src + k, null, d.frames[src].duration);
    for (let k = 0; k < count; k++) {
      const img = SM.stackRender(slices, d.w, d.h, (o.start || 0) + k * step, o.spacing, o.squash);
      d.setCel(src + k, out, img);
    }
    if (o.hideSlices) for (const l of sliceIdx) d.layers[l].visible = false;
    if (o.tag) d.tags.push({ name: o.tagName || 'stack', from: src, to: src + count - 1 });
    return { frame: src, layer: out, sel: null };
  };

  // Side-view turn: visible layers (bottom = farthest, top = nearest) become depth
  // slices of a voxel model that is rendered spinning around the vertical axis
  // through the pivot, into a new "Turn" layer with one frame per angle.
  gen.turn = function (ctx, o) {
    const d = ctx.doc, src = ctx.frame;
    const count = Math.max(2, o.count | 0);
    const sliceIdx = d.layers.map((l, i) => (l.visible ? i : -1)).filter((i) => i >= 0);
    if (!sliceIdx.length) return null;
    const model = SM.buildVoxels(sliceIdx.map((l) => d.cel(src, l)), d.w, d.h,
      { thickness: o.thickness, spacing: o.spacing, mode: o.shape });
    const cx = o.pivot === 'center' ? d.w / 2 : d.pivot.x + 0.5;
    ctx.hist.commit();
    const out = d.addLayer('Turn', d.layers.length);
    const step = (o.total >= 360 ? o.total / count : o.total / (count - 1)) * (o.direction === 'left' ? -1 : 1);
    for (let k = 1; k < count; k++) d.addFrame(src + k, null, d.frames[src].duration);
    for (let k = 0; k < count; k++) d.setCel(src + k, out, SM.renderTurn(model, (o.start || 0) + k * step, cx, o.shade ? 0.8 : 1));
    if (o.hideSlices) for (const l of sliceIdx) d.layers[l].visible = false;
    if (o.tag) d.tags.push({ name: o.tagName || 'turn', from: src, to: src + count - 1 });
    return { frame: src, layer: out, sel: null };
  };

  // Motion tween of the selection (or the whole active cel): interpolates a
  // rotation + offset across `count` frames. Source frame is t = 0.
  // mode: 'oneway' ends exactly on the target; 'loop' goes there and back so it loops seamlessly.
  gen.tween = function (ctx, o) {
    const d = ctx.doc, src = ctx.frame, L = ctx.layer;
    const count = Math.max(2, o.count | 0);
    const p = gen.pivotPoint(ctx, o.pivot);
    const ease = SM.ease[o.ease] || SM.ease.linear;
    const base = d.cel(src, L);
    ctx.hist.commit();
    for (let i = 1; i < count; i++) {
      const t = o.mode === 'loop' ? 1 - Math.abs((2 * i) / count - 1) : i / (count - 1);
      const e = ease(t);
      const idx = d.addFrame(src + i, src);
      const r = SM.transformRegion(base, d.w, d.h, ctx.sel, {
        angle: (o.angle || 0) * e, dx: (o.dx || 0) * e, dy: (o.dy || 0) * e, cx: p.cx, cy: p.cy, method: o.method,
      });
      d.setCel(idx, L, r.data);
    }
    if (o.tag) d.tags.push({ name: o.tagName || 'tween', from: src, to: src + count - 1 });
    return { frame: src, layer: L, sel: ctx.sel };
  };

  // Appends the frames in reverse (excluding both ends) so a clip plays forward then back.
  gen.pingPong = function (ctx) {
    const d = ctx.doc, n = d.frames.length;
    if (n < 3) return null;
    ctx.hist.commit();
    for (let i = n - 2; i >= 1; i--) d.addFrame(d.frames.length, i);
    return { frame: ctx.frame, layer: ctx.layer, sel: ctx.sel };
  };

  gen.reverse = function (ctx) {
    ctx.hist.commit();
    ctx.doc.reverseFrames();
    return { frame: ctx.doc.frames.length - 1 - ctx.frame, layer: ctx.layer, sel: ctx.sel };
  };

  // Mirror every cel (all frames) or only the current frame.
  gen.flip = function (ctx, horizontal, allFrames) {
    const d = ctx.doc;
    ctx.hist.commit();
    const frames = allFrames ? d.frames.map((_, i) => i) : [ctx.frame];
    for (const f of frames) {
      for (let l = 0; l < d.layers.length; l++) {
        const c = d.cel(f, l);
        d.setCel(f, l, horizontal ? SM.flipH(c, d.w, d.h) : SM.flipV(c, d.w, d.h));
      }
    }
    return { frame: ctx.frame, layer: ctx.layer, sel: null };
  };

  gen.rotate90 = function (ctx, clockwise) {
    const d = ctx.doc, w = d.w, h = d.h;
    ctx.hist.commit();
    for (const fr of d.frames) fr.cels = fr.cels.map((c) => { const n = SM.rotate90(c, w, h, clockwise); d.owned.add(n); return n; });
    d.w = h; d.h = w;
    d.pivot = clockwise ? { x: h - 1 - d.pivot.y, y: d.pivot.x } : { x: d.pivot.y, y: w - 1 - d.pivot.x };
    return { frame: ctx.frame, layer: ctx.layer, sel: null };
  };
})(globalThis);
