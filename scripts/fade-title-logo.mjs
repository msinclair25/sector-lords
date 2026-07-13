/**
 * Build title_logo.png with soft alpha so it blends into the menu void.
 * - Keys near-black plate to transparent
 * - Feathers rectangular edges + soft elliptical falloff
 */
import sharp from "sharp";
import { existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const srcJpg = resolve(root, "public/assets/ui/title_logo.jpg");
// Prefer freshly edge-faded edit if present
const candidates = [
  resolve(
    process.env.USERPROFILE || "",
    ".grok/sessions/C%3A%5CUsers%5Ccapta%5CDocuments%5Cchaosoverlords/019f5467-c743-7030-a278-6794d1b2ce9a/images/65.jpg",
  ),
  srcJpg,
];
const src = candidates.find((p) => existsSync(p)) || srcJpg;
const out = resolve(root, "public/assets/ui/title_logo.png");

console.log("source:", src);

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
const px = Buffer.from(data);
const edge = Math.max(32, Math.round(Math.min(width, height) * 0.14));
const cx = width / 2;
const cy = height / 2;
const rx = width * 0.44;
const ry = height * 0.42;

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const maxc = Math.max(r, g, b);

    // Near-black plate → transparent; keep neon / chrome / gold
    let a = 255;
    if (lum < 10 || maxc < 18) a = 0;
    else if (lum < 38 || maxc < 45) {
      const tLum = lum < 10 ? 0 : smoothstep((lum - 10) / 28);
      const tMax = maxc < 18 ? 0 : smoothstep((maxc - 18) / 27);
      a = Math.round(Math.min(tLum, tMax) * 255);
    }

    // Soft rectangular edge fade
    const dEdge = Math.min(x, y, width - 1 - x, height - 1 - y);
    const edgeMul = dEdge < edge ? smoothstep(dEdge / edge) : 1;

    // Soft elliptical falloff past core logo area
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const er = Math.sqrt(nx * nx + ny * ny);
    let radMul = 1;
    if (er > 0.82) radMul = 1 - smoothstep((er - 0.82) / 0.55);

    a = Math.round(a * edgeMul * radMul);
    px[i + 3] = Math.max(0, Math.min(255, a));
  }
}

await sharp(px, { raw: { width, height, channels } })
  .png({ compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
console.log(
  "wrote",
  out,
  meta.width,
  "x",
  meta.height,
  meta.format,
  "alpha=",
  meta.hasAlpha,
);
