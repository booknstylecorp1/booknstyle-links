// Tests for billing-guard.mjs. Run from web/links:
//   node --test scripts/billing-guard.test.mjs
// scripts/ is never published.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { billingLinksIn, assertNoLinksToBilling } from './billing-guard.mjs';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = (inner) => `<!DOCTYPE html><html><head><title>t</title></head><body>${inner}</body></html>`;

test('flags every way an HTML page can link to /pro', () => {
  const bad = [
    '<a href="/pro/">x</a>',
    '<a href="pro/">x</a>',
    '<a href="./pro/">x</a>',
    '<a href="../pro/">x</a>',
    '<a href="../../pro">x</a>',
    '<a href=/pro/>x</a>',
    '<a href=\'/pro\'>x</a>',
    '<a HREF = "./pro">x</a>',
    '<a href="pro">x</a>',
    '<a href="/%70ro/">x</a>',
    '<a href="/%2570ro/">x</a>',
    '<a href="&#47;pro/">x</a>',
    '<a href="&#x2f;pro/">x</a>',
    '<a href="/p&#114;o/">x</a>',
    '<a href="\\pro\\">x</a>',
    '<a href="/pr\no/">x</a>',
    '<a href="//app.booknstyle.com/pro/">x</a>',
    '<a href="https://app.booknstyle.com/pro/?from=app#top">x</a>',
    '<a href="https://APP.BookNStyle.com/pro">x</a>',
    '<a href="/pro?x=1">x</a>',
    '<a data-href="/pro/">x</a>',
    '<form action="/pro/"><button>x</button></form>',
    '<button formaction="../pro/">x</button>',
    '<iframe src="/pro/"></iframe>',
    '<img srcset="/img/a.png 1x, /pro/ 2x">',
    '<meta http-equiv="refresh" content="0; url=/pro/">',
    '<meta http-equiv="refresh" content="0;URL=\'pro/\'">',
    '<button onclick="location=\'../pro/\'">x</button>',
    '<button onclick="window.open(&quot;/pro/&quot;)">x</button>',
    '<script>window.open("/pro/")</script>',
    "<script>location.assign('../pro/')</script>",
    '<script>location.href = `/pro/${q}`</script>',
    "<script>fetch('\\u002fpro/')</script>",
    "<script>location='pro/'</script>",
    '<p>app.booknstyle.com/pro</p>',
  ];
  for (const html of bad) {
    assert.ok(billingLinksIn(page(html), 'markup').length > 0, `missed: ${html}`);
  }
});

test('flags /pro in scripts and JSON', () => {
  const bad = [
    'window.open("/pro/")',
    "location.assign('../pro/')",
    'fetch(`/pro/`)',
    'var u = "/pro/";',
    "var u = 'https://app.booknstyle.com/pro';",
    "var u = './pro';",
    '{"components":[{"/":"/pro/*"}]}',
  ];
  for (const js of bad) {
    assert.ok(billingLinksIn(js, 'code').length > 0, `missed: ${js}`);
  }
});

test('does not flag things that are not links to /pro', () => {
  const ok = [
    '<div id="pro"></div>',
    '<section class="pro"></section>',
    "<script>show('pro'); $('pro-name').textContent = 'x';</script>",
    '<a href="/profile">x</a>',
    '<a href="/professional">x</a>',
    '<a href="/products/">x</a>',
    '<a href="/book/pro-hair">x</a>',
    '<a href="/book/pro">x</a>',
    '<a href="https://legal.booknstyle.com/pro/">x</a>',
    '<a href="https://legal.booknstyle.com/terms/">x</a>',
    "<script>fetch(SUPABASE_URL + '/rest/v1/rpc/get_pro_invite_card')</script>",
    '<meta property="og:title" content="Pro">',
    '<p>Are you a pro? Pro/Am welcome.</p>',
    '<!-- <a href="/pro/">old</a> -->',
  ];
  for (const html of ok) {
    assert.deepEqual(billingLinksIn(page(html), 'markup'), [], `false alarm: ${html}`);
  }
});

test('text a pro typed on a generated book/ page cannot block the build', () => {
  // generate.mjs escapes < > " ' in everything a pro typed.
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  for (const name of ['Pro/Style Barbers', '../pro/', 'app.booknstyle.com/pro', '<a href="/pro/">x</a>', "x' href='/pro/", 'x href=/pro/']) {
    const html = `<title>${esc(name)} on BookNStyle</title><meta property="og:title" content="${esc(name)}"><img alt="${esc(name)}" src="/og/jo.png"><p>${esc(name)}</p>`;
    assert.deepEqual(billingLinksIn(page(html), 'markup', false), [], `a pro name blocked the build: ${name}`);
  }
});

test('the real site passes, and a bad file anywhere but pro/ fails it', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-guard-'));
  try {
    for (const f of ['index.html', '404.html', 'CNAME', '.nojekyll', '.well-known/apple-app-site-association', '.well-known/assetlinks.json', 'pro/index.html', 'pro/app.js']) {
      await fs.mkdir(path.dirname(path.join(tmp, f)), { recursive: true });
      await fs.copyFile(path.join(SITE_DIR, f), path.join(tmp, f));
    }
    // A generated pro page (index.html is its template) and an old-handle redirect page.
    await fs.mkdir(path.join(tmp, 'book'));
    await fs.copyFile(path.join(SITE_DIR, 'index.html'), path.join(tmp, 'book', 'jo.html'));
    await fs.writeFile(path.join(tmp, 'book', 'old-jo.html'),
      '<meta http-equiv="refresh" content="0; url=/book/jo"><script>location.replace("/book/jo" + location.search + location.hash);</script><p><a href="/book/jo">Continue</a></p>');
    await assertNoLinksToBilling(tmp); // pro/ itself links to /pro/ and is skipped

    await fs.writeFile(path.join(tmp, 'book', 'bad.html'), page('<a href="../pro/">Go Pro</a>'));
    await assert.rejects(assertNoLinksToBilling(tmp), /book\/bad\.html links to the \/pro\/ billing page/);
    await fs.rm(path.join(tmp, 'book', 'bad.html'));

    await fs.writeFile(path.join(tmp, '.well-known', 'apple-app-site-association'), '{"applinks":{"details":[{"components":[{"/":"/pro/*"}]}]}}');
    await assert.rejects(assertNoLinksToBilling(tmp), /apple-app-site-association/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
