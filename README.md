# Starfall

Space territory conquest on a **graph** (systems = nodes, lanes = edges). Easy to learn, high skill ceiling, 15–30 minute rounds, targeting 50–100 player FFA.

**Current status:** Phase 1 — headless sim + bots (`packages/sim`, `apps/cli`). Design docs under [`docs/`](./docs/).

## Quick start

```bash
# requires Node >= 20; uses pnpm via npm exec if not installed globally
npm exec --yes pnpm@9.15.0 install
npm exec --yes pnpm@9.15.0 test
npm exec --yes pnpm@9.15.0 sim:ffa -- --seed 42 --players 8 --ticks 12000
```

Shorter smoke FFA (2 simulated minutes):

```bash
npm exec --yes pnpm@9.15.0 sim:ffa -- --seed 42 --players 8 --ticks 1200
```

## Design goals

- Expansion/attacks only along adjacent lanes — chokepoints matter
- Two currencies with one job each: **credits** (ships/upgrades), **population** (invasions)
- No ship-type rock-paper-scissors — skill from concentration of force (Lanchester)
- Captured nodes keep upgrades — defense is the owner’s job

## Read next

1. [docs/design/mechanics.md](./docs/design/mechanics.md) — rules
2. [docs/design/visuals.md](./docs/design/visuals.md) — map / graphics
3. [docs/design/balance.md](./docs/design/balance.md) — seed numbers
4. [docs/roadmap.md](./docs/roadmap.md) — path to TypeScript sim → multiplayer

## Stack

- TypeScript monorepo (pnpm): `packages/sim` (pure Intent/Execution tick engine), `apps/cli` (bot FFA)
- OpenFront-style loop: **100ms** turns/ticks, `executeNextTick`
- Next: `packages/server` + `apps/web` (Phase 2)

See [docs/adr/001-tick-engine.md](./docs/adr/001-tick-engine.md) and [docs/adr/002-multiplayer-architecture.md](./docs/adr/002-multiplayer-architecture.md).
