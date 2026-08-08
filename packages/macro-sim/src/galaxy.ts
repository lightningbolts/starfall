import { createRng } from "./rng.js";
import { generateSystemName } from "./names.js";
import type { FlavorSystem, RegionId, Vec2 } from "./types.js";

export interface GalaxyGenResult {
  sites: Vec2[];
  neighbors: RegionId[][];
  polygons: Vec2[][];
  ids: RegionId[];
}

/**
 * Sunflower sites + true local Voronoi cells (clip against many nearby sites,
 * not just game-graph kNN — otherwise cells overlap badly).
 */
export function generateRegionGalaxy(
  seed: number,
  regionCount: number,
): GalaxyGenResult {
  const rng = createRng(seed);
  const sites = placeSites(regionCount, rng);
  const ids = sites.map((_, i) => `r${i}`);
  const n = sites.length;
  const radius = Math.max(...sites.map((s) => Math.hypot(s.x, s.y)), 1);
  const extent = radius * 1.25;
  // Ghost sites outside the disc clip rim cells so they don't spike to the bbox
  const ghosts = ghostRing(radius * 1.38, Math.max(28, Math.floor(Math.sqrt(n) * 2.5)));

  const clipSets: number[][] = [];
  const polygons: Vec2[][] = [];
  for (let i = 0; i < n; i++) {
    const nearby = nearestIndices(sites, i, Math.min(48, n - 1));
    clipSets.push(nearby);
    const clipSites = [
      ...nearby.map((j) => sites[j]!),
      ...ghosts,
    ];
    const cell = voronoiCell(sites[i]!, clipSites, extent);
    polygons.push(insetPolygon(cell, sites[i]!, 0.045));
  }

  // Game adjacency: mutual near-neighbors among clip sets (planar dual approx)
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const local = clipSets[i]!.slice(0, Math.min(10, clipSets[i]!.length));
    for (const j of local) {
      if (j <= i) continue;
      if (!clipSets[j]!.includes(i)) continue;
      // Only link if cells are close enough to share a border
      if (!cellsLikelyAdjacent(polygons[i]!, polygons[j]!)) continue;
      adj[i]!.push(j);
      adj[j]!.push(i);
    }
  }
  ensureConnected(sites, adj);

  return {
    sites,
    neighbors: adj.map((ns) => ns.map((j) => ids[j]!)),
    polygons,
    ids,
  };
}

function placeSites(n: number, rng: () => number): Vec2[] {
  const sites: Vec2[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const radius = Math.sqrt(n) * 1.35;
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt((i + 0.5) / n);
    const theta = i * golden;
    const jit = 0.04 * radius * (1 / Math.sqrt(n));
    sites.push({
      x: r * Math.cos(theta) + (rng() - 0.5) * jit,
      y: r * Math.sin(theta) + (rng() - 0.5) * jit,
    });
  }
  return sites;
}

function ghostRing(radius: number, count: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    out.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
  }
  return out;
}

function nearestIndices(sites: Vec2[], i: number, k: number): number[] {
  const dists: { j: number; d: number }[] = [];
  const si = sites[i]!;
  for (let j = 0; j < sites.length; j++) {
    if (i === j) continue;
    const dx = si.x - sites[j]!.x;
    const dy = si.y - sites[j]!.y;
    dists.push({ j, d: dx * dx + dy * dy });
  }
  dists.sort((a, b) => a.d - b.d);
  // Prefer a distance cutoff so far sites don't get skipped when k is small
  const dRef = dists[Math.min(5, dists.length - 1)]!.d;
  const cutoff = dRef * 9; // ~3× local spacing
  const out: number[] = [];
  for (const item of dists) {
    if (out.length >= k) break;
    if (item.d <= cutoff || out.length < 8) out.push(item.j);
  }
  return out;
}

function cellsLikelyAdjacent(a: Vec2[], b: Vec2[]): boolean {
  // After inset, vertices no longer coincide — use site-edge proximity
  let minD = Infinity;
  for (const pa of a) {
    for (const pb of b) {
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      minD = Math.min(minD, dx * dx + dy * dy);
      if (minD < 0.08) return true;
    }
  }
  return false;
}

