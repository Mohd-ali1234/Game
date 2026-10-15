# 3D models (.glb)

Upload free CC0 models here, one at a time, straight from GitHub on your phone
(**Add file → Upload files**). Every piece of furniture uses a simple built-in
shape until a model for it exists.

- **Poly Haven downloads work as they are:** choose the **glTF** format and **1K**,
  and upload the `.zip` you get. The build unpacks it and makes a small,
  compressed `.glb` (meshopt geometry + KTX2 textures).
- A `.glb` file works too.
- The file name decides what it replaces. The names each prop accepts are listed in
  `client/src/models.ts` (`MODEL_NAMES`), e.g. a bed accepts `bed.glb` or
  Poly Haven's `GothicBed_01_1k.gltf.zip`. If your file has a different name,
  add that name to the list (edit the file on GitHub, it's plain text).
- Models are scaled and placed automatically. If one faces the wrong way or is
  the wrong size, add a line to `MODEL_TWEAKS` in the same file.
- `ghost.glb` replaces the ghost (it keeps the ghostly glowing look).
  `avatar_0.glb` ... `avatar_7.glb` replace the player avatars.
- `example-ghost.glb` is a tiny sample file showing the format; nothing uses it.

Keep each file under ~5 MB before compression (1K textures are plenty for phones).
