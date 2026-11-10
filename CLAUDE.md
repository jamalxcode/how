# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**How** (https://how.sala.company) is a static, no-build web app: type a thing ("scissors", "a kettle") and get one
illustrated story in three chapters: **how it works** (an AI-painted exploded view with numbered parts, steps,
Wikipedia photos, a Sketchfab 3D model), **how it is made** (a factory plan in hand-made / mixed / automated versions,
with a to-scale floor plan and before/after pictures) and **what it costs** (financials, payback, and a world map of
where to make it). Visitors sign in with their own OpenRouter account (OAuth PKCE or pasted key); text comes from
Claude and pictures from OpenAI's image model, both via OpenRouter, called directly from the browser. Tech: vanilla
HTML/CSS/JS (classic scripts, no framework, no bundler), plus a small Cloudflare Worker + KV "link service".

## Commands

There is no package.json, build, lint or test setup. Serve the repo root statically, e.g.:

```bash
python3 -m http.server 8765   # port 8765 on localhost/127.0.0.1 is in the worker's CORS allow-list
```

Maintenance scripts (Node 22; normally run from the Actions tab, see Deployment):
- `OPENROUTER_KEY=… HOW_ADMIN_SECRET=… node scripts/make-gallery.mjs` – drives the live site in headless Playwright to
  make complete gallery pages (costs real OpenRouter money; `CHECK_ONLY=true` spends nothing).
- `PAGE=<id or share link> node scripts/inspect-page.mjs` – prints what the link service stores for one page.

## Architecture

- `index.html` – the page, SEO/OG/JSON-LD metadata, loads `demo.js`, `i18n.js`, `app.js` with `?v=` query strings,
  then the GoatCounter snippet.
- `app.js` (~1000 lines) – sign-in/keys, prompts and strict-JSON schemas, OpenRouter calls
  (`/api/v1/chat/completions`, `/api/v1/images`), picture checking/repaint, storing and sharing, gallery, flags,
  Wikipedia and Sketchfab panels, report download, RTL handling, hash routing (`#<thing>/s=<id>`, `#flags`, `#admin=…`).
- `factory.js` (How it's made), `money.js` (What it costs), `atlas.js` + `world.json` (world map) – loaded lazily by
  `loadFeatures()` in `app.js` just before the reader reaches those chapters.
- `i18n.js` – English UI labels and `tx('key', {placeholders})`; other languages are `i18n/<code>.js` (same keys),
  loaded on demand. The AI writes the content itself in the chosen language.
- `demo.js` + `demo-scissors.jpg` – built-in free Scissors demo (including its factory).
- `worker/worker.js` – the link service (Cloudflare Worker, KV binding `LINKS`, optional secret `ADMIN_SECRET`):
  content-addressed page storage with 7-char ids, pictures stored separately, gallery, flags, cached Wikipedia (`/wiki`)
  and Sketchfab (`/3d`) lookups, per-IP POST rate limit, and an origin allow-list. Its endpoint is hard-coded as
  `LINKS_API` in `app.js` and both scripts. It is **not** deployed by this repo's workflows (deployed separately to
  Cloudflare). It sanitizes stored pages field by field (`cleanAnswer`, `cleanFactory`, …): new fields added to a page
  in the front end are silently dropped unless the worker is updated too. Cloudflare's free plan limits it to ~1,000 KV
  writes/day.
- `localStorage` keys (via the `store` helper): `or_key` (OpenRouter key, never sent to the site or worker),
  `pkce_verifier`, `pending_q`, `how_admin`, `how_region` (money.js).

## Deployment

- `.github/workflows/pages.yml` – on push to `main` (or manual dispatch) uploads the **whole repo root** as the GitHub
  Pages artifact and deploys via Actions. No build step. **Pushing to `main` deploys live.**
- `CNAME` = `how.sala.company`; `.nojekyll` is present so files are served as-is.
- `gallery.yml` (manual, "Make gallery pages") runs `scripts/make-gallery.mjs` with repo secrets `OPENROUTER_KEY` and
  `HOW_ADMIN_SECRET`; `inspect.yml` (manual, "Inspect a page") runs `scripts/inspect-page.mjs`.

## Conventions / gotchas

- **Cache-busting**: assets are referenced with version query strings that must be bumped when the file changes:
  `style.css?v=`, `demo.js?v=`, `i18n.js?v=`, `app.js?v=` in `index.html`; `factory.js?v=`, `money.js?v=`,
  `atlas.js?v=` in `loadFeatures()` in `app.js`; `i18n/${code}.js?v=` in `i18n.js`.
- **GoatCounter** analytics at the end of `index.html` (endpoint `https://salacompany.goatcounter.com/count`, paths
  prefixed with `location.host`, skipped on localhost) – keep it intact. `app.js` also sends `goatcounter.count` events
  for tab views and opened answers.
- **RTL / i18n**: Arabic, Urdu, Persian (and Hebrew) results set `dir="rtl"` and load Noto Naskh Arabic; `style.css`
  includes RTL, dark mode and mobile rules. When adding a UI label, add the key to `I18N.en` in `i18n.js` and to each
  `i18n/*.js` (English is the fallback).
- Never send the user's OpenRouter key anywhere except OpenRouter. Do not commit secrets.
- The older SVG-cutaway version is tagged `svg-era` in git (per README).
