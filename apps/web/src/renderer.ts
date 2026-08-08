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

const ROLE_RADIUS: Record<string, number> = {
  homeworld: 14,
  core_world: 12,
  resource: 11,
  shipyard: 12,
  relay: 9,
  relic: 13,
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
  zoom = 40;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private fleetLerp = new Map<FleetId, { x: number; y: number }>();

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
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  bindPanZoom(onClick: (nodeId: NodeId | null, shift: boolean) => void): void {
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      this.zoom = Math.min(120, Math.max(12, this.zoom * factor));
    }, { passive: false });

    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.classList.add("dragging");
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.camX += dx;
      this.camY += dy;
    });
    this.canvas.addEventListener("pointerup", (e) => {
      const moved =
        Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY) > 4;
      this.dragging = false;
      this.canvas.classList.remove("dragging");
      if (moved) return;
      const world = this.screenToWorld(e.clientX, e.clientY);
      onClick(this.hitNode(world.x, world.y), e.shiftKey);
    });
  }

  private layoutOf(id: NodeId, map: MatchStartMessage["map"]): { x: number; y: number } {
    return map.layout?.[id] ?? { x: 0, y: 0 };
  }

  centerOn(map: MatchStartMessage["map"], nodeId: NodeId): void {
    const p = this.layoutOf(nodeId, map);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camX = w / 2 - p.x * this.zoom;
    this.camY = h / 2 - p.y * this.zoom;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.camX) / this.zoom,
      y: (sy - rect.top - this.camY) / this.zoom,
    };
  }

  private hitNode(wx: number, wy: number): NodeId | null {
    // set by last draw — use pending hit test via lastRender
    return this.lastHit?.(wx, wy) ?? null;
  }

  private lastHit: ((wx: number, wy: number) => NodeId | null) | null = null;

  private ownerColor(ownerId: PlayerId | null, selfId: PlayerId, colors: Record<PlayerId, string>): string {
    if (!ownerId) return "#6b7585";
    if (ownerId === selfId) return "#e8a838";
    return colors[ownerId] ?? "#6b7585";
  }

  private nodeRadius(role: string, level: number): number {
    const base = ROLE_RADIUS[role] ?? 11;
    return base * (1 + 0.04 * Math.min(Math.max(level - 1, 0), 12));
  }

  draw(state: RenderState, dt: number): void {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Starfield
    ctx.fillStyle = "#07090d";
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.4, w * 0.7);
    g.addColorStop(0, "#1a223044");
    g.addColorStop(1, "#07090d00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.camX, this.camY);
    ctx.scale(this.zoom, this.zoom);

    const visible = new Set(state.view.visibleNodes);
    const nodes = state.view.nodes;
    const mapNodes = state.map.nodes;

    // Lanes
    const drawn = new Set<string>();
    for (const gn of Object.values(mapNodes)) {
      for (const n of gn.neighbors) {
        const key = gn.id < n ? `${gn.id}:${n}` : `${n}:${gn.id}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const a = this.layoutOf(gn.id, state.map);
        const b = this.layoutOf(n, state.map);
        const known =
          nodes[gn.id] !== undefined || nodes[n] !== undefined;
        if (!known) continue;
        const live = visible.has(gn.id) || visible.has(n);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = live ? "#3a4558" : "#151a22";
        ctx.lineWidth = 0.04;
        ctx.stroke();
      }
    }

    // Path preview
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
      const worldR = this.nodeRadius(role, level) / 40;

      hitCandidates.push({ id, x: pos.x, y: pos.y, r: worldR * 1.2 });

      const fill = ROLE_FILL[role] ?? "#6b7585";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
      ctx.fillStyle = fogged ? "#151a22" : fill;
      ctx.globalAlpha = fogged ? 0.55 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;

      const ring = this.ownerColor(ownerId, state.selfId, state.seatColors);
      ctx.strokeStyle = ring;
      ctx.lineWidth = 0.06;
      ctx.stroke();

      const pulse = state.ownershipPulse.get(id) ?? 0;
      if (pulse > 0) {
        ctx.strokeStyle = `rgba(245,242,234,${pulse})`;
        ctx.lineWidth = 0.1;
        ctx.stroke();
        state.ownershipPulse.set(id, Math.max(0, pulse - dt * 1.8));
      }

      // Undefended high-value (owner-only): L≥3, no friendly fleet
      if (
        !fogged &&
        ownerId === state.selfId &&
        level >= 3 &&
        !hasFriendlyFleetAt(state.view, state.selfId, id)
      ) {
        const dangerPulse = 0.35 + 0.35 * Math.sin(performance.now() / 400);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(196,92,74,${dangerPulse})`;
        ctx.lineWidth = 0.07;
        ctx.stroke();
      }

      if (state.selectedNode === id) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.12, 0, Math.PI * 2);
        ctx.strokeStyle = "#f0d080";
        ctx.lineWidth = 0.05;
        ctx.stroke();
      }

      // Level numeral
      ctx.fillStyle = fogged ? "#9aa3b2" : "#e6eaf0";
      ctx.font = `${Math.max(0.28, worldR * 0.85)}px "Source Sans 3", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(level), pos.x, pos.y + 0.02);

      // Role mark (simple glyph)
      ctx.font = `${worldR * 0.55}px "Source Sans 3", sans-serif`;
      ctx.fillStyle = fogged ? "#6b7585" : "#e6eaf0";
      ctx.fillText(roleGlyph(role), pos.x + worldR * 0.55, pos.y - worldR * 0.55);
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

    // Fleets
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
        const fan = (i - (group.length - 1) / 2) * 0.12;
        target.x += fan;
        target.y += fan * 0.4;
        let cur = this.fleetLerp.get(f.id);
        if (!cur) {
          cur = { ...target };
          this.fleetLerp.set(f.id, cur);
        } else {
          const k = Math.min(1, dt * 8);
          cur.x += (target.x - cur.x) * k;
          cur.y += (target.y - cur.y) * k;
        }
        const power =
          (f.composition.fighter ?? 0) * 10 +
          (f.composition.cruiser ?? 0) * 40 +
          (f.composition.battleship ?? 0) * 120;
        const size = 0.08 + Math.min(0.25, Math.sqrt(power) * 0.012);
        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y - size);
        ctx.lineTo(cur.x + size * 0.7, cur.y + size * 0.6);
        ctx.lineTo(cur.x - size * 0.7, cur.y + size * 0.6);
        ctx.closePath();
        ctx.fillStyle = this.ownerColor(f.ownerId, state.selfId, state.seatColors);
        ctx.fill();
        if (f.invasionPopulation) {
          ctx.beginPath();
          ctx.arc(cur.x + size, cur.y - size, 0.06, 0, Math.PI * 2);
          ctx.fillStyle = "#e8a838";
          ctx.fill();
        }
      });
    }

    // Cargo
    for (const c of Object.values(state.view.cargoShips)) {
      const p = fleetWorldPos(c, state.map, this.layoutOf.bind(this));
      const s = 0.1;
      ctx.fillStyle = "#7aafc4";
      ctx.fillRect(p.x - s, p.y - s * 0.6, s * 2, s * 1.2);
    }

    if (state.combatFlash > 0) {
      ctx.fillStyle = `rgba(245,242,234,${state.combatFlash * 0.25})`;
      ctx.fillRect(-100, -100, 200, 200);
      state.combatFlash = Math.max(0, state.combatFlash - dt * 4);
    }

    ctx.restore();
  }
}

function roleGlyph(role: string): string {
  switch (role) {
    case "homeworld":
      return "⌂";
    case "core_world":
      return "◎";
    case "resource":
      return "◈";
    case "shipyard":
      return "⚒";
    case "relay":
      return "⌁";
    case "relic":
      return "✧";
    default:
      return "·";
  }
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
  layoutOf: (id: NodeId, map: MatchStartMessage["map"]) => { x: number; y: number },
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
