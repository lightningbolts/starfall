import type {
  Fleet,
  FleetId,
  MatchStartMessage,
  NodeId,
  PlayerId,
  PlayerView,
  ViewNode,
} from "@starfall/sim";
import { isFoggedNode } from "@starfall/sim";

const ROLE_FILL: Record<string, string> = {
  homeworld: "#4a6fa5",
  core_world: "#3d8f6e",
  resource: "#c4a035",
  shipyard: "#8b5a9e",
  relay: "#6b7c8f",
  relic: "#d4c07a",
};

/** World-space node radii (layout units). */
const ROLE_RADIUS: Record<string, number> = {
  homeworld: 0.28,
  core_world: 0.24,
  resource: 0.22,
  shipyard: 0.24,
  relay: 0.18,
  relic: 0.26,
};

export interface RenderState {
  map: MatchStartMessage["map"];
  view: PlayerView;
  seatColors: Record<PlayerId, string>;
  selfId: PlayerId;
  selectedNode: NodeId | null;
  pathPreview: NodeId[];
  ownershipPulse: Map<NodeId, number>;
  combatFlash: number;
}

export class MapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  camX = 0;
  camY = 0;
  zoom = 48;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pointerMoved = false;
  private fleetLerp = new Map<FleetId, { x: number; y: number }>();
  private layoutCache: Record<string, { x: number; y: number }> | null = null;
  private lastHit: ((wx: number, wy: number) => NodeId | null) | null = null;
  private stars: { x: number; y: number; r: number; a: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.rebuildStars(w, h);
  }

  private rebuildStars(w: number, h: number): void {
    const out: { x: number; y: number; r: number; a: number }[] = [];
    let s = 0x9e3779b9;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0xffffffff;
    };
    const n = Math.floor((w * h) / 9000);
    for (let i = 0; i < n; i++) {
      out.push({
        x: rand() * w,
        y: rand() * h,
        r: rand() < 0.15 ? 1.4 : 0.7,
        a: 0.25 + rand() * 0.55,
      });
    }
    this.stars = out;
  }

  bindPanZoom(onClick: (nodeId: NodeId | null, shift: boolean) => void): void {
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.zoom = Math.min(140, Math.max(18, this.zoom * factor));
        // Zoom toward cursor
        const after = this.screenToWorld(e.clientX, e.clientY);
        this.camX += (after.x - world.x) * this.zoom;
        this.camY += (after.y - world.y) * this.zoom;
      },
      { passive: false },
    );

    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.pointerMoved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.classList.add("dragging");
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.hypot(dx, dy) > 3) this.pointerMoved = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.camX += dx;
      this.camY += dy;
    });
    this.canvas.addEventListener("pointerup", (e) => {
      this.dragging = false;
      this.canvas.classList.remove("dragging");
      if (this.pointerMoved) return;
      const world = this.screenToWorld(e.clientX, e.clientY);
      onClick(this.hitNode(world.x, world.y), e.shiftKey);
    });
  }

  private layoutOf(
    id: NodeId,
    map: MatchStartMessage["map"],
  ): { x: number; y: number } {
    if (map.layout?.[id]) return map.layout[id]!;
    if (!this.layoutCache) this.layoutCache = synthesizeLayout(map);
    return this.layoutCache[id] ?? { x: 0, y: 0 };
  }

  setMap(map: MatchStartMessage["map"]): void {
    this.layoutCache = null;
    if (!map.layout || Object.keys(map.layout).length < 2) {
      map.layout = synthesizeLayout(map);
    }
  }

  /** Frame a set of node ids (visible neighborhood). */
  fitNodes(map: MatchStartMessage["map"], nodeIds: NodeId[]): void {
    const pts = nodeIds
      .map((id) => this.layoutOf(id, map))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length === 0) {
      this.fitMap(map);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    // Pad so a single node still has room
    const pad = 1.2;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const spanX = Math.max(maxX - minX, 0.5);
    const spanY = Math.max(maxY - minY, 0.5);
    this.zoom = Math.min(
      90,
      Math.max(28, Math.min((w * 0.75) / spanX, (h * 0.75) / spanY)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.camX = w / 2 - cx * this.zoom;
    this.camY = h / 2 - cy * this.zoom;
  }

  fitMap(map: MatchStartMessage["map"]): void {
    this.fitNodes(map, Object.keys(map.nodes));
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.camX) / this.zoom,
      y: (sy - rect.top - this.camY) / this.zoom,
    };
  }

  private hitNode(wx: number, wy: number): NodeId | null {
    return this.lastHit?.(wx, wy) ?? null;
  }

  private ownerColor(
    ownerId: PlayerId | null,
    selfId: PlayerId,
    colors: Record<PlayerId, string>,
  ): string {
    if (!ownerId) return "#6b7585";
    if (ownerId === selfId) return "#e8a838";
    return colors[ownerId] ?? "#6b7585";
  }

  private nodeRadius(role: string, level: number): number {
    const base = ROLE_RADIUS[role] ?? 0.22;
    return base * (1 + 0.04 * Math.min(Math.max(level - 1, 0), 12));
  }

  draw(state: RenderState, dt: number): void {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#07090d";
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(
      w * 0.5,
      h * 0.38,
      0,
      w * 0.5,
      h * 0.38,
      Math.max(w, h) * 0.65,
    );
    g.addColorStop(0, "#1a223055");
    g.addColorStop(0.55, "#0c101822");
    g.addColorStop(1, "#07090d00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (const star of this.stars) {
      ctx.fillStyle = `rgba(220,230,245,${star.a})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle combat flash in screen space (not a full white wipe)
    if (state.combatFlash > 0) {
      ctx.fillStyle = `rgba(245,242,234,${state.combatFlash * 0.08})`;
      ctx.fillRect(0, 0, w, h);
      state.combatFlash = Math.max(0, state.combatFlash - dt * 2.5);
    }

    ctx.save();
    ctx.translate(this.camX, this.camY);
    ctx.scale(this.zoom, this.zoom);

    const visible = new Set(state.view.visibleNodes);
    const nodes = state.view.nodes;
    const mapNodes = state.map.nodes;
    const neighborSet = new Set<NodeId>();
    if (state.selectedNode) {
      for (const n of mapNodes[state.selectedNode]?.neighbors ?? []) {
        neighborSet.add(n);
      }
    }

    // Lanes between known nodes
    const drawn = new Set<string>();
    for (const gn of Object.values(mapNodes)) {
      for (const n of gn.neighbors) {
        const key = gn.id < n ? `${gn.id}:${n}` : `${n}:${gn.id}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        if (nodes[gn.id] === undefined && nodes[n] === undefined) continue;
        const a = this.layoutOf(gn.id, state.map);
        const b = this.layoutOf(n, state.map);
        const live = visible.has(gn.id) || visible.has(n);
        const fromSel =
          state.selectedNode === gn.id || state.selectedNode === n;
        const toNeighbor =
          (state.selectedNode === gn.id && neighborSet.has(n)) ||
          (state.selectedNode === n && neighborSet.has(gn.id));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (toNeighbor) {
          ctx.strokeStyle = "#7a8aa0";
          ctx.lineWidth = 0.07;
        } else if (fromSel) {
          ctx.strokeStyle = "#4a5568";
          ctx.lineWidth = 0.05;
        } else {
          ctx.strokeStyle = live ? "#3a4558" : "#1a2230";
          ctx.lineWidth = 0.04;
        }
        ctx.stroke();
      }
    }

    if (state.pathPreview.length >= 2) {
      ctx.beginPath();
      for (let i = 0; i < state.pathPreview.length; i++) {
        const p = this.layoutOf(state.pathPreview[i]!, state.map);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "#f0d080";
      ctx.lineWidth = 0.08;
      ctx.stroke();
    }

    const hitCandidates: { id: NodeId; x: number; y: number; r: number }[] = [];

    for (const [id, vn] of Object.entries(nodes) as [NodeId, ViewNode][]) {
      const gn = mapNodes[id];
      if (!gn) continue;
      const pos = this.layoutOf(id, state.map);
      const fogged = isFoggedNode(vn);
      const role = fogged ? vn.role : gn.role;
      const level = fogged ? vn.level : vn.level;
      const ownerId = fogged ? vn.ownerId : vn.ownerId;
      const worldR = this.nodeRadius(role, level);

      hitCandidates.push({ id, x: pos.x, y: pos.y, r: worldR * 1.45 });

      const fill = ROLE_FILL[role] ?? "#6b7585";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
      ctx.fillStyle = fogged ? "#151a22" : fill;
      ctx.globalAlpha = fogged ? 0.55 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;

      const ring = this.ownerColor(ownerId, state.selfId, state.seatColors);
      ctx.strokeStyle = ring;
      ctx.lineWidth = ownerId === state.selfId ? 0.07 : 0.045;
      ctx.stroke();

      if (neighborSet.has(id) && state.selectedNode !== id) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(240,208,128,0.55)";
        ctx.lineWidth = 0.035;
        ctx.stroke();
      }

      const pulse = state.ownershipPulse.get(id) ?? 0;
      if (pulse > 0) {
        ctx.strokeStyle = `rgba(245,242,234,${pulse})`;
        ctx.lineWidth = 0.08;
        ctx.stroke();
        state.ownershipPulse.set(id, Math.max(0, pulse - dt * 1.8));
      }

      if (
        !fogged &&
        ownerId === state.selfId &&
        level >= 3 &&
        !hasFriendlyFleetAt(state.view, state.selfId, id)
      ) {
        const dangerPulse = 0.35 + 0.35 * Math.sin(performance.now() / 400);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.06, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(196,92,74,${dangerPulse})`;
        ctx.lineWidth = 0.05;
        ctx.stroke();
      }

      if (state.selectedNode === id) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.12, 0, Math.PI * 2);
        ctx.strokeStyle = "#f0d080";
        ctx.lineWidth = 0.05;
        ctx.stroke();
      }

      ctx.fillStyle = fogged ? "#9aa3b2" : "#e6eaf0";
      ctx.font = `600 ${Math.max(0.18, worldR * 0.85)}px "Source Sans 3", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(level), pos.x, pos.y + worldR * 0.08);

      drawRoleIcon(ctx, role, pos.x + worldR * 0.62, pos.y - worldR * 0.55, worldR * 0.38, fogged);
    }

    this.lastHit = (wx, wy) => {
      let best: NodeId | null = null;
      let bestD = Infinity;
      for (const c of hitCandidates) {
        const d = Math.hypot(wx - c.x, wy - c.y);
        if (d <= c.r && d < bestD) {
          bestD = d;
          best = c.id;
        }
      }
      return best;
    };

    const fleetGroups = new Map<string, Fleet[]>();
    for (const f of Object.values(state.view.fleets)) {
      const key = fleetKey(f);
      const arr = fleetGroups.get(key) ?? [];
      arr.push(f);
      fleetGroups.set(key, arr);
    }
    for (const group of fleetGroups.values()) {
      group.forEach((f, i) => {
        const target = fleetWorldPos(f, state.map, this.layoutOf.bind(this));
        const fan = (i - (group.length - 1) / 2) * 0.14;
        target.x += fan;
        target.y += fan * 0.45;
        // Offset fleets slightly off the node center so the circle stays readable
        if (f.location.kind === "node") {
          target.y += 0.28;
        }
        let cur = this.fleetLerp.get(f.id);
        if (!cur) {
          cur = { ...target };
          this.fleetLerp.set(f.id, cur);
        }
        cur.x += (target.x - cur.x) * Math.min(1, dt * 8);
        cur.y += (target.y - cur.y) * Math.min(1, dt * 8);
        const power = Object.entries(f.composition).reduce((sum, [t, n]) => {
          const p =
            t === "battleship" ? 120 : t === "cruiser" ? 40 : 10;
          return sum + (n ?? 0) * p;
        }, 0);
        const size = Math.min(0.2, 0.08 + Math.sqrt(Math.max(power, 1)) * 0.012);
        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y - size);
        ctx.lineTo(cur.x + size * 0.9, cur.y + size * 0.75);
        ctx.lineTo(cur.x - size * 0.9, cur.y + size * 0.75);
        ctx.closePath();
        ctx.fillStyle = this.ownerColor(f.ownerId, state.selfId, state.seatColors);
        ctx.fill();
        ctx.strokeStyle = "rgba(7,9,13,0.55)";
        ctx.lineWidth = 0.02;
        ctx.stroke();
        if (f.invasionPopulation) {
          ctx.beginPath();
          ctx.arc(cur.x + size * 0.95, cur.y - size * 0.7, 0.055, 0, Math.PI * 2);
          ctx.fillStyle = "#e8a838";
          ctx.fill();
        }
        if (power > 0 && this.zoom >= 32) {
          ctx.fillStyle = "#e6eaf0";
          ctx.font = `600 ${Math.max(0.12, size * 0.95)}px "Source Sans 3", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(String(power), cur.x, cur.y + size * 0.85);
        }
      });
    }

    for (const c of Object.values(state.view.cargoShips)) {
      const p = fleetWorldPos(c, state.map, this.layoutOf.bind(this));
      const s = 0.09;
      ctx.fillStyle = "#7aafc4";
      ctx.fillRect(p.x - s, p.y - s * 0.55, s * 2, s * 1.1);
      ctx.strokeStyle = "rgba(7,9,13,0.45)";
      ctx.lineWidth = 0.02;
      ctx.strokeRect(p.x - s, p.y - s * 0.55, s * 2, s * 1.1);
    }

    ctx.restore();
  }
}

function drawRoleIcon(
  ctx: CanvasRenderingContext2D,
  role: string,
  x: number,
  y: number,
  r: number,
  fogged: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = fogged ? "#6b7585" : "#e6eaf0";
  ctx.fillStyle = fogged ? "#6b7585" : "#e6eaf0";
  ctx.lineWidth = Math.max(0.025, r * 0.18);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (role) {
    case "homeworld": {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 0);
      ctx.lineTo(0, -r * 0.75);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(r * 0.7, r * 0.65);
      ctx.lineTo(-r * 0.7, r * 0.65);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "core_world": {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "resource": {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.75);
      ctx.lineTo(r * 0.65, 0);
      ctx.lineTo(0, r * 0.75);
      ctx.lineTo(-r * 0.65, 0);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "shipyard": {
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.55);
      ctx.lineTo(r * 0.55, r * 0.55);
      ctx.moveTo(r * 0.55, -r * 0.55);
      ctx.lineTo(-r * 0.55, r * 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "relay": {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.7);
      ctx.lineTo(0, -r * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.35, r * 0.35, Math.PI * 0.15, Math.PI * 0.85, true);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.35, r * 0.6, Math.PI * 0.25, Math.PI * 0.75, true);
      ctx.stroke();
      break;
    }
    case "relic": {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function fleetKey(f: Fleet): string {
  if (f.location.kind === "node") return `n:${f.location.nodeId}`;
  return `t:${f.location.from}:${f.location.to}`;
}

function hasFriendlyFleetAt(
  view: PlayerView,
  selfId: PlayerId,
  nodeId: NodeId,
): boolean {
  for (const f of Object.values(view.fleets)) {
    if (f.ownerId !== selfId) continue;
    if (f.location.kind === "node" && f.location.nodeId === nodeId) return true;
  }
  return false;
}

function fleetWorldPos(
  f: { location: Fleet["location"] },
  map: MatchStartMessage["map"],
  layoutOf: (
    id: NodeId,
    map: MatchStartMessage["map"],
  ) => { x: number; y: number },
): { x: number; y: number } {
  if (f.location.kind === "node") {
    return { ...layoutOf(f.location.nodeId, map) };
  }
  const a = layoutOf(f.location.from, map);
  const b = layoutOf(f.location.to, map);
  const total = Math.max(1, f.location.hopTotalTicks);
  const t = 1 - f.location.ticksRemaining / total;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Spread nodes on a large ring — never stack at origin. */
function synthesizeLayout(
  map: MatchStartMessage["map"],
): Record<string, { x: number; y: number }> {
  const ids = Object.keys(map.nodes).sort();
  const n = Math.max(ids.length, 1);
  const radius = Math.max(4, Math.sqrt(n) * 1.8);
  const out: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < ids.length; i++) {
    const angle = (2 * Math.PI * i) / n;
    out[ids[i]!] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  return out;
}
