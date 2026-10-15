// =====================================================================
// scripts/build-assets.mjs   (runs automatically during `npm run build`)
//
// Makes your uploaded files small and fast for phones:
//   client/public/textures/*.jpg|png  ->  dist/client/textures/<name>.ktx2  (+ <name>_lo.ktx2 for Low quality)
//   client/public/models/*.glb|.zip   ->  dist/client/models/<name>.glb     (meshopt + KTX2 textures inside)
//   client/public/sounds/*            ->  copied as they are
// Then writes dist/client/asset-manifest.json so the game knows what exists.
//
// KTX2 textures stay compressed on the graphics chip (much less memory than
// JPG/PNG) and are usually smaller to download too. Everything here runs on
// Render during the build - you only upload the original files on GitHub.
// Results are cached in node_modules/.cache, so unchanged files are fast.
// =====================================================================
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { unzipSync } from 'fflate';
import { encodeToKTX2 } from 'ktx2-encoder';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'client/public');
const OUT = path.join(ROOT, 'dist/client');
const CACHE = path.join(ROOT, 'node_modules/.cache/dark-hunt-assets');
const MAX_TEX = 1024; // full-quality texture size
const LO_TEX = 512; // Low-quality texture size
fs.mkdirSync(CACHE, { recursive: true });

/** Same naming rule as client/src/assets.ts */
const assetKey = (name) =>
  name
    .replace(/\.(gltf\.zip|zip|glb|gltf|ktx2|jpe?g|png|webp|ogg|mp3|wav|m4a)$/i, '')
    .replace(/[_-]\d+k(-(jpg|png))?/gi, '')
    .toLowerCase();
const hash = (buf, extra) => crypto.createHash('sha1').update(buf).update(extra).digest('hex').slice(0, 16);
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')) : []);
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const pot = (n, max) => Math.min(max, 2 ** Math.round(Math.log2(Math.max(4, n)))); // power of two (needed for mipmaps)
const manifest = { textures: {}, models: {}, sounds: {} };
/** The encoder prints a lot of progress text; keep the build log readable. */
async function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}
const rel = (abs) => path.relative(OUT, abs).split(path.sep).join('/');

// ---------- 1. decoders the browser needs (copied from three.js) ----------
for (const [from, to] of [['basis', 'libs/basis'], ['draco', 'libs/draco']]) {
  const src = path.join(ROOT, 'node_modules/three/examples/jsm/libs', from);
  const dst = path.join(OUT, to);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of list(src)) if (/\.(js|wasm)$/.test(f) && !f.includes('encoder')) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

// ---------- 2. textures -> KTX2 ----------
async function encodeTexture(file, size, linear) {
  const input = fs.readFileSync(file);
  const cached = path.join(CACHE, hash(input, `tex${size}${linear}`) + '.ktx2');
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const meta = await sharp(input).metadata();
  const png = await sharp(input).resize(pot(meta.width, size), pot(meta.height, size), { fit: 'fill' }).png().toBuffer();
  const out = await quietly(() => encodeToKTX2(new Uint8Array(png), {
    isUASTC: false, // ETC1S: small files, fine for phones
    qualityLevel: linear ? 200 : 140,
    compressionLevel: 2,
    isNormalMap: /nor|normal/i.test(path.basename(file)),
    isSetKTX2SRGBTransferFunc: !linear,
    isPerceptual: !linear,
    generateMipmap: true,
    isKTX2File: true,
    enableDebug: false,
    imageDecoder,
  }));
  fs.writeFileSync(cached, out);
  return Buffer.from(out);
}

