# Starfall — Macro-scale Spectator Mode (Chronicle)

**Status:** v1 design lock  
**Audience:** `packages/macro-sim` and `apps/web` Chronicle implementers  
**Companions:** [visuals.md](./visuals.md) (shared universe look), [ADR 003](../adr/003-macro-tick-split.md)

A separate mode from the competitive real-time game — same universe theme, different engine. The viewer does not act; they watch AI empires expand, ally, betray, and collapse across a galaxy of aggregated regions, with a toggleable dashboard for following the story.

## 1. Scale and entity model

- **Simulated unit: regions, not systems.** A galaxy is partitioned into hundreds to thousands of aggregated regions. Each region holds: owner, population, credits, garrison strength, and (if on a frontier) a contested-% value.
- **Individual systems are flavor only.** Not tracked in game state. When a viewer zooms into a region, system names and points are generated on demand from seed — same procedural approach as empire names.
- **AI empire count stays modest** — roughly 20–150 empires regardless of galaxy size. System/region scaling does not scale agent count linearly beyond the clamp below.

### Playtest defaults

| Parameter | Value |
|---|---|
| Logic tick interval | **100ms** at 1× (same cadence as competitive; pause / 2× / 4× allowed) |
| Economy pulse | every **10** logic ticks (~1s) |
| Bot cadence | every **5** logic ticks |
| Production variance | **±10%** per economy pulse |
| Regions (small / medium / large) | **400 / 1000 / 2500** |
| Empire count | `clamp(round(regions / 25), 20, 150)` |
| Starting territory | **capital region only**; wilderness is unowned until empires expand |
| Render interpolation | ease-in-out cubic between last and next snapshots |

## 2. Bot archetypes

| Archetype | Bias |
|---|---|
| Aggressive expansionist | High risk, low loyalty, attacks when favorable |
| Cautious turtle | Over-invests in garrison, rarely attacks first |
| Opportunistic backstabber | Allies readily, breaks when ally is overextended |
| Loyal builder | Sticks with allies, prioritizes joint defense |
| Wildcard | Randomized trait weights per game |

Traits: `aggression`, `loyalty`, `risk`, `greed` ∈ [0, 1]. Decision points: expand, reinforce, propose/break alliance, pressure a border fight.

## 3. Tick model

See [ADR 003](../adr/003-macro-tick-split.md). Logic ticks run at **100ms** (competitive cadence); the client still interpolates every frame so borders and counters ease between snapshots.

## 4. Randomization

- **Production variance:** each region's per-tick output × uniform multiplier in [0.9, 1.1].
- **Random events:** weighted occurrences (production surge, rebellion, relic discovery, pirate raid, natural disaster). Temporary or one-shot modifiers; every event emits a ticker line.

## 5. Combat and borders

Border regions compare aggregate garrison and shift a `contested.pct` front over time. Decisive shifts (front collapses, capital falls) are promoted to the event feed.

## 6. Dashboard

Toggleable panels: empire roster (sortable), event feed, map overlays (diplomacy, contested fronts, focus frontiers), per-empire trend graphs, filters (focus one empire, pin top N).

## 7. Empire naming

Procedural word-bank: species syllables + adjectives + government nouns (Imperium, Hegemony, Concord, Dominion, Collective, Republic). No live API.

## 8. Hosting

Client-only for v1 — sim runs in the browser. Competitive WebSocket path is unused.
