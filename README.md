# Starfall

Space territory conquest on a **graph** (systems = nodes, lanes = edges). Easy to learn, high skill ceiling, 15–30 minute rounds, targeting 50–100 player FFA.

**Current status:** Phase 3–4 — FFA skeleton + tune hooks (`packages/server` + `apps/web` + telemetry).

## Quick start

```bash
# requires Node >= 20; uses pnpm via npm exec if not installed globally
npm exec --yes pnpm@9.15.0 install
npm exec --yes pnpm@9.15.0 test
```

### Local multiplayer

One command (server + 7 bots + web):

```bash
npm exec --yes pnpm@9.15.0 run dev
```

Or two terminals:

```bash
# Terminal 1 — game server with bots (must stay running)
npm exec --yes pnpm@9.15.0 run server -- --seed 42 --players 8 --bots 7

# Terminal 2 — Vite (proxies /ws → :8787)
npm exec --yes pnpm@9.15.0 run web
```

Open http://localhost:5173, Join, Ready — match starts against the bots (last player standing).

Open two browser tabs to `http://localhost:5173`, join with different names, Ready both (or host Start).

Win condition defaults to **last player standing** (no clock). Pass `--ticks N` only if you want a timed score-based finish.

Client `clientId` is persisted in `localStorage` for reconnect. Diplomacy: propose from the ranks list or selected enemy node; accept/break in the Diplomacy panel.

LAN: build the client (`pnpm --filter @starfall/web build`) then serve it from the server:

```bash
npm exec --yes pnpm@9.15.0 run server -- --static apps/web/dist --port 8787
```

Metrics while a match runs: `http://localhost:8787/metrics`

### Load smoke (Phase 3)

```bash
npm exec --yes pnpm@9.15.0 load
```

### Headless bot FFA (Phase 1)

```bash
npm exec --yes pnpm@9.15.0 run sim:ffa -- --seed 42 --players 8 --ticks 12000
```

Prints a telemetry summary at the end (combat sizes, annex rates, snowball ratio).

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

- TypeScript monorepo (pnpm): `packages/sim` (pure Intent/Execution tick engine), `packages/server` (WebSocket host), `apps/web` (Canvas map), `apps/cli` (bot FFA)
- OpenFront-style loop: **100ms** turns/ticks, `executeNextTick`
- Authoritative server sim + fogged `PlayerView` deltas (ADR 002)

See [docs/adr/001-tick-engine.md](./docs/adr/001-tick-engine.md) and [docs/adr/002-multiplayer-architecture.md](./docs/adr/002-multiplayer-architecture.md).
