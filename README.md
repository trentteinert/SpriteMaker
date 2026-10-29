# SpriteMaker

A pixel-art editor in the spirit of Aseprite, with extra tools for **rotating** sprites and **generating animation**.
It is a desktop app built with Electron, and the editor itself is plain HTML/CSS/JavaScript with no build step.

```
npm install
npm start          # launch the desktop app
npm run dist       # build an installer for your OS into dist/ (AppImage/deb, NSIS/portable, dmg)
npm run web        # or serve it in a browser at http://localhost:8000
```

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
