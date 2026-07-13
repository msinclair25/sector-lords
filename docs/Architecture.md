# Architecture

## Layers

```
┌─────────────────────────────────────────┐
│  MenuScene (HTML landing)               │
│  Game3DScene (hybrid HUD + board host)  │
│  GameScene (classic flat Phaser map)    │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  GameController — save, orders, turns   │
└─────────────────┬───────────────────────┘
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
 src/engine   src/ai      src/content
 (rules)      (heuristic) (JSON defs)
     │
     ▼
 BoardTabletop (DOM/CSS 3D board)
 SoundBank (Web Audio + playlist)
```

## Key paths

| Path | Role |
|------|------|
| `src/engine/` | Pure game state: map, orders, combat, economy, events, jobs, research |
| `src/ai/heuristicAi.ts` | AI orders |
| `src/content/` | Gangs, sites, events, items, scenarios |
| `src/app/GameController.ts` | App façade + save migrate |
| `src/app/scenes/Game3DScene.ts` | Primary play HUD |
| `src/app-tabletop/` | War table board + CSS |
| `public/assets/` | Art, audio |
| `tests/engine/` | Vitest rules |

## Deploy

- **Build:** `npm run build` → `dist/`
- **Host:** Cloudflare Pages project `sector-lords`
- **Production:** https://sector-lords.pages.dev
- **Headers:** `public/_headers` (HTML revalidate; hashed assets immutable)

## Notable technical decisions

- Hybrid board = **DOM + CSS 3D**, not Three.js path (Three scaffold exists in `src/app-3d`)
- Game3D **static import** from Menu (mobile Safari circular dynamic import failure)
- Saves in `localStorage` with `migrateState` (e.g. chaos → unrest)
