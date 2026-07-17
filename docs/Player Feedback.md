# Player feedback

Collect external playtest notes here. **Do not ship knee-jerk changes from a single comment** — wait for themes across several players, then decide in [[Decisions]] / backlog.

---

## Status

| Mode | Notes |
|------|--------|
| **Parking** | Themes now repeated — prioritize onboarding / visual clarity |
| Last review | 2026-07-16 (We Playtest Games full video) |

### Themes to watch (tally when repeats show up)

| Theme | Count | Possible response (later) |
|-------|------:|---------------------------|
| Ownership hard to see at a glance | 2 | Stronger mine rim / coach beat / YOUR label |
| Influence vs unrest unclear (permanent vs temp) | 2 | Turn-card / coach one-liner |
| End Turn / resolve feels too fast or chaotic | 2 | Calmer resolve feedback; no camera thrash |
| Idea good, visuals/info density confusing | 2 | First-minute coach path only |
| Need step-by-step tutorial (not wall of text) | 1 | Guided mode; introduce systems one-by-one |
| Jobs unclear / must “accept” not obvious | 1 | Job copy + accept UX |
| Crew role (attack vs defense) not scannable | 1 | Icon/border on portraits (sword/shield) |
| Music / volume / menu audio UX | 1 | Volume slider; consistent mute |
| UI clutter / unreadable chrome | 1 | Reduce simultaneous text; scrollable panels |

---

## Log (newest first)

### 2026-07-16 — We Playtest Games (full video, ~31 min)

