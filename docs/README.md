# Starfall Docs

Design package for a graph-based space territory conquest game (TypeScript multiplayer vision).

## Index

| Doc | Purpose |
|---|---|
| [design/mechanics.md](./design/mechanics.md) | Normative v1 rules |
| [design/tech-tree.md](./design/tech-tree.md) | Empire tech tree (9 techs) |
| [design/rulings.md](./design/rulings.md) | Closed policy defaults (review) |
| [design/visuals.md](./design/visuals.md) | Map / HUD / graphics direction |
| [design/balance.md](./design/balance.md) | Provisional numbers |
| [design/balance.csv](./design/balance.csv) | Machine-readable balance seed |
| [design/domain.md](./design/domain.md) | TypeScript domain contracts |
| [adr/001-tick-engine.md](./adr/001-tick-engine.md) | OpenFront-style tick / intent / execution |
| [adr/002-multiplayer-architecture.md](./adr/002-multiplayer-architecture.md) | Lockstep turns + authoritative sim |
| [roadmap.md](./roadmap.md) | Phased path to FFA skeleton |

## Pinned v1 decisions (summary)

- **100ms ticks**, **100ms turns** (OpenFront `msPerTick` / `turnIntervalMs`); durations as `seconds * 10`
- Intent → Execution; orders revisable every turn
- Instant Lanchester combat on contact; proportional winner losses
- Empire **tech tree** (flat 3 tiers, 9 techs); Battleships via `heavy_warships`, not shipyard level
- No ship upkeep; no type counters; techs never change power-per-credit
- Capture keeps upgrades intact
- Garrison scales with level (+ tech bonuses); annexation needs population > garrison
- Lightweight alliances; score win at time limit
- Full-bleed graph map; systems are **circles** with role fill + small role symbol, owner ring, uncapped level number (see [visuals.md](./design/visuals.md))
- Policy rulings **accepted**: [rulings.md](./design/rulings.md)
