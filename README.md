# Starfall

Space territory conquest on a **graph** (systems = nodes, lanes = edges). Easy to learn, high skill ceiling, 15–30 minute rounds, targeting 50–100 player FFA.

**Current status:** Phase 2 — local multiplayer (`packages/server` + `apps/web` on top of `packages/sim`).

## Quick start

```bash
# requires Node >= 20; uses pnpm via npm exec if not installed globally
npm exec --yes pnpm@9.15.0 install
npm exec --yes pnpm@9.15.0 test
```

### Local multiplayer (Phase 2)

Terminal 1 — authoritative match host:

```bash
npm exec --yes pnpm@9.15.0 server -- --seed 42 --ticks 3600
```

Terminal 2 — web client (proxies `/ws` to the server):

```bash
npm exec --yes pnpm@9.15.0 web
```

Open two browser tabs to `http://localhost:5173`, join with different names, Ready both (or host Start). Short rounds default to **3600 ticks** (~6 min); pass `--ticks 12000` for a full 20-minute round.

LAN: build the client (`pnpm --filter @starfall/web build`) then serve it from the server:

```bash
npm exec --yes pnpm@9.15.0 server -- --static apps/web/dist --port 8787
```

### Headless bot FFA (Phase 1)

```bash
npm exec --yes pnpm@9.15.0 sim:ffa -- --seed 42 --players 8 --ticks 12000
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

- TypeScript monorepo (pnpm): `packages/sim` (pure Intent/Execution tick engine), `packages/server` (WebSocket host), `apps/web` (Canvas map), `apps/cli` (bot FFA)
- OpenFront-style loop: **100ms** turns/ticks, `executeNextTick`
- Authoritative server sim + fogged `PlayerView` (ADR 002)

See [docs/adr/001-tick-engine.md](./docs/adr/001-tick-engine.md) and [docs/adr/002-multiplayer-architecture.md](./docs/adr/002-multiplayer-architecture.md).
