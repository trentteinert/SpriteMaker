// Dependency-free tests for the pure modules: node test/run.js
globalThis.SM = {};
for (const f of ['util', 'transform', 'doc', 'generate', 'anim', 'gif']) require('../js/' + f + '.js');
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
test('reorderLayer moves layers and their cels together', () => {
  const d = new SM.Doc(2, 2); d.addLayer('b'); d.addLayer('c'); d.addFrame(1, null);
  d.celW(0, 0)[0] = 1; d.celW(0, 1)[0] = 2; d.celW(0, 2)[0] = 3; d.celW(1, 0)[0] = 4;
  eq(d.reorderLayer(0, 2), 2);
  eq(d.layers.map((l) => l.name), ['b', 'c', 'Layer 1']);
  eq([d.cel(0, 0)[0], d.cel(0, 1)[0], d.cel(0, 2)[0], d.cel(1, 2)[0]], [2, 3, 1, 4]);
  eq(d.reorderLayer(2, 1), 1); eq(d.layers.map((l) => l.name), ['b', 'Layer 1', 'c']);
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
test('side-view turn: 0 deg matches the flattened sprite, 180 mirrors it, 90 is a thin slab', () => {
  const pts = []; for (let y = 2; y < 10; y++) for (let x = 3; x < 9; x++) pts.push([x, y]);
  const a = make(12, 12, pts);
  for (const mode of ['flat', 'rounded']) {
    const m = SM.buildVoxels([a], 12, 12, { thickness: 4, spacing: 0, mode });
    const r0 = SM.renderTurn(m, 0, 6, 1);
    eq(Array.from(r0), Array.from(a), mode + ' 0deg');
    const r180 = SM.renderTurn(m, 180, 6, 1);
    eq(Array.from(r180), Array.from(SM.flipH(a, 12, 12)), mode + ' 180deg');
    const r90 = SM.renderTurn(m, 90, 6, 1);
    const b = SM.bounds(r90, 12, 12);
    if (!b || b.w > 5 || b.w < 1 || b.h !== 8) throw new Error(mode + ' 90deg bounds ' + JSON.stringify(b));
  }
});
test('side-view turn: layer depth order decides who is in front', () => {
  const back = make(8, 8, [[3, 3, [0, 0, 255, 255]]]), front = make(8, 8, [[3, 3]]);
  const m = SM.buildVoxels([back, front], 8, 8, { thickness: 1, spacing: 2, mode: 'flat' });
  eq(px(SM.renderTurn(m, 0, 4, 1), 8, 3, 3), [255, 0, 0, 255]);
  eq(px(SM.renderTurn(m, 180, 4, 1), 8, 4, 3), [0, 0, 255, 255]);
});
test('rounded turn is thinner at the edges than the middle', () => {
  const pts = []; for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) pts.push([x, y]);
  const m = SM.buildVoxels([make(12, 12, pts)], 12, 12, { thickness: 8, spacing: 0, mode: 'rounded' });
  const depth = (x, y) => { let n = 0; for (let z = 0; z < m.D; z++) if (m.vox[x + 12 * (y + 12 * z)]) n++; return n; };
  if (!(depth(6, 6) > depth(0, 6))) throw new Error('middle ' + depth(6, 6) + ' edge ' + depth(0, 6));
});
test('turn generator adds a Turn layer, frames and hides sources', () => {
  const d = new SM.Doc(12, 12), h = new SM.History(d);
  for (let y = 2; y < 10; y++) for (let x = 4; x < 8; x++) d.celW(0, 0).set(R, (y * 12 + x) * 4);
  const r = SM.gen.turn({ doc: d, hist: h, frame: 0, layer: 0, sel: null }, { count: 8, total: 360, direction: 'right', thickness: 4, spacing: 0, shape: 'rounded', pivot: 'doc', hideSlices: true, tag: true, shade: true });
  eq(d.frames.length, 8); eq(d.layers[1].name, 'Turn'); eq(d.layers[0].visible, false); eq(r.layer, 1);
  eq(Array.from(d.cel(0, 1)), Array.from(d.cel(0, 0)));
});
// ---- animation starter ----
function stickman() { // 3 layers on a 32x32 canvas: body, near leg, head
  const d = new SM.Doc(32, 32);
  d.layers[0].name = 'body'; d.addLayer('leg'); d.addLayer('head');
  const P = (l, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) d.celW(0, l).set(R, (y * 32 + x) * 4); };
  P(0, 14, 12, 17, 20); P(1, 15, 21, 16, 28); P(2, 14, 6, 17, 11);
  return d;
}
test('guessRole reads layer names', () => {
  eq(['Head', 'arm far', 'Left Leg', 'sword', 'torso', 'shadow'].map(SM.anim.guessRole), ['head', 'armF', 'legF', 'weapon', 'body', 'fixed']);
});
test('rigFor finds feet, scale and joints', () => {
  const d = stickman(), rig = SM.anim.rigFor(d, 0);
  eq(rig.roles, ['body', 'legN', 'head']);
  eq(rig.feet, { x: 16, y: 29 }); eq(rig.joints[1], { x: 16, y: 21 }); eq(rig.joints[2], { x: 16, y: 12 });
});
test('walk: near leg swings toward the facing direction at contact', () => {
  const d = stickman(), rig = SM.anim.rigFor(d, 0);
  for (const dir of [1, -1]) {
    const f = SM.anim.build(d, 0, 'walk', { count: 6, ms: 100, dir, method: 'nearest' }, rig)[0];
    const b = SM.bounds(f.cels[1], 32, 32), footX = b.x + b.w / 2;
    if (dir * (footX - 16) <= 1) throw new Error('dir ' + dir + ' foot at ' + footX);
  }
});
test('walk loops: N frames, durations, first frame differs from the idle only by pose', () => {
  const d = stickman(), rig = SM.anim.rigFor(d, 0), fr = SM.anim.build(d, 0, 'walk', { count: 8, ms: 90, dir: 1, method: 'rotsprite' }, rig);
  eq(fr.length, 8); eq(fr.every((f) => f.duration === 90 && f.cels.length === 3), true);
  eq(Array.from(fr[0].cels[0]), Array.from(d.cel(0, 0)), 'torso does not move at contact');
});
test('jump peaks higher than idle and squashes on landing', () => {
  const d = stickman(); d.resize(32, 48, 0.5, 1); // headroom above the sprite
  const rig = SM.anim.rigFor(d, 0), fr = SM.anim.build(d, 0, 'jump', { count: 11, ms: 80, dir: 1, method: 'nearest' }, rig);
  const heightOf = (cels) => SM.bounds(SM.anim.flatten(d, cels), d.w, d.h);
  const idle = heightOf(d.frames[0].cels), peak = Math.min(...fr.map((f) => heightOf(f.cels).y));
  if (!(peak <= idle.y - 8)) throw new Error('peak y ' + peak + ' idle y ' + idle.y);
  const lb = heightOf(fr[fr.length - 2].cels);
  if (!(lb.h < idle.h)) throw new Error('landing height ' + lb.h + ' vs ' + idle.h);
  eq(heightOf(fr[0].cels), idle); eq(heightOf(fr[fr.length - 1].cels), idle);
});
test('hurt flash whitens the first frame only; strength 0 leaves the sprite untouched', () => {
  const d = stickman(), rig = SM.anim.rigFor(d, 0);
  const fr = SM.anim.build(d, 0, 'hurt', { count: 4, ms: 90, dir: 1, method: 'nearest', flash: true }, rig);
  const whites = (c) => { let n = 0; for (let i = 0; i < c.length; i += 4) if (c[i + 3] && c[i + 1] === 255) n++; return n; };
  eq(whites(fr[0].cels[2]) > 0 && fr[0].cels.every((c) => whites(c) === c.filter((v, i) => i % 4 === 3 && v).length), true);
  eq(fr.slice(1).every((f) => f.cels.every((c) => whites(c) === 0)), true);
  const z = SM.anim.build(d, 0, 'attack', { count: 6, ms: 80, dir: 1, method: 'nearest', strength: 0 }, rig);
  eq(z.every((f) => f.cels.every((c, l) => JSON.stringify(Array.from(c)) === JSON.stringify(Array.from(d.cel(0, l))))), true);
});
test('animStarter inserts frames after the source, tags them and remembers the rig', () => {
  const d = stickman(), h = new SM.History(d), rig = SM.anim.rigFor(d, 0);
  const r = SM.gen.animStarter({ doc: d, hist: h, frame: 0, layer: 0, sel: null }, 'run', { count: 6, ms: 70, dir: 1, method: 'nearest', rig, tagName: 'run' });
  eq(d.frames.length, 7); eq(d.tags[0], { name: 'run', from: 1, to: 6 }); eq(r.frame, 1);
  eq(d.layers[1].role, 'legN'); eq(d.frames[3].duration, 70);
  const e = SM.deserialize(JSON.parse(JSON.stringify(SM.serialize(d))));
  eq(e.layers[1].role, 'legN'); eq(e.layers[1].joint, { x: 16, y: 21 });
  h.undo(); eq(d.frames.length, 1);
});
test('gif encoder emits a valid-looking file', () => {
  const f = [make(4, 4, [[1, 1]]), make(4, 4, [[2, 2]])];
  const g = SM.encodeGIF(f, 4, 4, [100, 100]);
  eq(String.fromCharCode(...g.slice(0, 6)), 'GIF89a'); eq(g[g.length - 1], 0x3b);
  require('fs').writeFileSync(process.env.GIF_OUT || '/dev/null', g);
});
if (failed) { console.log(failed + ' failed'); process.exit(1); } else console.log('all passed');
