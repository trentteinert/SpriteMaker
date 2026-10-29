(function (G) {
  'use strict';
  const SM = G.SM;

  class Bytes {
    constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
    push(b) {
      if (this.n === this.a.length) { const t = new Uint8Array(this.a.length * 2); t.set(this.a); this.a = t; }
      this.a[this.n++] = b;
    }
    u16(v) { this.push(v & 255); this.push(v >> 8); }
    str(s) { for (let i = 0; i < s.length; i++) this.push(s.charCodeAt(i)); }
    result() { return this.a.slice(0, this.n); }
  }

  // GIF-flavoured LZW (variable code size, 12-bit table with clear codes).
  function lzw(out, indices, minCode) {
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, next = eoi + 1, table = new Map();
    let cur = 0, shift = 0;
    const block = new Bytes();
    const put = (code) => {
      cur |= code << shift; shift += size;
      while (shift >= 8) { block.push(cur & 255); cur >>= 8; shift -= 8; }
    };
    put(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i], key = (prefix << 8) | k, hit = table.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      put(prefix);
      if (next === 4096) {
        put(clear);
        next = eoi + 1; size = minCode + 1; table = new Map();
      } else {
        if (next >= 1 << size) size++;
        table.set(key, next++);
      }
      prefix = k;
    }
    put(prefix);
    put(eoi);
    if (shift > 0) block.push(cur & 255);
    const data = block.result();
    for (let i = 0; i < data.length; i += 255) {
      const len = Math.min(255, data.length - i);
      out.push(len);
      for (let j = 0; j < len; j++) out.push(data[i + j]);
    }
    out.push(0);
  }

  // frames: array of RGBA buffers (w*h*4); delays in ms. Index 0 is transparent.
  // Uses the exact colours when there are <= 255, otherwise a fixed 6x7x6 palette.
  SM.encodeGIF = function (frames, w, h, delays, opt) {
    opt = opt || {};
    const map = new Map();
    let overflow = false;
    scan: for (const f of frames) {
      for (let i = 0; i < f.length; i += 4) {
        if (f[i + 3] < 128) continue;
        const k = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
        if (!map.has(k)) {
          if (map.size >= 255) { overflow = true; break scan; }
          map.set(k, map.size + 1);
        }
      }
    }
    const table = new Uint8Array(256 * 3);
    let lookup;
    if (!overflow) {
      for (const [k, i] of map) { table[i * 3] = k >> 16; table[i * 3 + 1] = (k >> 8) & 255; table[i * 3 + 2] = k & 255; }
      lookup = (r, g, b) => map.get((r << 16) | (g << 8) | b);
    } else {
      for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
        const i = 1 + (r * 7 + g) * 6 + b;
        table[i * 3] = Math.round((r * 255) / 5); table[i * 3 + 1] = Math.round((g * 255) / 6); table[i * 3 + 2] = Math.round((b * 255) / 5);
      }
      lookup = (r, g, b) => 1 + (Math.round((r * 5) / 255) * 7 + Math.round((g * 6) / 255)) * 6 + Math.round((b * 5) / 255);
    }

    const out = new Bytes();
    out.str('GIF89a'); out.u16(w); out.u16(h);
    out.push(0xf7); out.push(0); out.push(0);
    for (let i = 0; i < table.length; i++) out.push(table[i]);
    out.push(0x21); out.push(0xff); out.push(11); out.str('NETSCAPE2.0');
    out.push(3); out.push(1); out.u16(opt.loops || 0); out.push(0);

    frames.forEach((f, fi) => {
      const idx = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        idx[p] = f[i + 3] < 128 ? 0 : lookup(f[i], f[i + 1], f[i + 2]);
      }
      out.push(0x21); out.push(0xf9); out.push(4);
      out.push((2 << 2) | 1); // restore to background, transparent colour present
      out.u16(Math.max(2, Math.round(delays[fi] / 10)));
      out.push(0); out.push(0);
      out.push(0x2c); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.push(0);
      out.push(8);
      lzw(out, idx, 8);
    });
    out.push(0x3b);
    return out.result();
  };
})(globalThis);
