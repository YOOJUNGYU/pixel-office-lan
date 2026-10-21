// Wraps a PNG (≤ 256 px) in a single-image .ico — Windows Vista+ reads
// PNG-compressed icon entries, so no re-encoding is needed.
//   node scripts/package/png2ico.mjs icon.png out.ico
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
const png = readFileSync(src);
const w = png.readUInt32BE(16); // IHDR width / height
const h = png.readUInt32BE(20);
if (png.toString('latin1', 1, 4) !== 'PNG' || w > 256 || h > 256) {
  throw new Error(`${src}: need a PNG of at most 256×256`);
}
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(1, 4); // one image
head.writeUInt8(w % 256, 6); // 256 is stored as 0
head.writeUInt8(h % 256, 7);
head.writeUInt16LE(1, 10); // planes
head.writeUInt16LE(32, 12); // bit count
head.writeUInt32LE(png.length, 14);
head.writeUInt32LE(22, 18); // image offset
writeFileSync(out, Buffer.concat([head, png]));
console.log(`✓ ${out} (${w}×${h})`);
