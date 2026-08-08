import { createRng } from "./rng.js";
import { generateSystemName } from "./names.js";
import type {
  BorderEdge,
  GalaxyGeometry,
  LaneEdge,
  StarClass,
  SystemGeometry,
  SystemId,
  Vec2,
} from "./types.js";

/** Most stars get 2-4 lanes; the cap keeps the web readable. */
const LANE_DEGREE_CAP = 4;
const LANE_DEGREE_CAP_EXTRA = 5;
/** Chance a surplus candidate becomes a loop-forming lane. */
const EXTRA_LANE_CHANCE = 0.14;

export function borderKey(a: SystemId, b: SystemId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Build a galaxy of individual star systems: spiral-arm star placement, a
 * planar hyperlane web pruned from Voronoi adjacency, and per-star cells used
 * only to rasterize empire territory.
 */
export function generateGalaxy(
  seed: number,
  systemCount: number,
): GalaxyGeometry {
  const rng = createRng(seed);
  const placed = placeStars(systemCount, rng);
  const sites = placed.sites;
  const n = sites.length;
  const ids: SystemId[] = sites.map((_, i) => `s${i}`);

  const grid = new SpatialGrid(sites, placed.meanSpacing * 2);
  const cells = buildCells(sites, grid, placed.radius, placed.meanSpacing);
  const adjacency = collectAdjacency(sites, cells, placed.meanSpacing);
  const laneLists = chooseLanes(n, adjacency, rng);

  const systems: SystemGeometry[] = [];
  const byId: Record<SystemId, SystemGeometry> = {};
  for (let i = 0; i < n; i++) {
    const geo: SystemGeometry = {
      id: ids[i]!,
      index: i,
      name: generateSystemName(seed, ids[i]!, i),
      starClass: placed.classes[i]!,
      site: sites[i]!,
      cell: cells[i]!.cell,
      hyperlanes: laneLists[i]!.map((j) => ids[j]!),
    };
    systems.push(geo);
    byId[geo.id] = geo;
  }

  const lanes: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (const j of laneLists[i]!) {
      if (j > i) lanes.push({ a: ids[i]!, b: ids[j]! });
    }
  }

  const borderEdges: BorderEdge[] = [];
  const borderEdgeByKey: Record<string, BorderEdge> = {};
  for (const adj of adjacency) {
    const edge: BorderEdge = {
      a: ids[adj.i]!,
      b: ids[adj.j]!,
      p0: adj.p0,
      p1: adj.p1,
    };
    borderEdges.push(edge);
    borderEdgeByKey[borderKey(edge.a, edge.b)] = edge;
  }

  return {
    seed,
    systems,
    byId,
    ids,
    lanes,
    borderEdges,
    borderEdgeByKey,
    radius: placed.radius,
  };
}

// —— Star placement ————————————————————————————————————————————————

interface Placement {
  sites: Vec2[];
  classes: StarClass[];
  radius: number;
  meanSpacing: number;
}

/**
 * Spiral arms + a core bulge + a thin halo, rejected against a minimum
 * separation so stars never clump into unreadable knots.
 */
