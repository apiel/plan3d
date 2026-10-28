// Writes the app icons (public/icon-*.png): an L-shaped room with a door, drawn
// with plain rectangles so no image tool is needed. Run once: node scripts/icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x14, 0x16, 0x1a];
const WALL = [0xe6, 0xe8, 0xeb];
const ACCENT = [0x3b, 0x82, 0xf6];

/** Shapes on a 100 x 100 grid, kept inside the middle 60 so the icon can be cut to a circle (maskable). */
const shapes = [
  // floor of the room
  { c: [0x1f, 0x2a, 0x3d], r: [22, 22, 78, 78] },
  { c: BG, r: [52, 50, 80, 80] },
  // walls of an L-shaped room
  { c: WALL, r: [20, 20, 80, 26] },
  { c: WALL, r: [74, 20, 80, 52] },
  { c: WALL, r: [50, 46, 80, 52] },
  { c: WALL, r: [50, 46, 56, 80] },
  { c: WALL, r: [20, 74, 56, 80] },
  { c: WALL, r: [20, 20, 26, 80] },
  // a door in the bottom wall, its leaf open
  { c: [0x1f, 0x2a, 0x3d], r: [32, 74, 46, 80] },
  { c: ACCENT, r: [32, 60, 35, 76] },
];

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [u, v] = [((x + 0.5) / size) * 100, ((y + 0.5) / size) * 100];
      let c = BG;
      for (const s of shapes) if (u >= s.r[0] && u < s.r[2] && v >= s.r[1] && v < s.r[3]) c = s.c;
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size));
