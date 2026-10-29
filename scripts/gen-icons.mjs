/**
 * Generates the plugin icons as PNGs.
 *
 * Zotero's manifest requires PNG icons, and the template ships a placeholder.
 * This script draws a rounded gradient tile with a four-pointed sparkle, which
 * reads clearly at 16/20/32/48 px in both light and dark UI chrome.
 *
 * Run: node scripts/gen-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "addon", "content", "icons");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode an RGBA pixel buffer as a PNG. */
function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepend the filter byte (0 = none) to every scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Draw one icon.
 *
 * Background: rounded square with a diagonal gradient (indigo -> blue), plus a
 * soft highlight in the upper-left. Foreground: a white four-pointed sparkle.
 */
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const radius = size * 0.22;

  // Gradient endpoints.
  const topLeft = [99, 102, 241]; // #6366f1
  const bottomRight = [59, 130, 246]; // #3b82f6

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Rounded-rect mask.
      const dx = Math.max(Math.abs(x - c) - (c - radius), 0);
      const dy = Math.max(Math.abs(y - c) - (c - radius), 0);
      const corner = Math.hypot(dx, dy);
      const inside = corner <= radius;
      if (!inside) {
        px[i + 3] = 0;
        continue;
      }

      // Diagonal gradient.
      const t = (x / (size - 1) + y / (size - 1)) / 2;
      let [r, g, b] = mix(topLeft, bottomRight, t);

      // Soft top-left highlight.
      const hl = Math.max(0, 1 - Math.hypot(x - size * 0.32, y - size * 0.3) / (size * 0.55));
      r = Math.round(r + (255 - r) * hl * 0.16);
      g = Math.round(g + (255 - g) * hl * 0.16);
      b = Math.round(b + (255 - b) * hl * 0.16);

      // Four-pointed sparkle.
      const nx = (x - c) / c;
      const ny = (y - c) / c;
      const angle = Math.atan2(ny, nx);
      const dist = Math.hypot(nx, ny);
      const star = 0.22 + 0.78 * Math.pow(Math.abs(Math.cos(2 * angle)), 4);
      const onStar = dist <= star;
      const edge = dist > star - 0.12;

      if (onStar) {
        r = 255;
        g = 255;
        b = 255;
        // Slight shadow at the star's rim so it separates from the gradient.
        if (edge) {
          r = 214;
          g = 224;
          b = 255;
        }
      }

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  return encodePNG(size, size, px);
}

mkdirSync(OUT_DIR, { recursive: true });

const sizes = [
  { name: "favicon.png", size: 32 },
  { name: "favicon@0.5x.png", size: 16 },
  { name: "icon-48.png", size: 48 },
  { name: "icon-96.png", size: 96 },
  { name: "icon-128.png", size: 128 },
];

for (const { name, size } of sizes) {
  const png = drawIcon(size);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${png.length} bytes`);
}

// Also emit the SVG for the reader/pane header, which scales better.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <defs>
    <linearGradient id="zai-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="18" height="18" rx="5" fill="url(#zai-g)"/>
  <path d="M10 3.4l1.5 4.1L15.6 9l-4.1 1.5L10 14.6l-1.5-4.1L4.4 9l4.1-1.5L10 3.4z" fill="#fff"/>
  <circle cx="15.6" cy="14.4" r="1.5" fill="#fff" opacity=".85"/>
</svg>
`;
writeFileSync(join(OUT_DIR, "ai.svg"), svg);
console.log("ai.svg written");
