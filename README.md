# Twin Napper

A phone-first sleep tracker for twins. It runs as a home-screen web app on GitHub Pages. Both parents share one log through a `data` branch in this repository. There is no separate server.

Live app, after GitHub Pages is enabled: [https://pamparious.github.io/twin-napper/](https://pamparious.github.io/twin-napper/)

Nap suggestions are guidance, not medical advice. Watch the babies, not only the clock.

## What it does

- Shows both twins on the home screen, with one-tap start and stop.
- Lets you log or edit a sleep after the fact, move it to the other twin, and undo a recent tap.
- Suggests the next nap from corrected age (due date until 24 months) plus the last week of your own logs.
- Shortens the next wake window after a nap under 30 minutes, protects bedtime, and flags a possible nap transition instead of dropping a nap on its own.
- Charts each day, compares sleep with age targets, and scores how close the predictions were.
- Exports JSON and CSV, and copies a 14-day summary you can paste into another AI chat.

## Install on an iPhone

1. Open the Pages URL in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open Twin Napper from the new icon. Safari and the home-screen app do not share storage, so the token has to be pasted in the installed app.

Android: use the browser menu and choose **Install app** or **Add to Home screen**.

## Connect the two phones

The site is public. The sleep log is a `data` branch in this same public repository, so use nicknames rather than real names. Real names stay on each phone.

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Limit the token to `pamparious/twin-napper`.
3. Repository permission: **Contents: Read and write**. No other permissions.
4. Generate the token. GitHub shows it once. Fine-grained tokens expire after a year at most.
5. In the installed app, open Settings and paste the token. Use the same token on both phones. It stays in that phone's storage and is not committed.

The first save creates the `data` branch. After that, an open app checks for changes about every 15 seconds. Entries are saved on the phone first and sent when you are back online.

## How the suggestions are chosen

The engine runs in the browser:

- Age table blended from published wake-window charts (Napper, Huckleberry, CHOC, Babysential, The Baby Sleep Site) and AASM total-sleep ranges from 4 months.
- Personal wake windows are a recency-weighted average of the last 7 days for the same nap position, then blended with the age row. More logs pull toward your twins; the result stays near the age range.
- A nap under 30 minutes shortens the next wake window. Long naps, early wake-ups and a short day of sleep adjust the rest of the day. A nap that would run into bedtime becomes a short catnap or is skipped.
- An optional schedule override, including one pasted back from an AI chat, replaces the table. Same-day adjustments still apply unless the override turns them off.

Sources: Napper's wake-window guide, Huckleberry's description of SweetSpot, a University of Turku thesis on 13.5 million Napper logs (age norms plus 7-day rolling stats matched heavier models), and the two-process model of sleep pressure.

## Develop

```bash
npm install
npm test
npm run dev
```

The dev server uses the `/twin-napper/` base path. `npm test` runs the recommendation and sync-merge tests. `npm run build` checks TypeScript and builds the Pages site.
