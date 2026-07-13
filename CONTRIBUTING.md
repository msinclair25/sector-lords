# Contributing

## Setup

```bash
npm install
npm run dev
npm test
```

## Workflow

1. Prefer the **hybrid** game path (`Game3DScene` + `BoardTabletop`).  
2. Keep **rules** in `src/engine` pure and covered by Vitest when behavior changes.  
3. Player-facing mechanic name: **Unrest** (not chaos).  
4. Positioning: **inspired by** classic overlord strategy — not an official remake.  
5. Deploy: `npm run deploy` (Cloudflare Pages `sector-lords`).  

## Agents

See **[AGENTS.md](./AGENTS.md)** for coding-agent rules (Grok Build, Cursor, etc.).

## Docs / Obsidian

This directory is an Obsidian vault. Progress and decisions live under `docs/`.  
Update `docs/Progress Log.md` when you ship something meaningful.
