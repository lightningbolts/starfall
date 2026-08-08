# Starfall — Balance Seed Numbers

**Status:** provisional — for spreadsheet sims and first headless tests  
**Normative rules:** [mechanics.md](./mechanics.md)  
**Machine-readable:** [balance.csv](./balance.csv)  
**Clock:** [adr/001-tick-engine.md](../adr/001-tick-engine.md)

All values are **starting guesses**. Power-per-credit is near-constant across ship tiers; differentiation is speed, build time, and stack divisibility.

**Time convention (OpenFront):** `msPerTick = 100`, so **1 second = 10 ticks**. Durations below are in ticks unless noted.

---

## Match pacing

| Parameter | Seed | Notes |
|---|---|---|
| ms per tick | 100 | OpenFront `msPerTick()` |
| Turn interval | 100 ms | OpenFront `turnIntervalMs()` |
| Round duration | 20 minutes default | Band 15–30 |
| Round ticks | 12_000 | `20 * 60 * 10` |
| Target players | 100 | Band 50–100 |
| Target nodes | 250 | Band 150–300 |

---

## Upgrade formula

```
cost(n) = base_cost × 1.22^min(n−2, growthLevels−1)   // n = target level ≥ 2
growthLevels = 5   // exponential through L5→L6, then flat forever
```

Level 1 = newly owned / unupgraded. No max level — costs plateau after the soft cap.

### Per-level outputs (linear)

Outputs use `base + round(base × factor × (level − 1))`. Factors are the per-level fraction of base (e.g. 0.2 → +20% of base each level).

Shipyard concurrent build slots = `level` (L1=1, L5=5). Homeworld has 1 fighter-only slot.

---

## Ships

Wall-clock travel/build kept close to the old 2s-tick feel (1 hop per ~2s for fighters).

| Ship | Credit cost | Power | Power/credit | Build ticks | Ticks per hop | Unlock | Hop wall-clock |
|---|---|---|---|---|---|---|---|
| Fighter | 10 | 12 | 1.2 | 20 | 20 | Shipyard | 2.0 s |
| Cruiser | 40 | 40 | 1.0 | 60 | 40 | Shipyard | 4.0 s |
| Battleship | 120 | 90 | 0.75 | 160 | 80 | Shipyard + `heavy_warships` tech | 8.0 s |

Soft RPS (composition-weighted, 0.85× penalty): fighters weak vs cruisers, cruisers vs battleships, battleships vs fighters.

Mixed fleets move at the **slowest** ship’s speed unless an explicit split `composition` is provided on the move intent ([rulings.md](./rulings.md) §7).

---

## Tech tree

See [tech-tree.md](./tech-tree.md). Costs: `60 × 2.25^(tier−1)`.

| Tech ID | Tier | Cost | Seed effect |
|---|---|---|---|
| `advanced_propulsion` | 1 | 60 | −20% war-fleet ticks-per-hop (floor 1); **not cargo** |
| `fortified_colonies` | 1 | 60 | +25% garrison all owned nodes |
| `survey_drones` | 1 | 60 | +1 vision hop from owned nodes |
| `heavy_warships` | 2 | 135 | Unlock Battleship builds |
| `lane_logistics` | 2 | 135 | −25% **cargo** ticks-per-hop |
| `population_efficiency` | 2 | 135 | +25% core-world pop pulse |
| `orbital_shielding` | 3 | 304 | +15 flat garrison all owned nodes |
| `rapid_deployment` | 3 | 304 | −25% ship build ticks (floor 1) |
| `relic_scanning` | 3 | 304 | Reveal all relic nodes |

| Parameter | Seed |
|---|---|
| Launch threshold | 4 credits stockpiled |
| Cargo ticks-per-hop | 40 (same as Cruiser; logistics → 30) |
| Loot fraction when interdicted | 100% to attacker |
| Resource pulse → stockpile (not bank) | 4 / 10 ticks at L1 |
| Relic pulse → stockpile | 10 / 10 ticks at L1 |

Direct-to-bank pulses: homeworld / core / shipyard only (small trickle).

---

## Economy

Income uses a **1-second pulse** (every 10 ticks) so rates stay integer and readable.