function placeStars(n: number, rng: () => number): Placement {
  const target = Math.max(24, Math.floor(n));
  const discRadius = Math.sqrt(target) * 1.15;
  const meanSpacing = discRadius * Math.sqrt(Math.PI / target);
  let minSep = meanSpacing * 0.46;
  const cellSize = minSep;
  const buckets = new Map<string, Vec2[]>();

  const armCount = 2 + Math.floor(rng() * 3);
  const twist = 2.1 + rng() * 1.5;
  const armSpread = 0.11 + rng() * 0.05;
  const armOffsets: number[] = [];
  for (let i = 0; i < armCount; i++) {
    armOffsets.push((i / armCount) * Math.PI * 2 + rng() * 0.4);
  }

  const key = (x: number, y: number): string =>
    `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

  const farEnough = (p: Vec2, sep: number): boolean => {
    const gx = Math.floor(p.x / cellSize);
    const gy = Math.floor(p.y / cellSize);
    const sep2 = sep * sep;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = buckets.get(`${gx + dx},${gy + dy}`);
        if (!list) continue;
        for (const q of list) {
          const ddx = q.x - p.x;
          const ddy = q.y - p.y;
          if (ddx * ddx + ddy * ddy < sep2) return false;
        }
      }
    }
    return true;
  };

  const sites: Vec2[] = [];
  const classes: StarClass[] = [];
  let misses = 0;

  while (sites.length < target) {
    const p = spiralCandidate(
      rng,
      discRadius,
      armOffsets,
      armCount,
      twist,
      armSpread,
    );
    if (!farEnough(p, minSep)) {
      misses++;
      // Dense arms saturate first; relax rather than spin forever.
      if (misses > 220) {
        minSep *= 0.9;
        misses = 0;
      }
      continue;
    }
    misses = 0;
    const k = key(p.x, p.y);
    const list = buckets.get(k);
    if (list) list.push(p);
    else buckets.set(k, [p]);
    sites.push(p);
    classes.push(classifyStar(rng, Math.hypot(p.x, p.y) / discRadius));
  }

  let radius = 1;
  for (const s of sites) radius = Math.max(radius, Math.hypot(s.x, s.y));

  return { sites, classes, radius, meanSpacing };
}

function spiralCandidate(
  rng: () => number,
  discRadius: number,
  armOffsets: number[],
  armCount: number,
  twist: number,
  armSpread: number,
): Vec2 {
  const roll = rng();
  if (roll < 0.13) {
    // Core bulge
    const r = discRadius * 0.26 * Math.sqrt(rng());
    const th = rng() * Math.PI * 2;
    return { x: r * Math.cos(th), y: r * Math.sin(th) };
  }
  if (roll < 0.23) {
    // Sparse halo so the void between arms is not empty
    const r = discRadius * Math.sqrt(rng());
    const th = rng() * Math.PI * 2;
    return { x: r * Math.cos(th), y: r * Math.sin(th) };
  }
  const arm = Math.floor(rng() * armCount);
  const t = Math.pow(rng(), 0.72);
  const r = discRadius * (0.1 + 0.9 * t);
  const spread = armSpread * (1 + 1.7 * (1 - t));
  const th = armOffsets[arm]! + twist * t + gaussish(rng) * spread;
  return { x: r * Math.cos(th), y: r * Math.sin(th) };
}

/** Cheap bounded approximation of a normal deviate. */
function gaussish(rng: () => number): number {
  return (rng() + rng() + rng() - 1.5) * 1.2;
}

function classifyStar(rng: () => number, normalizedRadius: number): StarClass {
  const coreBias = 0.1 + 0.18 * (1 - Math.min(1, normalizedRadius));
  const roll = rng();
  if (roll < coreBias) return "core";
  if (roll < coreBias + 0.5) return "main";
  return "dim";
}

// —— Spatial index ————————————————————————————————————————————————

class SpatialGrid {
  private cellSize: number;
  private buckets = new Map<string, number[]>();

  constructor(
    private sites: Vec2[],
    cellSize: number,
  ) {
    this.cellSize = Math.max(1e-6, cellSize);
    for (let i = 0; i < sites.length; i++) {
      const k = this.key(sites[i]!);
      const list = this.buckets.get(k);
      if (list) list.push(i);
      else this.buckets.set(k, [i]);
    }
  }

  private key(p: Vec2): string {
    return `${Math.floor(p.x / this.cellSize)},${Math.floor(p.y / this.cellSize)}`;
  }

  /** Indices of the `k` nearest sites to `i`, nearest first. */
  nearest(i: number, k: number): number[] {
    const p = this.sites[i]!;
    const gx = Math.floor(p.x / this.cellSize);
    const gy = Math.floor(p.y / this.cellSize);
    const found: { j: number; d: number }[] = [];
    let ring = 1;
    while (true) {
      found.length = 0;
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          const list = this.buckets.get(`${gx + dx},${gy + dy}`);
          if (!list) continue;
          for (const j of list) {
            if (j === i) continue;
            const q = this.sites[j]!;
            const ddx = q.x - p.x;
            const ddy = q.y - p.y;
            found.push({ j, d: ddx * ddx + ddy * ddy });
          }
        }
      }
      if (found.length >= k + 4 || ring > 6) break;
      ring++;
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, k).map((f) => f.j);
  }
}

// —— Voronoi cells with tagged edges ——————————————————————————————

interface CellEdge {
  /** Index of the neighbor whose half-plane produced this edge, or -1. */
  neighbor: number;
  p0: Vec2;
  p1: Vec2;
}

interface CellResult {
  cell: Vec2[];
  edges: CellEdge[];
}

function buildCells(
  sites: Vec2[],
  grid: SpatialGrid,
  radius: number,
  meanSpacing: number,
): CellResult[] {
  const n = sites.length;
  // Ghosts keep rim cells from spiking outward past the galaxy edge.
  const ghosts = ghostRing(
    radius + meanSpacing * 1.6,
    Math.max(32, Math.floor(Math.sqrt(n) * 3)),
  );
  const extent = radius * 1.3 + meanSpacing * 4;
  const out: CellResult[] = [];
  const neighborCount = Math.min(28, Math.max(8, n - 1));

  for (let i = 0; i < n; i++) {
    const nearby = grid.nearest(i, neighborCount);
    const planes: { p: Vec2; tag: number }[] = nearby.map((j) => ({
      p: sites[j]!,
      tag: j,
    }));
    for (const g of ghosts) planes.push({ p: g, tag: -1 });
    out.push(taggedVoronoiCell(sites[i]!, planes, extent));
  }
  return out;
}

function ghostRing(radius: number, count: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    out.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
  }
  return out;
}

/**
 * Clip a bounding square by the perpendicular bisector to each nearby site,
 * tracking which site produced each surviving edge. Those tags give both true
 * Voronoi adjacency and the exact shared border segment.
 */
export function taggedVoronoiCell(
  site: Vec2,
  planes: { p: Vec2; tag: number }[],
  extent: number,
): CellResult {
  let pts: Vec2[] = [
    { x: site.x - extent, y: site.y - extent },
    { x: site.x + extent, y: site.y - extent },
    { x: site.x + extent, y: site.y + extent },
    { x: site.x - extent, y: site.y + extent },
  ];
  let tags: number[] = [-1, -1, -1, -1];

  // Nearest planes first for numerical stability.
  const ordered = [...planes].sort((a, b) => {
    const da = (a.p.x - site.x) ** 2 + (a.p.y - site.y) ** 2;
    const db = (b.p.x - site.x) ** 2 + (b.p.y - site.y) ** 2;
    return da - db;
  });

  for (const plane of ordered) {
    const mx = (site.x + plane.p.x) / 2;
    const my = (site.y + plane.p.y) / 2;
    const nx = plane.p.x - site.x;
    const ny = plane.p.y - site.y;
    const clipped = clipTagged(pts, tags, mx, my, nx, ny, plane.tag);
    pts = clipped.pts;
    tags = clipped.tags;
    if (pts.length < 3) break;
  }

  if (pts.length < 3) {
    const s = extent * 0.01;
    return {
      cell: [
        { x: site.x - s, y: site.y - s },
        { x: site.x + s, y: site.y - s },
        { x: site.x + s, y: site.y + s },
        { x: site.x - s, y: site.y + s },
      ],
      edges: [],
    };
  }

  const wound = ensureCCW(pts, tags);
  const edges: CellEdge[] = [];
  for (let i = 0; i < wound.pts.length; i++) {
    const a = wound.pts[i]!;
    const b = wound.pts[(i + 1) % wound.pts.length]!;
    edges.push({ neighbor: wound.tags[i]!, p0: a, p1: b });
  }
  return { cell: wound.pts, edges };
}

function clipTagged(
  pts: Vec2[],
  tags: number[],
  mx: number,
  my: number,
  nx: number,
  ny: number,
  clipTag: number,
): { pts: Vec2[]; tags: number[] } {
  const outPts: Vec2[] = [];
  const outTags: number[] = [];
  const inside = (p: Vec2): boolean => (p.x - mx) * nx + (p.y - my) * ny <= 1e-9;

  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const edgeTag = tags[i]!;
    const curIn = inside(cur);
    const nextIn = inside(next);

    if (curIn && nextIn) {
      outPts.push(cur);
      outTags.push(edgeTag);
    } else if (curIn && !nextIn) {
      outPts.push(cur);
      outTags.push(edgeTag);
      outPts.push(intersect(cur, next, mx, my, nx, ny));
      outTags.push(clipTag);
    } else if (!curIn && nextIn) {
      outPts.push(intersect(cur, next, mx, my, nx, ny));
      outTags.push(edgeTag);
    }
  }
  return { pts: outPts, tags: outTags };
}

function intersect(
  a: Vec2,
  b: Vec2,
  mx: number,
  my: number,
  nx: number,
  ny: number,
): Vec2 {
  const da = (a.x - mx) * nx + (a.y - my) * ny;
  const db = (b.x - mx) * nx + (b.y - my) * ny;
  const t = da / (da - db || 1e-12);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function ensureCCW(
  pts: Vec2[],
  tags: number[],
): { pts: Vec2[]; tags: number[] } {
  const m = pts.length;
  let area = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % m]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (area >= 0) return { pts, tags };
  // Reversed vertex k spans original edge (m - 2 - k).
  const rPts = [...pts].reverse();
  const rTags: number[] = [];
  for (let k = 0; k < m; k++) rTags.push(tags[(2 * m - 2 - k) % m]!);
  return { pts: rPts, tags: rTags };
}

// —— Adjacency and hyperlanes —————————————————————————————————————

interface Adjacency {
  i: number;
  j: number;
  p0: Vec2;
  p1: Vec2;
  length: number;
}

function collectAdjacency(
  sites: Vec2[],
  cells: CellResult[],
  meanSpacing: number,
): Adjacency[] {
  const minSegment = meanSpacing * 0.06;
  const found = new Map<string, Adjacency>();

  for (let i = 0; i < cells.length; i++) {
    for (const edge of cells[i]!.edges) {
      const j = edge.neighbor;
      if (j < 0 || j === i) continue;
      const len = Math.hypot(edge.p1.x - edge.p0.x, edge.p1.y - edge.p0.y);
      if (len < minSegment) continue;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}|${b}`;
      const existing = found.get(key);
      // Both cells describe the same segment; keep the better-resolved one.
      if (!existing || len > existing.length) {
        found.set(key, { i: a, j: b, p0: edge.p0, p1: edge.p1, length: len });
      }
    }
  }

  const out = [...found.values()];
  // Lane pruning ranks by star-to-star distance, not by shared-border length.
  for (const adj of out) {
    adj.length = Math.hypot(
      sites[adj.j]!.x - sites[adj.i]!.x,
      sites[adj.j]!.y - sites[adj.i]!.y,
    );
  }
  return out;
}

