# Rally timing

Small Kingshot helper: enter each rally leader's march time to the target, pick the
second the first rally should land, and it prints the exact clock time every leader has
to press **Go** so the rallies hit back-to-back (1 s apart by default).

- Static site, no build step, served from `public/`
- Everything runs in the browser; nothing is uploaded and there is no backend
- Screenshot reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) (loaded from cdnjs)
- Rows, target time and clock choice are remembered in the browser (localStorage)

## Using it

1. **First rally hits at** – the time (UTC by default, or switch to Local) the first rally
   should land. The quick-set chips fill in "now + N minutes".
2. **Rallies** – one row per rally: leader name and march time (`4:32`, `00:04:32`, `4m 32s`).
   Rallies hit in the order listed; use ↑ ↓ to reorder. Enter in the last march field adds a row.
3. **Read from screenshot** – drop / paste / choose a screenshot (e.g. alliance chat where
   members posted their march times). Every time it finds becomes a row; the name is taken
   from the chat line above it. Chat message timestamps are filtered out where possible —
   check the rows and fix anything it misread.
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
npx netlify deploy --prod
```

No environment variables are needed — the site has no write endpoints, so there is no
`ADMIN_TOKEN` gate.
