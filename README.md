# SpriteMaker

A pixel-art editor in the spirit of Aseprite, with extra tools for **rotating** sprites and **generating animation**.
It is a desktop app built with Electron, and the editor itself is plain HTML/CSS/JavaScript with no build step.

```
npm install
npm start          # launch the desktop app
npm run dist       # build an installer for your OS into dist/ (AppImage/deb, NSIS/portable, dmg)
npm run web        # or serve it in a browser at http://localhost:8000
```

## The workflow: one sprite → a complete game sprite sheet
1. Draw your idle character or object on a canvas with some empty room around it.
2. Split it into parts: select the head (M) → **J** (lift to new layer) → name it; repeat for arms, legs, weapon.
3. **Generate ▸ Full sprite set** (▦ Full set): tick the animations you want (idle, walk, run, jump, attack, hurt, death),
   set frame counts, Generate. Each animation gets its own tag. Use **Animation starter** instead when you want to tune one
   animation with a live preview and edit the joints.
4. Play with Enter, paint over the generated poses to clean them up (onion skin is on).
5. **File ▸ Export** → *PNG sprite sheet + JSON* with layout **One row per tag**: one row per animation, plus JSON with each
   animation's row, frame rectangles, durations, loop flag and the sprite pivot (Aseprite-style `frameTags` are included too).

## The basics
Pencil, eraser, line, rectangle, ellipse, fill, eyedropper, rectangular selection (drag to move; copy/cut/paste;
arrow-key nudge), brush size/shape, mirror drawing (X/Y), palettes (DB32, PICO-8, Game Boy…), layers with
visibility/opacity (drag layers in the timeline to reorder them), frames with per-frame timing, tags, onion skinning, live preview, unlimited undo,
zoom/pan with grid. Left button draws with the foreground colour, right button with the background colour.
Your work is autosaved in the browser; **File ▸ Save project** writes a `.spritemaker.json` file.

## Rotation tools (the extras)
* **Pivot (P)**: click to set the rotation centre (magenta marker). Saved with the project and exported in the sheet JSON.
* **Sprite ▸ Rotate…**: rotate the selection, a cel, a frame, or every frame by any angle. The *RotSprite*
  method upscales with Scale2x, rotates, and reduces again so edges stay crisp. *Nearest* is the fast option.
* **Generate ▸ Side-view turn (3D)**: for side/front-view characters and objects. It gives the sprite depth and renders it
  spinning around its vertical axis (pivot X). One layer is inflated into a rounded shape; several layers act as depth slices
  (bottom = farthest, top = nearest), e.g. far arm / body / near arm. Choose rounded or flat thickness.
* **Generate ▸ Top-down rotation frames**: in-plane rotation into a 4–36 frame spin, for top-down sprites (ships, cars, turrets).
* **Generate ▸ Top-down stack rotation**: draw an object as top-down slices on separate layers and render it spinning
  in pseudo-3D (stacked-sprite technique) with adjustable slice spacing and camera tilt.
* Rotate 90°, flip H/V, canvas resize with anchor, crop to content.

## Animation starter (idle → walk / run / jump / attack / hurt / death)
**Generate ▸ Animation starter** (or the ★ Animate button) builds key-pose frames from your finished idle sprite.
It follows how pixel artists actually work: split the character into parts, pose each key frame with integer-pixel
moves and crisp rotation, then paint over the result to clean it up. It does *not* try to replace hand polish.

1. **Split the sprite into parts**: with the Select tool (M) select the head, press **J** (Lift selection to new layer),
   name it; repeat for arms, legs and a weapon. The original layer stays active so you can keep lifting. Layers named
   head/arm/leg/sword… get their role guessed (add "far" or "back" for the far-side limbs).
2. **Open the starter**: pick an animation, frames, speed, facing and strength. A live preview plays in the dialog, and the
   rig view shows each part's joint. Edit roles and joints in the table, or Shift+click with the Pivot tool.
3. **Generate**: new frames are inserted after the current one and tagged. Onion skin turns on. Play with Enter and paint over the poses.

Presets use standard key poses: walk = contact/down/passing/up with counter-swinging arms; run = bigger swing, lean and a bounce;
jump = crouch, launch stretch, peak, fall stretch, landing squash; attack = windup, strike with a lunge, follow-through;
hurt = recoil with optional white flash; death = topple about the feet; idle = breathing. Frame counts default to common
starting points (walk 6, run 6, jump 8, attack 6, hurt 4, death 8) and are adjustable. Leave empty canvas around the sprite for jumps and falls.

## Animation tools
* **Generate ▸ Motion tween**: select a part (an arm, a leg) and generate frames that interpolate move + rotate
  with easing, either one-way or as a seamless loop. With no selection it animates the whole layer (body bob).
* Ping-pong and reverse frames, new/duplicate/move frames, per-frame durations, tags, play modes
  (loop / ping-pong / once), tag-only preview.

## Export
PNG (current frame), sprite sheet PNG plus Aseprite-style JSON (frames, durations, tags, pivot), animated GIF with
transparency. All with 1–8x scaling and optional tag selection. **File ▸ Import** reads PNG sprite sheets.

Shortcuts are listed under **Help ▸ Keyboard shortcuts**.

## Development
```
npm test        # unit tests for the pure modules (transform, document, generators, GIF encoder)
```
Layout: `js/util.js` helpers · `js/transform.js` rotation maths · `js/doc.js` document + undo ·
`js/generate.js` rotation/tween generators · `js/gif.js` encoder · `js/tools.js` · `js/editor.js` canvas/view ·
`js/export.js` · `js/ui.js` panels, menus, dialogs.
