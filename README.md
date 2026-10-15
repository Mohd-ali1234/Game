# 🕯️ Dark Hunt — multiplayer foundation

A free, browser-based, multiplayer horror treasure-hunt game: **first-person 3D** (Three.js) in a dark map where every player carries a **flashlight that casts shadows**. Collisions use **Rapier physics**.

**This first version is the multiplayer foundation only** — no monster or treasure yet:
friends open a link, pick an avatar, join your room, walk around a dark map together, and talk to each other with **proximity voice chat** (louder when close, silent when far).

Everything runs as **one free Web Service on Render.com**, deployed straight from this GitHub repo. You can do all of it from a phone browser.

---

## 🚀 Deploy on Render (free) — phone-only steps

1. **Make sure the code is on GitHub** in this repo (`Mohd-ali1234/game`) on the `main` branch.
2. Open **https://render.com** in your phone browser → **Get Started** → **Sign in with GitHub**. Allow Render to see your repos (you can allow just this one).
3. On the Render dashboard tap **New +** → **Blueprint**.
   *(A Blueprint reads the included `render.yaml` and fills in all settings for you.)*
4. Pick the **`game`** repo → tap **Connect**. You'll see a service called **dark-hunt** (Region: **Singapore**, Plan: **Free**). Tap **Apply** / **Deploy**.
5. Wait ~3–5 minutes while it builds. Tap the service → **Logs** to watch. When you see `Game server running on port …` and the status says **Live**, it works.
6. At the top of the service page is your game link, like `https://dark-hunt-xxxx.onrender.com`. Open it!

> **No Blueprint option?** Do it by hand: **New +** → **Web Service** → pick the repo →
> Region **Singapore** · Runtime **Node** · Build Command `npm install --include=dev && npm run build` · Start Command `npm start` · Instance type **Free** → **Create Web Service**.

### Updating the game later
Every time you push a change to `main` on GitHub, Render rebuilds and redeploys automatically.

---

## 👥 How to play with friends

1. Open your game link, type your name, pick an avatar.
2. Tap **Create Room** → you get a 4-letter code (e.g. `KQXD`).
3. Tap **🔗 Copy invite link** (top-left in the game) and send it to friends on WhatsApp etc.
   The link looks like `https://dark-hunt-xxxx.onrender.com/?room=KQXD`.
4. Friends open the link, enter a name, pick an avatar, tap **Join Room**. (Or they can type the code under "join a friend's room".)
5. Max **6 players** per room. If the room is full or the code is wrong, a clear message is shown.

### Controls
| | Computer | Phone |
|---|---|---|
| Move | **WASD** or arrow keys | **Left-thumb joystick** (bottom-left) |
| Look around | **Click the game** to capture the mouse, then move it (Esc frees the mouse) | **Drag on the right half** of the screen |

Works in portrait and landscape.

