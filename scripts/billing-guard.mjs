// Build check: no page on app.booknstyle.com except /pro/ itself may lead to
// the /pro/ billing page.
//
// WHY: the Android app opens this site's pages (booking links, the invite
// page), and Google Play doesn't let the app lead a pro to a purchase. Only
// emails BookNStyle sends on its own may link to /pro/. generate.mjs runs
// this on the finished _site folder and fails the build (nothing is
// published) if any other file links there.
//
// WHY so thorough: a plain "/pro/" search misses relative links ("pro/",
// "../pro/"), unquoted attributes, form actions, meta refreshes,
// window.open("/pro/") and disguised paths ("/%70ro/", "&#47;pro/"). 404.html
// is served at every missing address, so a relative link there can reach
// /pro/ from anywhere.
//
// WHY it reads HTML tag by tag instead of searching the whole file: the
// generated book/<handle>.html pages carry text each pro typed (name,
// business name, services) in <title>, alt= and content= text. A pro named
// "Pro/Style Barbers" must not be able to stop the whole site from
// publishing. So only real link places count: URL attributes (href, src,
// action...), on* handlers, a meta refresh, and <script> code. Pro text can't
// become one of those: generate.mjs escapes < > " ' in everything a pro
// typed.
//
// No dependencies, so the test (billing-guard.test.mjs, `node --test`) runs
// without installing anything. scripts/ is never published.

import fs from 'node:fs/promises';
import path from 'node:path';

const HOST = 'app.booknstyle.com';
const SITE_ROOT = `https://${HOST}/`;
const ABSOLUTE = /app\.booknstyle\.com\/+pro(?![a-z0-9_-])/i;

// Attributes whose value is a URL the browser may open or send to. Any
// attribute ending in "href" counts too (data-href, xlink:href).
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'ping', 'poster', 'data', 'cite', 'background', 'manifest', 'codebase', 'longdesc']);
// A whole tag, quotes respected (a ">" inside a quoted value doesn't end it).
const TAG = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const SCRIPT = /<script\b(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)<\/script\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
// Every quoted string in code, one pattern per quote mark, so a string inside
// another is still found (onclick="location='../pro/'").
const QUOTED = [
  /"((?:\\[\s\S]|[^"\\\n])*)"/g,
  /'((?:\\[\s\S]|[^'\\\n])*)'/g,
  /`((?:\\[\s\S]|[^`\\])*)`/g,
];

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

const NAMED = { sol: '/', period: '.', colon: ':', amp: '&', quest: '?', num: '#', percnt: '%', quot: '"', apos: "'", bsol: '\\', tab: '', newline: '' };
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

// Undo the ways a path can be disguised: HTML entities, JS escapes, %-codes.
export function unmask(s) {
  let v = decodeEntities(s)
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => safeChar(parseInt(a ?? b ?? c, 16)))
    .replace(/\\\//g, '/');
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(v);
      if (d === v) break;
      v = d;
    } catch {
      break;
    }
  }
  // Browsers drop tabs and newlines inside URLs and read "\" as "/".
  return v.replace(/[\t\n\r]/g, '').replace(/\\/g, '/').trim();
}

// True if opening `raw` from any page on this site could land on /pro.
// `bare`: a lone "pro" counts (link attributes) or not (strings in code,
// where 'pro' is usually an element id, e.g. show('pro') in index.html).
export function leadsToBilling(raw, bare) {
  const v = unmask(raw);
  if (!v) return false;
  if (ABSOLUTE.test(v)) return true;
  if (!bare && !v.split(/[?#]/)[0].includes('/')) return false;
  // Resolve from the site root: a relative path that reaches /pro from any
  // page also reaches it from the root, because extra "../" stop at the root.
  try {
    const u = new URL(v, SITE_ROOT);
    return u.hostname === HOST && /^\/pro(?:\/|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

// Quoted strings in code (a .js file, a <script>, an onclick="...").
function codeLinks(code) {
  const hits = [];
  for (const re of QUOTED) for (const m of code.matchAll(re)) if (leadsToBilling(m[1], false)) hits.push(m[0]);
  return hits;
}

// Link places in an HTML / SVG / XML file.
function markupLinks(text) {
  const hits = [];
  for (const m of text.matchAll(SCRIPT)) hits.push(...codeLinks(m[1]));
  // Comments aren't links; script bodies were checked just above.
  const tagsOnly = text.replace(COMMENT, '').replace(SCRIPT, '<script></script>');
  for (const tag of tagsOnly.matchAll(TAG)) {
    const attrs = [...tag[2].matchAll(ATTR)].map((a) => ({
      name: a[1].toLowerCase(),
      value: a[2] ?? a[3] ?? a[4] ?? '',
      text: a[0],
    }));
    const refresh = attrs.some((a) => a.name === 'http-equiv' && /refresh/i.test(a.value));
    for (const a of attrs) {
      if (URL_ATTRS.has(a.name) || a.name.endsWith('href')) {
        if (leadsToBilling(a.value, true)) hits.push(a.text);
      } else if (a.name === 'srcset' || a.name === 'imagesrcset') {
        for (const part of a.value.split(',')) if (leadsToBilling(part.trim().split(/\s+/)[0] ?? '', true)) hits.push(a.text);
      } else if (a.name.startsWith('on')) {
        hits.push(...codeLinks(decodeEntities(a.value)));
      } else if (a.name === 'content' && refresh) {
        const url = /\burl\s*=\s*['"]?([^'";]+)/i.exec(decodeEntities(a.value));
        if (url && leadsToBilling(url[1], true)) hits.push(a.text);
      }
    }
  }
  return hits;
}

// Every place in `text` that leads to /pro.
//   kind 'code':   a .js / .json file (its quoted strings).
//   kind 'markup': an HTML / SVG / XML file.
//   ownText: the file has no pro-typed text (everything except the generated
//            book/ pages), so a bare "app.booknstyle.com/pro" anywhere in it
//            is flagged too, even as plain text.
export function billingLinksIn(text, kind, ownText = true) {
  const hits = kind === 'code' ? codeLinks(text) : markupLinks(text);
  if (ownText && ABSOLUTE.test(unmask(text))) hits.push(`${HOST}/pro`);
  return hits;
}

const MARKUP_FILE = /\.(?:html?|svg|xml)$/i;
const CODE_FILE = /\.(?:m?js|json|webmanifest)$/i;

export async function assertNoLinksToBilling(dir, rel = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (relPath === 'pro') continue; // the billing page itself
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await assertNoLinksToBilling(full, relPath);
      continue;
    }
    // Files with no extension are read as code: .well-known/apple-app-site-
    // association is JSON (it must never send /pro/ links into the app).
    const kind = MARKUP_FILE.test(entry.name) ? 'markup'
      : CODE_FILE.test(entry.name) || !path.extname(entry.name) ? 'code'
      : null;
    if (!kind) continue; // images, fonts
    const hits = billingLinksIn(await fs.readFile(full, 'utf8'), kind, !relPath.startsWith('book/'));
    if (hits.length) {
      throw new Error(`${relPath} links to the /pro/ billing page (${hits[0]}); only emails may link there`);
    }
  }
}
