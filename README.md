# app.booknstyle.com

Pro invite links for BookNStyle: `https://app.booknstyle.com/book/<handle>`.

- `index.html` / `404.html` — the invite page (identical files; GitHub Pages serves `404.html` for any path it doesn't have).
- `.well-known/` — iOS Universal Links and Android App Links verification.
- `scripts/generate.mjs` — builds a page and a 1200×630 link-preview image for every pro from the BookNStyle database (public data only).
  A pro who changes their handle keeps the old one for 90 days: the generator also writes a redirect page at each old `/book/<handle>`, with the pro's preview tags.
- `.github/workflows/pages.yml` — runs the generator every 15 minutes and publishes the site.

Source of truth: `web/links/` in the BookNStyle app repository.
