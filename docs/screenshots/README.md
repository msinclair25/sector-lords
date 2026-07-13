# Screenshots for GitHub

Images in this folder show up on the repo homepage when linked from the root `README.md`.

## How it works

1. Save PNG/JPG files here, e.g. `menu.png`, `board.png`, `combat.png`.
2. In `README.md` use a **relative path** (not an absolute disk path):

```markdown
![Sector Lords menu](docs/screenshots/menu.png)
```

3. Commit and push. GitHub renders them on:

`https://github.com/msinclair25/sector-lords`

## Recommended set (3)

| File | Shot |
|------|------|
| `menu.png` | Title logo + Jack In |
| `board.png` | War table + crews / order routes |
| `combat.png` or `hire.png` | Card duel **or** hire pool |

## Capture tips

- Desktop Chrome, wide window (or phone for a mobile shot).
- Prefer **PNG** for UI chrome; compress if &gt; ~1.5 MB each.
- Avoid full desktop wallpaper noise — crop to the game.
- Windows: **Win+Shift+S** snip, or full window screenshot.
- Optional 4th: mobile crew drawer if you want “works on phone.”

## Optional: social OG image

GitHub does not use Open Graph for README the way a website does.  
For LinkedIn/X, attach images **in the post**, not only in the repo.

## Do not

- Paste screenshots only into Issues without adding files here (README won’t show them).
- Use `file:///C:/Users/...` paths (broken for everyone else).
