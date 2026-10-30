<img src="logo.svg" width="72" align="left" alt="">

# How

**Live: [how.sala.company](https://how.sala.company)** · part of [Sala Company](https://go.sala.company)

<br clear="left">

Type a thing — *a combustion engine*, *scissors*, *a kettle*, *how a house is built* — and get three answers: **how it works** (one big exploded view with numbered parts, a few short steps, the real thing in photos and in 3D, in the spirit of the old "Tell Me Why" picture books), **how it is made** (the factory, in three versions: hand-made, mixed and automated) and **what it costs** (to set up and to run, and how long each version takes to pay back). In your language.

It's a static site on GitHub Pages. Visitors sign in with their own OpenRouter account, which pays for both the words (Claude) and the picture (OpenAI's image model, also served through OpenRouter). The pages they make are stored by a tiny link service so they can be shared and reopened free.

## Using it

1. **Type a thing** (or tap a suggestion; *Scissors* is a built-in demo). Pick a language and who it's for (a curious adult, a 10-year-old, an engineering student).
2. **Show me.** Claude works out the parts and steps and writes the picture prompt (~1¢); OpenAI's image model paints the exploded view (~4¢ at high quality, set under *More options*). Both through OpenRouter. About 30 seconds.
3. **One story in three chapters**, with a bar pinned at the top (⚙️ How it works · 🏭 How it's made · 💰 What it costs) that fills as you scroll and jumps to a chapter. **How it works:** on wide screens the picture stays put while the numbered parts and steps scroll past; it starts whole and comes apart as the parts come up (a switch flips it by hand), and each part's number pulses as its card passes. Then the real thing in Wikipedia photos and a Sketchfab model to spin, which loads only when you reach it. Each part has a "How does this work?" link. The words appear as soon as Claude answers (~5 s); the pictures fill in as they are painted. The **How it's made** and **What it costs** chapters open with a title card and load their code and content just before you reach them.
4. **Share.** A short link (`…/#scissors/s=k7x2mq9`) opens the same page for anyone, no sign-in. *Download report* saves one self-contained HTML file with the picture inside; *Download picture* saves the image. *Paint again* keeps the words and paints new pictures; *Remake* starts over with new words too.

5. **🏭 Factory** comes in three versions, each its own plan: **✋ hand-made** (labour-heavy, simple tools), **🤝 mixed** and **🤖 automated** (robots; people only where they are actually needed). A switcher picks one; once two are planned a table compares people, automation, floor space, output, investment and cost to make one. What it would take to make the thing, in the order it happens: raw materials, which parts are made and which are bought, how each is made, assembly, quality control, packing and shipping. Every step is marked 🤖 machine, ✋ people or 🤝 both, with the reason. A line diagram and an automation bar sum it up; a floor plan drawn to scale shows each zone's size and the machines' footprints, with a painted overview of the floor above it. One click, ~12¢ for the first version (Claude ~2¢, the floor ~4¢, the before/after pictures ~6¢ at low quality, six at a time) and less for the others, which reuse every before/after picture that shows the same thing; the scissors demo has one built in. Under the plan, **before → after** pictures show each zone's work as it comes in and as it leaves (a coil of steel → stamped blanks → hardened blanks…), made with the plan (an older plan gets a button): Claude describes each state, the image model paints each one as a small square, reusing a picture when one zone's input is the last zone's output. It is saved with the page, so share links carry it.

6. **💰 Money.** Approximate financials for the three setups side by side, for a region you pick: land and building, people and monthly salaries, equipment, power, other running costs and materials (Claude estimates the inputs, ~2¢; the page does every sum). Every input can be changed — a few overall controls (output, salaries, power price, materials, equipment and running costs) and every line in the detail — and the page recalculates at once; numbers you type are exact, the AI's are shown as ranges. A markup slider shows the selling price, monthly profit and how long each setup takes to pay back, against the typical market price, and the markup needed to pay back in three years.

Right-to-left languages (Arabic, Urdu, Persian) flip the layout and switch to Noto Naskh Arabic. The home page shows a page from the gallery under the headline and a **Browse answers** grid, free to open.

## How it works

```
Question + language + audience
 ├─ 1. Claude Sonnet via OpenRouter (strict JSON): title, hook, kind, 4–8 parts (name, English name, role),
 │     3–6 steps, fun fact, Wikipedia title, 3D search terms, and an image prompt that lists the parts
 │     in order as numbered badges
 ├─ 2. openai/gpt-image-2.5-flare, via OpenRouter's /api/v1/images, paints the 1536×1024 picture (b64 → jpeg)
 ├─ 3. The page (words + picture) is POSTed to the link service, which stores the picture separately
 │     and answers with a 7-character id; the browser keeps only the id
 ├─ Wikipedia (via the service, cached) → photos of the real thing
 └─ Sketchfab (via the service, cached) → embedded 3D viewer
```

- **The key stays in the browser.** OpenRouter via OAuth PKCE (or a pasted key). It is never sent to this site or the link service.
- **Every picture is checked:** a cheap vision model looks at it against the parts list (each number once, on the right part; a scissor half drawn as a half, not a whole pair; no stray text). If it fails, one repaint with the corrections appended. The same look returns where each badge is, which is what makes the numbers tappable.
- **Same page → same id.** Storing is content-addressed, so re-sharing never fills the store.
- **"Something wrong?"** under every page flags it; the owner sees the list at `#flags`.
- **Gallery:** the owner (page opened once with `#admin=<ADMIN_SECRET>`) gets an *Add to gallery* button.
- **Follow-ups:** every part has "How does this work? →", which asks about that part in the context of the thing.
- **Factory:** a second Claude call (strict JSON: materials, make-or-buy per part, 12–24 steps each marked machine / people / both, 6–10 floor zones with sizes in metres and machine footprints, and a picture prompt), then the image model paints the floor. The floor plan is drawn in the browser from the zone sizes (folded into a U or S when the line is long), so its dimensions are exact. Storing it needs the current `worker/worker.js`; an older link service drops the plan and the page keeps it in the browser only.
- The earlier version, which asked Claude to draw animated SVG cutaways itself, is tagged `svg-era`. It produced lively but unrecognisable drawings; a painted picture wins.

## Files

| File | What |
|---|---|
| `index.html` | the page |
| `style.css` | picture-encyclopedia look (cream paper, ink lines), dark mode, RTL, mobile |
| `app.js` | sign-in and keys, the prompt and schema, painting, storing, sharing, gallery, Wikipedia and Sketchfab |
| `i18n.js`, `i18n/*.js` | the page's own labels: English in `i18n.js`, each other language in its own file, loaded only when a page in it opens; `tx('key')` picks the page's language |
| `scripts/make-gallery.mjs`, `.github/workflows/gallery.yml` | makes complete gallery pages (page, three factory versions, money) on the live site; run from the Actions tab |
| `money.js` | the What it costs chapter: the estimate's prompt and schema, the sums, cards, payback and cost bars |
| `factory.js` | the How it's made chapter: the plan's prompt and schema, the line diagram, the to-scale floor plan, the factory part of the report |
| `demo.js`, `demo-scissors.jpg` | the built-in demo page, with its factory |
| `worker/worker.js` | the link service: stores pages and pictures, short links, gallery, flags, Wikipedia and Sketchfab lookups (Cloudflare Worker + KV) |
| `logo.svg`, `favicon-48.png`, `apple-touch-icon.png` | gear-with-a-question-mark badge, also the favicon and home-screen icon |
| `og-image.jpg`, `robots.txt`, `sitemap.xml` | link preview picture and search-engine files |

`factory.js` and `money.js` load just before the reader scrolls to (or jumps to) the How it's made chapter. Every AI request sends its fixed instructions as a cached system prompt (repeats within a few minutes cost a tenth) and the product, language and reader in the user message.

## Privacy

| What | Where it goes |
|---|---|
| Your question and language | Through OpenRouter to Claude and to OpenAI's image model when you press *Show me*; to Wikipedia and Sketchfab to find photos and models |
| The page you get | Stored by the link service so it can be shared and reopened; it holds no name or account |
| OpenRouter sign-in | Your browser, until you sign out |
| Analytics | Page views, and which answers get opened, counted by GoatCounter (no cookies, nothing personal) |

## Licence

MIT. Photos and 3D models belong to their authors under their own licences.

## Filling the gallery

`scripts/make-gallery.mjs` opens the live site in a headless browser and, for each thing, makes the page, plans all three factory versions, estimates the money and adds the result to the gallery — about 30¢ and 5–10 minutes per thing. To run it on GitHub: add the repository secrets `OPENROUTER_KEY` and `HOW_ADMIN_SECRET`, then Actions → **Make gallery pages** → Run workflow (it stops starting new things once `max_spend` dollars are spent). The link service must be running the current `worker/worker.js`, or the factory and money parts are not kept.
