# Rally timing

Small Kingshot helper: enter each rally leader's march time to the target, pick the
second the first rally should land, and it prints the exact clock time every leader has
to press **Go** so the rallies hit back-to-back (1 s apart by default).

- Static site, no build step, served from `public/`
- Everything runs in the browser; nothing is uploaded and there is no backend
- Screenshot reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) (loaded from cdnjs)
- Rows and target time are remembered in the browser (localStorage)

## Using it

1. **First rally hits at** – the UTC time the first rally
   should land. The quick-set chips fill in "now + N minutes".
2. **Rallies** – one row per rally: leader name and march time (`4:32`, `00:04:32`, `4m 32s`).
   Rallies hit in the order listed; use ↑ ↓ to reorder. Enter in the last march field adds a row.
3. **Read from screenshot** – drop / paste / choose a screenshot (e.g. alliance chat where
   members posted their march times). For Kingshot chat it finds the cream speech bubbles by
   colour and reads each one on its own (plus the name line above left-side bubbles), which
   is far more reliable than OCR-ing the whole screen; other screenshots fall back to
   whole-image OCR. Every time it finds becomes a row — `1:00`, `52 :43`,
   `00:04:32`, `1min`, `1 min 30`, `2m 15s`, `90s`, or a bubble that is just `1` (= minutes).
   The name is taken from the chat line above the bubble (rank badge and alliance tag
   stripped); your own bubbles on the right side become **You**. Lines like "hit at 34:00"
   are skipped. Check the rows and fix anything it misread.
4. **Launch at** is the second each leader starts their rally. It turns red if that second has
   already passed (pick a later target), yellow when it is less than a minute away.
5. **Copy for chat** copies the schedule, sorted by launch time, as plain text.

Math: `hit_i = target + i × gap`, `launch_i = hit_i − march_i`.

## Run locally

```bash
npx -y serve -l 8765 public
```

## Deploy

```bash
./deploy.sh
```

This stamps a build version into `index.html` (shown in the page footer and used to
cache-bust `app.js` / `style.css`) and runs `netlify deploy --prod`. If a phone shows an
old footer version after a deploy, close the tab completely and reopen it.

No environment variables are needed — the site has no write endpoints, so there is no
`ADMIN_TOKEN` gate.
