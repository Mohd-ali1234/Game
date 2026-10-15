# 🕯️ Dark Hunt — Blackwood Manor

A free, browser-based, multiplayer **first-person horror** game. Up to 6 friends explore a dark
**haunted Victorian mansion** with warm flashlights, talking over **proximity voice chat**,
while a pale figure watches from the ends of the corridors.

- **Three.js** 3D, **Rapier** physics, **Socket.IO** multiplayer, **WebRTC** voice.
- One free **Render.com** Web Service, deployed straight from this GitHub repo — all doable from a phone.

> Status: the multiplayer foundation + the first map. No monster attacks or treasure yet.

---

## 🚀 Deploy on Render (free) — phone-only steps

1. The code must be on the `main` branch of this GitHub repo.
2. Open **https://render.com** → **Get Started** → **Sign in with GitHub** (allow it to see this repo).
3. **New +** → **Blueprint** → pick this repo → **Apply**. (`render.yaml` fills in everything: Singapore region, free plan.)
4. Wait for the build (**3–6 minutes**; longer when it is compressing new textures/models). **Logs** shows progress.
5. When it says **Live**, open the link at the top (like `https://dark-hunt-xxxx.onrender.com`).

> No Blueprint option? **New +** → **Web Service** → this repo → Region **Singapore** · Runtime **Node** ·
> Build `npm install --include=dev && npm run build` · Start `npm start` · Instance **Free**.

Every push to `main` redeploys automatically.

### 😴 The free server sleeps
After ~15 minutes with nobody playing, Render puts the server to sleep. The next visitor waits **30–60 seconds**
on the **"Waking up the server…"** screen — it switches to the lobby by itself. Rooms live in memory, so after a
sleep just create a new room. Tip: open the link a minute before your friends.

---

## 👥 Playing with friends

1. Open the link, type a name, pick an avatar, **Create Room** (you get a 4-letter code).
2. Tap **🔗 Copy invite link** and send it (WhatsApp etc.). Friends open it and tap **Join Room**.
3. While the mansion loads you'll see a **loading bar** (first visit downloads ~3 MB; more once you add textures).

| | Computer | Phone |
|---|---|---|
| Move | **WASD** / arrow keys | **Left-thumb joystick** |
| Look | **Click the game** (captures the mouse), Esc to free it | **Drag on the right half** of the screen |
| Open / close doors | **E** (when "[E] Open door" shows) | the **✋** button that appears near doors |

Buttons (top-right): 🎤 mute (green ring = you're talking) · ⚙️ settings · 🐞 debug · 🚪 leave.

**The ghost:** a tall pale figure stands still at the far end of corridors. Point your flashlight **straight at it**
and it vanishes… and reappears somewhere nearby a few seconds later. Your flashlight **flickers** when one is close,
and you'll hear a low hum. It doesn't attack (yet). Everyone in the room sees the same ghost and the same doors.

🎧 **Wear headphones** — it stops voice echo and the sounds are much creepier.

### ⚙️ Settings (saved on your device)
- **Look sensitivity** and **Field of view** sliders.
- **Graphics quality**
  - **Low** — no shadows, no camera effects, small textures. For budget phones.
  - **Medium** — flashlight shadows + "cookie" beam, film grain, vignette, bloom, colour grade. **Default on phones.**
  - **High** — everything, sharper shadows, full resolution, 4 nearby players' flashlights. **Default on computers.**
- If the game can't keep up it **lowers the resolution automatically** (watch the 🐞 panel's `@0.80x` number).
  Shadows/effects change instantly; texture size changes the next time you join.

### 🐞 Debug panel
Shows connection status, ping, **FPS**, **total download size**, quality + resolution, draw calls/triangles,
**your position and room name** (handy when editing the map), mic state, and every error/warning.
Screenshot it if something goes wrong.

---

## 🏚️ The map: Blackwood Manor

Two floors joined by a grand staircase, plus an attic:

| Ground floor | First floor | Top |
|---|---|---|
| Entrance Hall (spawn, double height, grand staircase) | Upper Corridor | Attic (via the Attic Stairwell) |
| Main Corridor (28 m long) | Nursery | |
| Library · Dining Room · Kitchen | Master Bedroom · Guest Room | |
| Locked **front door**, locked **basement door** (future map) | | |

### ✏️ Changing the map — `shared/maps/mansion.json` (no code needed)
Open it on GitHub, tap ✏️, edit, commit. Coordinates are **meters**; north is `-z`, east is `+x`.
The 🐞 panel shows your current position and room, which makes placing things easy.

- **rooms**: `x, z` (north-west corner), `w` (east-west size), `d` (north-south size), `floor` (0, 1, 2),
  optional `h` (height), and materials: `wall`, `floorMat`, `ceiling`, `wainscot` (lower wood panels or `false`).
  Each room gets its own walls automatically.
