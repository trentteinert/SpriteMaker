// Dependency-free tests for the pure modules: node test/run.js
globalThis.SM = {};
for (const f of ['util', 'transform', 'doc', 'generate', 'gif']) require('../js/' + f + '.js');
const SM = globalThis.SM;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const px = (buf, w, x, y) => Array.from(buf.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const R = [255, 0, 0, 255];
function make(w, h, pts) { const b = SM.blank(w, h); for (const [x, y, c] of pts) b.set(c || R, (y * w + x) * 4); return b; }
const count = (b) => { let n = 0; for (let i = 3; i < b.length; i += 4) if (b[i]) n++; return n; };

test('flipH / flipV', () => {
  const b = make(4, 3, [[0, 0]]);
  eq(px(SM.flipH(b, 4, 3), 4, 3, 0), R); eq(px(SM.flipV(b, 4, 3), 4, 0, 2), R);
});
test('rotate90 clockwise moves top-left to top-right', () => {
  const b = make(4, 2, [[0, 0]]);
  const r = SM.rotate90(b, 4, 2, true); // now 2 wide, 4 tall
  eq(px(r, 2, 1, 0), R);
  const l = SM.rotate90(b, 4, 2, false);
  eq(px(l, 2, 0, 3), R);
});
test('rotateNN 90deg about pixel centre is exact', () => {
  const b = make(5, 5, [[3, 2]]); // right of centre pixel (2,2)
  const r = SM.rotateNN(b, 5, 5, 90, 2.5, 2.5);
  eq(px(r, 5, 2, 3), R, 'clockwise 90: right -> down');
  eq(count(r), 1);
  eq(px(SM.rotateNN(b, 5, 5, 180, 2.5, 2.5), 5, 1, 2), R);
  eq(px(SM.rotateNN(b, 5, 5, 270, 2.5, 2.5), 5, 2, 1), R);
});
test('rotSprite 360 is identity and 90 matches nearest', () => {
  const b = make(8, 8, [[1, 1], [2, 1], [3, 5]]);
  eq(Array.from(SM.rotSprite(b, 8, 8, 360, 4, 4)), Array.from(b));
  eq(Array.from(SM.rotSprite(b, 8, 8, 90, 4, 4)), Array.from(SM.rotateNN(b, 8, 8, 90, 4, 4)));
});
test('rotSprite 45deg keeps a solid square roughly the same area and stays opaque', () => {
  const pts = []; for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) pts.push([x, y]);
  const b = make(24, 24, pts);
  const r = SM.rotSprite(b, 24, 24, 45, 12, 12);
  const n = count(r);
  if (n < 50 || n > 80) throw new Error('area ' + n);
  for (let i = 0; i < r.length; i += 4) if (r[i + 3] && r[i + 3] !== 255) throw new Error('semi-transparent pixel');
});
test('scale2x doubles size', () => { eq(SM.scale2x(make(3, 3, [[1, 1]]), 3, 3).length, 6 * 6 * 4); });
test('transformRegion moves only the selection', () => {
  const b = make(10, 10, [[1, 1], [8, 8]]);
  const r = SM.transformRegion(b, 10, 10, { x: 0, y: 0, w: 4, h: 4 }, { dx: 2, dy: 3 });
  eq(px(r.data, 10, 3, 4), R); eq(px(r.data, 10, 1, 1), [0, 0, 0, 0]); eq(px(r.data, 10, 8, 8), R);
  eq(r.bounds, { x: 3, y: 4, w: 1, h: 1 });
});
test('stackRender lifts upper slices', () => {
  const a = make(8, 8, [[4, 4]]), c = make(8, 8, [[4, 4]], [0, 0, 255, 255]);
  const out = SM.stackRender([a, c], 8, 8, 0, 2, 1);
  eq(count(out), 2);
  eq(px(out, 8, 4, 2), R); // lifted slice shows at y-2... (index 1)
});
test('doc layers/frames and tags stay consistent', () => {
  const d = new SM.Doc(4, 4);
  d.addFrame(1, 0); d.addFrame(2, 0); d.tags.push({ name: 'a', from: 1, to: 2 });
  d.addFrame(0, null);
  eq(d.tags[0], { name: 'a', from: 2, to: 3 });
  d.removeFrame(0); eq(d.tags[0], { name: 'a', from: 1, to: 2 });
  d.addLayer('x'); eq(d.frames.every((f) => f.cels.length === 2), true);
  d.moveLayer(1, -1); eq(d.layers[0].name, 'x');
});
test('history undo/redo is copy-on-write safe', () => {
  const d = new SM.Doc(4, 4), h = new SM.History(d);
  h.commit(); d.celW(0, 0)[3] = 255;
  h.commit(); d.celW(0, 0)[7] = 255;
  eq(d.cel(0, 0)[7], 255);
  h.undo(); eq(d.cel(0, 0)[7], 0); eq(d.cel(0, 0)[3], 255);
  h.undo(); eq(d.cel(0, 0)[3], 0);
  h.redo(); h.redo(); eq(d.cel(0, 0)[7], 255);
});
test('serialize round-trips', () => {
  const d = new SM.Doc(6, 5); d.celW(0, 0).set(R, 8); d.addFrame(1, 0); d.tags.push({ name: 't', from: 0, to: 1 });
  const e = SM.deserialize(JSON.parse(JSON.stringify(SM.serialize(d))));
  eq(Array.from(e.cel(1, 0)), Array.from(d.cel(1, 0))); eq(e.tags, d.tags); eq([e.w, e.h], [6, 5]);
});
test('resize anchors content', () => {
  const d = new SM.Doc(4, 4); d.celW(0, 0).set(R, 0);
  d.resize(8, 8, 1, 1); eq(px(d.cel(0, 0), 8, 4, 4), R);
});
test('turntable produces count frames and a tag', () => {
  const d = new SM.Doc(16, 16), h = new SM.History(d);
  for (let y = 4; y < 8; y++) for (let x = 8; x < 14; x++) d.celW(0, 0).set(R, (y * 16 + x) * 4);
  const ctx = { doc: d, hist: h, frame: 0, layer: 0, sel: null };
  SM.gen.turntable(ctx, { count: 8, total: 360, direction: 'cw', method: 'rotsprite', pivot: 'center', tag: true, tagName: 'spin' });
  eq(d.frames.length, 8); eq(d.tags[0], { name: 'spin', from: 0, to: 7 });
  const n0 = count(d.cel(0, 0));
  for (let i = 1; i < 8; i++) { const n = count(d.cel(i, 0)); if (n < n0 * 0.6 || n > n0 * 1.5) throw new Error('frame ' + i + ' area ' + n + ' vs ' + n0); }
  eq(Array.from(d.cel(4, 0)), Array.from(SM.rotateNN(d.cel(0, 0), 16, 16, 180, 8, 8)));
  h.undo(); eq(d.frames.length, 1);
});
test('stackRotate adds a Stack layer and hides slices', () => {
  const d = new SM.Doc(16, 16), h = new SM.History(d);
  d.addLayer('top'); d.celW(0, 0).set(R, (8 * 16 + 8) * 4); d.celW(0, 1).set(R, (8 * 16 + 9) * 4);
  const ctx = { doc: d, hist: h, frame: 0, layer: 0, sel: null };
  const r = SM.gen.stackRotate(ctx, { count: 4, total: 360, spacing: 1, squash: 1, hideSlices: true, tag: true });
  eq(d.frames.length, 4); eq(d.layers.length, 3); eq(d.layers[0].visible, false); eq(r.layer, 2);
  eq(count(d.cel(0, 2)), 2);
});
test('tween loop returns to the start pose', () => {
  const d = new SM.Doc(16, 16), h = new SM.History(d);
  d.celW(0, 0).set(R, (8 * 16 + 8) * 4);
  const ctx = { doc: d, hist: h, frame: 0, layer: 0, sel: null };
  SM.gen.tween(ctx, { count: 8, dx: 4, dy: 0, angle: 0, ease: 'linear', mode: 'loop', pivot: 'center' });
  eq(d.frames.length, 8);
  eq(px(d.cel(4, 0), 16, 12, 8), R, 'peak at the middle frame');
  eq(px(d.cel(7, 0), 16, 9, 8), R, 'almost back');
});
test('tween one-way ends on target', () => {
  const d = new SM.Doc(16, 16), h = new SM.History(d);
  d.celW(0, 0).set(R, (8 * 16 + 8) * 4);
  SM.gen.tween({ doc: d, hist: h, frame: 0, layer: 0, sel: null }, { count: 5, dx: 4, dy: 2, angle: 0, ease: 'linear', mode: 'oneway', pivot: 'center' });
  eq(px(d.cel(4, 0), 16, 12, 10), R);
});
test('gif encoder emits a valid-looking file', () => {
  const f = [make(4, 4, [[1, 1]]), make(4, 4, [[2, 2]])];
  const g = SM.encodeGIF(f, 4, 4, [100, 100]);
  eq(String.fromCharCode(...g.slice(0, 6)), 'GIF89a'); eq(g[g.length - 1], 0x3b);
  require('fs').writeFileSync(process.env.GIF_OUT || '/dev/null', g);
});
if (failed) { console.log(failed + ' failed'); process.exit(1); } else console.log('all passed');
