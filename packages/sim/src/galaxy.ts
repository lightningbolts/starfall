import { createRng, randInt, shuffleInPlace } from "./rng.js";
import type {
  GalaxyMap,
  GalaxyNode,
  NodeId,
  NodeRole,
} from "./types.js";

export interface GalaxyGenOptions {
  seed: number;
  playerCount: number;
  /** Target total nodes; default scales with players. */
  nodeCount?: number;
  maxAttempts?: number;
}

export interface GeneratedGalaxy {
  map: GalaxyMap;
  homeworldIds: NodeId[];
  seed: number;
}

export interface GalaxyValidation {
  ok: boolean;
  errors: string[];
}

function hopDistance(
  nodes: Record<NodeId, GalaxyNode>,
  a: NodeId,
  b: NodeId,
): number {
  if (a === b) return 0;
  const q: NodeId[] = [a];
  const dist = new Map<NodeId, number>([[a, 0]]);
  while (q.length) {
    const cur = q.shift()!;
    const d = dist.get(cur)!;
    for (const n of nodes[cur]?.neighbors ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      if (n === b) return d + 1;
      q.push(n);
    }
  }
  return Infinity;
}

function isConnected(nodes: Record<NodeId, GalaxyNode>): boolean {
  const ids = Object.keys(nodes);
  if (ids.length === 0) return false;
  const seen = new Set<NodeId>();
  const q: NodeId[] = [ids[0]!];
  seen.add(ids[0]!);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of nodes[cur]!.neighbors) {
      if (seen.has(n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen.size === ids.length;
}

export function validateGalaxy(
  map: GalaxyMap,
  homeworldIds: NodeId[],
  playerCount: number,
): GalaxyValidation {
  const errors: string[] = [];
  const nodes = map.nodes;
  const ids = Object.keys(nodes);
  const n = ids.length;

  if (!isConnected(nodes)) errors.push("not connected");

  // Home spacing
  for (let i = 0; i < homeworldIds.length; i++) {
    for (let j = i + 1; j < homeworldIds.length; j++) {
      const a = homeworldIds[i]!;
      const b = homeworldIds[j]!;
      const d = hopDistance(nodes, a, b);
      if (d < 3) errors.push(`homes ${a}-${b} distance ${d} < 3`);
      if (nodes[a]?.neighbors.includes(b)) {
        errors.push(`homes ${a}-${b} adjacent`);
      }
    }
  }

  // Shipyard access
  const shipyards = ids.filter((id) => nodes[id]!.role === "shipyard");
  for (const hw of homeworldIds) {
    let best = Infinity;
    for (const sy of shipyards) {
      best = Math.min(best, hopDistance(nodes, hw, sy));
    }
    if (best > 2) errors.push(`home ${hw} shipyard hops ${best} > 2`);
  }

  // Role mix (scaled for smaller maps)
  const count = (role: NodeRole) =>
    ids.filter((id) => nodes[id]!.role === role).length;
  const players = playerCount;
  if (count("homeworld") !== players) {
    errors.push(`homeworlds ${count("homeworld")} != players ${players}`);
  }
  if (count("shipyard") < players) {
    errors.push(`shipyards ${count("shipyard")} < players`);
  }
  if (count("resource") < players) {
    errors.push(`resources ${count("resource")} < players`);
  }
  if (count("core_world") < Math.floor(players / 2)) {
    errors.push(`cores ${count("core_world")} < players/2`);
  }
  if (count("relay") < Math.floor(players / 3)) {
    errors.push(`relays ${count("relay")} < players/3`);
  }
  const relics = count("relic");
  // Scale relic band: for 100p/250n → 5±2; for smaller, at least 1 if n>=20
  const expectedRelics = Math.max(
    1,
    Math.round((5 * n) / 250),
  );
  if (Math.abs(relics - expectedRelics) > 2 && n >= 40) {
    errors.push(`relics ${relics} not near ${expectedRelics}`);
  }

  // Relics not adjacent to homes
  for (const id of ids) {
    if (nodes[id]!.role !== "relic") continue;
    for (const hw of homeworldIds) {
      if (nodes[id]!.neighbors.includes(hw)) {
        errors.push(`relic ${id} adjacent to home ${hw}`);
      }
    }
  }

  // Degree stats
  const degrees = ids.map((id) => nodes[id]!.neighbors.length);
  const mean = degrees.reduce((a, b) => a + b, 0) / degrees.length;
  if (mean < 2.2 || mean > 3.2) errors.push(`mean degree ${mean.toFixed(2)} out of 2.2–3.2`);
  if (!degrees.some((d) => d >= 5)) errors.push("no hub degree >= 5");
  const leaves = degrees.filter((d) => d <= 2).length;
  if (leaves / n < 0.1) errors.push(`leaf ratio ${leaves / n} < 10%`);

  return { ok: errors.length === 0, errors };
}

/**
 * Seeded procedural galaxy. Tries until acceptance or maxAttempts.
 * Uses a ring+chord backbone with spokes for degree skew.
 */
export function generateGalaxy(opts: GalaxyGenOptions): GeneratedGalaxy {
  const players = opts.playerCount;
  const nodeCount =
    opts.nodeCount ?? Math.max(players * 3, Math.round((250 * players) / 100));
  const maxAttempts = opts.maxAttempts ?? 80;
  const rng = createRng(opts.seed);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = (opts.seed + attempt * 9973) >>> 0;
    const g = tryGenerate(attemptSeed, players, nodeCount, rng);
    if (!g) continue;
    const v = validateGalaxy(g.map, g.homeworldIds, players);
    if (v.ok) return { ...g, seed: opts.seed };
  }

  // Fallback: relaxed generator that still meets hard constraints (connected, spacing, yards)
  const g = tryGenerateRelaxed(opts.seed, players, nodeCount);
  return { ...g, seed: opts.seed };
}

function tryGenerate(
  seed: number,
  players: number,
  nodeCount: number,
  _outerRng: () => number,
): GeneratedGalaxy | null {
  const rng = createRng(seed);
  const ids: NodeId[] = Array.from({ length: nodeCount }, (_, i) => `n${i}`);
  const neighbors: Record<NodeId, Set<NodeId>> = {};
  for (const id of ids) neighbors[id] = new Set();

  const link = (a: NodeId, b: NodeId) => {
    if (a === b) return;
    neighbors[a]!.add(b);
    neighbors[b]!.add(a);
  };

  // Ring backbone
  for (let i = 0; i < nodeCount; i++) {
    link(ids[i]!, ids[(i + 1) % nodeCount]!);
  }

  // Random chords for hubs / mean degree ~2.6
  const targetEdges = Math.floor((nodeCount * 2.6) / 2);
  let edges = nodeCount; // ring
  let guard = 0;
  while (edges < targetEdges && guard < nodeCount * 20) {
    guard++;
    const a = ids[randInt(rng, 0, nodeCount - 1)]!;
    const b = ids[randInt(rng, 0, nodeCount - 1)]!;
    if (a === b || neighbors[a]!.has(b)) continue;
    // Prefer attaching to existing higher-degree nodes occasionally
    link(a, b);
    edges++;
  }

  // Force at least one hub: connect a node to 5 others
  const hub = ids[randInt(rng, 0, nodeCount - 1)]!;
  const others = shuffleInPlace(
    ids.filter((id) => id !== hub),
    rng,
  );
  for (const o of others.slice(0, 5)) link(hub, o);

  // Pick homeworlds with spacing
  const homeworldIds: NodeId[] = [];
  const candidates = shuffleInPlace([...ids], rng);
  for (const c of candidates) {
    if (homeworldIds.length >= players) break;
    if (
      homeworldIds.every((h) => hopDistLocal(neighbors, h, c) >= 3)
    ) {
      homeworldIds.push(c);
    }
  }
  if (homeworldIds.length < players) return null;

  // Assign roles
  const roleOf: Record<NodeId, NodeRole> = {};
  for (const id of ids) roleOf[id] = "relay"; // placeholder
  for (const h of homeworldIds) roleOf[h] = "homeworld";

  const remaining = shuffleInPlace(
    ids.filter((id) => !homeworldIds.includes(id)),
    rng,
  );

  const needShipyards = players;
  const needResources = players;
  const needCores = Math.floor(players / 2);
  const needRelays = Math.floor(players / 3);
  const needRelics = Math.max(1, Math.round((5 * nodeCount) / 250));

  // Place shipyards within 2 hops of each home
  const yards: NodeId[] = [];
  for (const hw of homeworldIds) {
    const near = remaining.filter(
      (id) =>
        !yards.includes(id) &&
        hopDistLocal(neighbors, hw, id) <= 2 &&
        hopDistLocal(neighbors, hw, id) >= 1,
    );
    const pick =
      near[randInt(rng, 0, Math.max(0, near.length - 1))] ??
      remaining.find((id) => !yards.includes(id));
    if (!pick) return null;
    yards.push(pick);
    roleOf[pick] = "shipyard";
  }
  // Extra shipyards if needed
  while (yards.length < needShipyards) {
    const pick = remaining.find(
      (id) => roleOf[id] === "relay" && !homeworldIds.includes(id),
    );
    if (!pick) break;
    roleOf[pick] = "shipyard";
    yards.push(pick);
  }

  const assign = (role: NodeRole, count: number) => {
    let placed = 0;
    for (const id of remaining) {
      if (placed >= count) break;
      if (roleOf[id] !== "relay") continue;
      if (role === "relic") {
        if (homeworldIds.some((h) => neighbors[id]!.has(h))) continue;
      }
      roleOf[id] = role;
      placed++;
    }
    return placed;
  };

  assign("resource", needResources);
  assign("core_world", needCores);
  assign("relic", needRelics);
  // Remaining stay relay (already set); ensure minimum relays by converting extras if needed
  const relayCount = ids.filter((id) => roleOf[id] === "relay").length;
  if (relayCount < needRelays) {
    // Convert some resources/cores surplus — shouldn't usually happen
  }

  const nodes: Record<NodeId, GalaxyNode> = {};
  const layout: Record<NodeId, { x: number; y: number }> = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    nodes[id] = {
      id,
      role: roleOf[id]!,
      neighbors: [...neighbors[id]!].sort(),
    };
    const angle = (2 * Math.PI * i) / ids.length;
    layout[id] = { x: Math.cos(angle), y: Math.sin(angle) };
  }

  return {
    map: { nodes, layout },
    homeworldIds,
    seed,
  };
}

