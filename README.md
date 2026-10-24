<img src="logo.svg" width="72" align="left" alt="">

# How

**Live: [how.sala.company](https://how.sala.company)** · part of [Sala Company](https://go.sala.company)

<br clear="left">

Type a thing — *a combustion engine*, *scissors*, *a can opener*, *how a house is built* — and see how it works, in the spirit of the old "Tell Me Why" picture books: an animated cutaway drawing, the parts pulled apart, the real thing in photos and in 3D, in your language. Almost no reading.

It's a static site on GitHub Pages: no server, no database, nothing to pay for hosting. Visitors sign in with their own OpenRouter account, which pays for the AI. Every answer is kept in the visitor's browser, so reopening it is free.

## Using it

1. **Type a thing** (or tap one of the suggestions; *Scissors* is a built-in demo that needs no sign-in). Pick a language and who the answer is for (a curious adult, a 10-year-old, an engineering student).
2. **Show me.** The AI draws the answer in a few seconds (about $0.05 on Claude Sonnet, shown under *More options*).
3. **Four views** of the same answer:
   - **In action** — the drawing moves: pistons slide, blades close, gears turn, water flows. Tap any part to name it; tap a step to light up the parts it involves.
   - **Parts** — a slider pulls the drawing apart into an exploded view, each part numbered and named in one line.
   - **Real thing** — photos from the Wikipedia article.
   - **3D** — a Sketchfab model to spin and zoom.
4. **Share.** The link is short (`…/#scissors/s=k7x2mq9`): the answer is stored by a tiny link service (a Cloudflare Worker with KV, `worker/worker.js`), and whoever opens it sees it at once with no sign-in and no AI. If the service can't be reached, the link carries the whole answer compressed into the address instead (3–5 KB). *Download report* saves one self-contained HTML file that works offline with the drawing still moving; *Download drawing* saves the SVG. *Draw it again* asks for a fresh drawing.

Right-to-left languages (Arabic, Urdu, Persian) flip the layout and switch to Noto Naskh Arabic.

The home page opens with a moving drawing under the headline and a **Browse answers** gallery of curated answers, free to open without signing in.

## How it works

```
Question + language + audience
 └─ Claude (via OpenRouter, OAuth PKCE sign-in, or a pasted key)
      returns ONE JSON object: title, one-line hook, 3–7 parts (name, one-line role, colour),
      3–6 steps, a fun fact, Wikipedia title, 3D search terms, and an animated SVG
          ├─ each part is a <g id="…" data-explode="dx dy"> → the page wraps it, numbers it,
          │  makes it tappable, and slides it along (dx, dy) for the exploded view
          └─ motion is SMIL (<animate>, <animateTransform>) → Pause/Play just pauses the SVG
 ├─ Wikipedia media-list API → photos of the real thing
 └─ Sketchfab search API → embedded 3D viewer
```

- **Two calls, not one:** a cheap planning call first works out the parts (with shape, place and motion), the viewpoint, and each step's cause and effect; the drawing call then has to follow that plan. *Draw it again* reuses the plan and only redraws.
- **"Something wrong?"** under every answer stores the flag in the link service; the owner sees the list at `#flags`.
- **The drawing is checked before it's shown:** the SVG must parse, every listed part must exist and be visible, something must move, and parts need a pull-apart direction. If a check fails the page asks the AI once more with the list of problems and keeps the better drawing. Missing pull-apart directions are filled in radially, and all directions are pushed out until the exploded pieces stop overlapping.
- **Steps follow the motion:** the AI gives each step a position in the animation cycle (`at`, 0–100 %) and the cycle length (`loop_seconds`); the page reads the SVG's own clock and lights up the current step and its parts. Tapping a step jumps the animation there.
- **Photos and 3D go through the link service** (`/wiki`, `/3d`), which ranks Wikipedia pictures (lead image first, photos before diagrams, no flags/maps/icons) and caches both for a day; the page falls back to calling Wikipedia and Sketchfab directly.
- **Gallery:** the service keeps a curated list (`/gallery`). Open the page once with `#admin=<ADMIN_SECRET>` and an *Add to gallery* button appears under every answer.
- **Sharing without AI:** `#s=<id>` fetches the answer from the link service (same answer → same id, so re-sharing never fills the store); the fallback `#r=…` is the answer deflated and base64url-encoded, decoded with `DecompressionStream`. Either way the page draws it like any other answer.
- **No AI needed for a repeat:** answers are cached in `localStorage` (last 24), and a built-in demo (`demo.js`) shows the idea without signing in.
- **Safety:** the SVG is parsed with `DOMParser`, stripped of scripts, foreign objects, images and external links before it touches the page.
- **Labels** are placed on each part's biggest shape (through any transforms) and nudged apart so they never overlap.
- **Models:** Claude Sonnet 5.5 by default; Opus for the best drawings, Haiku for the cheapest.

## Files

| File | What |
|---|---|
| `index.html` | the page |
| `style.css` | picture-encyclopedia look (cream paper, ink lines), dark mode, RTL, mobile |
| `app.js` | OpenRouter sign-in, the prompt and JSON schema, drawing/explode/labels, Wikipedia and Sketchfab |
| `demo.js` | built-in answers that need no AI (scissors) |
| `worker/worker.js` | the link service: short links, gallery, Wikipedia and Sketchfab lookups (Cloudflare Worker + KV) |
| `logo.svg` | gear-with-a-question-mark badge, also the favicon |

## Privacy

| What | Where it goes |
|---|---|
| Your question and language | To the AI (Claude via OpenRouter) when you press *Show me*; to Wikipedia and Sketchfab to find photos and models |
| The answer | Shown on the page and kept in your browser; nothing comes back to this site |
| OpenRouter sign-in | Your browser, until you sign out |
| Analytics | Page views only (GoatCounter, no cookies) |

## Licence

MIT. Photos and 3D models belong to their authors under their own licences.
