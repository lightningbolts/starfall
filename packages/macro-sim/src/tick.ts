import { runBotDecisions } from "./bots.js";
import { resolveContestedFronts } from "./combat.js";
import {
  applyEconomyTick,
  applyEmpireEconomyPulse,
  decayEmpireModifiers,
} from "./economy.js";
import { maybeSpawnRandomEvent } from "./events.js";
import { emit } from "./log.js";
import { createRng } from "./rng.js";
import { buildSnapshot } from "./snapshot.js";
import type {
  MacroConfig,
  MacroEvent,
  MacroSnapshot,
  MacroState,
} from "./types.js";

export interface StepResult {
  state: MacroState;
  snapshot: MacroSnapshot;
  newEvents: MacroEvent[];
}

export function stepLogic(state: MacroState, config: MacroConfig): StepResult {
  if (state.status !== "running") {
    return { state, snapshot: buildSnapshot(state), newEvents: [] };
  }

  state.tick += 1;
  const rng = createRng(state.seed ^ (state.tick * 0x9e3779b9));
  const newEvents: MacroEvent[] = [];

  const pulseEvery = Math.max(1, config.economyPulseTicks);
  if (state.tick % pulseEvery === 0) {
    for (const sid of state.systemOrder) {
      const system = state.systems[sid]!;
      const empire = system.ownerId ? state.empires[system.ownerId] : undefined;
      applyEconomyTick(system, empire, config, rng());
    }
    for (const eid of state.empireOrder) {
      applyEmpireEconomyPulse(state, state.empires[eid]!);
    }
  }
  for (const eid of state.empireOrder) {
    decayEmpireModifiers(state.empires[eid]!);
  }

  const botEvery = Math.max(1, config.botCadenceTicks);
  if (state.tick % botEvery === 0) {
    const diploEvery = Math.max(botEvery, config.diplomacyCadenceTicks);
    newEvents.push(
      ...runBotDecisions(state, config, rng, state.tick % diploEvery === 0),
    );
  }

  const combat = resolveContestedFronts(state, config);
  newEvents.push(...combat.events);

  newEvents.push(
    ...maybeSpawnRandomEvent(state, config.eventChancePerTick, rng),
  );

  const alive = state.empireOrder.filter((id) => state.empires[id]!.alive);
  if (alive.length <= 1) {
    state.status = "ended";
    if (alive.length === 1) {
      const winner = state.empires[alive[0]!]!;
      newEvents.push(
        emit(state, {
          tick: state.tick,
          kind: "match_won",
          empireIds: [winner.id],
          systemId: null,
          text: `${winner.name} stands alone across the galaxy.`,
        }),
      );
    }
  }

  state.events.push(...newEvents);
  if (state.events.length > 400) {
    state.events = state.events.slice(-300);
  }

  return { state, snapshot: buildSnapshot(state), newEvents };
}