- **doors**: `"between": ["roomA", "roomB"]` puts a door in the middle of their shared wall
  (`"at": 0.3` moves it along). `"type": "arch"` = open doorway. `"locked": true, "label": "…"` = locked door
  with a message. A door in an outside wall: `"room": "kitchen", "wall": "n", "at": 0.7`.
- **stairs**: inside a room — start `x, z` (relative to the room), `width`, `length`, `dir` (the way you walk **up**: n/s/e/w),
  `rise`. The top must end at a wall that touches the room above; an opening is cut there automatically.
- **props**: `type` (see `shared/props.ts`), `room`, `x, z` inside the room, `rot` (degrees). Wall things
  (paintings, windows, lamps, fireplaces) use `"wall": "n|s|e|w", "at": 0..1, "y": height of the centre`.
  `"with": "vase_flowers"` puts something on top of a table. Rugs use `w` and `l`.
- **ghostSpots**: where the ghost may stand. Put them at the far ends of corridors and dark corners.
- If something is wrong (unknown room, rooms that don't touch…), Render's log shows `MAP WARNING: …`.

---

## 🎨 Making it look real: free CC0 textures & models

Everything has a **built-in fallback** (textures generated in code, furniture built from shapes), so you can add
real assets **one at a time** and nothing breaks. Upload through GitHub on your phone:
open the folder → **Add file → Upload files** → commit. Render rebuilds and **compresses them automatically**
(textures → **KTX2**, models → **meshopt + KTX2** `.glb`), so downloads stay small on mobile data.

> ⚠️ I couldn't open polyhaven.com from the computer I built this on, so the asset names below are from memory.
> If a name doesn't exist, search Poly Haven for the words in the "look for" column and pick any similar **CC0**
> asset. If its file names differ, either rename the files to the **"or name it"** column before uploading,
> or add the new name to the `files` list in `client/src/materials.ts` / `MODEL_NAMES` in `client/src/models.ts`
> (both are plain text you can edit on GitHub).

### Textures → `client/public/textures/`
On **polyhaven.com/textures**: open the texture → pick **1K** and **JPG** → download these maps:
**Diffuse**, **Normal (GL)** (not DX!) and **Rough** (or **ARM**). Upload them as they are, e.g.
`wood_floor_worn_diff_1k.jpg`, `wood_floor_worn_nor_gl_1k.jpg`, `wood_floor_worn_rough_1k.jpg`.

| Used for | Look for (Poly Haven name) | or name it |
|---|---|---|
| **Dark wood**: furniture, doors, stairs, frames, rails | "dark wood" — `dark_wood` or `wood_table_001` | `wood_dark_diff.jpg`, `wood_dark_nor_gl.jpg`, `wood_dark_rough.jpg` |
| **Floorboards** (almost every floor) | "worn wood floor" — `wood_floor_worn` | `floorboards_diff.jpg` … |
| **Ceilings & plaster walls** | "painted plaster" — `painted_plaster_wall` or `beige_wall_001` | `plaster_diff.jpg` … |
| **Attic & stairwell planks** | "grey planks" — `wood_planks_grey` or `brown_planks_03` | `attic_planks_diff.jpg` … |
| **Fireplace brick** | "red brick" — `red_brick_03` | `brick_diff.jpg` … |
| **Kitchen floor tiles** | "floor tiles" / "checker tiles" | `tiles_diff.jpg` … |
| **Rugs & stair runner** | "fabric pattern" — `fabric_pattern_05` | `carpet_diff.jpg` … |
| **Wall panelling (lower walls)** | "wood panel" / "wainscot" (ambientCG has some) | `wood_panel_diff.jpg` … |
| **Wallpapers** (5 colours) | Poly Haven has almost none — try ambientCG "wallpaper"; the built-in damask is decent | `wallpaper_red_diff.jpg`, `wallpaper_green_…`, `wallpaper_blue_…`, `wallpaper_brown_…`, `wallpaper_nursery_…` |
| Armchair / curtain velvet | "velvet" / "fabric" | `fabric_red_diff.jpg`, `fabric_green_diff.jpg` |
| Bed sheets / dust sheets | "linen" / "cotton" | `linen_diff.jpg` |

### Models → `client/public/models/`
On **polyhaven.com/models**: open the model → pick **glTF** and **1K** → download the **.zip** → upload the zip as it is.
Models are scaled and placed automatically.

| Prop | Look for (Poly Haven name) | or name it |
|---|---|---|
| Four-poster bed | `GothicBed_01` | `bed.glb` / `bed.zip` |
| Wardrobe | `GothicCabinet_01` | `wardrobe.zip` |
| Dresser | `GothicCommode_01` | `dresser.zip` |
| Sideboard | `ClassicConsole_01` | `sideboard.zip` |
| Armchair | `ArmChair_01` / `Ottoman_01` | `armchair.zip` |
| Rocking chair | `Rockingchair_01` | `rocking_chair.zip` |
| Grandfather clock | "grandfather clock" — `vintage_grandfather_clock_01` | `grandfather_clock.zip` |
| Side table | "side table" — `side_table_01` | `side_table.zip` |
| Vase (+ dead flowers) | "antique vase" — `antique_ceramic_vase_01` | `vase_flowers.zip` |
| Chandelier | "chandelier" — `Chandelier_01` | `chandelier.zip` |
| Candelabra | "candle holder" / "candelabra" | `candelabra.zip` |
| Picture frames | "picture frame" — `fancy_picture_frame_01` | `painting.zip` |
| Crates | "wooden crate" — `wooden_crate_01` | `crate.zip` |
| Chairs | "wooden chair" | `chair.zip` |
| The ghost | any tall figure (Sketchfab/Quaternius CC0) | `ghost.glb` (keeps the ghostly glow) |
| Player avatars | any CC0 character | `avatar_0.glb` … `avatar_7.glb` |

### Sounds (optional) → `client/public/sounds/`
All sounds are generated in code. To use real recordings (CC0 from freesound.org / Pixabay), upload short
`.ogg`/`.mp3` files named: `floor_creak`, `footstep`, `door_creak`, `door_locked`, `whisper`, `clock_tick`.

---

## 💡 How it's built (and kept fast on phones)

- **Map from data**: `shared/layout.ts` turns the JSON into walls (with door holes cut out), floors, stairs ramps,
  door colliders, furniture, light sources and sound sources — used by **both** server and browser.
- **Lighting**: only flashlights are real-time. Wall lamps, candles and moonlight are **baked** into the
  geometry once while loading (free at run-time), plus glowing windows, moonbeams and lamp halos.
- **Flashlight**: warm spotlight with a "cookie" texture (uneven beam, lens smudges), soft edges, sway while
  walking, slight lag when turning, flicker near ghosts.
- **Static geometry merged** into one mesh per material: ~40 draw calls for the whole house on Low, ~70–130 on Medium/High (shadow + effect passes included).
- **Post-processing** (pmndrs `postprocessing`): bloom, film grain, vignette, slight chromatic aberration, warm muted grade.
- **Server-authoritative multiplayer** (20 updates/s) with client-side prediction (same Rapier physics as the server)
  and interpolation. Doors and ghosts are decided by the server, so everyone sees the same thing.
- **Proximity voice** (WebRTC, Google STUN; add a TURN server in `client/src/voice.ts` for strict mobile networks).

---

## 📁 Files

| File | What it does |
|---|---|
| `render.yaml` | Render deploy settings (Singapore, free) |
| `package.json` | Libraries + `build` / `start` |
| `scripts/build-assets.mjs` | Runs during the build: textures → KTX2, models → compressed .glb, writes the asset list |
| `shared/maps/mansion.json` | **The map** (rooms, doors, stairs, furniture, ghost spots) |
| `shared/layout.ts` | Turns the map file into walls/floors/doors/colliders |
| `shared/props.ts` | Every furniture type and its size |
| `shared/game.ts` | Speeds, sizes, and the Rapier physics used by server + browser |
| `server/index.ts` | The Node server: game files, rooms, 20 Hz loop, doors, ghosts, voice signalling |
| `client/index.html`, `client/src/style.css` | Screens, buttons, layout |
| `client/src/main.ts` | Glue: lobby, joining, loading bar, reconnecting, buttons, debug numbers |
| `client/src/game.ts` | The 3D view: flashlight, movement, other players, doors, quality presets |
| `client/src/mansion.ts` | Builds the house, merges geometry, bakes light, doors, moonbeams |
| `client/src/props3d.ts` | Placeholder furniture made of shapes |
| `client/src/materials.ts` | **Material list** (which texture files each surface uses) |
| `client/src/procedural.ts` | Fallback textures generated in code, flashlight cookie, paintings |
| `client/src/models.ts` | **Model registry** (file names per prop) + auto-fitting |
| `client/src/assets.ts` | Downloads textures/models/sounds (KTX2, Draco, meshopt) and counts bytes |
| `client/src/ghost.ts` | The ghost's look (glowing, see-through, shimmering) |
| `client/src/sound.ts` | Creaks, footsteps, whispers, clocks, wind, ghost hum |
| `client/src/post.ts` | Camera effects |
| `client/src/avatar3d.ts`, `avatars.ts` | Player avatars |
| `client/src/voice.ts`, `ui.ts` | Voice chat; joystick, settings, debug panel |

## 💻 On a computer (optional)
```bash
npm install
npm run build
npm start        # http://localhost:3000
```
`npm run typecheck` checks for TypeScript errors.