**Source:** YouTube · [Sector Lords Playtest](https://www.youtube.com/watch?v=Jt6DNOjHliQ) · channel **We Playtest Games** · r/weplaygames / u/weplaytestgames  
**Length:** ~30:59 (1859s)  
**Session depth:** Full 30-minute cold playtest (Kill ’Em All, normal, flat)  
**Tone:** Patient, confused early, slowly learns; ends “complicated but scratched the surface”  
**Transcript:** `docs/review-weplaytest/transcript.txt` (auto-captions; some ASR errors)

#### Positives (keep)
- Eventually understood **move / claim / attack** and that you need to get adjacent to rivals
- Liked **war table vs flat** (preferred flat; liked table look but wanted free 3D rotate)
- Found **jobs** as a cash path (late)
- Won some fights; said he was “starting to understand the basics”
- Stayed the full 30 minutes

#### Issues / friction (prioritized for review)

**P0 — Onboarding / cognitive load**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 1 | **Overwhelming for new players — too much text at once** | 02:54, 06:31, 21:28, 24:35 | KEY/glossary + coach + HUD; wants systems introduced *in play*, not a wall of reading |
| 2 | **Wants a real step-by-step tutorial** (one concept at a time) | 07:39, 24:41 | Coach exists but didn’t feel like a proper tutorial mode |
| 3 | **Confused how the game “basically works” for a long stretch** | 04:12–05:03 | After tutorial text still lost |
| 4 | **Only learning by sitting and reading** | 16:59 | Feels bad as primary teach method |

**P1 — Economy / jobs / goals**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 5 | **Unclear how to make cash** beyond guessing | 05:01, 25:09 | Hires delayed; later found jobs |
| 6 | **Jobs unclear** — what goals mean (“win attacks”, “hold 5 sectors”, influence site) | 11:06, 15:55, 16:51, 25:12 | Misread “hold sectors” as “stay on a sector 5 turns” |
| 7 | **Didn’t know jobs must be accepted** — thought list was optional checklist | 28:24 | Big UX miss |
| 8 | **Doesn’t know where cash comes from / why cash drops on End Turn** | 30:12, 30:19 | Upkeep not explained |
| 9 | **Support** — saw numbers, didn’t understand | 14:27 | Tooltip hard to read |

**P1 — Combat / crew readability**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 10 | **Can’t tell attacker vs defender crews** at a glance | 20:25–21:01, 22:53 | Suggests sword/shield corner icon or different border colors |
| 11 | **Combat odds / multi-attacker hard to parse** | 18:12–19:19 | “4.4?”; unclear three enemies on tile |
| 12 | **HP / who attacks best** requires constant reading map labels | 21:20, 22:53 | Wants more **visual** indicators, less text |
| 13 | **Idle-crew End Turn warning** misread (thought it killed them?) | 08:59, 23:40 | Scary/confusing copy |

**P1 — UI chrome / layout**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 14 | **Menu: too many buttons / better layout needed** | 00:20, 01:13 | Scenario/diff dual controls confusing at first |
| 15 | **Bottom bar / UI “blurred” / unreadable; can’t move it** | 14:30, 17:08 | Possibly status gradient or stacked chrome |
| 16 | **Can’t scroll some panel content** | 14:34 | Hire/info panel? |
| 17 | **KEY glossary is a lot to read mid-game** | 28:49 | Useful but late; still dense |
| 18 | **War table: can’t freely rotate/orbit 3D** | 29:40 | Likes look; wants mouse-orbit |

**P2 — Audio**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 19 | **Music didn’t start until he pressed Music** | 01:27 | Expected; autoplay policy — but confusing |
| 20 | **No volume slider** — only on/off | 01:39 | Wanted lower, not mute |
| 21 | **Music mute inconsistent** (menu vs in-game) | 13:26 | Off in one place, came back / different control |

**P2 — Systems he never fully got**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 22 | **Influence / Unrest** still “sound confusing” | 25:18 | Aligns with r/playmygame |
| 23 | **Research** poked (pipe wrench) without deep understanding | 07:16 | |
| 24 | **Raid / heat / cops** saw KEY text; limited use | 04:27 | |
| 25 | **Map mode / 3D** confusion mid-run | 07:04, 29:35 | |

**P3 — Nice-to-haves / misreads**
| # | Issue | ~Time | Notes |
|---|--------|-------|--------|
| 26 | Turn counter confusion (thought “how many times I played”) | 11:50 | Clarified himself |
| 27 | “No money to claim” misconception | 10:15 | Claims free; he was broke for hire |
| 28 | Ending: still feels he only scratched the surface | 30:42 | Expected for 30 min + dense game |

#### Suggested priority if we act on this video
1. **Tutorial mode** that gates systems (move → claim → hire → influence → end turn → attack)  
2. **Crew role icons** (combat vs defense lean) on portraits  
3. **Jobs:** clearer goal text + “Accept job” affordance  
4. **Cash/upkeep** one-liner on End Turn / status  
5. **Volume slider** + single music mute state  
6. Reduce simultaneous onboarding text (coach vs KEY)

#### Shipped (2026-07-16, v29) — Tier A/B from this review
- Field guide: KEY default closed; +jobs +cash steps; Influence vs Unrest one-liners  
- Jobs: **Accept · $** cards + clearer `jobs.json` copy  
- End Turn: income − upkeep status line; softer idle-crew warning  
- ATK/DEF/BAL role chips on board, hire, roster, dock  
- Music: **Off / Low / Med / High** cycle (menu + in-game)  
- Stronger mine rim + **YOU** tag on empty owned blocks  
- Combat odds show **ATK x vs DEF y**

#### Archived — Tier C (not soon)
Parked intentionally; do not pull into active sprint without a new decision:
- Full guided campaign tutorial mode (beyond field guide extension)
- Free 3D orbit on war table
- Auto-accept jobs
- Strip KEY entirely
- Major menu redesign

#### Quote (closing)
> “I found this game a bit complicated… I started to understand it the more I played. But there’s a lot of stuff I haven’t understood. Basically just scratched the surface.”

---

### 2026-07-14 — r/playmygame (first reply)

**Source:** Reddit · r/playmygame · cold traffic  
**Session depth:** “played it for a bit” (likely short)  
**Tone:** Honest first impression; not a deep systems review  

**Verbatim:**

> Hey i played it for a bit. My instant (honest) feedback:
>
> hard to tell whats going on, am i building buildings or just temporarily 'working' the area?
>
> hard to tell which areas i own, if any.
>
> turns happen too quick, i found myself wondering what was going on lol, maybe its just me...but the screen pinging around everywhere just confused me
>
> I think the idea is good, its just visually too confusing to understand (again from my POV)

**Parse (for later, not for immediate ship):**

| Quote | Likely meaning |
|-------|----------------|
| Building vs temporarily working | Influence (permanent racket) vs Unrest (one-shot) not labeled clearly enough |
| Which areas I own | Soft gold ownership rim easy to miss on dense neon board |
| Turns too quick / screen pinging | End Turn packs many events; camera/focus thrash (partially fixed already) |
| Idea good, visually confusing | Onboarding / glanceability, not “systems are wrong” |

**Action:** Stored only. Revisit when **2–3 more** independent players hit similar themes.

---

## Template for new entries

```markdown
### YYYY-MM-DD — Source (e.g. r/playmygame, friend, X)

**Source:**  
**Session depth:** glance / few turns / full game  
**Tone:**  

**Verbatim:**
> …

**Parse:**
- …

**Action:** park / backlog / ship
```
