# app.booknstyle.com

Pro invite links for BookNStyle: `https://app.booknstyle.com/book/<handle>`.

- `index.html` / `404.html` — the invite page (identical files; GitHub Pages serves `404.html` for any path it doesn't have).
- `.well-known/` — iOS Universal Links and Android App Links verification.
- `scripts/generate.mjs` — builds a page and a 1200×630 link-preview image for every pro from the BookNStyle database (public data only).
  A pro who changes their handle keeps the old one for 90 days: the generator also writes a redirect page at each old `/book/<handle>`, with the pro's preview tags.
- `.github/workflows/pages.yml` — runs the generator every 15 minutes and publishes the site.
- `pro/` — the Pro billing page, `https://app.booknstyle.com/pro/` (see `pro/README.md`). No other page links to it: the Android app opens this site's `/book/` pages, and Google Play doesn't allow the Android app to lead pros to a purchase.
- `scripts/billing-guard.mjs` — run by the generator on the finished site: the build fails (nothing is published) if any page other than `pro/` links to `/pro/`, however the link is written. Tests: `node --test scripts/billing-guard.test.mjs` (also run by the workflow).

Source of truth: `web/links/` in the BookNStyle app repository.
