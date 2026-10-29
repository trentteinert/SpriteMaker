(function (G) {
  'use strict';
  const SM = G.SM;
  const godot = (SM.godot = {});

  const num = (v) => String(Math.round(v * 1000) / 1000);
  const flt = (v) => { const t = num(v); return t.includes('.') ? t : t + '.0'; }; // Godot writes floats as 1.0

  // Godot 4 SpriteFrames resource: one animation per sheet row, each frame an AtlasTexture region.
  // anims: [{ name, loop, durations: [ms], rects: [{x,y,w,h}] }]; texturePath e.g. "res://sprites/hero.png".
  godot.spriteFrames = function (anims, texturePath) {
    const subs = [], entries = [];
    for (const a of anims) {
      const base = Math.max(1, Math.min(...a.durations)), frames = [];
      a.rects.forEach((r, i) => {
        const id = `AtlasTexture_${a.name}_${i}`;
        subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("1")\nregion = Rect2(${r.x}, ${r.y}, ${r.w}, ${r.h})\nfilter_clip = true\n`);
        frames.push(`{\n"duration": ${flt(a.durations[i] / base)},\n"texture": SubResource("${id}")\n}`);
      });
      entries.push(`{\n"frames": [${frames.join(', ')}],\n"loop": ${a.loop ? 'true' : 'false'},\n"name": &"${a.name}",\n"speed": ${flt(1000 / base)}\n}`);
    }
    return `[gd_resource type="SpriteFrames" load_steps=${subs.length + 2} format=3]\n\n[ext_resource type="Texture2D" path="${texturePath}" id="1"]\n\n${subs.join('\n')}\n[resource]\nanimations = [${entries.join(', ')}]\n`;
  };

  // A ready-to-use AnimatedSprite2D scene. offset puts the sprite's pivot at the node origin.
  godot.scene = function (nodeName, framesPath, firstAnim, offset) {
    const off = offset && (offset.x || offset.y) ? `\noffset = Vector2(${num(offset.x)}, ${num(offset.y)})` : '';
    return `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="SpriteFrames" path="${framesPath}" id="1"]\n\n[node name="${nodeName}" type="AnimatedSprite2D"]\ntexture_filter = 1\nsprite_frames = ExtResource("1")\nanimation = &"${firstAnim}"${off}\n`;
  };

  godot.isLooping = (name) => ['idle', 'walk', 'run'].includes(name.split('_')[0]);
})(globalThis);
