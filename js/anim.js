(function (G) {
  'use strict';
  const SM = G.SM;
  const anim = (SM.anim = {});

  // Layers act as body parts. A part has a role and a joint (the point it rotates about).
  anim.ROLES = [
    ['body', 'Body / torso (moves with the body)'], ['head', 'Head'],
    ['armN', 'Arm - near side'], ['armF', 'Arm - far side'],
    ['legN', 'Leg - near side'], ['legF', 'Leg - far side'],
    ['weapon', 'Weapon (follows near arm)'], ['fixed', 'Fixed (shadow, ground…)'],
  ];

  anim.guessRole = function (name) {
    const n = name.toLowerCase(), far = /far|back|behind|rear|left/.test(n);
    if (/head|face|hair|hat|helmet|eye/.test(n)) return 'head';
    if (/sword|weapon|staff|gun|bow|axe|spear|wand|shield/.test(n)) return 'weapon';
    if (/arm|hand|shoulder/.test(n)) return far ? 'armF' : 'armN';
    if (/leg|foot|feet|boot|knee|thigh/.test(n)) return far ? 'legF' : 'legN';
    if (/shadow|ground/.test(n)) return 'fixed';
    return 'body';
  };

  // Roles, joints, feet position and size scale for a set of per-layer cels (one frame).
  // Layer.role / layer.joint override guesses; with trustStored false the stored joint is only
  // used when it lies on that cel (so joints set for one view are not applied to another).
  anim.rigForCels = function (doc, cels, trustStored) {
    const w = doc.w, h = doc.h, trust = trustStored !== false;
    let all = null;
    doc.layers.forEach((L, l) => {
      if (!L.visible && doc.layers.some((x) => x.visible)) return;
      const b = SM.bounds(cels[l], w, h);
      if (!b) return;
      if (!all) all = { ...b };
      else { const x1 = Math.max(all.x + all.w, b.x + b.w), y1 = Math.max(all.y + all.h, b.y + b.h); all.x = Math.min(all.x, b.x); all.y = Math.min(all.y, b.y); all.w = x1 - all.x; all.h = y1 - all.y; }
    });
    all = all || { x: 0, y: 0, w, h };
    const roles = doc.layers.map((L) => L.role || anim.guessRole(L.name));
    const near = (b, j) => j.x >= b.x - 2 && j.x <= b.x + b.w + 2 && j.y >= b.y - 2 && j.y <= b.y + b.h + 2;
    const joints = doc.layers.map((L, l) => {
      const b = SM.bounds(cels[l], w, h);
      if (L.joint && (trust || !b || near(b, L.joint))) return { ...L.joint };
      const bb = b || all, cx = bb.x + bb.w / 2, r = roles[l];
      if (r === 'head') return { x: cx, y: bb.y + bb.h };
      if (r === 'armN' || r === 'armF' || r === 'legN' || r === 'legF') return { x: cx, y: bb.y };
      return { x: cx, y: bb.y + bb.h / 2 };
    });
    roles.forEach((r, l) => { // weapons pivot where the near arm does
      if (r !== 'weapon' || (doc.layers[l].joint && trust)) return;
      const a = roles.indexOf('armN');
      if (a >= 0) joints[l] = { ...joints[a] };
    });
    return { roles, joints, feet: { x: all.x + all.w / 2, y: all.y + all.h }, k: Math.max(0.5, all.h / 32), height: all.h, width: all.w };
  };
  anim.rigFor = (doc, f, trustStored) => anim.rigForCels(doc, doc.frames[f].cels, trustStored);

  // Facing directions. `angle` is the 3D turn from a front (down) view; front views (down/up)
  // walk by stepping in depth, side views (anything with a left/right part) swing their limbs.
  anim.DIR = {
    down: { view: 'front', fv: 1, dir: 1, angle: 0 }, down_right: { view: 'side', fv: 1, dir: 1, angle: 45 },
    right: { view: 'side', fv: 1, dir: 1, angle: 90 }, up_right: { view: 'side', fv: -1, dir: 1, angle: 135 },
    up: { view: 'front', fv: -1, dir: 1, angle: 180 }, up_left: { view: 'side', fv: -1, dir: -1, angle: 225 },
    left: { view: 'side', fv: 1, dir: -1, angle: 270 }, down_left: { view: 'side', fv: 1, dir: -1, angle: 315 },
  };

  const snap = (v) => Math.round(v - 1e-6);

  // Piecewise interpolation between keyed poses. Each key: { t, root: {dx,dy,sy,rot}, parts: {role: {rot,dx,dy}}, ease }.
  function lerp(a, b, e) { return a + (b - a) * e; }
  function keyed(keys, t) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    const span = b.t - a.t, u = span > 0 ? SM.clamp((t - a.t) / span, 0, 1) : 1, e = (SM.ease[b.ease || 'inOut'] || SM.ease.linear)(u);
    const ra = a.root || {}, rb = b.root || {};
    const root = {
      dx: lerp(ra.dx || 0, rb.dx || 0, e), dy: lerp(ra.dy || 0, rb.dy || 0, e),
      rot: lerp(ra.rot || 0, rb.rot || 0, e), sy: lerp(ra.sy || 1, rb.sy || 1, e),
    };
    const parts = {}, pa = a.parts || {}, pb = b.parts || {};
    for (const r of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      const x = pa[r] || {}, y = pb[r] || {};
      parts[r] = { rot: lerp(x.rot || 0, y.rot || 0, e), dx: lerp(x.dx || 0, y.dx || 0, e), dy: lerp(x.dy || 0, y.dy || 0, e) };
    }
    return { root, parts };
  }
  const both = (v) => ({ armN: v, armF: v });

  // Presets. c = { k: size scale, dir: +1 faces right / -1 left }. h = which way a hanging limb swings
  // to go "forward"; u = which way a standing part leans to go "forward".
  const P = (anim.PRESETS = {
    idle: {
      name: 'Idle breathing', loop: true, count: 4, ms: 220,
      info: 'Upper body rises a pixel and settles; feet stay planted.',
      pose(t, c) {
        const y = snap(c.k * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)) * 1.2);
        return { root: {}, parts: { body: { dy: -y }, head: { dy: -y }, armN: { dy: -y }, armF: { dy: -y }, weapon: { dy: -y } } };
      },
    },
    walk: {
      name: 'Walk cycle', loop: true, count: 6, ms: 110,
      front(t, c) { // seen from front/back: feet alternate up/down the screen instead of swinging sideways
        const sw = Math.cos(2 * Math.PI * t), sn = Math.sin(2 * Math.PI * t), k = c.k, v = c.fv;
        return {
          root: { dy: k * Math.cos(4 * Math.PI * (t - 0.125)) },
          parts: {
            legN: { dy: v * 1.2 * k * sw - 1.5 * k * Math.max(0, sn) }, legF: { dy: -v * 1.2 * k * sw - 1.5 * k * Math.max(0, -sn) },
            armN: { dy: -v * k * sw }, armF: { dy: v * k * sw },
          },
        };
      },
      info: 'Legs swing, arms counter-swing, body bobs: contact → down → passing → up.',
      pose(t, c) {
        const h = -c.dir, sw = Math.cos(2 * Math.PI * t);
        return {
          root: { dy: c.k * Math.cos(4 * Math.PI * (t - 0.125)) },
          parts: { legN: { rot: h * 24 * sw }, legF: { rot: -h * 24 * sw }, armN: { rot: -h * 18 * sw }, armF: { rot: h * 18 * sw } },
        };
      },
    },
    run: {
      name: 'Run cycle', loop: true, count: 6, ms: 80,
      front(t, c) {
        const sw = Math.cos(2 * Math.PI * t), sn = Math.sin(2 * Math.PI * t), k = c.k, v = c.fv;
        return {
          root: { dy: -2 * k * (0.5 - 0.5 * Math.cos(4 * Math.PI * t)) },
          parts: {
            legN: { dy: v * 2.2 * k * sw - 2.5 * k * Math.max(0, sn) }, legF: { dy: -v * 2.2 * k * sw - 2.5 * k * Math.max(0, -sn) },
            armN: { dy: -v * 1.8 * k * sw }, armF: { dy: v * 1.8 * k * sw },
          },
        };
      },
      info: 'Bigger swing, forward lean and a bounce with a short airborne moment.',
      pose(t, c) {
        const h = -c.dir, u = c.dir, sw = Math.cos(2 * Math.PI * t);
        return {
          root: { dy: -2 * c.k * (0.5 - 0.5 * Math.cos(4 * Math.PI * t)) },
          parts: {
            legN: { rot: h * 42 * sw }, legF: { rot: -h * 42 * sw }, armN: { rot: -h * 50 * sw }, armF: { rot: h * 50 * sw },
            body: { rot: u * 8 }, head: { rot: -u * 3 },
          },
        };
      },
    },
    jump: {
      name: 'Jump', loop: false, count: 8, ms: 90,
      front(t, c) {
        const H = 14 * c.k;
        return keyed([
          { t: 0 }, { t: 0.16, root: { dy: 2 * c.k, sy: 0.86 } }, { t: 0.32, root: { dy: -0.35 * H, sy: 1.1 }, ease: 'out' },
          { t: 0.52, root: { dy: -H }, ease: 'out' }, { t: 0.72, root: { dy: -0.5 * H, sy: 1.06 }, ease: 'in' },
          { t: 0.88, root: { sy: 0.82 }, ease: 'in' }, { t: 1 },
        ], t);
      },
      info: 'Anticipation crouch → launch stretch → peak → fall stretch → landing squash.',
      pose(t, c) {
        const h = -c.dir, H = 14 * c.k, a = (v) => both({ rot: h * v });
        return keyed([
          { t: 0 },
          { t: 0.16, root: { dy: 2 * c.k, sy: 0.86 }, parts: a(-30) },
          { t: 0.32, root: { dy: -0.35 * H, sy: 1.1 }, parts: a(70), ease: 'out' },
          { t: 0.52, root: { dy: -H }, parts: { ...a(50), legN: { rot: h * 30 }, legF: { rot: -h * 15 } }, ease: 'out' },
          { t: 0.72, root: { dy: -0.5 * H, sy: 1.06 }, parts: a(60), ease: 'in' },
          { t: 0.88, root: { sy: 0.82 }, parts: a(-20), ease: 'in' },
          { t: 1 },
        ], t);
      },
    },
    attack: {
      name: 'Attack (melee swing)', loop: false, count: 6, ms: 75,
      front(t, c) { // thrust toward / away from the camera
        const k = c.k, v = c.fv, arm = (y) => ({ armN: { dy: v * y }, weapon: { dy: v * y } });
        return keyed([
          { t: 0 },
          { t: 0.28, root: { dy: -v * k }, parts: arm(-2 * k), ease: 'out' },
          { t: 0.5, root: { dy: v * 2 * k }, parts: arm(3 * k), ease: 'in' },
          { t: 0.7, root: { dy: v * 3 * k }, parts: arm(4 * k), ease: 'out' },
          { t: 1 },
        ], t);
      },
      info: 'Windup (anticipation) → fast strike with a lunge → follow-through → recover. Paint a smear over the strike frame.',
      pose(t, c) {
        const h = -c.dir, u = c.dir, k = c.k;
        const arm = (v) => ({ armN: { rot: h * v }, weapon: { rot: h * v } });
        return keyed([
          { t: 0 },
          { t: 0.28, root: { dx: -u * k }, parts: { ...arm(-70), body: { rot: -u * 6 }, head: { rot: -u * 4 } }, ease: 'out' },
          { t: 0.5, root: { dx: u * 2 * k }, parts: { ...arm(85), body: { rot: u * 10 }, head: { rot: u * 4 } }, ease: 'in' },
          { t: 0.7, root: { dx: u * 3 * k }, parts: { ...arm(100), body: { rot: u * 10 }, head: { rot: u * 4 } }, ease: 'out' },
          { t: 1 },
        ], t);
      },
    },
    hurt: {
      name: 'Hurt / hit reaction', loop: false, count: 4, ms: 90, flash: true,
      front(t, c) {
        const k = c.k, v = c.fv;
        return keyed([{ t: 0, root: { dy: -v * 2 * k, sy: 0.92 } }, { t: 0.35, root: { dy: -v * 3 * k }, ease: 'out' }, { t: 0.7, root: { dy: -v * k } }, { t: 1 }], t);
      },
      info: 'Recoil away from the hit with a squash; optional white flash on the first frame.',
      pose(t, c) {
        const u = c.dir, k = c.k;
        return keyed([
          { t: 0, root: { dx: -u * 2 * k, sy: 0.92 } },
          { t: 0.35, root: { dx: -u * 3 * k }, parts: { body: { rot: -u * 10 }, head: { rot: -u * 14 } }, ease: 'out' },
          { t: 0.7, root: { dx: -u * k }, parts: { body: { rot: -u * 4 } } },
          { t: 1 },
        ], t);
      },
    },
    death: {
      name: 'Death (fall over)', loop: false, count: 8, ms: 110,
      front(t, c) { return P.death.pose(t, { ...c, dir: 1 }); }, // topples sideways whichever way it faced
      info: 'Recoil, then the whole body topples backward about the feet.',
      pose(t, c) {
        const u = c.dir, k = c.k;
        // Lying down, the body spans H pixels behind the feet; shift it just enough to stay on the canvas.
        const fit = u === 1 ? Math.max(0, c.H - c.fx + 1) : -Math.max(0, c.fx + c.H + 1 - c.w);
        return keyed([
          { t: 0 },
          { t: 0.15, root: { dx: -u * 2 * k }, parts: { head: { rot: -u * 12 } } },
          { t: 0.45, root: { dx: fit * 0.5 - u * 2 * k, rot: -u * 50 }, ease: 'in' },
          { t: 0.7, root: { dx: fit * 0.9, rot: -u * 85 }, ease: 'in' },
          { t: 1, root: { dx: fit, rot: -u * 90 } },
        ], t);
      },
    },
  });

  function renderLayer(cel, w, h, role, joint, pose, rig, method) {
    if (role === 'fixed') return new Uint8ClampedArray(cel);
    const part = pose.parts[role === 'weapon' && !pose.parts.weapon ? 'armN' : role] || {}, r = pose.root;
    let c = cel;
    if (part.rot) c = SM.rotate(c, w, h, part.rot, joint.x, joint.y, method);
    // Move first, then rotate/scale about the moved feet: same result as rotating first, but
    // nothing is clipped while it passes outside the canvas.
    const rdx = Math.round(r.dx || 0), rdy = Math.round(r.dy || 0);
    const dx = Math.round((part.dx || 0) + (r.dx || 0)), dy = Math.round((part.dy || 0) + (r.dy || 0));
    if (dx || dy) c = SM.translate(c, w, h, dx, dy);
    const fx = rig.feet.x + rdx, fy = rig.feet.y + rdy;
    if (r.rot) c = SM.rotate(c, w, h, r.rot, fx, fy, method);
    if (r.sy !== 1) c = SM.scaleAbout(c, w, h, 1, r.sy, fx, fy);
    return c === cel ? new Uint8ClampedArray(cel) : c;
  }

  // Builds the frames of preset `id` from per-layer cels. o: { count, ms, dir (+1 right / -1 left),
  // view ('side' | 'front'), fv (+1 faces down the screen / -1 faces up, front view), strength (percent),
  // method, flash }. Returns [{ cels, duration }] without touching the document.
  anim.buildFrom = function (doc, cels0, id, o, rig) {
    const pre = P[id], n = Math.max(2, o.count | 0), s = (o.strength === undefined ? 100 : o.strength) / 100;
    const fn = o.view === 'front' && pre.front ? pre.front : pre.pose;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = pre.loop ? i / n : i / (n - 1);
      const p = fn.call(pre, t, { k: rig.k, dir: o.dir || 1, fv: o.fv || 1, H: rig.height, fx: rig.feet.x, w: doc.w });
      const sc = (v) => (v || 0) * s;
      const pose = { root: { dx: sc(p.root.dx), dy: sc(p.root.dy), rot: sc(p.root.rot), sy: 1 + ((p.root.sy || 1) - 1) * s }, parts: {} };
      for (const r in p.parts) pose.parts[r] = { rot: sc(p.parts[r].rot), dx: sc(p.parts[r].dx), dy: sc(p.parts[r].dy) };
      const cels = doc.layers.map((_, l) => renderLayer(cels0[l], doc.w, doc.h, rig.roles[l], rig.joints[l], pose, rig, o.method));
      if (pre.flash && o.flash && i === 0) for (const c of cels) for (let q = 0; q < c.length; q += 4) if (c[q + 3]) { c[q] = c[q + 1] = c[q + 2] = 255; }
      out.push({ cels, duration: o.ms });
    }
    return out;
  };
  anim.build = (doc, src, id, o, rig) => anim.buildFrom(doc, doc.frames[src].cels, id, o, rig);

  // Flattens one built frame using the document's layer visibility and opacity.
  anim.flatten = function (doc, cels) {
    const out = SM.blank(doc.w, doc.h);
    doc.layers.forEach((L, l) => { if (L.visible) SM.blend(out, cels[l], L.opacity / 255); });
    return out;
  };
})(globalThis);
