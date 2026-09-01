/* Génère les icônes PNG de la PWA sans dépendance externe.
   node tools/gen-icons.js   ->   icons/*.png */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

/* ---------- Encodeur PNG minimal (RGBA, 8 bits, non entrelacé) ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                       // filtre « None »
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- Géométrie ---------- */

const clamp01 = v => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

/** Distance signée à un rectangle arrondi centré en (0.5, 0.5). */
function sdRoundRect(x, y, half, r) {
  const qx = Math.abs(x - 0.5) - (half - r);
  const qy = Math.abs(y - 0.5) - (half - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance à un segment [a, b]. */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy || 1e-9));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

const TEAL_HI = [0x4a, 0x87, 0x72];
const TEAL_LO = [0x24, 0x50, 0x3f];

/** Couleur du pixel en coordonnées normalisées (0..1). Renvoie [r, g, b, a]. */
function sample(x, y, opts) {
  const bg = sdRoundRect(x, y, 0.5, opts.radius);
  if (bg > 0) return [0, 0, 0, 0];

  // Fond dégradé en diagonale.
  const t = clamp01((x * 0.35 + y * 0.65));
  let col = [mix(TEAL_HI[0], TEAL_LO[0], t), mix(TEAL_HI[1], TEAL_LO[1], t), mix(TEAL_HI[2], TEAL_LO[2], t)];

  const R = opts.glyph;                       // rayon de l'horloge
  const trait = R * 0.13;
  const d = Math.hypot(x - 0.5, y - 0.5);

  // Cadran : anneau + deux aiguilles + point central.
  let encre = Math.abs(d - R) < trait / 2;
  if (!encre) {
    const h1 = sdSegment(x, y, 0.5, 0.5, 0.5, 0.5 - R * 0.55);          // grande aiguille (12 h)
    const h2 = sdSegment(x, y, 0.5, 0.5, 0.5 + R * 0.42, 0.5 + R * 0.24); // petite aiguille (≈ 4 h)
    encre = h1 < trait / 2 || h2 < trait / 2 || d < trait * 0.75;
  }
  if (encre) col = [255, 255, 255];

  return [col[0], col[1], col[2], 1];
}

function render(size, opts) {
  const ss = 4;                                // suréchantillonnage pour l'anticrénelage
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, opts);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      if (a > 0) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePNG(size, size, px);
}

/* ---------- Sortie ---------- */

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });

const jobs = [
  // Icônes « any » : coins arrondis, glyphe généreux.
  ['icon-192.png',          192, { radius: 0.22, glyph: 0.27 }],
  ['icon-512.png',          512, { radius: 0.22, glyph: 0.27 }],
  ['apple-touch-icon.png',  180, { radius: 0.22, glyph: 0.27 }],
  // Icônes « maskable » : pleine surface, glyphe dans la zone sûre (80 % centraux).
  ['maskable-192.png',      192, { radius: 0,    glyph: 0.20 }],
  ['maskable-512.png',      512, { radius: 0,    glyph: 0.20 }]
];

for (const [name, size, opts] of jobs) {
  const buf = render(size, opts);
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`${name.padEnd(22)} ${size}×${size}  ${(buf.length / 1024).toFixed(1)} Ko`);
}
