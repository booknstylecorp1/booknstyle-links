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
// Reads only public data, with the same public key the app uses: pros'
// handles (profiles.handle) and get_pro_invite_card (migration 031).

import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
// a large card).
// ---------------------------------------------------------------------------
const FONT_FILES = ['Inter-400.ttf', 'Inter-600.ttf', 'Inter-800.ttf'].map((f) => path.join(ROOT, 'fonts', f));

// Rough width of Inter text, to shrink long names instead of cutting them off.
const textWidth = (text, size, weight) => text.length * size * (weight >= 700 ? 0.6 : 0.53);
const fit = (text, weight, maxWidth, start, min) => {
  let size = start;
  while (size > min && textWidth(text, size, weight) > maxWidth) size -= 2;
  let t = text;
  while (textWidth(t, size, weight) > maxWidth && t.length > 4) t = t.slice(0, -2);
  return { text: t === text ? text : t.trimEnd() + '…', size };
};

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

async function previewImage(card, markUri) {
  const name = card.name || card.handle;
  const photo = await dataUri(card.avatar_url);
  const place = [card.city, card.state].filter(Boolean).join(', ');
  const sub = [card.business_name && card.business_name !== name ? card.business_name : null, place]
    .filter(Boolean).join('  ·  ');
  const services = (card.services || []).slice(0, 2);

  const nameFit = fit(name, 800, 640, 72, 44);
  const subFit = fit(sub, 400, 640, 30, 22);

  const avatar = photo
    ? `<image href="${photo}" x="100" y="155" width="320" height="320" preserveAspectRatio="xMidYMid slice" clip-path="url(#round)"/>`
    : `<circle cx="260" cy="315" r="160" fill="#2A3050"/>
       <text x="260" y="345" text-anchor="middle" font-family="Inter" font-weight="800" font-size="110" fill="#F5F4EE">${esc(initials(name))}</text>`;

  const serviceRows = services.map((s, i) => {
    const line = fit(`${s.name}`, 400, 470, 28, 20);
    const y = 430 + i * 48;
    return `<text x="480" y="${y}" font-family="Inter" font-weight="400" font-size="${line.size}" fill="#E7E5DE">${esc(line.text)}</text>
            <text x="1100" y="${y}" text-anchor="end" font-family="Inter" font-weight="600" font-size="28" fill="#C8956A">${esc(price(s.price_cents))}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="round"><circle cx="260" cy="315" r="160"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1A1F36"/><stop offset="1" stop-color="#0E1220"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="8" fill="#C8956A"/>
  ${avatar}
  <circle cx="260" cy="315" r="163" fill="none" stroke="#C8956A" stroke-width="6"/>
  <text x="480" y="200" font-family="Inter" font-weight="600" font-size="24" letter-spacing="5" fill="#C8956A">BOOK WITH</text>
  <text x="480" y="${200 + 18 + nameFit.size}" font-family="Inter" font-weight="800" font-size="${nameFit.size}" fill="#FFFFFF">${esc(nameFit.text)}</text>
  ${sub ? `<text x="480" y="${200 + 18 + nameFit.size + 48}" font-family="Inter" font-weight="400" font-size="${subFit.size}" fill="#B9B8B0">${esc(subFit.text)}</text>` : ''}
  ${services.length ? `<line x1="480" y1="385" x2="1100" y2="385" stroke="#2E3452" stroke-width="2"/>` : ''}
  ${serviceRows}
  ${markUri ? `<image href="${markUri}" x="480" y="528" width="40" height="40"/>` : ''}
  <text x="${markUri ? 534 : 480}" y="559" font-family="Inter" font-weight="800" font-size="30" fill="#FFFFFF">BookNStyle</text>
  <text x="1100" y="559" text-anchor="end" font-family="Inter" font-weight="400" font-size="22" fill="#8E8F95">Reminders · First reschedule free</text>
</svg>`;

  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  }).render().asPng();
  return png;
}

// The card for links that aren't a specific pro's page yet (the home page, or
// a pro who signed up minutes ago and is served 404.html until the next run).
function defaultImage(markUri) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1A1F36"/><stop offset="1" stop-color="#0E1220"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="8" fill="#C8956A"/>
  <image href="${markUri}" x="540" y="130" width="120" height="120"/>
  <text x="600" y="345" text-anchor="middle" font-family="Inter" font-weight="800" font-size="84" fill="#FFFFFF">BookNStyle</text>
  <text x="600" y="410" text-anchor="middle" font-family="Inter" font-weight="400" font-size="34" fill="#B9B8B0">Book beauty pros near you — in a few taps</text>
  <text x="600" y="520" text-anchor="middle" font-family="Inter" font-weight="600" font-size="24" letter-spacing="4" fill="#C8956A">BOOK NOW · GET STYLED · LIVE WELL</text>
</svg>`;
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  }).render().asPng();
}

// ---------------------------------------------------------------------------
// Per-pro page: the invite page, with this pro's preview tags in <head>.
// ---------------------------------------------------------------------------
function proPage(template, card) {
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

  // Swap the generic tags for this pro's.
  return template
    .replace(/<title>[\s\S]*?<\/title>\n?/, '')
    .replace(/<meta name="description"[^>]*>\n?/, '')
    .replace(/<meta property="og:[^"]*"[^>]*>\n?/g, '')
    .replace(/<meta name="twitter:[^"]*"[^>]*>\n?/g, '')
    .replace(/<meta name="apple-itunes-app"[^>]*>\n?/g, '')
    .replace('<meta name="theme-color"', `${tags.trim()}\n<meta name="theme-color"`);
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
    made++;
  }
  console.log(`Built ${made} pro page(s) into _site/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
