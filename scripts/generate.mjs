// Builds the app.booknstyle.com site into _site/: the static files, plus one
// page and one link-preview image per pro.
//
// Why per-pro pages: when someone texts a pro's invite link, iMessage,
// WhatsApp, Instagram and Facebook build the preview card from the page's
// meta tags WITHOUT running its JavaScript. A single shared page could only
// ever preview as a generic "BookNStyle" card. Each pro now gets
// /book/<handle> with their own title, description and a 1200×630 image
// showing their photo, name, city and top services.
//
// Run by .github/workflows/pages.yml every 15 minutes (and on every push),
// which deploys _site/ to GitHub Pages. A handle that doesn't have its own
// page yet (a pro who signed up in the last few minutes) still works: GitHub
// Pages serves 404.html for it, which loads the pro's card in the browser.
//
// A pro who changes their handle keeps the old one for 90 days (migration
// 040). Each old handle gets a small page that sends visitors on to the new
// /book/<handle> and carries the same preview tags, so a link texted before
// the change still previews as the pro.
//
// Reads only public data, with the same public key the app uses: pros'
// handles (profiles.handle), get_pro_invite_card (migration 031) and
// get_handle_redirects (migration 040).

import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { assertNoLinksToBilling } from './billing-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const SITE = 'https://app.booknstyle.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ebrxekhmlxlccuvcwiwb.supabase.co';
// Public by design — the same publishable key is inside the app and index.html.
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Vc4MPxSdXx1FmL3562bLUQ_A_KwQeVe';
const APP_STORE_ID = '6813224710';

// Files and folders that belong to the build, not the site.
const NOT_PUBLISHED = new Set(['_site', 'node_modules', 'scripts', '.github', 'package.json', 'package-lock.json', '.gitignore', '.git', 'fonts', 'README.md']);

const HANDLE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const price = (cents) => {
  const d = (cents ?? 0) / 100;
  return '$' + (cents % 100 === 0 ? d.toFixed(0) : d.toFixed(2));
};