function ensureConnected(sites: Vec2[], adj: number[][]): void {
  const n = sites.length;
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of adj[u]!) {
      if (!seen[v]) {
        seen[v] = 1;
        stack.push(v);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (!seen[j]) continue;
      const dx = sites[i]!.x - sites[j]!.x;
      const dy = sites[i]!.y - sites[j]!.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) {
      adj[i]!.push(best);
      adj[best]!.push(i);
      const q = [i];
      seen[i] = 1;
      while (q.length) {
        const u = q.pop()!;
        for (const v of adj[u]!) {
          if (!seen[v]) {
            seen[v] = 1;
            q.push(v);
          }
        }
      }
    }
  }
}

/** Pull vertices slightly toward the site so borders read as thin gaps. */
function insetPolygon(poly: Vec2[], site: Vec2, t: number): Vec2[] {
  if (poly.length < 3) return poly;
  return poly.map((p) => ({
    x: p.x + (site.x - p.x) * t,
    y: p.y + (site.y - p.y) * t,
  }));
}

/** Clip a square bbox by half-planes closer to `site` than each neighbor. */
export function voronoiCell(
  site: Vec2,
  neighborSites: Vec2[],
  extent: number,
): Vec2[] {
  let poly: Vec2[] = [
    { x: site.x - extent, y: site.y - extent },
    { x: site.x + extent, y: site.y - extent },
    { x: site.x + extent, y: site.y + extent },
    { x: site.x - extent, y: site.y + extent },
  ];
  // Clip nearer neighbors first for numerical stability
  const ordered = [...neighborSites].sort((a, b) => {
    const da = (a.x - site.x) ** 2 + (a.y - site.y) ** 2;
    const db = (b.x - site.x) ** 2 + (b.y - site.y) ** 2;
    return da - db;
  });
  for (const other of ordered) {
    const mx = (site.x + other.x) / 2;
    const my = (site.y + other.y) / 2;
    const nx = other.x - site.x;
    const ny = other.y - site.y;
    poly = clipHalfPlane(poly, mx, my, nx, ny);
    if (poly.length < 3) break;
  }
  poly = ensureWindingCCW(poly);
  return poly.length >= 3 ? poly : softSquare(site, extent * 0.02);
}

function softSquare(site: Vec2, s: number): Vec2[] {
  return [
    { x: site.x - s, y: site.y - s },
    { x: site.x + s, y: site.y - s },
    { x: site.x + s, y: site.y + s },
    { x: site.x - s, y: site.y + s },
  ];
}

function ensureWindingCCW(poly: Vec2[]): Vec2[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? poly.reverse() : poly;
}

function clipHalfPlane(
  poly: Vec2[],
  mx: number,
  my: number,
  nx: number,
  ny: number,
): Vec2[] {
  if (poly.length === 0) return poly;
  const out: Vec2[] = [];
  const inside = (p: Vec2) => (p.x - mx) * nx + (p.y - my) * ny <= 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      out.push(intersect(prev, cur, mx, my, nx, ny));
    }
    if (curIn) out.push(cur);
  }
  return out;
}

function intersect(
  a: Vec2,
  b: Vec2,
  mx: number,
  my: number,
  nx: number,
  ny: number,
): Vec2 {
  const ax = a.x - mx;
  const ay = a.y - my;
  const bx = b.x - mx;
  const by = b.y - my;
  const da = ax * nx + ay * ny;
  const db = bx * nx + by * ny;
  const t = da / (da - db || 1e-12);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** On-demand flavor systems inside a region polygon (no persistent state). */
export function flavorSystems(
  seed: number,
  regionId: RegionId,
  site: Vec2,
  polygon: Vec2[],
  budget: number,
): FlavorSystem[] {
  const rng = createRng(seed ^ hashRegion(regionId));
  const count = Math.max(1, Math.min(budget, 3 + Math.floor(rng() * 5)));
  const out: FlavorSystem[] = [];
  for (let i = 0; i < count; i++) {
    const p = randomInPolygon(polygon, site, rng);
    out.push({
      name: generateSystemName(seed, regionId, i),
      x: p.x,
      y: p.y,
    });
  }
  return out;
}

function hashRegion(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomInPolygon(
  poly: Vec2[],
  fallback: Vec2,
  rng: () => number,
): Vec2 {
  if (poly.length < 3) {
    return {
      x: fallback.x + (rng() - 0.5) * 0.4,
      y: fallback.y + (rng() - 0.5) * 0.4,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (pointInPoly(x, y, poly)) return { x, y };
  }
  return {
    x: fallback.x + (rng() - 0.5) * 0.2,
    y: fallback.y + (rng() - 0.5) * 0.2,
  };
}

function pointInPoly(x: number, y: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