**Buttons (top-right):** 🎤 mute / unmute (green ring = you're talking) · ⚙️ settings · 🐞 debug panel · 🚪 leave room.

### ⚙️ Settings (saved on your device)
- **Look sensitivity**: how fast the view turns.
- **Field of view**: how wide you see (higher = wider but things look smaller).
- **Low graphics**: turns **off shadows** and uses a lower resolution. Much faster on budget phones. **Phones start with it ON.** Turn it off in ⚙️ if your phone is fast.

🎧 **Everyone should wear headphones** — otherwise your speakers feed back into your mic and others hear echo.

### 🎤 Voice chat notes
- The game asks first (with a friendly explanation), then your browser asks for microphone permission. If you say no, you can still play and hear others.
- Voice goes **directly between players** (WebRTC) and is never recorded. A speaker icon 🔊 appears above whoever is talking.
- Uses free public Google STUN servers. A few mobile networks / strict firewalls block direct connections — then voice won't connect for that person. The fix is a **TURN server** (not free to host). There's a ready-made spot for it: see `ICE_SERVERS` at the top of `client/src/voice.ts`.

---

## 😴 The free server sleeps!

Render's free tier **puts the server to sleep after ~15 minutes with no visitors**. The next person to open the link waits about **30–60 seconds** while it wakes up. The game shows a friendly **"Waking up the server…"** screen with a timer during that time — just wait, it will switch to the lobby by itself.

Tip: open the link yourself a minute before your friends arrive. Also, rooms live only in the server's memory: if the server restarts or sleeps, rooms disappear and you simply create a new one.

---

## 🐞 Debug panel (for phones with no dev tools)

Tap **🐞** during the game. It shows **connection status, ping (ms), FPS, player count, microphone state**, and a log of **errors** and voice-connection events. If something goes wrong, screenshot this panel.

---

## 🧠 How the smooth multiplayer works (short version)

- **Server-authoritative:** the server owns every player's position and updates 20 times per second. Clients only send their *input* (where the stick points + where they look).
- **Rapier physics on both sides:** the server and your browser run the same Rapier collision code (walls, crates, floor), so your predicted movement almost always matches the server.
- **Client-side prediction:** your own player moves instantly; if the server disagrees you're gently nudged back (big errors snap).
- **Interpolation:** other players are drawn ~100 ms in the past so they glide between updates.
- **Tiny messages:** inputs are `[seq, x, y, yaw, pitch]`; server updates are one flat number array (6 numbers per player), and nothing is sent while everyone stands still and doesn't look around.
- **Reconnect:** if your connection drops, your spot is held for 20 s and the game rejoins you automatically. Leaving on purpose (🚪 or closing the page) removes you right away and closes your voice link.

---

## 📁 Files (what each one does)

| File | What it does |
|---|---|
| `package.json` | Project info, libraries, and the `build` / `start` commands |
| `render.yaml` | Tells Render how to deploy (Singapore, free plan, build + start commands) |
| `tsconfig.json` / `tsconfig.server.json` | TypeScript settings for the browser code / the server code |
| `vite.config.mts` | Bundles the browser code into `dist/client` |
| `shared/game.ts` | Map layout (walls, crates), speed, and the **Rapier** collision code — used by **both** server and browser so prediction matches |
| `server/index.ts` | The one Node app: serves the game files, rooms + 20 Hz game loop (Socket.IO), voice signaling relay |
| `client/index.html` | The page: loading screen, lobby, microphone explanation, in-game buttons |
| `client/src/style.css` | All the styling (phone-friendly, portrait + landscape) |
| `client/src/main.ts` | Glue: connects to the server, lobby, rooms, reconnecting, buttons |
| `client/src/game.ts` | The **Three.js** first-person view: dark map, flashlight spotlights + shadows, mouse/touch look, prediction + interpolation |
| `client/src/avatar3d.ts` | 3D avatars from simple shapes: colored capsule, eyes, funny hat, flashlight + beam, name tag, 🔊 icon |
| `client/src/models.ts` | The **.glb model loader** — list a model per avatar here to replace the simple shapes |
| `client/public/models/` | Put your `.glb` files here (includes a tiny `example-ghost.glb` to test with) |
| `client/src/avatars.ts` | The 8 avatar looks (colors + hats) and their flat pictures for the lobby |
| `client/src/voice.ts` | WebRTC proximity voice chat, speaking detection, STUN/TURN config |
| `client/src/ui.ts` | Joystick, right-half touch look, settings storage, debug panel, pop-up messages |

---

## 💻 Running it on a computer (optional)

```bash
npm install
npm run build
npm start        # then open http://localhost:3000
```
`npm run typecheck` checks the TypeScript for errors.

## 🧸 Swapping in real 3D models (.glb)

Right now avatars are built from simple shapes. To use a free low-poly `.glb` model:
1. Download a CC0 model (e.g. from Quaternius, Kenney or Poly Pizza).
2. On github.com open `client/public/models/` → **Add file → Upload files** → upload it (e.g. `ghost.glb`).
3. Open `client/src/models.ts` → tap ✏️ edit → change an avatar's `null` to `{ url: '/models/ghost.glb' }` → **Commit**.
4. Render redeploys automatically. If the model is too big/small or faces backwards, adjust `scale`, `yOffset`, `rotationY` there.

If a model fails to load, the game simply keeps the simple-shape avatar (and the 🐞 panel shows a warning).

## 🔭 Next steps (not built yet)
Monster, treasures, win/lose, sounds. This foundation (rooms, movement, voice) is ready for them.
