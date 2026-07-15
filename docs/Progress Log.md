# Progress Log

Reverse-chronological ship log. Add new entries at the top.

---

## 2026-07-15 — iOS Safari/Chrome stability

- **Music on iOS:** HTMLAudioElement stream (no `decodeAudioData` of 4MB MP3s → RAM crash)
- **Boot:** stop loading all portraits into Phaser (hybrid uses DOM assets)
- **Board:** skip bulk district preload on iOS/coarse mobile
- **Viewport:** `100dvh` / `-webkit-fill-available`, visualViewport resize; lighter Phaser CANVAS + noAudio
- **UI:** tighter mobile chrome, hide brand on short height, mobile detection includes iPhone UA

## 2026-07-15 — First-session hire / selection

- **Default board view = flat** (war table still toggleable; clearer for hire/stack pick)
- **Move/claim no longer jumps tile selection** to the destination — stays on origin so home stays easy to re-click for Hire
- **Easier crew-tile hits** (larger pick radius + prefer mine tiles)
- **Hire always snaps** off-turf picks to nearest owned (desktop + mobile); open Hire pre-aims an owned block

## 2026-07-14 — Feedback park + repo polish

- **[[Player Feedback]]** vault note: first r/playmygame comment stored; themes tallied; act when repeats land
- **Mobile hire:** snap deploy to nearest owned tile (no hard fail on miss-taps)
- **Mobile KEY:** lower so it clears stats/brand
- **Rival stacks:** one face + card peeks + red `×N` (no tile spill / gold sticker)
- README how-to-play synced to current order flow; GitHub topics + docs catch-up
- **GitHub repo public:** https://github.com/msinclair25/sector-lords

## 2026-07-13 (late) — Mobile pinch pass + repo sync

- **Pinch/zoom dialed in:** no early pointer-capture on touch (2nd finger works), pinch deadzone, wider coarse-pointer scale range, smoother wheel/trackpad, **double-tap zoom** toward finger, gestureend blocked for iOS
- **Mobile bar:** hide disabled Unrest/Influence (turn card still has local work); leaner bottom chrome + sticky End turn in scroller
- **Board safe area:** tighter phone viewport padding, overscroll/pull-to-refresh guards
- GitHub: pushed outstanding main commits; tooling scripts (`check:live`, `check:trace`, `smoke:import`) + playwright devDep

## 2026-07-13 — Orders UI cleanup + live polish

- **Tech gated on selection:** desktop bottom bar and empire hub hide Tech until a free human crew is selected; `tech-open` refuses otherwise (research uses that crew’s Tech rating)
- **Turn card simplified:** local work only (influence sites, unrest, tech) — move/claim/attack stay on green map neighbors (no redundant dest “send them” list)
- **Dropped side Order Guide card** — redundant with turn card + map + bottom-bar Guide / Next free; guide queue behavior kept on bottom bar + idle End Turn banner
- **Unrest / crackdown feedback:** heat bands, crackdown cooldown, sector crackdown turns, police art; unrest meter on tiles (no fire blob)
- **Crew stack UX:** stable roster sort (no reshuffle on select), side scroll preserve, stack Prev/Next, free-first cycle
- **Mobile:** 720px pass (crew FAB/scrim, compact chrome, action scroller); KEY glossary expands instead of scrolling
- **Live recovery:** `_headers` / `_redirects` so JS chunks aren’t SPA-fallback’d as `text/html`; BUILD_ID cache-bust
- Deployed Cloudflare Pages `sector-lords` → sectorlords.com (hard-refresh after chunk changes)
- **Perf traces** re-captured under `chrome dev tools saves/` (`Trace.json.gz`, `Trace2.json.gz`) — still compositor/layer heavy; see [[Decisions]]

## 2026-07-12 — Repo hygiene

- Added **AGENTS.md**, **CONTRIBUTING.md**, **.editorconfig**, **.gitattributes**, **.npmrc**
- Expanded **.gitignore** (wrangler, traces, Obsidian cache, env)
- README aligned with hybrid-first + Unrest + agent docs
- Obsidian vault scaffold under `docs/`

## 2026-07-12 (late) — Mobile + launch polish

- Mobile: crew panel **slide-over** (board full width); FAB **Crew**
- Fixed mobile **Game3DScene import** (static import; circular chunk broke Safari)
- Menu **credits** scrollable / visible on phone
- Board: **pinch-zoom**, edge **X,Y** axis guide, smarter **order routes** (color + monogram + lines)
- Hire: deploy to selected owned tile + focus new crew
- Chaos → **Unrest** rename + save migration
- Idle-crew **End Turn** warning
- Event cards stay until **Acknowledge**
- Audio toggles + now-playing under brand
- Side panel collapsible sections + large selected-crew hero art
- Marketing: X post, LinkedIn draft; live on Cloudflare Pages

## Earlier — Hybrid game vertical slice

- Hybrid **CSS 3D war table** + HTML HUD (`Game3DScene` + `BoardTabletop`)
- Card-style **battle clash** UI (no modal shake preference)
- Order guide, influence sites, research/gear, hire pool
- Music playlist (Iron Litany / Iron Vesper — Gemini credit)
- Cloudflare Pages project `sector-lords`
- Title logo blend (transparent PNG)
- Perf passes from DevTools traces (compositor-bound, not JS)

## Origin

- Vite + TS + Phaser scaffold
- Pure `src/engine` + Vitest
- Content JSON (gangs, sites, events, jobs, items)
- Classic flat `GameScene` retained; hybrid is primary path

---

### Template for new entries

```markdown
## YYYY-MM-DD — Title

- Bullet of what shipped
- Why / player impact
- Deploy / link if relevant
```
