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
  homeworld: 0.32,
  core_world: 0.26,
  resource: 0.24,
  shipyard: 0.27,
  relay: 0.2,
  relic: 0.3,
};

const SHIP_POWER: Record<string, number> = {
  fighter: 10,
  cruiser: 40,
  battleship: 120,
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
  /** World positions that just fought — spawn particles. */
  combatBursts?: { x: number; y: number }[];
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  layer: 0 | 1 | 2;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
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
  private stars: Star[] = [];
  private dust: { x: number; y: number; r: number; a: number }[] = [];
  private hoverNode: NodeId | null = null;
  private particles: Particle[] = [];
  private ringWash = new Map<NodeId, { from: string; to: string; t: number }>();
  private lastOwner = new Map<NodeId, PlayerId | null>();
  private animT = 0;

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
    let s = 0x9e3779b9;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0xffffffff;
    };
    const stars: Star[] = [];
    const n = Math.floor((w * h) / 4200);
    for (let i = 0; i < n; i++) {
      const layer = (rand() < 0.55 ? 0 : rand() < 0.7 ? 1 : 2) as 0 | 1 | 2;
      stars.push({
        x: rand() * w,
        y: rand() * h,
        r: layer === 0 ? 0.55 + rand() * 0.5 : layer === 1 ? 0.9 + rand() * 0.7 : 1.3 + rand(),
        a: layer === 0 ? 0.2 + rand() * 0.35 : layer === 1 ? 0.35 + rand() * 0.4 : 0.5 + rand() * 0.4,
        layer,
      });
    }
    this.stars = stars;

    const dust: { x: number; y: number; r: number; a: number }[] = [];
    for (let i = 0; i < 28; i++) {
      dust.push({
        x: rand() * w,
        y: rand() * h,
        r: 40 + rand() * 120,
        a: 0.015 + rand() * 0.03,
      });
    }
    this.dust = dust;
  }

  bindPanZoom(onClick: (nodeId: NodeId | null, shift: boolean) => void): void {
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.zoom = Math.min(160, Math.max(16, this.zoom * factor));
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
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        if (Math.hypot(dx, dy) > 3) this.pointerMoved = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.camX += dx;
        this.camY += dy;
        return;
      }
      const world = this.screenToWorld(e.clientX, e.clientY);
      this.hoverNode = this.hitNode(world.x, world.y);
      this.canvas.style.cursor = this.hoverNode ? "pointer" : "grab";
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverNode = null;
    });
    this.canvas.addEventListener("pointerup", (e) => {
      this.dragging = false;
      this.canvas.classList.remove("dragging");
      this.canvas.style.cursor = this.hoverNode ? "pointer" : "grab";
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
    this.ringWash.clear();
    this.lastOwner.clear();
    this.fleetLerp.clear();
    this.particles = [];
    if (!map.layout || Object.keys(map.layout).length < 2) {
      map.layout = synthesizeLayout(map);
    }
  }

  /** Frame a set of node ids (visible neighborhood), leaving HUD gutters. */
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
    // Always leave breathing room so a 1–2 node start doesn't fill the screen
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const pad = Math.min(2.2, Math.max(1.4, 180 / Math.max(w, 1)));
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const spanX = Math.max(maxX - minX, 3.2);
    const spanY = Math.max(maxY - minY, 3.2);
    // Leave room for top HUD + bottom strip; prefer readable node size
    this.zoom = Math.min(
      90,
      Math.max(42, Math.min((w * 0.7) / spanX, (h * 0.55) / spanY)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.camX = w / 2 - cx * this.zoom;
    this.camY = h * 0.44 - cy * this.zoom;
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
    const base = ROLE_RADIUS[role] ?? 0.24;
    return base * (1 + 0.04 * Math.min(Math.max(level - 1, 0), 12));
  }

  /** Keep nodes readable when the camera is zoomed out. */
  private screenRadius(role: string, level: number): number {
    const world = this.nodeRadius(role, level);
    const minWorld = 14 / Math.max(this.zoom, 1);
    return Math.max(world, minWorld);
  }

  private spawnBurst(x: number, y: number, n = 14): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = 0.4 + Math.random() * 1.2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.25,
        max: 0.55,
      });
    }
  }

  draw(state: RenderState, dt: number): void {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.animT += dt;

    if (state.combatBursts?.length) {
      for (const b of state.combatBursts) this.spawnBurst(b.x, b.y);
      state.combatBursts.length = 0;
    }

    ctx.clearRect(0, 0, w, h);

    // Void + soft dust clouds (screen space, slight parallax)
    ctx.fillStyle = "#07090d";
    ctx.fillRect(0, 0, w, h);

    const px = (-this.camX * 0.02) % w;
    const py = (-this.camY * 0.02) % h;
    for (const d of this.dust) {
      const dx = ((d.x + px) % w + w) % w;
      const dy = ((d.y + py) % h + h) % h;
      const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, d.r);
      g.addColorStop(0, `rgba(26,34,48,${d.a})`);
      g.addColorStop(1, "rgba(7,9,13,0)");
      ctx.fillStyle = g;
      ctx.fillRect(dx - d.r, dy - d.r, d.r * 2, d.r * 2);
    }

    const vignette = ctx.createRadialGradient(
      w * 0.5,
      h * 0.42,
      0,
      w * 0.5,
      h * 0.42,
      Math.max(w, h) * 0.72,
    );
    vignette.addColorStop(0, "#1a223040");
    vignette.addColorStop(0.5, "#0c101818");
    vignette.addColorStop(1, "#07090d00");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Parallax star layers
    for (const star of this.stars) {
      const factor = star.layer === 0 ? 0.04 : star.layer === 1 ? 0.08 : 0.14;
      const sx = ((star.x - this.camX * factor) % w + w) % w;
      const sy = ((star.y - this.camY * factor) % h + h) % h;
      const twinkle =
        star.layer === 2
          ? 0.85 + 0.15 * Math.sin(this.animT * 1.7 + star.x * 0.01)
          : 1;
      ctx.fillStyle = `rgba(220,230,245,${star.a * twinkle})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.combatFlash > 0) {
      ctx.fillStyle = `rgba(245,242,234,${state.combatFlash * 0.1})`;
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

    // Track ownership washes
    for (const [id, vn] of Object.entries(nodes) as [NodeId, ViewNode][]) {
      const ownerId = vn.ownerId;
      const prev = this.lastOwner.get(id);
      if (prev !== undefined && prev !== ownerId) {
        const from = this.ownerColor(prev, state.selfId, state.seatColors);
        const to = this.ownerColor(ownerId, state.selfId, state.seatColors);
        this.ringWash.set(id, { from, to, t: 0 });
      }
      this.lastOwner.set(id, ownerId);
    }

    // Lanes — including faint ghosts into unexplored space from known nodes
    const drawn = new Set<string>();
    for (const gn of Object.values(mapNodes)) {
      for (const n of gn.neighbors) {
        const key = gn.id < n ? `${gn.id}:${n}` : `${n}:${gn.id}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const knowsA = nodes[gn.id] !== undefined;
        const knowsB = nodes[n] !== undefined;
        // Ghost stub: one end known, other unexplored
        const ghostStub = knowsA !== knowsB;
        if (!knowsA && !knowsB) continue;
        const a = this.layoutOf(gn.id, state.map);
        const b = this.layoutOf(n, state.map);
        const live = visible.has(gn.id) || visible.has(n);
        const toNeighbor =
          (state.selectedNode === gn.id && neighborSet.has(n)) ||
          (state.selectedNode === n && neighborSet.has(gn.id));

        if (toNeighbor || live) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = toNeighbor
            ? "rgba(240,208,128,0.18)"
            : "rgba(58,69,88,0.35)";
          ctx.lineWidth = toNeighbor ? 0.14 : 0.1;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (toNeighbor) {
          ctx.strokeStyle = "#c4b070";
          ctx.lineWidth = 0.065;
        } else if (live && knowsA && knowsB) {
          ctx.strokeStyle = "#3a4558";
          ctx.lineWidth = 0.045;
        } else if (ghostStub) {
          ctx.strokeStyle = "rgba(26,34,48,0.85)";
          ctx.lineWidth = 0.03;
          ctx.setLineDash([0.06, 0.1]);
        } else {
          ctx.strokeStyle = "#1a2230";
          ctx.lineWidth = 0.035;
          ctx.setLineDash([0.08, 0.1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
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
      ctx.strokeStyle = "rgba(240,208,128,0.35)";
      ctx.lineWidth = 0.16;
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < state.pathPreview.length; i++) {
        const p = this.layoutOf(state.pathPreview[i]!, state.map);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "#f0d080";
      ctx.lineWidth = 0.07;
      ctx.stroke();
    }

    const hitCandidates: { id: NodeId; x: number; y: number; r: number }[] = [];

    // Nodes
    for (const [id, vn] of Object.entries(nodes) as [NodeId, ViewNode][]) {
      const gn = mapNodes[id];
      if (!gn) continue;
      const pos = this.layoutOf(id, state.map);
      const fogged = isFoggedNode(vn);
      const role = fogged ? vn.role : gn.role;
      const level = fogged ? vn.level : vn.level;
      const ownerId = fogged ? vn.ownerId : vn.ownerId;
      const worldR = this.screenRadius(role, level);
      const isSel = state.selectedNode === id;
      const isHover = this.hoverNode === id;
      const isNeighbor = neighborSet.has(id) && !isSel;

      hitCandidates.push({ id, x: pos.x, y: pos.y, r: worldR * 1.5 });

      // Selection / neighbor halo
      if (isSel || isNeighbor || isHover) {
        ctx.beginPath();
        ctx.arc(
          pos.x,
          pos.y,
          worldR + (isSel ? 0.18 : isNeighbor ? 0.14 : 0.1),
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = isSel
          ? "rgba(240,208,128,0.55)"
          : isNeighbor
            ? "rgba(240,208,128,0.4)"
            : "rgba(230,234,240,0.25)";
        ctx.lineWidth = isSel ? 0.06 : 0.04;
        ctx.stroke();
      }

      const fill = darken(ROLE_FILL[role] ?? "#6b7585", fogged ? 0.45 : 0.12);
      // Soft body glow for live owned nodes
      if (!fogged && ownerId === state.selfId) {
        const glow = ctx.createRadialGradient(
          pos.x,
          pos.y,
          worldR * 0.2,
          pos.x,
          pos.y,
          worldR * 1.8,
        );
        glow.addColorStop(0, "rgba(232,168,56,0.12)");
        glow.addColorStop(1, "rgba(232,168,56,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
      ctx.fillStyle = fogged ? "#151a22" : fill;
      ctx.globalAlpha = fogged ? 0.58 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Inner highlight disc
      if (!fogged) {
        const hi = ctx.createRadialGradient(
          pos.x - worldR * 0.25,
          pos.y - worldR * 0.3,
          0,
          pos.x,
          pos.y,
          worldR,
        );
        hi.addColorStop(0, "rgba(255,255,255,0.16)");
        hi.addColorStop(0.55, "rgba(255,255,255,0.04)");
        hi.addColorStop(1, "rgba(0,0,0,0.2)");
        ctx.fillStyle = hi;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ownership ring (with wash)
      let ring = this.ownerColor(ownerId, state.selfId, state.seatColors);
      const wash = this.ringWash.get(id);
      if (wash) {
        wash.t = Math.min(1, wash.t + dt / 0.4);
        ring = mixHex(wash.from, wash.to, wash.t);
        if (wash.t >= 1) this.ringWash.delete(id);
      }
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
      ctx.strokeStyle = ring;
      ctx.lineWidth = ownerId === state.selfId ? 0.085 : 0.05;
      ctx.stroke();

      const pulse = state.ownershipPulse.get(id) ?? 0;
      if (pulse > 0) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.06 * (1 - pulse), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(245,242,234,${pulse * 0.9})`;
        ctx.lineWidth = 0.09;
        ctx.stroke();
        state.ownershipPulse.set(id, Math.max(0, pulse - dt * 1.6));
      }

      if (
        !fogged &&
        ownerId === state.selfId &&
        level >= 3 &&
        !hasFriendlyFleetAt(state.view, state.selfId, id)
      ) {
        const dangerPulse = 0.3 + 0.35 * Math.sin(this.animT * 4);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(196,92,74,${dangerPulse})`;
        ctx.lineWidth = 0.055;
        ctx.stroke();
      }

      if (isSel) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.14, 0, Math.PI * 2);
        ctx.strokeStyle = "#f0d080";
        ctx.lineWidth = 0.045;
        ctx.stroke();
      }

      // Level numeral — screen-space minimum ~9px
      const fontWorld = Math.max(9 / this.zoom, worldR * 0.78);
      ctx.fillStyle = fogged ? "#9aa3b2" : "#e6eaf0";
      ctx.font = `700 ${fontWorld}px "Source Sans 3", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(level), pos.x, pos.y + worldR * 0.06);

      const iconR = Math.min(Math.max(worldR * 0.36, 0.08), 0.16);
      drawRoleIcon(
        ctx,
        role,
        pos.x + worldR * 0.68,
        pos.y - worldR * 0.62,
        iconR,
        fogged,
      );
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
        const target = fleetWorldPos(f, state.map, (id, m) =>
          this.layoutOf(id, m),
        );
        const fan = (i - (group.length - 1) / 2) * 0.16;
        target.x += fan;
        target.y += fan * 0.4;
        if (f.location.kind === "node") {
          target.y += 0.34;
        }
        let cur = this.fleetLerp.get(f.id);
        if (!cur) {
          cur = { ...target };
          this.fleetLerp.set(f.id, cur);
        }
        cur.x += (target.x - cur.x) * Math.min(1, dt * 9);
        cur.y += (target.y - cur.y) * Math.min(1, dt * 9);

        const power = fleetPowerOf(f);
        const size = Math.min(0.22, 0.09 + Math.sqrt(Math.max(power, 1)) * 0.013);
        const color = this.ownerColor(f.ownerId, state.selfId, state.seatColors);

        // Soft shadow
        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y - size);
        ctx.lineTo(cur.x + size * 0.95, cur.y + size * 0.78);
        ctx.lineTo(cur.x - size * 0.95, cur.y + size * 0.78);
        ctx.closePath();
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y - size);
        ctx.lineTo(cur.x + size * 0.9, cur.y + size * 0.72);
        ctx.lineTo(cur.x - size * 0.9, cur.y + size * 0.72);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(7,9,13,0.65)";
        ctx.lineWidth = 0.022;
        ctx.stroke();

        // Tier ticks
        const fN = f.composition.fighter ?? 0;
        const cN = f.composition.cruiser ?? 0;
        const bN = f.composition.battleship ?? 0;
        if (fN + cN + bN > 0 && this.zoom >= 36) {
          const ticks = [
            fN > 0 ? "#b8c4d4" : null,
            cN > 0 ? "#7aafc4" : null,
            bN > 0 ? "#e8a838" : null,
          ].filter(Boolean) as string[];
          ticks.forEach((col, ti) => {
            const tx = cur!.x - size * 0.35 + ti * size * 0.35;
            const ty = cur!.y + size * 0.35;
            ctx.fillStyle = col;
            ctx.fillRect(tx, ty, size * 0.18, size * 0.08);
          });
        }

        if (f.invasionPopulation) {
          ctx.beginPath();
          ctx.arc(cur.x + size * 0.95, cur.y - size * 0.65, 0.06, 0, Math.PI * 2);
          ctx.fillStyle = "#e8a838";
          ctx.fill();
          ctx.strokeStyle = "#07090d";
          ctx.lineWidth = 0.015;
          ctx.stroke();
        }

        if (power > 0 && this.zoom >= 28) {
          const label = String(power);
          const fs = Math.max(0.11, size * 0.9);
          ctx.font = `700 ${fs}px "Source Sans 3", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "rgba(7,9,13,0.55)";
          ctx.fillText(label, cur.x + 0.01, cur.y + size * 0.88 + 0.01);
          ctx.fillStyle = "#e6eaf0";
          ctx.fillText(label, cur.x, cur.y + size * 0.88);
        }
      });
    }

    // Cargo
    for (const c of Object.values(state.view.cargoShips)) {
      const p = fleetWorldPos(c, state.map, (id, m) => this.layoutOf(id, m));
      if (c.location.kind === "node") p.y += 0.28;
      const band = Math.min(1, c.cargoCredits / 40);
      const s = 0.08 + band * 0.05;
      // Capsule
      ctx.beginPath();
      roundRect(ctx, p.x - s * 1.15, p.y - s * 0.55, s * 2.3, s * 1.1, s * 0.45);
      ctx.fillStyle = "#7aafc4";
      ctx.fill();
      ctx.strokeStyle = "rgba(7,9,13,0.5)";
      ctx.lineWidth = 0.02;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(p.x - s * 0.7, p.y - s * 0.2, s * 1.4, s * 0.18);
    }

    // Particles (world space)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const a = p.life / p.max;
      ctx.fillStyle = `rgba(245,242,234,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.04 * a, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function fleetPowerOf(f: Fleet): number {
  let p = 0;
  for (const [t, n] of Object.entries(f.composition)) {
    p += (n ?? 0) * (SHIP_POWER[t] ?? 10);
  }
  return p;
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const f = 1 - amount;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${m(A.r, B.r)},${m(A.g, B.g)},${m(A.b, B.b)})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  if (hex.startsWith("rgb")) {
    const m = hex.match(/(\d+)/g);
    if (m && m.length >= 3) {
      return { r: Number(m[0]), g: Number(m[1]), b: Number(m[2]) };
    }
  }
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
  // Badge disc behind icon for contrast
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.fillStyle = fogged ? "rgba(21,26,34,0.85)" : "rgba(7,9,13,0.55)";
  ctx.fill();
  ctx.strokeStyle = fogged ? "#6b7585" : "#e6eaf0";
  ctx.fillStyle = fogged ? "#6b7585" : "#e6eaf0";
  ctx.lineWidth = Math.max(0.02, r * 0.16);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (role) {
    case "homeworld": {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 0.05);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(r * 0.7, 0.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-r * 0.42, 0.05, r * 0.84, r * 0.55);
      ctx.stroke();
      break;
    }
    case "core_world": {
      ctx.beginPath();
      ctx.arc(-r * 0.28, -r * 0.15, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.32, -r * 0.1, r * 0.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, r * 0.55);
      ctx.quadraticCurveTo(-r * 0.28, r * 0.15, r * 0.05, r * 0.55);
      ctx.moveTo(r * 0.05, r * 0.55);
      ctx.quadraticCurveTo(r * 0.35, r * 0.2, r * 0.7, r * 0.55);
      ctx.stroke();
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
      ctx.moveTo(-r * 0.15, -r * 0.7);
      ctx.lineTo(-r * 0.15, r * 0.15);
      ctx.lineTo(-r * 0.55, r * 0.55);
      ctx.moveTo(-r * 0.15, r * 0.15);
      ctx.lineTo(r * 0.55, r * 0.55);
      ctx.moveTo(r * 0.1, -r * 0.55);
      ctx.lineTo(r * 0.55, -r * 0.15);
      ctx.stroke();
      break;
    }
    case "relay": {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.7);
      ctx.lineTo(0, -r * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.32, Math.PI * 0.2, Math.PI * 0.8, true);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.55, Math.PI * 0.28, Math.PI * 0.72, true);
      ctx.stroke();
      break;
    }
    case "relic": {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15);
        ctx.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
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
