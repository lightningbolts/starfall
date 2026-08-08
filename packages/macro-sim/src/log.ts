import type { MacroEvent, MacroState } from "./types.js";

/** Stamp an event with the next monotonic sequence id. */
export function emit(
  state: MacroState,
  event: Omit<MacroEvent, "seq">,
): MacroEvent {
  state.eventSeq += 1;
  return { seq: state.eventSeq, ...event };
}
