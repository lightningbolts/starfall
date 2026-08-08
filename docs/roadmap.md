# Starfall Roadmap

Design-first path toward a TypeScript multiplayer FFA skeleton.

## Phase 0 — Design

- [x] Normative mechanics lock
- [x] Balance seed tables
- [x] Domain TypeScript contracts
- [x] Tick engine ADR
- [x] Multiplayer architecture ADR
- [x] Tech tree lock (empire research; Battleship unlock)
- [x] Visual design lock
- [x] Policy rulings **accepted** (spawn, vision, invasion, lanes, cargo sink, multi-side combat, tooling)

**Exit:** implementers can build `packages/sim` without reopening combat, annexation, currencies, tech unlocks, or tick order. Rulings checklist in [rulings.md](./design/rulings.md) is checked.

## Phase 1 — Headless sim + bots

- [x] Scaffold monorepo (`packages/sim`)
- [x] Implement OpenFront-style `Executor` / `Execution` / `executeNextTick` (100ms ticks)
- [x] Lanchester combat, annexation, upgrades, multi-tick movement executions
- [x] Golden tests from [balance.md](./design/balance.md) + recorded `Turn[]` replays
- [x] Procedural galaxy generator honoring [mechanics.md](./design/mechanics.md) constraints
- [x] CLI scenarios + simple bot policies (expand, garrison chokepoints, mass attacks)

**Exit:** 20-minute simulated FFA with bots completes and produces a scoreboard.

## Phase 2 — Local multiplayer

- [x] `packages/server` WebSocket match host
- [x] Vision filter + command validation
- [x] Minimal `apps/web` graph map (nodes/edges, fleets, orders)

**Exit:** 4–8 humans can finish a short round on a LAN/localhost.

## Phase 3 — FFA skeleton

- [x] Lobby for 50–100 seats
- [x] Alliances (propose/accept/break, shared vision)
- [x] Score-at-time-limit + elimination bonus
- [x] Snapshot deltas / command rate limits

**Exit:** large match runs without sim desync; clients only see fogged state.

## Phase 4 — Tune

- [x] Telemetry on combat sizes, capture rates, snowball
- [x] Iterate balance.csv / balance tables (hooks + elimination bonus; numbers remain playtest)
- [x] UX for undefended high-value nodes (design requirement)

---

Phase 1 exit met: `pnpm sim:ffa -- --seed 42 --players 8 --ticks 12000` prints a scoreboard.  
Phase 2 exit: `pnpm server` + `pnpm web` — two browsers can join, play, and finish a short round.  
Phase 3 exit: `pnpm load` (50 seats) + fogged deltas; capacity default 100.  
Phase 4: `GET /metrics`, CLI telemetry summary, undefended L≥3 owner pulse.
