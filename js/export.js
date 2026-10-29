(function (G) {
  'use strict';
  const SM = G.SM;
  const io = (SM.io = {});

  io.download = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  function upscale(data, w, h, s) {
    if (s === 1) return data;
    const out = new Uint8ClampedArray(w * s * h * s * 4), ow = w * s;
    for (let y = 0; y < h * s; y++) {
      const sy = Math.floor(y / s);
      for (let x = 0; x < ow; x++) {
        const si = (sy * w + Math.floor(x / s)) * 4, di = (y * ow + x) * 4;
        out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
      }
    }
    return out;
  }

  function canvasOf(data, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return c;
  }
  const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

  io.frameRange = function (doc, tagIndex) {
    const t = doc.tags[tagIndex];
    return t ? [t.from, t.to] : [0, doc.frames.length - 1];
  };

  io.png = async function (doc, frame, scale) {
    const d = upscale(doc.composite(frame), doc.w, doc.h, scale);
    return toBlob(canvasOf(d, doc.w * scale, doc.h * scale));
  };

  // layout: 'row' | 'column' | 'grid' (cols columns) | 'tags' (one row per tag). Returns { blob, json }.
  io.sheet = async function (doc, o) {
    const s = o.scale, pad = o.pad, cw = doc.w * s, ch = doc.h * s;
    let cells; // [{ f: frame index, col, row, name }]
    let cols, rows;
    if (o.layout === 'tags' && doc.tags.length) {
      cells = [];
      doc.tags.forEach((t, r) => { for (let f = t.from; f <= t.to; f++) cells.push({ f, col: f - t.from, row: r, name: t.name + '_' + (f - t.from) }); });
      cols = Math.max(...doc.tags.map((t) => t.to - t.from + 1)); rows = doc.tags.length;
    } else {
      const [a, b] = io.frameRange(doc, o.tag), n = b - a + 1;
      cols = o.layout === 'row' || o.layout === 'tags' ? n : o.layout === 'column' ? 1 : Math.min(n, Math.max(1, o.cols));
      rows = Math.ceil(n / cols);
      cells = Array.from({ length: n }, (_, i) => ({ f: a + i, col: i % cols, row: Math.floor(i / cols), name: o.name + ' ' + (a + i) }));
    }
    const W = cols * cw + (cols + 1) * pad, H = rows * ch + (rows + 1) * pad;
    const sheet = SM.blank(W, H), frames = [];
    for (const c of cells) {
      const img = upscale(doc.composite(c.f), doc.w, doc.h, s);
      const ox = pad + c.col * (cw + pad), oy = pad + c.row * (ch + pad);
      for (let y = 0; y < ch; y++) sheet.set(img.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * W + ox) * 4);
      frames.push({ filename: c.name, frame: { x: ox, y: oy, w: cw, h: ch }, duration: doc.frames[c.f].duration });
    }
    const byTag = o.layout === 'tags' && doc.tags.length;
    const json = {
      frames,
      meta: {
        app: 'SpriteMaker', size: { w: W, h: H }, scale: String(s), frameSize: { w: cw, h: ch },
        pivot: { x: doc.pivot.x * s, y: doc.pivot.y * s },
        frameTags: byTag
          ? doc.tags.map((t) => ({ name: t.name, from: 0, to: t.to - t.from, direction: 'forward' }))
          : doc.tags.map((t) => ({ name: t.name, from: t.from - cells[0].f, to: t.to - cells[0].f, direction: 'forward' })).filter((t) => t.from >= 0 && t.to < cells.length),
        // Engine-friendly summary: row, frame rectangles and per-frame timing for each animation.
        animations: byTag ? Object.fromEntries(doc.tags.map((t, r) => [t.name, {
          row: r, frames: t.to - t.from + 1, loop: ['idle', 'walk', 'run'].includes(t.name),
          durations: doc.frames.slice(t.from, t.to + 1).map((fr) => fr.duration),
          rects: Array.from({ length: t.to - t.from + 1 }, (_, i) => ({ x: pad + i * (cw + pad), y: pad + r * (ch + pad), w: cw, h: ch })),
        }])) : undefined,
      },
    };
    return { blob: await toBlob(canvasOf(sheet, W, H)), json };
  };

  io.gif = function (doc, o) {
    const [a, b] = io.frameRange(doc, o.tag), frames = [], delays = [];
    for (let f = a; f <= b; f++) {
      frames.push(upscale(doc.composite(f), doc.w, doc.h, o.scale));
      delays.push(doc.frames[f].duration);
    }
    return new Blob([SM.encodeGIF(frames, doc.w * o.scale, doc.h * o.scale, delays)], { type: 'image/gif' });
  };

  io.saveProject = function (doc, name) {
    io.download(new Blob([JSON.stringify(SM.serialize(doc))], { type: 'application/json' }), (name || 'sprite') + '.spritemaker.json');
  };

  io.readFile = (file, kind) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    if (kind === 'text') r.readAsText(file); else r.readAsDataURL(file);
  });

  // Decodes an image file to RGBA at its natural size.
  io.readImage = async function (file) {
    const url = await io.readFile(file, 'url');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  };
})(globalThis);