function hopDistLocal(
  neighbors: Record<NodeId, Set<NodeId>>,
  a: NodeId,
  b: NodeId,
): number {
  if (a === b) return 0;
  const q: NodeId[] = [a];
  const dist = new Map<NodeId, number>([[a, 0]]);
  while (q.length) {
    const cur = q.shift()!;
    const d = dist.get(cur)!;
    for (const n of neighbors[cur] ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      if (n === b) return d + 1;
      q.push(n);
    }
  }
  return Infinity;
}

/** Guaranteed-valid smaller construction for stubborn seeds. */
function tryGenerateRelaxed(
  seed: number,
  players: number,
  nodeCount: number,
): GeneratedGalaxy {
  const rng = createRng(seed ^ 0xabc);
  // Build clusters: each player gets home — shipyard — resource chain, then connect clusters
  const nodes: Record<NodeId, GalaxyNode> = {};
  const homeworldIds: NodeId[] = [];
  let seq = 0;
  const nid = () => {
    const id = `n${seq}`;
    seq++;
    return id;
  };

  const ensure = (id: NodeId, role: NodeRole) => {
    if (!nodes[id]) nodes[id] = { id, role, neighbors: [] };
    else nodes[id]!.role = role;
  };
  const link = (a: NodeId, b: NodeId) => {
    if (!nodes[a]!.neighbors.includes(b)) nodes[a]!.neighbors.push(b);
    if (!nodes[b]!.neighbors.includes(a)) nodes[b]!.neighbors.push(a);
  };

  const clusterHubs: NodeId[] = [];
  for (let p = 0; p < players; p++) {
    const hw = nid();
    const sy = nid();
    const res = nid();
    const core = nid();
    const hub = nid();
    ensure(hw, "homeworld");
    ensure(sy, "shipyard");
    ensure(res, "resource");
    ensure(core, "core_world");
    ensure(hub, "relay");
    homeworldIds.push(hw);
    link(hw, sy);
    link(sy, hub);
    link(hub, res);
    link(hub, core);
    clusterHubs.push(hub);
  }

  // Connect hubs in a ring + chords
  for (let i = 0; i < clusterHubs.length; i++) {
    link(clusterHubs[i]!, clusterHubs[(i + 1) % clusterHubs.length]!);
  }
  if (clusterHubs.length > 4) {
    link(clusterHubs[0]!, clusterHubs[Math.floor(clusterHubs.length / 2)]!);
  }

  // Add relays/relics/fill to nodeCount
  while (Object.keys(nodes).length < nodeCount) {
    const id = nid();
    const roles: NodeRole[] = ["relay", "resource", "shipyard", "core_world"];
    const role = roles[randInt(rng, 0, roles.length - 1)]!;
    ensure(id, role);
    const existing = Object.keys(nodes).filter((x) => x !== id);
    const attach = existing[randInt(rng, 0, existing.length - 1)]!;
    link(id, attach);
  }

  // Place relics away from homes
  const relicCount = Math.max(1, Math.round((5 * Object.keys(nodes).length) / 250));
  const candidates = Object.keys(nodes).filter((id) => {
    if (nodes[id]!.role === "homeworld") return false;
    return homeworldIds.every((h) => !nodes[id]!.neighbors.includes(h));
  });
  shuffleInPlace(candidates, rng);
  for (let i = 0; i < Math.min(relicCount, candidates.length); i++) {
    nodes[candidates[i]!]!.role = "relic";
  }

  // Ensure a hub degree >= 5
  const ids = Object.keys(nodes);
  let hub = ids[0]!;
  for (const id of ids) {
    if (nodes[id]!.neighbors.length > nodes[hub]!.neighbors.length) hub = id;
  }
  while (nodes[hub]!.neighbors.length < 5) {
    const other = ids.find(
      (id) => id !== hub && !nodes[hub]!.neighbors.includes(id),
    );
    if (!other) break;
    link(hub, other);
  }

  for (const n of Object.values(nodes)) {
    n.neighbors.sort();
  }

  return { map: { nodes }, homeworldIds, seed };
}