| Role | Credits / 10 ticks | Destination | Population / 10 ticks | Pop cap (L1) | Ship build slots | Notes |
|---|---|---|---|---|---|---|
| Homeworld | 2 | Bank (direct) | 1 | 40 | 0.5 equiv. | Fighters only at 2× build ticks; cap must beat L1 shipyard garrison |
| Core world | 2 | Bank (direct) | 3 | 40 | 0 | Primary pop |
| Resource node | 4 | **Cargo stockpile** | 0 | 0 | 0 | Primary wealth via cargo ships |
| Shipyard | 2 | Bank (direct) | 0 | 0 | level | Concurrent slots = level; speed + trickle scale linearly |
| Relay | 0 | — | 0 | 0 | 0 | Vision |
| Relic | 10 | **Cargo stockpile** | 0 | 0 | 0 | Wildcard cargo + score |

These match the prior 2s-tick design’s *per-second* economy (resource was 8 / 2s → 4 / s).

### Per-level multipliers (linear)

Outputs use `base + round(base × factor × (level − 1))`. Factors are the per-level fraction of base (e.g. 0.2 → +20% of base each level). Garrison uses flat `garrisonBase + (level−1)×garrisonPerLevel`.

| Role | What scales | Factor |
|---|---|---|
| Homeworld | Credits, pop pulse, pop cap | 0.20 / 0.15 / 0.12 |
| Core world | Credits, pop pulse, pop cap | 0.12 / 0.22 / 0.18 |
| Resource node | Cargo pulse | 0.25 |
| Shipyard | Build speed, credit trickle, **slots = level** | 0.20 / 0.12 |
| Relay | Vision (+1 hop at L2, then every 2 lvls) | vision steps |
| Relic | Cargo pulse | 0.22 |

### Upgrade base costs (credits for level 2; ×1.22 through L5→L6, then flat)

| Role | base_cost (→ L2) |
|---|---|
| Homeworld | 25 |
| Core world | 20 |
| Resource node | 20 |
| Shipyard | 30 |
| Relay | 15 |
| Relic | 40 |

---

## Garrison (annexation only)

| Role | Base garrison (L1) | Per level above 1 |
|---|---|---|
| Homeworld | 40 | +8 (+ soft ×1.1^L on base) |
| Core world | 20 | +5 (+ soft ×1.08^L on base) |
| Resource node | 15 | +4 |
| Shipyard | 25 | +6 |
| Relay | 10 | +3 |
| Relic | 30 | +8 |

Then apply techs: Fortified colonies (+25% after role/level), Orbital shielding (+15 flat).

Committed population must be **strictly greater** than garrison.

---

## Vision

| Parameter | Seed |
|---|---|
| Base vision from owned nodes | 1 hop |
| Survey drones bonus | +1 hop |
| See transit fleets on lanes touching visible nodes | yes |

Policy: [rulings.md](./rulings.md) §2.

---

## Starting kit (per player)

| Asset | Seed |
|---|---|
| Homeworld | 1 (level 1); may build Fighters at half speed |
| Credits | 80 |
| Population (at homeworld) | 25 |
| Starting fleet | 5 Fighters at homeworld |
| Researched techs | none |

---

## Score weights (end of round)

| Factor | Points |
|---|---|
| Owned node | 10 |
| Owned relic node | +15 extra (25 total for that node) |
| Per upgrade level above 1 (sum over nodes) | 3 |
| Per 10 credits in bank | 1 |
| Per 10 population owned | 1 |
| Per 100 fleet power | 2 |
| Per researched tech | 5 |
| Elimination bonus (to capturer on knock-out) | 50 |

Elimination of all rivals: instant win (last player standing — default for multiplayer).  
Optional timed finish: only when `roundTicks > 0` (pass `--ticks N` to the server); then highest score wins.

When iterating numbers: run a match, read `GET /metrics` (or CLI FFA telemetry summary), then adjust `docs/design/balance.csv` and mirror in `packages/sim/src/balance.ts`.

---

## Combat loss conversion (reminder)

Winner remaining power: `sqrt(Pw² − Pl²)`.  
Surviving ships: reduce each type proportionally to pre-fight power share (floor).

Worked example (unit-test candidate):

- Attacker: 10 Fighters (100) + 1 Cruiser (40) = 140  
- Defender: 3 Cruisers = 120  
- Remaining ≈ `sqrt(140² − 120²) ≈ 72.1` → floor proportional survivors

---

## Diplomacy

Alliances: free propose/accept; betrayal immediate; shared vision while allied.
