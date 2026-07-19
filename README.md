# Abridged

A one sentence journal. Write a single line each day, and keep it.

Static prototype — no build step, no dependencies, no backend. Same shape as
`faunadex`: plain HTML/CSS/JS that can be served from anywhere, installable as a
PWA on phone and desktop.

## Running it

Any static server works:

```sh
npx http-server . -p 4178 -c-1
```

Then open <http://localhost:4178>. Installing (home screen / dock) needs
`https://` or `localhost` — a plain `file://` open will not register the service
worker.

## The three views

| View | What it does |
| --- | --- |
| **Write** | Today's date, one 160-character sentence, save or update. `Enter` saves; `Shift+Enter` adds a line break. |
| **Calendar** | Month grid with a dot on every day that has an entry. Tap a day to read it, edit it, or delete it. Past days without an entry can still be written for. |
| **Journal** | Every sentence, newest or oldest first, paged in as you scroll. Search highlights matches; the filter narrows to last 30 days / this year / this month. |

## Storage

Everything lives in `localStorage` under `abridged.entries.v1`, keyed by **local**
date:

```json
{ "2026-07-19": { "text": "…", "created": 1770000000000, "updated": 1770000000000 } }
```

One entry per day, by design. Settings (gear icon) can export the whole store as
JSON, import it back, add ~84 sample entries to explore the prototype, or erase
everything.

Because it's `localStorage`, entries are per-browser and per-origin — they do not
sync between phone and desktop. That's the main thing to replace if this becomes
more than a prototype.

## Files

```
index.html            markup for all three views
app.css               design tokens + mobile layout, desktop from 900px up
app.js                storage, routing, and the three view renderers
sw.js                 service worker — stale-while-revalidate app shell
manifest.webmanifest  PWA manifest
icons/                generated PNG icons (any + maskable)
```

Mobile gets a bottom tab bar; from 900px up the same markup becomes a left
sidebar with a two-column calendar.

## Changing app.css or app.js

Assets are cache-busted by query string so the service worker can't serve a stale
shell. Bump the version in **both** places together:

- `index.html` — `app.css?v=N` and `app.js?v=N`
- `sw.js` — `VERSION` and the two `SHELL` entries

## Icons

`icons/leaf.svg` is the source of truth. `icons/make_icons.py` renders every PNG
from it — parsing the path, flattening its beziers, and scanline-filling at 4x
supersampling. Pure stdlib: no Pillow, no ImageMagick, no browser. Edit the SVG,
re-run the script, done:

```sh
python3 icons/make_icons.py
```

Four variants, because each context masks differently:

| File | Purpose | Shape |
| --- | --- | --- |
| `mark-96.png` | header logo, favicon | full-bleed circle |
| `icon-192/512.png` | manifest `any` | circle inset 10% — desktop draws its own rounded-square tile and would clip a flush circle |
| `icon-192/512-maskable.png` | manifest `maskable` | full-bleed opaque, mark inside the 80% safe zone |
| `icon-180.png` | `apple-touch-icon` | full-bleed opaque — iOS composites transparency against black |

The rule: anything the platform masks itself must be opaque edge to edge;
anything drawn as-is needs its own margin. The per-icon mark size is the last
column of `ICONS` in the script — keep the mark inside 80% of half-width on
maskable, and roughly 88% on the Apple icon.

Icon URLs carry `?v=N` in `index.html`, `manifest.webmanifest` and `sw.js`
because the service worker's `addAll` fetches through the browser's HTTP cache —
without it, a stale icon can survive a version bump. Bump all three together.
