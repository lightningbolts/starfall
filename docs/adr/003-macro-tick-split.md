# ADR 003 — Macro Chronicle Logic / Render Tick Split

## Status

Accepted

## Context

The competitive game (ADR 001) uses a unified **100ms** Intent → Execution tick. The macro spectator mode still wants that near-real-time cadence so expansion and fronts feel alive, but painting only discrete sim updates would look steppy. Bot work is cheaper than the competitive Intent loop (region aggregates, modest empire count), so matching **100ms** logic ticks is acceptable.

Viewers need the galaxy to *feel* continuous: territory easing, counters flowing, graphs animating.

## Decision

Split time into two clocks:

| Clock | Cadence | Responsibility |
|---|---|---|
| **Logic tick** | Default **100ms** at 1× (same as competitive; pause / 2× / 4× multipliers allowed) | Bot decisions (cadenced), economy pulses, contested front shifts, random events, alliances |
| **Render tick** | Every animation frame | Interpolate between last and newly computed `MacroSnapshot` (ease-in-out cubic) |

Economy applies every **10** logic ticks (~1s). Bots decide every **5** logic ticks so decisions stay readable without starving expansion. The expensive full-empire pass therefore still runs well below frame rate; interpolation keeps the UI smooth between logic snapshots.

### Starting map

Empires begin with a **single capital region**. All other regions are unowned wilderness and are claimed over time as bots expand — not pre-flood-filled at match start.

### Why not reuse ADR 001

- No human intents, no lockstep multiplayer, no fogged deltas.
- Region aggregates replace per-system fleets and multi-tick executions.
- A separate package (`@starfall/macro-sim`) keeps the Intent/Execution engine unpolluted.

### Client loop (sketch)

```
every logic interval (100ms): prev = next; next = stepLogic(state); t0 = now
every rAF: u = ease((now - t0) / logicMs); view = lerpSnapshot(prev, next, u)
```

## Consequences

- Sim must expose immutable snapshots suitable for interpolation (numeric fields, contested %, ownership for color blend).
- Determinism is seed-based on the logic clock only; wall-clock render timing does not affect sim outcomes.
- Per-tick rates (events, contested drift, modifier durations) are tuned for 100ms ticks, not multi-second ticks.
- Server hosting / spectator CDN remain out of scope for v1 (client-only).