async function api(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${pathAndQuery} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function copyStatic(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (NOT_PUBLISHED.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyStatic(src, dst);
    else await fs.copyFile(src, dst);
  }
}

// ---------------------------------------------------------------------------
// Link-preview image (1200×630, the size iMessage and every social app use for
// a large card), in the website's look: the ground, frame and type of
// booknstyle.com's own share image (web/site/assets/og.png). Navy with a soft
// champagne glow, a thin champagne frame, the pro's name in Bodoni Moda with
// the gold gradient, tracked Inter eyebrows, thin gold rules, and the B mark
// with the spaced BOOKNSTYLE wordmark.
// ---------------------------------------------------------------------------
const FONT_FILES = ['Inter-400.ttf', 'Inter-600.ttf', 'BodoniModa_28pt-Medium.ttf', 'BodoniModa_28pt-MediumItalic.ttf']
  .map((f) => path.join(ROOT, 'fonts', f));
const FONT = { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' };

// Type styles. spacing is letter-spacing in em, as in the website's CSS.
const SERIF = { family: 'Bodoni Moda 28pt', weight: 500, spacing: -0.01 };
const SERIF_ITALIC = { ...SERIF, style: 'italic' };
const EYEBROW = { family: 'Inter', weight: 600, spacing: 0.24 };
const TRACKED = { family: 'Inter', weight: 600, spacing: 0.13 };
const WORDMARK = { family: 'Inter', weight: 600, spacing: 0.3 };
const BODY = { family: 'Inter', weight: 400 };
const STRONG = { family: 'Inter', weight: 600 };

const type = (f, size) =>
  `font-family="${f.family}" font-weight="${f.weight}"${f.style ? ` font-style="${f.style}"` : ''} font-size="${size}"` +
  (f.spacing ? ` letter-spacing="${+(f.spacing * size).toFixed(2)}"` : '');

// How far a line of text reaches to the right of its x, and above and below
// its baseline: measured by resvg with the real fonts (kerning and all), once
// per text at 100px, since the ink grows in step with the size. Long names
// shrink instead of running off.
const measured = new Map();
function ink(text, f) {
  const key = `${f.family}|${f.weight}|${f.style}|${f.spacing}|${text}`;
  if (!measured.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text x="0" y="100" ${type(f, 100)}>${esc(text)}</text></svg>`;
    const box = new Resvg(svg, { font: FONT }).getBBox();
    measured.set(key, box
      ? { right: box.x + box.width, above: 100 - box.y, below: box.y + box.height - 100 }
      : { right: 0, above: 0, below: 0 });
  }
  return measured.get(key);
}
const textWidth = (text, f, size) => (ink(text, f).right * size) / 100;

// Bodoni Moda has the letters of most Latin-script names (é, ñ, ø, ł, ș), but
// not Vietnamese, Greek or Cyrillic ones (ư, ễ, Д). resvg would then draw the
// line in Inter anyway, or pile loose accents onto Bodoni letters, so a name
// with a letter only Inter has is set in Inter, all of it. (If a font file
// can't be read, every name stays in Bodoni, as before this check.)
function charsOf(file) { // the font's Windows Unicode cmap (format 4)
  let font;
  try {
    font = readFileSync(file);
  } catch {
    return null;
  }
  const chars = new Set();
  let cmap = 0;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    if (font.toString('latin1', 12 + i * 16, 16 + i * 16) === 'cmap') cmap = font.readUInt32BE(20 + i * 16);
  }
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    const sub = cmap + font.readUInt32BE(rec + 4);
    if (font.readUInt16BE(rec) !== 3 || font.readUInt16BE(rec + 2) !== 1 || font.readUInt16BE(sub) !== 4) continue;
    const segs = font.readUInt16BE(sub + 6) / 2;
    const ends = sub + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const offsets = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const start = font.readUInt16BE(starts + s * 2);
      const delta = font.readUInt16BE(deltas + s * 2);
      const offset = font.readUInt16BE(offsets + s * 2);
      for (let c = start; c <= font.readUInt16BE(ends + s * 2) && c < 0xffff; c++) {
        const glyph = offset ? font.readUInt16BE(offsets + s * 2 + offset + (c - start) * 2) : c;
        if (glyph && (glyph + delta) & 0xffff) chars.add(c);
      }
    }
  }
  return chars;
}
const SERIF_CHARS = charsOf(path.join(ROOT, 'fonts', 'BodoniModa_28pt-Medium.ttf'));
const SANS_CHARS = charsOf(path.join(ROOT, 'fonts', 'Inter-400.ttf'));
const NAME_SANS = { family: 'Inter', weight: 400, spacing: -0.02 };
const nameStyle = (name) => (SERIF_CHARS && SANS_CHARS && Array.from(name).some((ch) =>
  !SERIF_CHARS.has(ch.codePointAt(0)) && SANS_CHARS.has(ch.codePointAt(0))) ? NAME_SANS : SERIF);

// A character neither font has (an emoji, a Chinese or Korean letter) would
// draw as an empty box, so it is left out of the picture. Only the picture:
// the page's title and preview tags keep the pro's text as typed.
const drawable = (text) => (SERIF_CHARS && SANS_CHARS
  ? Array.from(String(text ?? '')).filter((ch) => /\s/.test(ch) || SERIF_CHARS.has(ch.codePointAt(0)) || SANS_CHARS.has(ch.codePointAt(0))).join('')
  : String(text ?? '')).replace(/\s+/g, ' ').trim();

// The largest size from `start` down to `min` at which `text` fits `maxWidth`.
// At `min`, a text that still doesn't fit is cut short with an ellipsis.
function fit(text, f, maxWidth, start, min) {
  const full = textWidth(text, f, start);
  const size = full <= maxWidth ? start : Math.max(min, Math.floor((start * maxWidth) / full));
  if (textWidth(text, f, size) <= maxWidth) return { text, size, cut: false };
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) { // the most characters that fit with the ellipsis
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(chars.slice(0, mid).join('').trimEnd() + '…', f, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return { text: chars.slice(0, lo).join('').trimEnd() + '…', size, cut: true };
}

// A pro's name: one line from 80px down to 54px. A longer name breaks onto two
// lines (64px down to 44px) at the space that balances them best; a name too
// long even for that is cut short on one line.
function fitName(name, f, maxWidth) {
  const one = fit(name, f, maxWidth, 80, 54);
  if (!one.cut) return { lines: [one.text], size: one.size };
  const words = name.split(/\s+/).filter(Boolean);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const widest = Math.max(...lines.map((line) => textWidth(line, f, 100)));
    const size = Math.min(64, Math.floor((100 * maxWidth) / widest));
    if (!best || size > best.size) best = { lines, size };
  }
  return best && best.size >= 44 ? best : { lines: [one.text], size: one.size };
}

// The share image's ground: navy, a champagne glow falling from the top edge
// and a faint warm light in the bottom-right corner, inside a thin champagne
// frame. Each light is a soft-edged ellipse (a radial gradient): fully lit out
// to `from` times its radius, dark from `to`, with a cosine fall-off between.
function glow(id, cx, cy, rx, ry, color, opacity, from, to) {
  const stops = Array.from({ length: 13 }, (_, i) => {
    const r = (i / 12) * to;
    const lit = r <= from ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (r - from)) / (to - from));
    return `<stop offset="${(i / 12).toFixed(3)}" stop-color="${color}" stop-opacity="${(opacity * lit).toFixed(3)}"/>`;
  }).join('');
  const k = ry / rx;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${to * rx}" ` +
    `gradientTransform="matrix(1 0 0 ${k.toFixed(4)} 0 ${(cy * (1 - k)).toFixed(2)})">${stops}</radialGradient>`;
}
const GROUND_DEFS = glow('glow', 600, -50, 445, 390, '#C8956A', 0.228, 0.5, 1.5) +
  glow('corner', 1150, 820, 300, 350, '#EFD0BB', 0.1, 0, 2.2);
const GROUND = `<rect width="1200" height="630" fill="#16182B"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" fill="url(#corner)"/>
  <rect x="24.5" y="24.5" width="1151" height="581" rx="24" fill="none" stroke="#C8956A"/>`;

// resvg's own PNG keeps an alpha channel these opaque images never use and
// skips PNG's row filters. Written here as plain RGB, with the best filter for
// each row and full compression, a photo card comes out about a third smaller:
// quicker to load in a chat, and under the roughly 300 KB past which WhatsApp
// may show no preview at all.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(name, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(name, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, data.length + 8)), data.length + 8);
  return out;
}
function toPng(svg) {
  const { width, height, pixels } = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: FONT }).render();
  const stride = width * 3;
  const rows = Buffer.alloc((stride + 1) * height);
  const filtered = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      line[x * 3] = pixels[p];
      line[x * 3 + 1] = pixels[p + 1];
      line[x * 3 + 2] = pixels[p + 2];
    }
    // PNG filters 0 to 4 (none, sub, up, average, Paeth); keep the one whose
    // output is closest to zero, the usual guess for what compresses best.
    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = filtered[f];
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? line[i - 3] : 0;
        const b = prev[i];
        const c = i >= 3 ? prev[i - 3] : 0;
        let guess = 0;
        if (f === 1) guess = a;
        else if (f === 2) guess = b;
        else if (f === 3) guess = (a + b) >> 1;
        else if (f === 4) {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          guess = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (line[i] - guess) & 0xff;
        out[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }
    rows[y * (stride + 1)] = best;
    filtered[best].copy(rows, y * (stride + 1) + 1);
    prev = line;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function dataUri(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\/(png|jpe?g|webp)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'B';

// A pro's card: the photo on the left; on the right, an eyebrow, the name, the
// business and city, and two services with the pro's own prices, between
// thin gold rules. The text is centred on the photo, above the footer.
const COL_LEFT = 480;
const COL_RIGHT = 1104;
const PHOTO_X = 276;
const PHOTO_R = 150;
const STACK_TOP = 56;
const STACK_BOTTOM = 500;
const FOOT_Y = 552;

async function previewImage(card, markUri) {
  const name = drawable(card.name) || card.handle;
  const photo = await dataUri(card.avatar_url);
  const place = drawable([card.city, card.state].filter(Boolean).join(', '));
  const business = drawable(card.business_name);
  const sub = [business && business !== name ? business : null, place]
    .filter(Boolean).join('  ·  ');
  const services = (card.services || []).slice(0, 2).map((s) => ({ ...s, name: drawable(s.name) }));
  const width = COL_RIGHT - COL_LEFT;

  const nameFont = nameStyle(name);
  const nameFit = fitName(name, nameFont, width);
  const subFit = sub ? fit(sub, BODY, width, 28, 22) : null;

  // Baselines, measured from the top of the stack (the eyebrow's cap height).
  // The name starts 30px under the eyebrow, lower if a tall accent (Å, Ė)
  // would come within 14px of it. A second line sits 1.08 sizes under the
  // first, further if an accent on it would meet a descender (g, y, Ș) above.
  // Below the name, room for its descenders (g, p, y) before the next line.
  const [first, second] = nameFit.lines.map((line) => ink(line, nameFont));
  const eyebrowY = 15;
  const nameY = eyebrowY + Math.max(30 + Math.round(nameFit.size * 0.75), 14 + Math.ceil((first.above * nameFit.size) / 100));
  const lead = second
    ? Math.max(Math.round(nameFit.size * 1.08), Math.ceil(((first.below + second.above) / 100 + 0.08) * nameFit.size))
    : 0;
  let bottom = nameY + (nameFit.lines.length - 1) * lead + Math.round(nameFit.size * 0.25);
  const subY = subFit ? (bottom += 32) : 0;
  const rules = [];
  const rows = [];
  if (services.length) {
    bottom += 32;
    rules.push(bottom);
    for (const s of services) {
      rows.push({ s, y: bottom + 38 });
      bottom += 56;
      rules.push(bottom);
    }
  }
  const top = Math.round((STACK_TOP + STACK_BOTTOM - bottom) / 2);
  const cy = Math.round((STACK_TOP + STACK_BOTTOM) / 2);

  const text = [
    `<rect x="${COL_LEFT}" y="${top + eyebrowY - 8}" width="40" height="1" fill="#DFB990" fill-opacity=".55"/>`,
    `<text x="${COL_LEFT + 56}" y="${top + eyebrowY}" ${type(EYEBROW, 20)} fill="#DFB990">BOOK WITH</text>`,
    ...nameFit.lines.map((line, i) =>
      `<text x="${COL_LEFT}" y="${top + nameY + i * lead}" ${type(nameFont, nameFit.size)} fill="url(#gold)">${esc(line)}</text>`),
  ];
  if (subFit) {
    text.push(`<text x="${COL_LEFT}" y="${top + subY}" ${type(BODY, subFit.size)} fill="#F5F4EE" fill-opacity=".76">${esc(subFit.text)}</text>`);
  }
  for (const y of rules) {
    text.push(`<rect x="${COL_LEFT}" y="${top + y}" width="${width}" height="1" fill="#DFB990" fill-opacity=".3"/>`);
  }
  for (const { s, y } of rows) {
    const cost = price(s.price_cents);
    const line = fit(`${s.name}`, BODY, width - textWidth(cost, STRONG, 28) - 28, 28, 20);
    text.push(
      `<text x="${COL_LEFT}" y="${top + y}" ${type(BODY, line.size)} fill="#F5F4EE" fill-opacity=".92">${esc(line.text)}</text>`,
      `<text x="${COL_RIGHT}" y="${top + y}" text-anchor="end" ${type(STRONG, 28)} fill="#DFB990">${esc(cost)}</text>`,
    );
  }

  const avatar = photo
    ? `<image href="${photo}" x="${PHOTO_X - PHOTO_R}" y="${cy - PHOTO_R}" width="${2 * PHOTO_R}" height="${2 * PHOTO_R}" preserveAspectRatio="xMidYMid slice" clip-path="url(#round)"/>`
    : `<circle cx="${PHOTO_X}" cy="${cy}" r="${PHOTO_R}" fill="#1D2038"/>
  <text x="${PHOTO_X}" y="${cy + 42}" text-anchor="middle" ${type(nameFont, 112)} fill="#DFB990">${esc(initials(name))}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    ${GROUND_DEFS}
    <linearGradient id="gold" x2="1">
      <stop offset="0" stop-color="#F0D3AE"/><stop offset=".35" stop-color="#DFB990"/>
      <stop offset=".7" stop-color="#C8956A"/><stop offset="1" stop-color="#E7C59D"/>
    </linearGradient>
    <clipPath id="round"><circle cx="${PHOTO_X}" cy="${cy}" r="${PHOTO_R}"/></clipPath>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  ${GROUND}
  <circle cx="${PHOTO_X}" cy="${cy + 20}" r="${PHOTO_R - 6}" fill="#000" fill-opacity=".55" filter="url(#soft)"/>
  <circle cx="${PHOTO_X}" cy="${cy}" r="${PHOTO_R + 9.5}" fill="#C8956A"/>
  <circle cx="${PHOTO_X}" cy="${cy}" r="${PHOTO_R + 6}" fill="#0A0B11"/>
  ${avatar}
  ${text.join('\n  ')}
  ${markUri ? `<image href="${markUri}" x="${COL_LEFT}" y="${FOOT_Y - 35}" width="42" height="38"/>` : ''}
  <text x="${COL_LEFT + (markUri ? 58 : 0)}" y="${FOOT_Y}" ${type(WORDMARK, 18)} fill="#F5F4EE">BOOKNSTYLE</text>
  <text x="${COL_RIGHT}" y="${FOOT_Y}" text-anchor="end" ${type(BODY, 21)} fill="#F5F4EE" fill-opacity=".56">Reminders · First reschedule free</text>
</svg>`;
  return toPng(svg);
}

// The card for links that aren't a specific pro's page yet (the home page, or
// a pro who signed up minutes ago and is served 404.html until the next run):
// laid out like the website's share image, og.png, with this card's words.
function defaultImage(markUri) {
  const mark = { width: 80, height: 73, gap: 24 }; // the B mark at the wordmark's cap height
  const left = Math.round(600 - (mark.width + mark.gap + textWidth('BookNStyle', SERIF, 98)) / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    ${GROUND_DEFS}
    <linearGradient id="gold" x2="0" y2="1"><stop offset="0" stop-color="#F6CEA0"/><stop offset="1" stop-color="#DDB083"/></linearGradient>
  </defs>
  ${GROUND}
  <image href="${markUri}" x="${left}" y="151" width="${mark.width}" height="${mark.height}"/>
  <text x="${left + mark.width + mark.gap}" y="224" ${type(SERIF, 98)} fill="url(#gold)">BookNStyle</text>
  <text x="600" y="373" text-anchor="middle" ${type(SERIF, 46)} fill="#F5F4EE">Book beauty pros <tspan ${type(SERIF_ITALIC, 46)} fill="#DFB990">near you</tspan>, in a few taps</text>
  <rect x="540" y="420" width="121" height="1" fill="#C8956A"/>
  <text x="600" y="467" text-anchor="middle" ${type(TRACKED, 18)} fill="#DFB990">BOOK NOW  ·  GET STYLED  ·  LIVE WELL</text>
</svg>`;
  return toPng(svg);
}

// ---------------------------------------------------------------------------
// Per-pro page: the invite page, with this pro's preview tags in <head>.
// ---------------------------------------------------------------------------
function proTags(card) {
  const name = card.name || card.handle;
  const place = [card.city, card.state].filter(Boolean).join(', ');
  const top = (card.services || []).slice(0, 3).map((s) => `${s.name} ${price(s.price_cents)}`).join(' · ');
  const title = `Book with ${name} on BookNStyle`;
  const description = [
    [card.business_name && card.business_name !== name ? card.business_name : null, place].filter(Boolean).join(' · '),
    top,
    'Reminders before every appointment, and your first reschedule is free.',
  ].filter(Boolean).join('. ');
  const url = `${SITE}/book/${card.handle}`;
  const image = `${SITE}/og/${card.handle}.png`;

  const tags = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="BookNStyle">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${name} on BookNStyle`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${url}">`;
  return { tags, name };
}

function proPage(template, card) {
  const { tags } = proTags(card);

  // Swap the generic tags for this pro's.
  return template
    .replace(/<title>[\s\S]*?<\/title>\n?/, '')
    .replace(/<meta name="description"[^>]*>\n?/, '')
    .replace(/<meta property="og:[^"]*"[^>]*>\n?/g, '')
    .replace(/<meta name="twitter:[^"]*"[^>]*>\n?/g, '')
    .replace(/<meta name="apple-itunes-app"[^>]*>\n?/g, '')
    .replace('<meta name="theme-color"', `${tags.trim()}\n<meta name="theme-color"`);
}

// Page at a pro's OLD handle: straight on to their current page (meta refresh,
// plus a script for browsers that ignore it), with the same preview tags —
// iMessage and the social apps read those without following the redirect,
// and rel=canonical / og:url point them at the new address. Dark like the
// pages on either side of it (ink ground, cream text, champagne link), so the
// hop doesn't flash white.
function redirectPage(card) {
  const { tags, name } = proTags(card);
  const target = `/book/${card.handle}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${tags.trim()}
<meta http-equiv="refresh" content="0; url=${target}">
<meta name="theme-color" content="#0A0B11">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/img/mark.png">
<style>
  html { background: #0A0B11; color-scheme: dark; }
  body { margin: 0; padding: 48px 20px; text-align: center; color: #F5F4EE; font: 16px/1.6 Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: #DFB990; text-underline-offset: 3px; }
</style>
<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>
</head>
<body>
<p><a href="${target}">Continue to ${esc(name)} on BookNStyle</a></p>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await copyStatic(ROOT, OUT);

  const template = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const markPath = path.join(ROOT, 'img', 'mark.png');
  const markUri = `data:image/png;base64,${(await fs.readFile(markPath)).toString('base64')}`;

  const pros = await api('/rest/v1/profiles?select=handle&role=eq.stylist&handle=not.is.null&order=handle');
  await fs.mkdir(path.join(OUT, 'book'), { recursive: true });
  await fs.mkdir(path.join(OUT, 'og'), { recursive: true });
  await fs.writeFile(path.join(OUT, 'og', 'default.png'), defaultImage(markUri));

  let made = 0;
  const cards = new Map();
  for (const { handle } of pros) {
    if (!HANDLE.test(handle ?? '')) continue;
    let card;
    try {
      card = await api('/rest/v1/rpc/get_pro_invite_card', { p_handle: handle });
    } catch (e) {
      console.warn(`skip ${handle}: ${e.message}`);
      continue;
    }
    if (!card?.id) continue;
    card.handle = card.handle || handle;
    await fs.writeFile(path.join(OUT, 'book', `${handle}.html`), proPage(template, card));
    await fs.writeFile(path.join(OUT, 'og', `${handle}.png`), await previewImage(card, markUri));
    cards.set(handle, card);
    made++;
  }
  console.log(`Built ${made} pro page(s) into _site/`);

  // Old handles still reserved (040). If the database doesn't have the
  // function yet, build the rest of the site anyway: old links then land on
  // 404.html, which still finds the pro.
  let redirects = [];
  try {
    redirects = await api('/rest/v1/rpc/get_handle_redirects', {});
  } catch (e) {
    console.warn(`skip old-handle pages: ${e.message}`);
  }

  let moved = 0;
  for (const { old_handle: oldHandle, current_handle: handle } of redirects ?? []) {
    if (!HANDLE.test(oldHandle ?? '') || !HANDLE.test(handle ?? '')) continue;
    // A live pro page always wins (shouldn't happen: 040 keeps the name
    // reserved, but never overwrite a real page).
    if (cards.has(oldHandle)) continue;
    // The pro's own page wasn't built (it failed above): no preview image to
    // point at, and 404.html handles the old link just as well.
    const card = cards.get(handle);
    if (!card) continue;
    await fs.writeFile(path.join(OUT, 'book', `${oldHandle}.html`), redirectPage(card));
    moved++;
  }
  console.log(`Built ${moved} old-handle redirect page(s)`);

  // The Android app opens this site's pages, and Google Play doesn't let the
  // app lead a pro to a purchase. So no page here except /pro/ itself may
  // link to the billing page (scripts/billing-guard.mjs). Fails the build
  // (nothing is published) if one does.
  await assertNoLinksToBilling(OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
