import { createRng } from "./rng.js";
import type {
  GalaxyMap,
  GalaxyNode,
  NodeId,
  NodeRole,
} from "./types.js";

export interface GalaxyGenOptions {
  seed: number;
  playerCount: number;
  /** Target total nodes; default scales with players (see recommendedNodeCount). */
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

/** Mean degree the generator aims for; validator band is 2.2–3.2. */
const TARGET_MEAN_DEGREE = 2.7;
const MAX_DEGREE = 7;
/** rulings.md §9 wants >=10% of nodes at degree <= 2. */
const MIN_LEAF_RATIO = 0.12;

/**
 * Node budget for a match.
 *
 * balance.md targets 150–300 nodes for ~100 players. Small matches need more
 * room per player or there is nothing to expand into, so density scales down
 * along a log curve. The 3x floor is load-bearing rather than cosmetic: the
 * role budget cannot be met below it, so large matches land at 3x (300 nodes
 * for 100 players, the top of the documented band).
 */
export function recommendedNodeCount(players: number): number {
  const p = Math.max(2, players);
  const t = clamp01((Math.log2(p) - 1) / (Math.log2(100) - 1));
  const factor = 6.5 - 4 * t;
  return Math.max(p * 3, Math.round(p * factor));
}

export interface RoleBudget {
  shipyard: number;
  resource: number;
  core_world: number;
  relay: number;
  relic: number;
}

/**
 * Role split for a node budget.
 *
 * rulings.md §9 lists absolute minimums (shipyards >= players, resources >=
 * players, ...) that sum to ~3.8x players, which cannot fit the documented
 * 250-node / 100-player map. Small maps hit the absolute minimums exactly;
 * larger ones degrade proportionally so shipyards become contested objectives.
 */
export function roleBudget(nodeCount: number, players: number): RoleBudget {
  const relic = relicTarget(nodeCount);
  const rest = Math.max(0, nodeCount - players - relic);
  const shipyard = Math.min(players, Math.max(1, Math.round(rest * 0.24)));
  const resource = Math.min(players, Math.max(1, Math.round(rest * 0.28)));
  const core_world = Math.min(
    Math.max(1, Math.floor(players / 2)),
    Math.max(1, Math.round(rest * 0.2)),
  );
  const relay = Math.max(0, rest - shipyard - resource - core_world);
  return { shipyard, resource, core_world, relay, relic };
}

function relicTarget(nodeCount: number): number {
  return Math.max(1, Math.round(nodeCount / 50));
}

/**
 * Homeworlds must never be adjacent. The >=3 hop rule needs roughly 4 nodes per
 * player to be satisfiable at all (each homeworld blocks its 2-hop
 * neighbourhood), so crowded maps fall back to >=2.
 */
export function homeSpacingTarget(nodeCount: number, players: number): number {
  return nodeCount / Math.max(1, players) >= 4 ? 3 : 2;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function bfsFrom(
  nodes: Record<NodeId, GalaxyNode>,
  src: NodeId,
): Map<NodeId, number> {
  const dist = new Map<NodeId, number>([[src, 0]]);
  const q: NodeId[] = [src];
  for (let head = 0; head < q.length; head++) {
    const cur = q[head]!;
    const d = dist.get(cur)!;
    for (const n of nodes[cur]?.neighbors ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      q.push(n);
    }
  }
  return dist;
}

function hopDistance(
  nodes: Record<NodeId, GalaxyNode>,
  a: NodeId,
  b: NodeId,
): number {
  if (a === b) return 0;
  return bfsFrom(nodes, a).get(b) ?? Infinity;
}

function isConnected(nodes: Record<NodeId, GalaxyNode>): boolean {
  const ids = Object.keys(nodes);
  if (ids.length === 0) return false;
  return bfsFrom(nodes, ids[0]!).size === ids.length;
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

  // Home spacing. Adjacency is always illegal; the hop floor adapts to density.
  const spacing = homeSpacingTarget(n, playerCount);
  for (let i = 0; i < homeworldIds.length; i++) {
    const a = homeworldIds[i]!;
    const distA = bfsFrom(nodes, a);
    for (let j = i + 1; j < homeworldIds.length; j++) {
      const b = homeworldIds[j]!;
      const d = distA.get(b) ?? Infinity;
      if (d < spacing) {
        errors.push(`homes ${a}-${b} distance ${d} < ${spacing}`);
      }
      if (nodes[a]?.neighbors.includes(b)) {
        errors.push(`homes ${a}-${b} adjacent`);
      }
    }
  }

  // Shipyard access: every homeworld within 2 hops of some shipyard.
  for (const hw of homeworldIds) {
    const dist = bfsFrom(nodes, hw);
    let best = Infinity;
    for (const [id, d] of dist) {
      if (d > 2) continue;
      if (nodes[id]!.role === "shipyard") best = Math.min(best, d);
    }
    if (best > 2) errors.push(`home ${hw} has no shipyard within 2 hops`);
  }

  const count = (role: NodeRole) =>
    ids.filter((id) => nodes[id]!.role === role).length;
  const players = playerCount;
  const rest = Math.max(1, n - players - relicTarget(n));

  if (count("homeworld") !== players) {
    errors.push(`homeworlds ${count("homeworld")} != players ${players}`);
  }
  const minShipyards = Math.min(players, Math.ceil(rest * 0.18));
  if (count("shipyard") < minShipyards) {
    errors.push(`shipyards ${count("shipyard")} < ${minShipyards}`);
  }
  const minResources = Math.min(players, Math.ceil(rest * 0.2));
  if (count("resource") < minResources) {
    errors.push(`resources ${count("resource")} < ${minResources}`);
  }
  const minCores = Math.min(
    Math.floor(players / 2),
    Math.ceil(rest * 0.12),
  );
  if (count("core_world") < minCores) {
    errors.push(`cores ${count("core_world")} < ${minCores}`);
  }
  const minRelays = Math.min(
    Math.floor(players / 3),
    Math.ceil(rest * 0.15),
  );
  if (count("relay") < minRelays) {
    errors.push(`relays ${count("relay")} < ${minRelays}`);
  }

  const relics = count("relic");
  const expectedRelics = relicTarget(n);
  if (Math.abs(relics - expectedRelics) > 2 && n >= 40) {
    errors.push(`relics ${relics} not near ${expectedRelics}`);
  }

  for (const id of ids) {
    if (nodes[id]!.role !== "relic") continue;
    for (const hw of homeworldIds) {
      if (nodes[id]!.neighbors.includes(hw)) {
        errors.push(`relic ${id} adjacent to home ${hw}`);
      }
    }
  }

  const degrees = ids.map((id) => nodes[id]!.neighbors.length);
  const mean = degrees.reduce((a, b) => a + b, 0) / degrees.length;
  if (mean < 2.2 || mean > 3.2) {
    errors.push(`mean degree ${mean.toFixed(2)} out of 2.2–3.2`);
  }
  if (!degrees.some((d) => d >= 5)) errors.push("no hub degree >= 5");
  const leaves = degrees.filter((d) => d <= 2).length;
  if (leaves / n < 0.1) {
    errors.push(`leaf ratio ${(leaves / n).toFixed(2)} < 10%`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Seeded procedural galaxy.
 *
 * Builds a geometric graph (even point spread -> spanning tree -> extra chords
 * with preferential attachment) so the topology is planar-ish and the layout
 * matches it. Homeworlds are chosen by farthest-point sampling on hop distance,
 * which succeeds on chord-dense graphs where greedy scanning does not.
 */
export function generateGalaxy(opts: GalaxyGenOptions): GeneratedGalaxy {
  const players = opts.playerCount;
  const nodeCount = Math.max(
    players * 2,
    opts.nodeCount ?? recommendedNodeCount(players),
  );
  const maxAttempts = opts.maxAttempts ?? 24;

  let best: { g: GeneratedGalaxy; errors: string[] } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = (opts.seed + attempt * 9973) >>> 0;
    const g = buildGalaxy(attemptSeed, players, nodeCount);
    if (!g) continue;
    const v = validateGalaxy(g.map, g.homeworldIds, players);
    if (v.ok) return { ...g, seed: opts.seed };
    if (!best || v.errors.length < best.errors.length) {
      best = { g, errors: v.errors };
    }
  }

  // Never ship an unvalidated map silently: surface why generation failed.
  if (best) {
    throw new Error(
      `generateGalaxy: no valid galaxy for ${players} players / ${nodeCount} nodes ` +
        `after ${maxAttempts} attempts (best: ${best.errors.join("; ")})`,
    );
  }
  throw new Error(
    `generateGalaxy: could not construct a galaxy for ${players} players / ${nodeCount} nodes`,
  );
}

interface Point {
  x: number;
  y: number;
}

function buildGalaxy(
  seed: number,
  players: number,
  nodeCount: number,
): GeneratedGalaxy | null {
  const rng = createRng(seed);
  const ids: NodeId[] = Array.from({ length: nodeCount }, (_, i) => `n${i}`);
  const pos = spreadPoints(nodeCount, rng);
  const adj = buildEdges(ids, pos, rng);

  const nodes: Record<NodeId, GalaxyNode> = {};
  for (const id of ids) {
    nodes[id] = { id, role: "relay", neighbors: [...adj[id]!].sort() };
  }
  if (!isConnected(nodes)) return null;

  const homeworldIds = pickHomeworlds(nodes, ids, players, nodeCount);
  if (!homeworldIds) return null;

  if (!assignRoles(nodes, ids, homeworldIds, players, nodeCount, rng)) {
    return null;
  }

  const layout: Record<NodeId, Point> = {};
  const targetR = Math.max(5, Math.sqrt(nodeCount) * 1.6);
  for (const id of ids) {
    layout[id] = { x: pos[id]!.x * targetR, y: pos[id]!.y * targetR };
  }

  return { map: { nodes, layout }, homeworldIds, seed };
}

/** Sunflower spread with jitter: even coverage of a unit disc, no clumps. */
function spreadPoints(n: number, rng: () => number): Record<NodeId, Point> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Record<NodeId, Point> = {};
  const jitter = 0.45 / Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const theta = i * golden;
    out[`n${i}`] = {
      x: r * Math.cos(theta) + (rng() - 0.5) * jitter * 2,
      y: r * Math.sin(theta) + (rng() - 0.5) * jitter * 2,
    };
  }
  return out;
}

interface Candidate {
  a: NodeId;
  b: NodeId;
  d: number;
}

/**
 * Spanning tree over nearest neighbours (connectivity + plenty of leaves), then
 * extra short chords biased toward already-busy nodes so real hubs emerge.
 */
function buildEdges(
  ids: NodeId[],
  pos: Record<NodeId, Point>,
  rng: () => number,
): Record<NodeId, Set<NodeId>> {
  const n = ids.length;
  const adj: Record<NodeId, Set<NodeId>> = {};
  for (const id of ids) adj[id] = new Set();

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const k = Math.min(n - 1, 10);
  for (const a of ids) {
    const near = ids
      .filter((b) => b !== a)
      .map((b) => ({ b, d: dist(pos[a]!, pos[b]!) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, k);
    for (const { b, d } of near) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ a, b, d });
    }
  }
  candidates.sort((x, y) => x.d - y.d || (x.a < y.a ? -1 : 1));

  // Kruskal spanning forest over the candidate set.
  const parent = new Map<NodeId, NodeId>(ids.map((id) => [id, id]));
  const find = (x: NodeId): NodeId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const union = (x: NodeId, y: NodeId): boolean => {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return false;
    parent.set(rx, ry);
    return true;
  };

  const link = (a: NodeId, b: NodeId) => {
    adj[a]!.add(b);
    adj[b]!.add(a);
  };

  const leftovers: Candidate[] = [];
  for (const c of candidates) {
    if (union(c.a, c.b)) link(c.a, c.b);
    else leftovers.push(c);
  }

  // kNN candidates can leave separate components; stitch them by nearest pair.
  let guard = 0;
  while (guard++ < n) {
    const roots = new Set(ids.map((id) => find(id)));
    if (roots.size <= 1) break;
    let bestPair: Candidate | null = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        if (find(a) === find(b)) continue;
        const d = dist(pos[a]!, pos[b]!);
        if (!bestPair || d < bestPair.d) bestPair = { a, b, d };
      }
    }
    if (!bestPair) break;
    union(bestPair.a, bestPair.b);
    link(bestPair.a, bestPair.b);
  }

  // Extra chords up to the target mean degree.
  const targetEdges = Math.round((n * TARGET_MEAN_DEGREE) / 2);
  const minLeaves = Math.ceil(n * MIN_LEAF_RATIO);
  let edgeCount = countEdges(adj);

  const leafCount = () =>
    ids.reduce((acc, id) => acc + (adj[id]!.size <= 2 ? 1 : 0), 0);

  // Preferential attachment: score short edges between busier nodes first.
  const scored = leftovers
    .map((c) => ({
      c,
      score: c.d / (1 + 0.35 * (adj[c.a]!.size + adj[c.b]!.size)) + rng() * 0.01,
    }))
    .sort((x, y) => x.score - y.score);

  for (const { c } of scored) {
    if (edgeCount >= targetEdges) break;
    if (adj[c.a]!.has(c.b)) continue;
    if (adj[c.a]!.size >= MAX_DEGREE || adj[c.b]!.size >= MAX_DEGREE) continue;
    // Preserve the leaf quota: don't consume the last few degree<=2 nodes.
    const consumesLeaf =
      (adj[c.a]!.size === 2 ? 1 : 0) + (adj[c.b]!.size === 2 ? 1 : 0);
    if (consumesLeaf > 0 && leafCount() - consumesLeaf < minLeaves) continue;
    link(c.a, c.b);
    edgeCount++;
  }

  // Guarantee at least one real hub (rulings.md §9: some node with degree >= 5).
  let hub = ids[0]!;
  for (const id of ids) {
    if (adj[id]!.size > adj[hub]!.size) hub = id;
  }
  if (adj[hub]!.size < 5) {
    const near = ids
      .filter((b) => b !== hub && !adj[hub]!.has(b))
      .sort((x, y) => dist(pos[hub]!, pos[x]!) - dist(pos[hub]!, pos[y]!));
    for (const b of near) {
      if (adj[hub]!.size >= 5) break;
      if (adj[b]!.size >= MAX_DEGREE) continue;
      link(hub, b);
    }
  }

  return adj;
}

