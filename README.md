<img src="logo.svg" width="72" align="left" alt="">

# How

**Live: [how.sala.company](https://how.sala.company)** · part of [Sala Company](https://go.sala.company)

<br clear="left">

Type a thing — *a combustion engine*, *scissors*, *a can opener*, *how a house is built* — and see how it works, in the spirit of the old "Tell Me Why" picture books: one big exploded view with numbered parts, a few short steps, the real thing in photos and in 3D, in your language. Almost no reading.

It's a static site on GitHub Pages. Visitors sign in with their own OpenRouter account, which pays for both the words (Claude) and the picture (OpenAI's image model, also served through OpenRouter). The pages they make are stored by a tiny link service so they can be shared and reopened free.

## Using it

1. **Type a thing** (or tap a suggestion; *Scissors* is a built-in demo). Pick a language and who it's for (a curious adult, a 10-year-old, an engineering student).
2. **Show me.** Claude works out the parts and steps and writes the picture prompt (~1¢); OpenAI's image model paints the exploded view (~4¢ at high quality, set under *More options*). Both through OpenRouter. About 30 seconds.
3. **Four views:** **Pulled apart** (the exploded view), **Whole** (the thing assembled, same numbers), **Real thing** (Wikipedia photos), **3D** (a Sketchfab model to spin). Under the picture: the numbered parts with a "How does this work?" link on each, step by step, a fun fact. The words appear as soon as Claude answers (~5 s); the two pictures fill in as they are painted. Tap a number on the picture and its card lights up; tap a card and its badge pulses.
4. **Share.** A short link (`…/#scissors/s=k7x2mq9`) opens the same page for anyone, no sign-in. *Download report* saves one self-contained HTML file with the picture inside; *Download picture* saves the image. *Paint again* keeps the words and paints new pictures; *Remake* starts over with new words too.

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
- The earlier version, which asked Claude to draw animated SVG cutaways itself, is tagged `svg-era`. It produced lively but unrecognisable drawings; a painted picture wins.

## Files

| File | What |
|---|---|
| `index.html` | the page |
| `style.css` | picture-encyclopedia look (cream paper, ink lines), dark mode, RTL, mobile |
| `app.js` | sign-in and keys, the prompt and schema, painting, storing, sharing, gallery, Wikipedia and Sketchfab |
| `demo.js`, `demo-scissors.jpg` | the built-in demo page |
| `worker/worker.js` | the link service: stores pages and pictures, short links, gallery, flags, Wikipedia and Sketchfab lookups (Cloudflare Worker + KV) |
| `logo.svg` | gear-with-a-question-mark badge, also the favicon |

## Privacy

| What | Where it goes |
|---|---|
| Your question and language | Through OpenRouter to Claude and to OpenAI's image model when you press *Show me*; to Wikipedia and Sketchfab to find photos and models |
| The page you get | Stored by the link service so it can be shared and reopened; it holds no name or account |
| OpenRouter sign-in | Your browser, until you sign out |
| Analytics | Page views only (GoatCounter, no cookies) |

## Licence

MIT. Photos and 3D models belong to their authors under their own licences.
