# Decisions

Product and design calls worth remembering.

## Naming

| Decision | Choice | Why |
|----------|--------|-----|
| Project title | **Sector Lords** | Own brand, not the IP name |
| Mechanic rename | **Unrest** (was chaos) | Distance from Chaos Overlords; clear strategy language |
| Positioning | Inspired by 90s overlord strategy | Honest; safer than “remake” |

## Combat / UX

| Decision | Choice | Why |
|----------|--------|-----|
| Fight presentation | **Card duel** | Portrait-forward; player preference |
| Modal shake | **Removed** | Felt cheap / nausea |
| End turn with free crews | **Warn + confirm** | Prevent accidental idle turns |
| City events | Stay until **Acknowledge** | Time to read |
| Tech entry | **Only with free selected crew** | Research uses that crew’s Tech; hide not disable |
| Side Order Guide card | **Removed** | Overlapped turn card + map greens + bottom Guide |
| Bottom Order guide / Next free | **Keep** | Sequential free-crew walk without side chrome |
| Move/claim/attack UI | **Map greens primary** | Turn card = influence / unrest / tech only |

## Board

| Decision | Choice | Why |
|----------|--------|-----|
| Order markers | Color routes + monogram, **no second portrait** | Multi-crew clarity + perf |
| Coordinates | Edge **X,Y** rails | Match UI `block 1,2` labels |
| Mobile board | Full width + **Crew** slide-over | Side panel was covering half the board |
| Mobile zoom | **Pinch** + wheel on desktop | Phone playability |

## Performance (DevTools traces)

| Finding | Choice / note | Why |
|---------|----------------|-----|
| Bottleneck class | **Compositor / layers**, not V8 | Massive `UpdateLayer` + `RasterTask` + `ImageDecodeTask`; JS `onclick` re-renders ~10–30ms |
| Frame feel | ~46–54 FPS median; many `DroppedFrame` | Board CSS 3D + full HUD `innerHTML` paint |
| Perf response so far | Avoid extra board portraits on routes; heat as CSS meter | Earlier traces same class |
| Next levers (not done) | Partial HUD paint; fewer layers / `will-change`; decode/cache art; reduce mousemove work | Only if play still feels janky |

Traces live locally (gitignored): `chrome dev tools saves/Trace.json.gz`, `Trace2.json.gz`. Analyzer: `node scripts/analyze-trace.mjs`.

## Meta

| Decision | Choice | Why |
|----------|--------|-----|
| Credits | Morgan + Grok/xAI + Gemini music | Accurate attribution |
| Domain | sectorlords.com on Cloudflare Pages | Custom domain live; pages.dev remains as fallback |
| Docs | Obsidian vault **in this folder** | Progress + evaluation notes |
| Source | **Public GitHub** https://github.com/msinclair25/sector-lords | Portfolio + backup (MIT) |