function countEdges(adj: Record<NodeId, Set<NodeId>>): number {
  let total = 0;
  for (const s of Object.values(adj)) total += s.size;
  return total / 2;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Farthest-point sampling on hop distance. Repeatedly takes the node whose
 * closest existing homeworld is furthest away, which spreads seats across the
 * graph instead of hoping a random shuffle happens to be well separated.
 */
function pickHomeworlds(
  nodes: Record<NodeId, GalaxyNode>,
  ids: NodeId[],
  players: number,
  nodeCount: number,
): NodeId[] | null {
  const preferred = homeSpacingTarget(nodeCount, players);
  for (const spacing of preferred === 3 ? [3, 2] : [2]) {
    const chosen = sampleFarthest(nodes, ids, players, spacing);
    if (chosen) return chosen;
  }
  return null;
}

function sampleFarthest(
  nodes: Record<NodeId, GalaxyNode>,
  ids: NodeId[],
  players: number,
  spacing: number,
): NodeId[] | null {
  if (players <= 0) return [];
  // Double sweep to start from a peripheral node, so seats hug the rim first.
  const firstSweep = bfsFrom(nodes, ids[0]!);
  let start = ids[0]!;
  let bestD = -1;
  for (const id of ids) {
    const d = firstSweep.get(id) ?? -1;
    if (d > bestD || (d === bestD && id < start)) {
      bestD = d;
      start = id;
    }
  }

  const chosen: NodeId[] = [start];
  const minDist = new Map<NodeId, number>();
  const seed = bfsFrom(nodes, start);
  for (const id of ids) minDist.set(id, seed.get(id) ?? Infinity);

  while (chosen.length < players) {
    let pick: NodeId | null = null;
    let pickD = -1;
    for (const id of ids) {
      const d = minDist.get(id) ?? -1;
      if (d === Infinity) continue;
      if (d > pickD || (d === pickD && pick !== null && id < pick)) {
        pickD = d;
        pick = id;
      }
    }
    if (pick === null || pickD < spacing) return null;
    chosen.push(pick);
    const dist2 = bfsFrom(nodes, pick);
    for (const id of ids) {
      const cur = minDist.get(id) ?? Infinity;
      const d = dist2.get(id) ?? Infinity;
      if (d < cur) minDist.set(id, d);
    }
  }
  return chosen;
}

function assignRoles(
  nodes: Record<NodeId, GalaxyNode>,
  ids: NodeId[],
  homeworldIds: NodeId[],
  players: number,
  nodeCount: number,
  rng: () => number,
): boolean {
  for (const id of ids) nodes[id]!.role = "relay";
  const homeSet = new Set(homeworldIds);
  for (const h of homeworldIds) nodes[h]!.role = "homeworld";

  const budget = roleBudget(nodeCount, players);
  const free = ids.filter((id) => !homeSet.has(id));
  const taken = new Set<NodeId>();

  // Every homeworld needs a shipyard within 2 hops (rulings.md §1). Reuse an
  // existing one where possible so yards stay shared, contested objectives.
  const shipyards: NodeId[] = [];
  for (const hw of homeworldIds) {
    const dist = bfsFrom(nodes, hw);
    const alreadyServed = shipyards.some((sy) => (dist.get(sy) ?? Infinity) <= 2);
    if (alreadyServed) continue;
    const near = free
      .filter((id) => !taken.has(id))
      .map((id) => ({ id, d: dist.get(id) ?? Infinity }))
      .filter((x) => x.d >= 1 && x.d <= 2)
      // Prefer 2 hops out so the yard is not welded to the homeworld.
      .sort((a, b) => b.d - a.d || (a.id < b.id ? -1 : 1));
    const pick = near[0]?.id;
    if (!pick) return false;
    taken.add(pick);
    shipyards.push(pick);
    nodes[pick]!.role = "shipyard";
  }

  const pool = shuffle(
    free.filter((id) => !taken.has(id)),
    rng,
  );
  let cursor = 0;
  const take = (count: number, role: NodeRole, filter?: (id: NodeId) => boolean) => {
    let placed = 0;
    for (let i = cursor; i < pool.length && placed < count; i++) {
      const id = pool[i]!;
      if (taken.has(id)) continue;
      if (filter && !filter(id)) continue;
      taken.add(id);
      nodes[id]!.role = role;
      placed++;
    }
    while (cursor < pool.length && taken.has(pool[cursor]!)) cursor++;
    return placed;
  };

  // Relics first: they have a placement constraint (never adjacent to a home).
  take(budget.relic, "relic", (id) =>
    nodes[id]!.neighbors.every((nb) => !homeSet.has(nb)),
  );
  take(Math.max(0, budget.shipyard - shipyards.length), "shipyard");
  take(budget.resource, "resource");
  take(budget.core_world, "core_world");
  // Everything left stays a relay, which covers the relay budget by definition.

  for (const id of ids) nodes[id]!.neighbors.sort();
  return true;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Force-directed layout for maps that arrive without one (hand-built fixtures,
 * older saves). Generated galaxies already carry a geometric layout.
 */
export function ensureMapLayout(map: GalaxyMap, seed = 1): void {
  if (map.layout && Object.keys(map.layout).length === Object.keys(map.nodes).length) {
    return;
  }
  map.layout = computeForceLayout(map.nodes, seed);
}

function computeForceLayout(
  nodes: Record<NodeId, GalaxyNode>,
  seed: number,
): Record<NodeId, Point> {
  const ids = Object.keys(nodes);
  const n = ids.length;
  if (n === 0) return {};

  const rng = createRng(seed ^ 0x11f);
  const pos: Record<NodeId, Point> = {};
  for (let i = 0; i < n; i++) {
    const id = ids[i]!;
    const angle = (2 * Math.PI * i) / n + rng() * 0.2;
    const r = 0.8 + rng() * 0.4;
    pos[id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  }

  const ideal = Math.max(0.25, 2.2 / Math.sqrt(n));
  const iterations = Math.min(120, 40 + n);
  for (let iter = 0; iter < iterations; iter++) {
    const force: Record<NodeId, Point> = {};
    for (const id of ids) force[id] = { x: 0, y: 0 };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const dx = pos[a]!.x - pos[b]!.x;
        const dy = pos[a]!.y - pos[b]!.y;
        const d2 = dx * dx + dy * dy + 0.02;
        const f = 0.04 / d2;
        force[a]!.x += dx * f;
        force[a]!.y += dy * f;
        force[b]!.x -= dx * f;
        force[b]!.y -= dy * f;
      }
    }

    for (const id of ids) {
      for (const nb of nodes[id]!.neighbors) {
        if (id >= nb) continue;
        const dx = pos[nb]!.x - pos[id]!.x;
        const dy = pos[nb]!.y - pos[id]!.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = (d - ideal) * 0.1;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        force[id]!.x += fx;
        force[id]!.y += fy;
        force[nb]!.x -= fx;
        force[nb]!.y -= fy;
      }
    }

    const cool = 1 - iter / iterations;
    for (const id of ids) {
      pos[id]!.x += force[id]!.x * cool;
      pos[id]!.y += force[id]!.y * cool;
    }
  }

  let cx = 0;
  let cy = 0;
  for (const id of ids) {
    cx += pos[id]!.x;
    cy += pos[id]!.y;
  }
  cx /= n;
  cy /= n;
  let maxR = 0.01;
  for (const id of ids) {
    pos[id]!.x -= cx;
    pos[id]!.y -= cy;
    maxR = Math.max(maxR, Math.hypot(pos[id]!.x, pos[id]!.y));
  }
  const targetR = Math.max(5, Math.sqrt(n) * 1.6);
  for (const id of ids) {
    pos[id]!.x = (pos[id]!.x / maxR) * targetR;
    pos[id]!.y = (pos[id]!.y / maxR) * targetR;
  }
  return pos;
}

export { hopDistance };
