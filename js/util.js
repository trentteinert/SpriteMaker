(function (G) {
  'use strict';
  const SM = (G.SM = G.SM || {});

  SM.DB32 = ['#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
    '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
    '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
    '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30'];
  SM.PICO8 = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'];
  SM.GAMEBOY = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
  SM.GRAYS = ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'];

  SM.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  SM.hexToRgba = function (h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  };
  SM.rgbaToHex = (c) => '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('');

  SM.blank = (w, h) => new Uint8ClampedArray(w * h * 4);

  // Standard alpha-over of src onto dst (both RGBA, same size).
  SM.blend = function (dst, src, opacity) {
    if (opacity === undefined) opacity = 1;
    for (let i = 0; i < src.length; i += 4) {
      const sa = (src[i + 3] / 255) * opacity;
      if (sa <= 0) continue;
      const da = dst[i + 3] / 255;
      if (sa >= 1 || da === 0) {
        dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2];
        dst[i + 3] = Math.round(sa * 255);
        continue;
      }
      const ra = sa + da * (1 - sa);
      const k = da * (1 - sa);
      dst[i] = Math.round((src[i] * sa + dst[i] * k) / ra);
      dst[i + 1] = Math.round((src[i + 1] * sa + dst[i + 1] * k) / ra);
      dst[i + 2] = Math.round((src[i + 2] * sa + dst[i + 2] * k) / ra);
      dst[i + 3] = Math.round(ra * 255);
    }
  };

  // Bresenham line, calls cb(x, y) for every pixel including both ends.
  SM.line = function (x0, y0, x1, y1, cb) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      cb(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };

  SM.rectPoints = function (x0, y0, x1, y1, filled, cb) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        if (filled || x === xa || x === xb || y === ya || y === yb) cb(x, y);
      }
    }
  };

  // Ellipse inscribed in the bounding box (x0,y0)-(x1,y1), inclusive.
  SM.ellipsePoints = function (x0, y0, x1, y1, filled, cb) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    const w = xb - xa + 1, h = yb - ya + 1;
    const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2;
    const inside = (i, j) => {
      if (i < 0 || j < 0 || i >= w || j >= h) return false;
      const dx = (i - cx) / rx, dy = (j - cy) / ry;
      return dx * dx + dy * dy <= 1;
    };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!inside(i, j)) continue;
        if (filled || !(inside(i - 1, j) && inside(i + 1, j) && inside(i, j - 1) && inside(i, j + 1))) cb(xa + i, ya + j);
      }
    }
  };

  SM.ease = {
    linear: (t) => t,
    in: (t) => t * t,
    out: (t) => 1 - (1 - t) * (1 - t),
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  };

  SM.b64encode = function (u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString('base64');
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  SM.b64decode = function (str) {
    if (typeof Buffer !== 'undefined') return new Uint8ClampedArray(Buffer.from(str, 'base64'));
    const bin = atob(str), out = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  // Uint32 view over an RGBA buffer, copying only if it is not 4-byte aligned.
  SM.u32 = function (buf) {
    if (buf.byteOffset % 4 === 0) return new Uint32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
    return new Uint32Array(new Uint8ClampedArray(buf).buffer);
  };
})(globalThis);
