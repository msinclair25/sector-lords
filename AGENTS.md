# Agent instructions — Sector Lords

Instructions for coding agents (Grok Build, Cursor, Claude Code, etc.) working in this repo.

## Project

- **Name:** Sector Lords  
- **What:** Browser cyberpunk crime-war strategy game (hybrid war-table board + HTML HUD)  
- **Live:** https://sectorlords.com (also https://sector-lords.pages.dev)  
- **Host:** Cloudflare Pages project `sector-lords`  
- **Designer:** Morgan Sinclair (`@morganinc` on X)  
- **Purpose:** Playable game **and** evaluation of Grok Build under human direction  

## Stack

- Vite + TypeScript  
- Phaser 4 (shell / scenes)  
- Pure rules in `src/engine` (Vitest)  
- Hybrid board: `src/app-tabletop` (DOM + CSS 3D)  
- Primary play scene: `src/app/scenes/Game3DScene.ts`  
- Content: `src/content/*.json`  
- Deploy: `npm run deploy` → Wrangler Pages  

## Hard rules

1. **Do not break the pure engine.** Keep Phaser/DOM out of `src/engine`. Prefer tests for rule changes.  
2. **IP language:** say **inspired by** classic 90s overlord strategy / Chaos Overlords *vibes* — never claim official remake/license.  
3. **Player-facing name for the cash/heat mechanic is Unrest** (not “chaos”). Internal migration from `chaos` exists in `GameController.migrateState`.  
4. **Primary path is hybrid Game3D**, not classic flat Phaser map. Don’t re-add “Classic flat map” to the main menu without asking.  
5. **No combat modal shake** unless the user asks; card duel presentation is preferred.  
6. **Don’t expand scope** into unsolicited Steam/mobile ports, full Three.js rewrite, or monetization systems.  
7. **Don’t commit secrets.** No API keys in repo.  
8. **Risky git ops** (force push, hard reset, delete remote branches) only with explicit user OK.  
9. **Mobile Safari:** do **not** reintroduce dynamic `import('./Game3DScene')` that pulls a chunk which imports the entry graph (circular → “Failed to import module”). Prefer static import registration.  
10. **Desktop layout must not regress** when changing mobile CSS — use `@media` guards.  

## Conventions

- Prefer small, focused diffs; match existing style.  
- Hybrid HUD CSS: `src/app/ui/hybridHud.css` (self-contained battle/event CSS when overlays mount outside `#sl-hybrid-root`).  
- Board: `BoardTabletop` — pan, wheel zoom, **pinch zoom**, order routes (colored monogram badges + SVG lines), axis X,Y rails.  
- Saves: `localStorage` via `GameController`; extend `migrateState` when renaming persisted fields.  
- Credits on menu: Morgan Sinclair · Grok / SpaceXAI · Gemini (music).  
- Obsidian vault = this folder; progress notes under `docs/`. Update `docs/Progress Log.md` after meaningful ships when practical.  

## Commands

```bash
npm install
npm run dev          # local
npm test             # vitest
npm run build        # tsc + vite
npm run deploy       # build + pages deploy sector-lords
```

## After shipping UI

- Prefer deploy when the user is iterating on live play (Pages).  
- Production URL may lag previews; give preview URL from wrangler when relevant.  
- Tell user to hard-refresh on mobile after chunk/HTML changes.  

## Docs map

| Doc | Use |
|-----|-----|
| `docs/00 Home.md` | Vault dashboard |
| `docs/Grok Build Evaluation.md` | Tool evaluation notes |
| `docs/Progress Log.md` | Ship log |
| `docs/Architecture.md` | Structure |
| `docs/Decisions.md` | Why we chose X |
| `docs/Next Steps.md` | Backlog / GitHub |
| `docs/Player Feedback.md` | External playtest notes (park until themes repeat) |
| `docs/BALANCE.md` | Economy / combat balance |
| `art/STYLE.md` | Art direction |

## Out of scope unless asked

- Rewriting the board in WebGL/Three as default  
- Backend multiplayer  
- Store pages (Steam/itch) full production pipeline  
- Renaming package folder `chaosoverlords` (historical path; product name is Sector Lords)  