/**
 * Prune Voronoi adjacency into a hyperlane web. Every candidate is a Voronoi
 * (Delaunay) edge, so no accepted lane can cross another.
 */
function chooseLanes(
  n: number,
  adjacency: Adjacency[],
  rng: () => number,
): number[][] {
  const candidates = [...adjacency].sort((a, b) => a.length - b.length);
  if (candidates.length === 0) return Array.from({ length: n }, () => []);

  const lengths = candidates.map((c) => c.length);
  const median = lengths[Math.floor(lengths.length / 2)]!;
  const lengthCap = median * 2.4;

  const degree: number[] = new Array<number>(n).fill(0);
  const accepted: boolean[] = new Array<boolean>(candidates.length).fill(false);
  const dsu = new Dsu(n);

  const accept = (k: number, c: Adjacency): void => {
    accepted[k] = true;
    degree[c.i] = (degree[c.i] ?? 0) + 1;
    degree[c.j] = (degree[c.j] ?? 0) + 1;
    dsu.union(c.i, c.j);
  };

  for (let k = 0; k < candidates.length; k++) {
    const c = candidates[k]!;
    if (c.length > lengthCap) continue;
    if (degree[c.i]! >= LANE_DEGREE_CAP || degree[c.j]! >= LANE_DEGREE_CAP) {
      continue;
    }
    accept(k, c);
  }

  // Connectivity pass: shortest unused candidates that join two components.
  for (let k = 0; k < candidates.length; k++) {
    if (accepted[k]) continue;
    const c = candidates[k]!;
    if (dsu.find(c.i) === dsu.find(c.j)) continue;
    accept(k, c);
  }

  // A few surplus lanes so the web has loops instead of pure tree branches.
  for (let k = 0; k < candidates.length; k++) {
    if (accepted[k]) continue;
    const c = candidates[k]!;
    if (c.length > lengthCap * 1.5) continue;
    if (
      degree[c.i]! >= LANE_DEGREE_CAP_EXTRA ||
      degree[c.j]! >= LANE_DEGREE_CAP_EXTRA
    ) {
      continue;
    }
    if (rng() > EXTRA_LANE_CHANCE) continue;
    accept(k, c);
  }

  const lanes: number[][] = Array.from({ length: n }, () => []);
  for (let k = 0; k < candidates.length; k++) {
    if (!accepted[k]) continue;
    const c = candidates[k]!;
    lanes[c.i]!.push(c.j);
    lanes[c.j]!.push(c.i);
  }
  return lanes;
}

class Dsu {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root]! !== root) root = this.parent[root]!;
    let cur = x;
    while (this.parent[cur]! !== cur) {
      const next = this.parent[cur]!;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}
