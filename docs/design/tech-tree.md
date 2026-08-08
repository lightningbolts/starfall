# Starfall — Tech Tree (Normative)

**Status:** v1 design lock  
**Companion:** [mechanics.md](./mechanics.md), [balance.md](./balance.md), [domain.md](./domain.md)

Polytopia-style empire progression on the node-graph design. Real-time: techs unlock the moment they are paid for (instant `ResearchExecution` on the purchase turn).

---

## Design constraints

| Constraint | Rule |
|---|---|
| Scope | **Empire-wide**, not per-node. One global research set per player, funded by credits. |
| Structure | **Flat tiers.** Three tiers; each tech only requires *any one* tech from the tier below (not a specific path). |
| Size | **9 techs.** Whole tree visible at a glance; one-line effects. |
| Purchase | **One-time, permanent.** No tech levels — node upgrades own local scaling. |
| Combat | No tech changes power-per-credit or adds type counters. Flat global bonuses / unlocks only. |

**Separation of systems**

- **Node upgrades** = local production / garrison / vision on that node.
- **Tech tree** = empire-wide capability and global multipliers.

---

## Cost curve

```
cost(tier) = 60 × 2.25^(tier − 1)
```

| Tier | Cost (credits) |
|---|---|
| 1 | **60** |
| 2 | **135** |
| 3 | **304** |

Steeper than node-upgrade growth (1.5): these are permanent empire unlocks.

Purchase spends credits immediately; failed purchase (insufficient credits / missing prereq / already owned) → `NoOpExecution`.

---

## Prerequisites

- **Tier 1:** none.
- **Tier 2:** owns **any** Tier 1 tech.
- **Tier 3:** owns **any** Tier 2 tech.

Techs within a tier have no ordering among themselves.

---

## Tier 1 — early game

| Tech ID | Name | Effect |
|---|---|---|
| `advanced_propulsion` | Advanced propulsion | −20% war-fleet ticks-per-hop (floor 1). Does **not** affect cargo ships. |
| `fortified_colonies` | Fortified colonies | +25% garrison on all owned nodes |
| `survey_drones` | Survey drones | +1 vision hop from owned nodes |

Affordable within the first few minutes (start credits 80; first resource pulse helps).

---

## Tier 2 — mid game

| Tech ID | Name | Effect |
|---|---|---|
| `heavy_warships` | Heavy warship development | **Unlocks Battleships** at owned shipyards (any shipyard level) |
| `lane_logistics` | Lane logistics | −25% cargo ship ticks-per-hop (faster credit delivery) |
| `population_efficiency` | Population efficiency | +25% population pulse on owned core worlds |

### Battleship unlock (single source of truth)

Battleships are **not** gated by shipyard upgrade level. Building a Battleship requires:

1. `heavy_warships` researched, and  
2. An owned **shipyard** node (any level) with build slot / queue space.

Fighters and Cruisers need only a shipyard (no tech).

---

## Tier 3 — late game

| Tech ID | Name | Effect |
|---|---|---|
| `orbital_shielding` | Orbital shielding | +15 flat garrison on all owned nodes (stacks with Fortified colonies and homeworld/role bonuses) |
| `rapid_deployment` | Rapid deployment | −25% ship build ticks at all owned shipyards (floor 1) |
| `relic_scanning` | Relic scanning | Reveals all **relic** nodes on the map (role + ownership visible; fog cleared for those nodes) |

---

## Lanes and cargo (Lane logistics)

**No lane capacity caps.** Fleets and cargo ships may stack freely on an edge; UI shows all markers.

**Cargo:** resource and relic pulses fill a node stockpile; at threshold, an automatic cargo ship runs to the owner’s **cargo sink** (homeworld if owned, else oldest owned node — [rulings.md](./rulings.md) §6b) and banks credits on arrival. Raiders who clear friendlies at the cargo’s location loot the credits.

`lane_logistics` only speeds **your** cargo ships (−25% ticks-per-hop). `advanced_propulsion` affects war fleets only, not cargo.

---

## Relic nodes (supports Relic scanning)

Map role `relic`: sparse (~3–8 on a ~250-node map). High credit pulse and/or score when held. Not player-buildable. Not adjacent to homeworlds at spawn. Fogged like distant nodes until adjacent vision **or** `relic_scanning`.

---

## Explicit non-goals

- Per-node research
- Tech prerequisite chains deeper than “any of previous tier”
- Tech upgrades / repeat purchases
- New ship types or combat matchup techs
- Shared alliance tech pools
- Player-built role conversion

---

## Open for playtesting

- Exact bonus percentages
- Cargo launch threshold, loot fraction, cargo speed
- Relic economic vs score weighting
