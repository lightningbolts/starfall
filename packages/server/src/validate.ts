import type { FleetComposition, Intent, ShipType, TechId } from "@starfall/sim";
import { SHIP_TYPES, TECH_IDS } from "@starfall/sim";

const SHIP_SET = new Set<string>(SHIP_TYPES);
const TECH_SET = new Set<string>(TECH_IDS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isShipType(v: unknown): v is ShipType {
  return isString(v) && SHIP_SET.has(v);
}

function isTechId(v: unknown): v is TechId {
  return isString(v) && TECH_SET.has(v);
}

function isComposition(v: unknown): boolean {
  if (v === undefined) return true;
  if (!isRecord(v)) return false;
  for (const [k, n] of Object.entries(v)) {
    if (!SHIP_SET.has(k)) return false;
    if (!isNumber(n) || n < 0 || !Number.isInteger(n)) return false;
  }
  return true;
}

/** Schema-validate a client intent; returns null if invalid. */
export function parseIntent(raw: unknown): Intent | null {
  if (!isRecord(raw) || !isString(raw.type)) return null;
  switch (raw.type) {
    case "BuildShips":
      if (!isString(raw.nodeId) || !isShipType(raw.shipType)) return null;
      if (!isNumber(raw.count) || raw.count < 1 || !Number.isInteger(raw.count))
        return null;
      return {
        type: "BuildShips",
        nodeId: raw.nodeId,
        shipType: raw.shipType,
        count: raw.count,
      };
    case "UpgradeNode":
      if (!isString(raw.nodeId)) return null;
      return { type: "UpgradeNode", nodeId: raw.nodeId };
    case "ResearchTech":
      if (!isTechId(raw.techId)) return null;
      return { type: "ResearchTech", techId: raw.techId };
    case "MoveFleet": {
      if (!isString(raw.fleetId) || !Array.isArray(raw.path)) return null;
      if (!raw.path.every(isString) || raw.path.length < 2) return null;
      if (!isComposition(raw.composition)) return null;
      if (raw.composition !== undefined) {
        return {
          type: "MoveFleet",
          fleetId: raw.fleetId,
          path: raw.path as string[],
          composition: raw.composition as FleetComposition,
        };
      }
      return {
        type: "MoveFleet",
        fleetId: raw.fleetId,
        path: raw.path as string[],
      };
    }
    case "CancelMove":
      if (!isString(raw.fleetId)) return null;
      return { type: "CancelMove", fleetId: raw.fleetId };
    case "CommitInvasion":
      if (
        !isString(raw.fleetId) ||
        !isString(raw.fromNodeId) ||
        !isNumber(raw.population) ||
        raw.population < 1 ||
        !Number.isInteger(raw.population)
      )
        return null;
      return {
        type: "CommitInvasion",
        fleetId: raw.fleetId,
        fromNodeId: raw.fromNodeId,
        population: raw.population,
      };
    case "CancelInvasion":
      if (!isString(raw.fleetId)) return null;
      return { type: "CancelInvasion", fleetId: raw.fleetId };
    case "ProposeAlliance":
      if (!isString(raw.toPlayerId)) return null;
      return { type: "ProposeAlliance", toPlayerId: raw.toPlayerId };
    case "AcceptAlliance":
      if (!isString(raw.fromPlayerId)) return null;
      return { type: "AcceptAlliance", fromPlayerId: raw.fromPlayerId };
    case "BreakAlliance":
      if (!isString(raw.withPlayerId)) return null;
      return { type: "BreakAlliance", withPlayerId: raw.withPlayerId };
    default:
      return null;
  }
}

export function parseClientMessage(raw: unknown):
  | { type: "Hello"; displayName: string; clientId?: string }
  | { type: "SetReady"; ready: boolean }
  | { type: "StartMatch"; botCount: number }
  | { type: "Intent"; sequence: number; intent: Intent }
  | null {
  if (!isRecord(raw) || !isString(raw.type)) return null;
  switch (raw.type) {
    case "Hello": {
      if (!isString(raw.displayName)) return null;
      const name = raw.displayName.trim().slice(0, 24);
      if (name.length < 1) return null;
      const out: { type: "Hello"; displayName: string; clientId?: string } = {
        type: "Hello",
        displayName: name,
      };
      if (raw.clientId !== undefined) {
        if (!isString(raw.clientId) || raw.clientId.length < 8) return null;
        out.clientId = raw.clientId;
      }
      return out;
    }
    case "SetReady":
      if (typeof raw.ready !== "boolean") return null;
      return { type: "SetReady", ready: raw.ready };
    case "StartMatch": {
      const raw2 = raw.botCount;
      if (raw2 !== undefined && (!isNumber(raw2) || !Number.isInteger(raw2))) {
        return null;
      }
      const botCount = Math.max(0, Math.min(99, (raw2 as number) ?? 0));
      return { type: "StartMatch", botCount };
    }
    case "Intent": {
      if (!isNumber(raw.sequence) || !Number.isInteger(raw.sequence)) return null;
      const intent = parseIntent(raw.intent);
      if (!intent) return null;
      return { type: "Intent", sequence: raw.sequence, intent };
    }
    default:
      return null;
  }
}
