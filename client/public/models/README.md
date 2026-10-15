# 3D models (.glb)

Put free low-poly `.glb` models here, then point an avatar at it in
`client/src/models.ts` (the `AVATAR_MODELS` list).

- `example-ghost.glb` is a tiny sample so you can test the loader. To try it, change
  `null, // 5 Bunny Orange` to `{ url: '/models/example-ghost.glb' }, // 5 Bunny Orange`.
- Good free sources: Quaternius, Kenney (kenney.nl), Poly Pizza. Look for **CC0** (free to use).
- Players are about **1.7 m tall** and must **face -Z** (forward). Use `scale`, `yOffset`
  and `rotationY` in `models.ts` to fit a model.
- Keep files small (under ~1 MB each) so phones on mobile data load quickly.
- Uploading from your phone: on github.com open this folder → **Add file** → **Upload files**.
