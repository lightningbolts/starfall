# Starfall — Macro-scale Spectator Mode (Chronicle)

**Status:** v1 design lock  
**Audience:** `packages/macro-sim` and `apps/web` Chronicle implementers  
**Companions:** [visuals.md](./visuals.md) (shared palette + Chronicle map look), [ADR 003](../adr/003-macro-tick-split.md)

A separate mode from the competitive real-time game — same universe theme, different engine. The viewer does not act; they watch AI empires expand, ally, betray, and collapse across a galaxy of individual star systems linked by planar hyperlanes, with a toggleable dashboard for following the story.

## 1. Scale and entity model

- **Simulated unit: star systems.** Each system holds: owner, population, credits, garrison strength, persistent name, star class, hyperlane links, and (if on a frontier) a contested-% value.
- **Territory cells are render-only.** Voronoi cells around each star rasterize into a soft empire coverage field (blobby fills + glowing rims). Cell edges are never stroked.
- **Hyperlanes** form a planar, connected graph (k-nearest candidates, short-first acceptance with degree caps, MST connectivity, a few loop-forming extras). Combat and colonization only travel along these links.
- **AI empire count stays modest** — roughly a dozen to a few dozen empires so each grows a readable blob of territory.

### Playtest defaults

| Parameter | Value |
|---|---|
| Logic tick interval | **100ms** at 1× (same cadence as competitive; pause / 2× / 4× allowed) |
| Economy pulse | every **10** logic ticks (~1s) |
| Bot cadence | every **5** logic ticks |
| Production variance | **±10%** per economy pulse |
| Systems (small / medium / large) | **600 / 1200 / 2400** |
| Empire count | `clamp(round(systems / 50), 12, 48)` |
| Starting territory | **capital system only**; wilderness is unowned until empires expand |
| Colonization | credit cost from adjacent owned systems; cost scales with owned count so expansion decelerates |
| Render interpolation | ease-in-out cubic between last and next snapshots |

## 2. Bot archetypes

| Archetype | Bias |
|---|---|
| Aggressive expansionist | High risk, low loyalty, attacks when favorable |
| Cautious turtle | Over-invests in garrison, rarely attacks first |
| Opportunistic backstabber | Allies readily, breaks when ally is overextended |
| Loyal builder | Sticks with allies, prioritizes joint defense |
| Wildcard | Randomized trait weights per game |

Traits: `aggression`, `loyalty`, `risk`, `greed` ∈ [0, 1]. Decision points: expand (multi-claim when rich), reinforce, propose/break alliance, pressure a border fight.

## 3. Tick model

See [ADR 003](../adr/003-macro-tick-split.md). Logic ticks run at **100ms** (competitive cadence); the client still interpolates every frame so borders and counters ease between snapshots.

## 4. Randomization

- **Production variance:** each system's per-tick output × uniform multiplier in [0.9, 1.1].
- **Random events:** weighted occurrences (production surge, rebellion, relic discovery, pirate raid, natural disaster). Temporary or one-shot modifiers; every event emits a ticker line with a monotonic sequence id.

## 5. Combat and borders

Adjacent hostile systems compare aggregate garrison and shift a `contested.pct` front over time along the real shared border segment. Decisive shifts (front collapses, capital falls) are promoted to the event feed.

## 6. Map presentation

- Seeded nebula + parallax starfield background.
- Empire territory as a coverage-field composite (no visible tile edges).
- Hyperlanes, contested fronts on true border edges, instanced star sprites, capital rings, bezier diplomacy arcs.
- DOM labels for empire and system names with zoom-based fading; zoom-to-cursor camera.

## 7. Dashboard

Toggleable panels: empire roster (sortable, persistent rows), event feed (sequence-deduped), map overlays (diplomacy, contested fronts, frontiers, lanes, labels), multi-series trend graphs, filters (focus one empire, pin top N). Seed shown in the top bar; keyboard: space pause, 1/2/4 speed, F fit, Esc clear focus.

## 8. Empire naming

Procedural word-bank: species syllables + adjectives + government nouns (Imperium, Hegemony, Concord, Dominion, Collective, Republic). System names from the same seeded generator. No live API.

## 9. Hosting

Client-only for v1 — sim runs in the browser. Competitive WebSocket path is unused.
