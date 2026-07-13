# Sector Lords — Balance Notes (v0.6)

## Goals
- Territory + sites should beat pure unrest spam mid/late.
- Elite combat gangs are expensive (cash + upkeep).
- Early tech (shades, wrench) is reachable; late gear still matters.
- Police heat is a real third force from ~55+ warning, crackdown ~75.
- Landmarks are strong but not win-the-game alone.

## Economy
| Lever | Value | Intent |
|-------|-------|--------|
| Base sector income | 18 | Slightly lower than early prototypes |
| Unrest cash | scaled down + diminishing with sector unrest | Push-your-luck, not a printer |
| Landmarks | 8–32 cash, 0–3 support | Contested prizes |
| Police | warn 55 / crack 75 | Earlier than “80 only” |

## Combat
- Empty sector militia: 2.0 defense stub
- Stack power scales with HP; armor mitigates losses
- Signatures: ambush, surgical, encore, overwatch, iron nuns, salvage
- **Win chance** (same for player & AI): `0.10 + ratio^1.18 * 0.86`, plus soft bonuses at 2× / 3× power, clamp 5–95%
  - Even fights ~50%; big edges (e.g. 18 vs 5) high 80%s — still not guaranteed
  - Difficulty should come from AI economy/aggression, not a different dice formula
- UI: `formatOdds` labels strong/favorable/risky and reminds “can fail”

## AI
- Adaptive weights from human style
- Difficulty: cash mult + attack threshold + fog cheat (overlord)

## Open knobs
Tune in `economy.ts`, `combat.ts`, `gangs.json`, `items.json`, `map.ts` landmarks.
