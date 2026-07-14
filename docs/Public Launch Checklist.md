# Public GitHub launch checklist

Repo: https://github.com/msinclair25/sector-lords  
Live: https://sectorlords.com (also https://sector-lords.pages.dev)  

Use this before flipping **private → public**.

---

## How screenshots appear on GitHub

GitHub has no separate “gallery” product. The **README is the storefront**.

1. Put images in the repo (we use `docs/screenshots/`).
2. Reference them in `README.md` with markdown:

```markdown
![Alt text](docs/screenshots/menu.png)
```

3. Push to `main` → they show on the repo home page.

**Also set** (GitHub → Settings, or `gh`):

- Description  
- Website: `https://sector-lords.pages.dev`  
- Topics: `typescript`, `vite`, `game`, `phaser`, `cloudflare-pages`, etc.  

Optional: a **social preview** image under Settings → General → Social preview (separate from README images).

---

## Checklist

### Must do

| # | Item | Status |
|---|------|--------|
| 1 | **LICENSE** (e.g. MIT) | ⬜ Add before public |
| 2 | **README** polished: live link, what it is, IP disclaimer, screenshots | ✅ |
| 3 | **Screenshots** in `docs/screenshots/` (2–3 strong shots) | ✅ (refresh later if UI drifts) |
| 4 | **No secrets** in git (`.env`, tokens, wrangler secrets) | ✅ None found |
| 5 | **Ignore junk** (`node_modules`, `dist`, traces) | ✅ |
| 6 | **IP wording** — inspired by / not official remake | ✅ in README |
| 7 | **Homepage + description** on GitHub | ✅ set |
| 8 | **Build + tests pass** | ✅ re-check before flip |
| 9 | Flip visibility **public** | ✅ 2026-07-14 |

### Should do

| # | Item | Status |
|---|------|--------|
| 10 | Topics / tags on repo | ✅ |
| 11 | Social preview image (repo Settings) | ⬜ optional |
| 12 | Decide: keep `AGENTS.md` + `docs/` (fine for public — shows process) | ✅ keep |
| 13 | LinkedIn / X use **same** live URL + GitHub URL | after public |

### Nice later

| # | Item |
|---|------|
| 14 | GitHub Actions: `npm test` on push |
| 15 | Releases / changelog |
| 16 | Make repo public → announce |

---

## Suggested shot list

1. **Menu** — title art + Jack In (hero)  
2. **Board** — war table, a few crews, maybe order routes  
3. **Combat or Hire** — card duel *or* hire pool  

---

## Flip command (when ready)

```bash
gh repo edit msinclair25/sector-lords --visibility public
```

Or: GitHub → Settings → Danger Zone → Change visibility.

---

## After public

- Add repo link to LinkedIn / X / Reddit  
- Pin repo on your GitHub profile (optional)  
- Watch Issues for spam; disable if needed  