const texDir = path.join(SRC, 'textures');
const texOut = path.join(OUT, 'textures');
for (const f of list(texDir)) {
  if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
  const key = assetKey(f);
  const file = path.join(texDir, f);
  const linear = /(nor|normal|rough|arm|ao|disp|height|metal|spec)/i.test(key); // data maps, not colours
  try {
    const t0 = Date.now();
    const big = await encodeTexture(file, MAX_TEX, linear);
    const lo = await encodeTexture(file, LO_TEX, linear);
    fs.writeFileSync(path.join(texOut, key + '.ktx2'), big);
    fs.writeFileSync(path.join(texOut, key + '_lo.ktx2'), lo);
    fs.rmSync(path.join(texOut, f), { force: true }); // the original isn't needed by the game
    manifest.textures[key] = { url: `textures/${key}.ktx2`, bytes: big.length, lo: { url: `textures/${key}_lo.ktx2`, bytes: lo.length } };
    console.log(`texture ${f} -> ${key}.ktx2 (${(big.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
  } catch (e) {
    console.warn(`texture ${f}: could not convert (${e.message}) - using the original file`);
    manifest.textures[key] = { url: `textures/${f}`, bytes: fs.statSync(file).size };
  }
}

// ---------- 3. models -> optimized .glb ----------
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

async function optimizeModel(srcFile, workDir) {
  const doc = await io.read(srcFile);
  await quietly(() => doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, resize: [MAX_TEX, MAX_TEX], targetFormat: 'png' }),
    ktx2({ isUASTC: false, qualityLevel: 150, generateMipmap: true, enableDebug: false, imageDecoder }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  ));
  const out = path.join(workDir, 'out.glb');
  await io.write(out, doc);
  return fs.readFileSync(out);
}

const modelDir = path.join(SRC, 'models');
const modelOut = path.join(OUT, 'models');
for (const f of list(modelDir)) {
  if (!/\.(glb|gltf|zip)$/i.test(f)) continue;
  const key = assetKey(f);
  const file = path.join(modelDir, f);
  const input = fs.readFileSync(file);
  const cached = path.join(CACHE, hash(input, 'model') + '.glb');
  const t0 = Date.now();
  let result = null;
  try {
    if (fs.existsSync(cached)) result = fs.readFileSync(cached);
    else {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'model-'));
      let srcFile = file;
      if (/\.zip$/i.test(f)) {
        // a Poly Haven glTF download: unpack it and find the .gltf inside
        const files = unzipSync(new Uint8Array(input));
        for (const [name, data] of Object.entries(files)) {
          if (name.endsWith('/')) continue;
          const dst = path.join(work, name);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, data);
        }
        const main = Object.keys(files).find((n) => /\.(gltf|glb)$/i.test(n));
        if (!main) throw new Error('no .gltf or .glb inside the zip');
        srcFile = path.join(work, main);
      }
      result = await optimizeModel(srcFile, work);
      fs.writeFileSync(cached, result);
      fs.rmSync(work, { recursive: true, force: true });
    }
    fs.rmSync(path.join(modelOut, f), { force: true });
    fs.writeFileSync(path.join(modelOut, key + '.glb'), result);
    manifest.models[key] = { url: `models/${key}.glb`, bytes: result.length };
    console.log(`model ${f} -> ${key}.glb (${(input.length / 1024).toFixed(0)} KB -> ${(result.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
  } catch (e) {
    console.warn(`model ${f}: could not optimize (${e.message})${/\.glb$/i.test(f) ? ' - using the original' : ' - skipped'}`);
    if (/\.glb$/i.test(f)) manifest.models[key] = { url: `models/${f}`, bytes: input.length };
  }
}

// ---------- 4. sounds: as they are ----------
for (const f of list(path.join(SRC, 'sounds'))) {
  if (!/\.(ogg|mp3|wav|m4a)$/i.test(f)) continue;
  manifest.sounds[assetKey(f)] = { url: rel(path.join(OUT, 'sounds', f)), bytes: fs.statSync(path.join(SRC, 'sounds', f)).size };
}

fs.writeFileSync(path.join(OUT, 'asset-manifest.json'), JSON.stringify(manifest, null, 1));
const count = (o) => Object.keys(o).length;
console.log(`asset manifest: ${count(manifest.textures)} textures, ${count(manifest.models)} models, ${count(manifest.sounds)} sounds`);
