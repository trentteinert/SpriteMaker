(function (G) {
  'use strict';
  const SM = G.SM;

  SM.flipH = function (src, w, h) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4, d = (y * w + (w - 1 - x)) * 4;
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
      }
    }
    return out;
  };

  SM.flipV = function (src, w, h) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    return out;
  };

  // Rotates a whole buffer by 90 degrees; the result is h wide and w tall.
  SM.rotate90 = function (src, w, h, clockwise) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = clockwise ? h - 1 - y : y;
        const ny = clockwise ? x : w - 1 - x;
        const s = (y * w + x) * 4, d = (ny * h + nx) * 4;
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
      }
    }
    return out;
  };

  // Scale2x / EPX: doubles resolution while keeping hard edges and diagonals.
  SM.scale2x = function (src, w, h) {
    const s = SM.u32(src).slice();
    for (let i = 0; i < s.length; i++) if ((s[i] >>> 24) === 0) s[i] = 0; // little-endian alpha byte
    const out = new Uint32Array(w * 2 * h * 2), ow = w * 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = s[y * w + x];
        const a = y > 0 ? s[(y - 1) * w + x] : p;
        const b = x < w - 1 ? s[y * w + x + 1] : p;
        const c = x > 0 ? s[y * w + x - 1] : p;
        const d = y < h - 1 ? s[(y + 1) * w + x] : p;
        let p1 = p, p2 = p, p3 = p, p4 = p;
        if (c === a && c !== d && a !== b) p1 = a;
        if (a === b && a !== c && b !== d) p2 = b;
        if (d === c && d !== b && c !== a) p3 = c;
        if (b === d && b !== a && d !== c) p4 = d;
        const o = y * 2 * ow + x * 2;
        out[o] = p1; out[o + 1] = p2; out[o + ow] = p3; out[o + ow + 1] = p4;
      }
    }
    return new Uint8ClampedArray(out.buffer);
  };

  // Nearest-neighbour rotation about (cx, cy) in continuous pixel coordinates
  // (pixel i covers [i, i+1)). Positive angles turn clockwise on screen.
  // opt.squash < 1 flattens the result vertically (top-down tilt) and
  // opt.lift moves the result up by that many pixels.
  SM.rotateNN = function (src, w, h, angle, cx, cy, opt) {
    opt = opt || {};
    const squash = opt.squash || 1, lift = opt.lift || 0;
    const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const s = SM.u32(src), out = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      const ey = (y + 0.5 + lift - cy) / squash;
      for (let x = 0; x < w; x++) {
        const ex = x + 0.5 - cx;
        const sx = Math.floor(cx + cos * ex + sin * ey + 1e-6);
        const sy = Math.floor(cy - sin * ex + cos * ey + 1e-6);
        if (sx >= 0 && sy >= 0 && sx < w && sy < h) out[y * w + x] = s[sy * w + sx];
      }
    }
    return new Uint8ClampedArray(out.buffer);
  };

  // Shrinks by an integer factor, picking the most common opaque colour per block.
  SM.downsampleMode = function (src, w, h, f) {
    const ow = Math.floor(w / f), oh = Math.floor(h / f);
    const s = SM.u32(src), out = new Uint32Array(ow * oh);
    const keys = [], counts = [];
    for (let by = 0; by < oh; by++) {
      for (let bx = 0; bx < ow; bx++) {
        let opaque = 0;
        keys.length = 0; counts.length = 0;
        for (let j = 0; j < f; j++) {
          for (let i = 0; i < f; i++) {
            const v = s[(by * f + j) * w + bx * f + i];
            if ((v >>> 24) < 128) continue;
            opaque++;
            const k = keys.indexOf(v);
            if (k < 0) { keys.push(v); counts.push(1); } else counts[k]++;
          }
        }
        if (opaque * 2 < f * f || !keys.length) continue;
        let best = 0;
        for (let k = 1; k < keys.length; k++) if (counts[k] > counts[best]) best = k;
        out[by * ow + bx] = keys[best];
      }
    }
    return new Uint8ClampedArray(out.buffer);
  };

  // RotSprite-style rotation: upscale 8x with Scale2x, rotate with nearest
  // neighbour, then reduce back. Keeps pixel art crisp at arbitrary angles.
  SM.rotSprite = function (src, w, h, angle, cx, cy) {
    const a = ((angle % 360) + 360) % 360;
    if (a === 0) return new Uint8ClampedArray(src);
    if (a % 90 === 0) return SM.rotateNN(src, w, h, a, cx, cy);
    let up = src, uw = w, uh = h;
    for (let k = 0; k < 3; k++) { up = SM.scale2x(up, uw, uh); uw *= 2; uh *= 2; }
    const rot = SM.rotateNN(up, uw, uh, a, cx * 8, cy * 8);
    return SM.downsampleMode(rot, uw, uh, 8);
  };

  // method: 'rotsprite' (default) or 'nearest'.
  SM.rotate = function (src, w, h, angle, cx, cy, method) {
    if (method === 'nearest') return SM.rotateNN(src, w, h, angle, cx, cy);
    return SM.rotSprite(src, w, h, angle, cx, cy);
  };

  SM.translate = function (src, w, h, dx, dy) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= w) continue;
        const s = (sy * w + sx) * 4, d = (y * w + x) * 4;
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
      }
    }
    return out;
  };

  // Bounding box of non-transparent pixels, or null if empty.
  SM.bounds = function (buf, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (buf[(y * w + x) * 4 + 3]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  // Lifts the pixels inside rect (null = everything) out of buf, rotates them
  // about (cx, cy), shifts them by (dx, dy) and drops them back on top.
  // Returns { data, bounds } where bounds is the new extent of the moved pixels.
  SM.transformRegion = function (buf, w, h, rect, p) {
    const base = new Uint8ClampedArray(buf), patch = new Uint8ClampedArray(buf.length);
    const r = rect || { x: 0, y: 0, w, h };
    const x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
    for (let y = Math.max(0, r.y); y < y1; y++) {
      for (let x = Math.max(0, r.x); x < x1; x++) {
        const i = (y * w + x) * 4;
        patch[i] = base[i]; patch[i + 1] = base[i + 1]; patch[i + 2] = base[i + 2]; patch[i + 3] = base[i + 3];
        base[i] = base[i + 1] = base[i + 2] = base[i + 3] = 0;
      }
    }
    let moved = patch;
    if (p.angle && SM.bounds(patch, w, h)) moved = SM.rotate(patch, w, h, p.angle, p.cx, p.cy, p.method);
    const dx = Math.round(p.dx || 0), dy = Math.round(p.dy || 0);
    if (dx || dy) moved = SM.translate(moved, w, h, dx, dy);
    SM.blend(base, moved, 1);
    return { data: base, bounds: SM.bounds(moved, w, h) };
  };

  // "Stacked sprite" rotation: every slice is rotated about the centre and
  // lifted by its index * step, giving a pseudo-3D turntable of an object.
  SM.stackRender = function (slices, w, h, angle, step, squash) {
    const out = new Uint8ClampedArray(w * h * 4);
    slices.forEach((s, i) => {
      const r = SM.rotateNN(s, w, h, angle, w / 2, h / 2, { squash: squash || 1, lift: Math.round(i * step) });
      SM.blend(out, r, 1);
    });
    return out;
  };
})(globalThis);
