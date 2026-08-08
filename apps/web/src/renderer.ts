import type {
  CargoShip,
  Fleet,
  FleetId,
  MatchStartMessage,
  NodeId,
  PlayerId,
  PlayerView,
  ViewNode,
} from "@starfall/sim";
import { isFoggedNode } from "@starfall/sim";

const PALETTE = {
  void: "#07090d",
  dust: "#1a2230",
  lane: "#3a4558",
  cargo: "#7aafc4",
  unowned: "#6b7585",
  fogGhost: "#151a22",
  self: "#e8a838",
  focus: "#f0d080",
  danger: "#c45c4a",
  flash: "#f5f2ea",
  text: "#e6eaf0",
  textDim: "#9aa3b2",
} as const;

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
  homeworld: 0.34,
  core_world: 0.27,
  resource: 0.25,
  shipyard: 0.29,
  relay: 0.21,
  relic: 0.31,
};

const SHIP_POWER: Record<string, number> = {
  fighter: 12,
  cruiser: 40,
  battleship: 90,
};

/**
 * Knowledge tiers, per visuals.md. Topology is public (the server ships the
 * whole map at match start), so unexplored systems render as dim ghosts rather
 * than nothing at all.
 */
type Tier = "unexplored" | "explored" | "visible";

/** Detail drops out as the camera pulls back so 300-node maps stay readable. */
const ZOOM_ICONS = 30;
const ZOOM_NUMERALS = 20;
const ZOOM_FLEET_LABELS = 34;

export interface RenderState {
  map: MatchStartMessage["map"];
  view: PlayerView;
  seatColors: Record<PlayerId, string>;
  selfId: PlayerId;
  selectedNode: NodeId | null;
  /** Multi-select fleets (own). */
  selectedFleetIds: Set<string>;
  pathPreview: NodeId[];
  ownershipPulse: Map<NodeId, number>;
  /** Node level-up pulses, per visuals.md motion set. */
  upgradePulse: Map<NodeId, number>;
  combatFlash: number;
  /** World positions that just fought — spawn particles + shockwave. */
  combatBursts?: { x: number; y: number }[];
  allies: Set<PlayerId>;
  showMinimap: boolean;
  /** Hover power preview text (world coords). */
  powerPreview?: { x: number; y: number; text: string } | null;
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

interface Shockwave {
  x: number;
  y: number;
  t: number;
}

interface Point {
  x: number;
  y: number;
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
  private fleetLerp = new Map<FleetId, Point>();
  private layoutCache: Record<string, Point> | null = null;
  private hitCandidates: { id: NodeId; x: number; y: number; r: number }[] = [];
  private stars: Star[] = [];
  private dust: { x: number; y: number; r: number; a: number }[] = [];
  private hoverNode: NodeId | null = null;
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private ringWash = new Map<NodeId, { from: string; to: string; t: number }>();
  private lastOwner = new Map<NodeId, PlayerId | null>();
  private animT = 0;
  private minimapRect: { x: number; y: number; w: number; h: number } | null =
    null;
  private mapBounds: { minX: number; minY: number; maxX: number; maxY: number } | null =
    null;
  private lastSize: { w: number; h: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  get hovered(): NodeId | null {
    return this.hoverNode;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    // Keep whatever the player was looking at under the centre of the canvas.
    const anchor =
      this.lastSize && this.zoom > 0
        ? this.screenToWorldLocal(this.lastSize.w / 2, this.lastSize.h * 0.46)
        : null;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.lastSize = { w, h };
    if (anchor) this.centerOn(anchor);
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
    const n = Math.floor((w * h) / 3600);
    for (let i = 0; i < n; i++) {
      const layer = (rand() < 0.55 ? 0 : rand() < 0.7 ? 1 : 2) as 0 | 1 | 2;
      stars.push({
        x: rand() * w,
        y: rand() * h,
        r:
          layer === 0
            ? 0.55 + rand() * 0.5
            : layer === 1
              ? 0.9 + rand() * 0.7
              : 1.3 + rand(),
        a:
          layer === 0
            ? 0.2 + rand() * 0.35
            : layer === 1
              ? 0.35 + rand() * 0.4
              : 0.5 + rand() * 0.4,
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

  bindPanZoom(
    onClick: (
      nodeId: NodeId | null,
      mods: { shift: boolean; alt: boolean; ctrl: boolean },
    ) => void,
    onMinimapJump?: (world: Point) => void,
    onRightClick?: () => void,
  ): void {
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.zoom = Math.min(180, Math.max(6, this.zoom * factor));
        const after = this.screenToWorld(e.clientX, e.clientY);
        this.camX += (after.x - world.x) * this.zoom;
        this.camY += (after.y - world.y) * this.zoom;
      },
      { passive: false },
    );

    this.canvas.addEventListener("pointerdown", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      if (this.minimapHit(lx, ly)) {
        const world = this.minimapToWorld(lx, ly);
        if (world) {
          this.centerOn(world);
          onMinimapJump?.(world);
        }
        return;
      }
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
      if (!this.dragging) return;
      this.dragging = false;
      this.canvas.classList.remove("dragging");
      this.canvas.style.cursor = this.hoverNode ? "pointer" : "grab";
      if (this.pointerMoved) return;
      const world = this.screenToWorld(e.clientX, e.clientY);
      onClick(this.hitNode(world.x, world.y), {
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey || e.metaKey,
      });
    });

    // Right-click clears a pending path / selection staging.
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onRightClick?.();
    });
  }

  private layoutOf(id: NodeId, map: MatchStartMessage["map"]): Point {
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
    this.shockwaves = [];
    if (!map.layout || Object.keys(map.layout).length < 2) {
      map.layout = synthesizeLayout(map);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of Object.keys(map.nodes)) {
      const p = this.layoutOf(id, map);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    this.mapBounds = Number.isFinite(minX)
      ? { minX, minY, maxX, maxY }
      : null;
  }

  /** Frame a set of node ids (visible neighbourhood), leaving HUD gutters. */
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
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const pad = 1.8;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const spanX = Math.max(maxX - minX, 4);
    const spanY = Math.max(maxY - minY, 4);
    this.zoom = Math.min(
      82,
      Math.max(30, Math.min((w * 0.72) / spanX, (h * 0.6) / spanY)),
    );
    this.centerOn({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }

  fitMap(map: MatchStartMessage["map"]): void {
    this.fitNodes(map, Object.keys(map.nodes));
  }

  centerOn(world: Point): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.camX = w / 2 - world.x * this.zoom;
    this.camY = h * 0.46 - world.y * this.zoom;
  }

  zoomBy(factor: number): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const center = this.screenToWorld(
      w / 2 + this.canvas.getBoundingClientRect().left,
      h / 2 + this.canvas.getBoundingClientRect().top,
    );
    this.zoom = Math.min(180, Math.max(6, this.zoom * factor));
    this.centerOn(center);
  }

  screenToWorld(sx: number, sy: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.camX) / this.zoom,
      y: (sy - rect.top - this.camY) / this.zoom,
    };
  }

  private hitNode(wx: number, wy: number): NodeId | null {
    let best: NodeId | null = null;
    let bestD = Infinity;
    for (const c of this.hitCandidates) {
      const d = Math.hypot(wx - c.x, wy - c.y);
      if (d <= c.r && d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  }

  private minimapHit(lx: number, ly: number): boolean {
    const r = this.minimapRect;
    if (!r) return false;
    return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h;
  }

  private minimapToWorld(lx: number, ly: number): Point | null {
    const r = this.minimapRect;
    const b = this.mapBounds;
    if (!r || !b) return null;
    const spanX = Math.max(b.maxX - b.minX, 0.001);
    const spanY = Math.max(b.maxY - b.minY, 0.001);
    const scale = Math.min(r.w / spanX, r.h / spanY);
    const offX = r.x + (r.w - spanX * scale) / 2;
    const offY = r.y + (r.h - spanY * scale) / 2;
    return {
      x: b.minX + (lx - offX) / scale,
      y: b.minY + (ly - offY) / scale,
    };
  }

  private ownerColor(
    ownerId: PlayerId | null,
    selfId: PlayerId,
    colors: Record<PlayerId, string>,
  ): string {
    if (!ownerId) return PALETTE.unowned;
    if (ownerId === selfId) return PALETTE.self;
    return colors[ownerId] ?? PALETTE.unowned;
  }

  private nodeRadius(role: string, level: number): number {
    const base = ROLE_RADIUS[role] ?? 0.24;
    return base * (1 + 0.04 * Math.min(Math.max(level - 1, 0), 12));
  }

  /** Keep nodes clickable and readable when the camera is zoomed out. */
  private screenRadius(role: string, level: number): number {
    const world = this.nodeRadius(role, level);
    const minWorld = 9 / Math.max(this.zoom, 1);
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
    this.shockwaves.push({ x, y, t: 0 });
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

    this.drawBackground(ctx, w, h);

    ctx.save();
    ctx.translate(this.camX, this.camY);
    ctx.scale(this.zoom, this.zoom);

    const visible = new Set(state.view.visibleNodes);
    const known = state.view.nodes;
    const mapNodes = state.map.nodes;

    const tierOf = (id: NodeId): Tier => {
      if (visible.has(id)) return "visible";
      return known[id] !== undefined ? "explored" : "unexplored";
    };

    // World-space viewport with a margin, for culling.
    const margin = 1.5;
    const tl = this.screenToWorldLocal(0, 0);
    const br = this.screenToWorldLocal(w, h);
    const cull = {
      minX: tl.x - margin,
      minY: tl.y - margin,
      maxX: br.x + margin,
      maxY: br.y + margin,
    };
    const inView = (p: Point) =>
      p.x >= cull.minX && p.x <= cull.maxX && p.y >= cull.minY && p.y <= cull.maxY;

    const neighborSet = new Set<NodeId>();
    if (state.selectedNode) {
      for (const n of mapNodes[state.selectedNode]?.neighbors ?? []) {
        neighborSet.add(n);
      }
    }

    this.trackOwnershipWashes(state, known);

    // Nodes with a friendly fleet, computed once rather than per node.
    const friendlyFleetNodes = new Set<NodeId>();
    for (const f of Object.values(state.view.fleets)) {
      if (f.ownerId !== state.selfId) continue;
      if (f.location.kind === "node") friendlyFleetNodes.add(f.location.nodeId);
    }

    this.drawLanes(state, tierOf, neighborSet, cull);
    this.drawPathPreview(state);
    this.drawNodes(state, tierOf, neighborSet, inView, friendlyFleetNodes, dt);
    this.drawFleets(state, dt, inView);
    this.drawCargo(state, inView);
    this.drawEffects(dt);

    ctx.restore();

    if (state.showMinimap) this.drawMinimap(state, w, h, visible);
    else this.minimapRect = null;

    if (state.powerPreview) {
      const scr = {
        x: state.powerPreview.x * this.zoom + this.camX,
        y: state.powerPreview.y * this.zoom + this.camY,
      };
      ctx.font = `600 13px "Source Sans 3", sans-serif`;
      const tw = ctx.measureText(state.powerPreview.text).width;
      const pad = 8;
      ctx.fillStyle = "rgba(7,9,13,0.82)";
      ctx.fillRect(scr.x - tw / 2 - pad, scr.y - 28, tw + pad * 2, 22);
      ctx.fillStyle = PALETTE.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(state.powerPreview.text, scr.x, scr.y - 17);
    }

    if (state.combatFlash > 0) {
      ctx.fillStyle = `rgba(245,242,234,${Math.min(0.06, state.combatFlash * 0.06)})`;
      ctx.fillRect(0, 0, w, h);
      state.combatFlash = Math.max(0, state.combatFlash - dt * 2.5);
    }
  }

  /** screenToWorld without the DOM rect lookup (hot path). */
  private screenToWorldLocal(lx: number, ly: number): Point {
    return {
      x: (lx - this.camX) / this.zoom,
      y: (ly - this.camY) / this.zoom,
    };
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, w, h);

    const px = (-this.camX * 0.02) % w;
    const py = (-this.camY * 0.02) % h;
    for (const d of this.dust) {
      const dx = (((d.x + px) % w) + w) % w;
      const dy = (((d.y + py) % h) + h) % h;
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

    for (const star of this.stars) {
      const factor = star.layer === 0 ? 0.04 : star.layer === 1 ? 0.08 : 0.14;
      const sx = (((star.x - this.camX * factor) % w) + w) % w;
      const sy = (((star.y - this.camY * factor) % h) + h) % h;
      const twinkle =
        star.layer === 2
          ? 0.85 + 0.15 * Math.sin(this.animT * 1.7 + star.x * 0.01)
          : 1;
      ctx.fillStyle = `rgba(220,230,245,${star.a * twinkle})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private trackOwnershipWashes(
    state: RenderState,
    known: Record<NodeId, ViewNode>,
  ): void {
    for (const [id, vn] of Object.entries(known) as [NodeId, ViewNode][]) {
      const ownerId = vn.ownerId;
      const prev = this.lastOwner.get(id);
      if (prev !== undefined && prev !== ownerId) {
        this.ringWash.set(id, {
          from: this.ownerColor(prev, state.selfId, state.seatColors),
          to: this.ownerColor(ownerId, state.selfId, state.seatColors),
          t: 0,
        });
      }
      this.lastOwner.set(id, ownerId);
    }
  }

  private drawLanes(
    state: RenderState,
    tierOf: (id: NodeId) => Tier,
    neighborSet: Set<NodeId>,
    cull: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const ctx = this.ctx;
    const mapNodes = state.map.nodes;
    const drawn = new Set<string>();
    const lineScale = Math.max(0.6, Math.min(1.6, 48 / this.zoom));

    for (const gn of Object.values(mapNodes)) {
      const a = this.layoutOf(gn.id, state.map);
      for (const n of gn.neighbors) {
        if (gn.id > n) continue;
        const key = `${gn.id}:${n}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const b = this.layoutOf(n, state.map);

        // Cull lanes whose bounding box misses the viewport.
        if (
          Math.max(a.x, b.x) < cull.minX ||
          Math.min(a.x, b.x) > cull.maxX ||
          Math.max(a.y, b.y) < cull.minY ||
          Math.min(a.y, b.y) > cull.maxY
        ) {
          continue;
        }

        const ta = tierOf(gn.id);
        const tb = tierOf(n);
        const best: Tier =
          ta === "visible" || tb === "visible"
            ? "visible"
            : ta === "explored" || tb === "explored"
              ? "explored"
              : "unexplored";
        const toNeighbor =
          (state.selectedNode === gn.id && neighborSet.has(n)) ||
          (state.selectedNode === n && neighborSet.has(gn.id));

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (toNeighbor) {
          ctx.strokeStyle = "rgba(240,208,128,0.75)";
          ctx.lineWidth = 0.055 * lineScale;
        } else if (best === "visible") {
          ctx.strokeStyle = "rgba(96,114,142,0.85)";
          ctx.lineWidth = 0.04 * lineScale;
        } else if (best === "explored") {
          ctx.strokeStyle = "rgba(58,69,88,0.7)";
          ctx.lineWidth = 0.032 * lineScale;
        } else {
          // Unexplored: the lane is known to exist, nothing about it is.
          ctx.strokeStyle = "rgba(38,47,62,0.55)";
          ctx.lineWidth = 0.022 * lineScale;
        }
        ctx.stroke();
      }
    }
  }

  private drawPathPreview(state: RenderState): void {
    if (state.pathPreview.length < 2) return;
    const ctx = this.ctx;
    const lineScale = Math.max(0.6, Math.min(1.6, 48 / this.zoom));
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i < state.pathPreview.length; i++) {
        const p = this.layoutOf(state.pathPreview[i]!, state.map);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    };
    trace();
    ctx.strokeStyle = "rgba(240,208,128,0.22)";
    ctx.lineWidth = 0.16 * lineScale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    trace();
    ctx.strokeStyle = PALETTE.focus;
    ctx.lineWidth = 0.055 * lineScale;
    ctx.setLineDash([0.18, 0.12]);
    ctx.lineDashOffset = -this.animT * 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Arrowhead at the destination.
    const n = state.pathPreview.length;
    const from = this.layoutOf(state.pathPreview[n - 2]!, state.map);
    const to = this.layoutOf(state.pathPreview[n - 1]!, state.map);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 0.18 * lineScale;
    const tipDist = 0.34;
    const tx = to.x - Math.cos(ang) * tipDist;
    const ty = to.y - Math.sin(ang) * tipDist;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(
      tx - Math.cos(ang - 0.5) * size,
      ty - Math.sin(ang - 0.5) * size,
    );
    ctx.lineTo(
      tx - Math.cos(ang + 0.5) * size,
      ty - Math.sin(ang + 0.5) * size,
    );
    ctx.closePath();
    ctx.fillStyle = PALETTE.focus;
    ctx.fill();
  }

  private drawNodes(
    state: RenderState,
    tierOf: (id: NodeId) => Tier,
    neighborSet: Set<NodeId>,
    inView: (p: Point) => boolean,
    friendlyFleetNodes: Set<NodeId>,
    dt: number,
  ): void {
    const ctx = this.ctx;
    const known = state.view.nodes;
    const showIcons = this.zoom >= ZOOM_ICONS;
    const showNumerals = this.zoom >= ZOOM_NUMERALS;
    this.hitCandidates = [];

    for (const gn of Object.values(state.map.nodes)) {
      const id = gn.id;
      const pos = this.layoutOf(id, state.map);
      const tier = tierOf(id);
      const vn = known[id];

      const isSel = state.selectedNode === id;
      const isHover = this.hoverNode === id;
      const isNeighbor = neighborSet.has(id) && !isSel;

      if (tier === "unexplored") {
        const r = this.screenRadius("relay", 1) * 0.72;
        this.hitCandidates.push({ id, x: pos.x, y: pos.y, r: r * 1.6 });
        if (!inView(pos)) continue;
        // Ghost: the system exists, nothing else is known about it.
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.fogGhost;
        ctx.fill();
        ctx.strokeStyle = isHover
          ? "rgba(154,163,178,0.55)"
          : "rgba(74,86,106,0.5)";
        ctx.lineWidth = 0.026;
        ctx.stroke();
        continue;
      }

      const fogged = vn ? isFoggedNode(vn) : true;
      const role = fogged ? (vn as { role: string }).role : gn.role;
      const level = vn?.level ?? 1;
      const ownerId = vn?.ownerId ?? null;
      const worldR = this.screenRadius(role, level);

      this.hitCandidates.push({ id, x: pos.x, y: pos.y, r: worldR * 1.45 });
      if (!inView(pos)) continue;

      const dim = tier === "explored";

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
          ? "rgba(240,208,128,0.6)"
          : isNeighbor
            ? "rgba(240,208,128,0.42)"
            : "rgba(230,234,240,0.28)";
        ctx.lineWidth = isSel ? 0.06 : 0.04;
        ctx.stroke();
      }

      // Self glow reads ownership instantly at overview zoom.
      if (!dim && ownerId === state.selfId) {
        const glow = ctx.createRadialGradient(
          pos.x,
          pos.y,
          worldR * 0.2,
          pos.x,
          pos.y,
          worldR * 1.9,
        );
        glow.addColorStop(0, "rgba(232,168,56,0.16)");
        glow.addColorStop(1, "rgba(232,168,56,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
      ctx.fillStyle = darken(ROLE_FILL[role] ?? PALETTE.unowned, dim ? 0.5 : 0.1);
      ctx.fill();

      if (!dim) {
        const hi = ctx.createRadialGradient(
          pos.x - worldR * 0.25,
          pos.y - worldR * 0.3,
          0,
          pos.x,
          pos.y,
          worldR,
        );
        hi.addColorStop(0, "rgba(255,255,255,0.18)");
        hi.addColorStop(0.55, "rgba(255,255,255,0.05)");
        hi.addColorStop(1, "rgba(0,0,0,0.22)");
        ctx.fillStyle = hi;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ownership ring, with capture crossfade.
      let ring = this.ownerColor(ownerId, state.selfId, state.seatColors);
      const wash = this.ringWash.get(id);
      if (wash) {
        wash.t = Math.min(1, wash.t + dt / 0.4);
        ring = mixHex(wash.from, wash.to, wash.t);
        if (wash.t >= 1) this.ringWash.delete(id);
      }
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, worldR, 0, Math.PI * 2);
      ctx.strokeStyle = dim ? withAlpha(ring, 0.5) : ring;
      ctx.lineWidth = ownerId === state.selfId ? 0.085 : 0.055;
      ctx.stroke();

      // Allies get a subtle dashed outer ring, not a third theme colour.
      if (ownerId && state.allies.has(ownerId)) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.11, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(ring, 0.55);
        ctx.lineWidth = 0.03;
        ctx.setLineDash([0.1, 0.08]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const pulse = state.ownershipPulse.get(id) ?? 0;
      if (pulse > 0) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.28 * (1 - pulse), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(245,242,234,${pulse * 0.9})`;
        ctx.lineWidth = 0.09 * pulse;
        ctx.stroke();
        state.ownershipPulse.set(id, Math.max(0, pulse - dt * 1.6));
      }

      const up = state.upgradePulse.get(id) ?? 0;
      if (up > 0) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, worldR + 0.34 * (1 - up), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(240,208,128,${up * 0.85})`;
        ctx.lineWidth = 0.07 * up;
        ctx.stroke();
        state.upgradePulse.set(id, Math.max(0, up - dt * 1.4));
      }

      // Owner-only warning: valuable and undefended (visuals.md).
      if (
        !dim &&
        ownerId === state.selfId &&
        level >= 3 &&
        !friendlyFleetNodes.has(id)
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
        ctx.arc(pos.x, pos.y, worldR + 0.15, 0, Math.PI * 2);
        ctx.strokeStyle = PALETTE.focus;
        ctx.lineWidth = 0.045;
        ctx.stroke();
      }

      if (showNumerals) {
        const fontWorld = Math.max(10 / this.zoom, worldR * 0.8);
        ctx.fillStyle = dim ? PALETTE.textDim : PALETTE.text;
        ctx.font = `700 ${fontWorld}px "Source Sans 3", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(level), pos.x, pos.y + worldR * 0.04);
      }

      if (showIcons) {
        const iconR = Math.min(Math.max(worldR * 0.34, 0.075), 0.15);
        drawRoleIcon(
          ctx,
          role,
          pos.x + worldR * 0.72,
          pos.y - worldR * 0.66,
          iconR,
          dim,
        );
      }
    }
  }

  private drawFleets(
    state: RenderState,
    dt: number,
    inView: (p: Point) => boolean,
  ): void {
    const ctx = this.ctx;
    const showLabels = this.zoom >= ZOOM_FLEET_LABELS;

    // Group so co-located fleets fan out instead of stacking.
    const groups = new Map<string, Fleet[]>();
    for (const f of Object.values(state.view.fleets)) {
      const key = fleetKey(f);
      const arr = groups.get(key) ?? [];
      arr.push(f);
      groups.set(key, arr);
    }

    const live = new Set<FleetId>();
    for (const group of groups.values()) {
      group.sort((a, b) => (a.id < b.id ? -1 : 1));
      group.forEach((f, i) => {
        live.add(f.id);
        const target = this.fleetAnchor(f, state, i, group.length);
        let cur = this.fleetLerp.get(f.id);
        if (!cur) {
          cur = { ...target };
          this.fleetLerp.set(f.id, cur);
        }
        // Snap on big jumps (teleport after a full snapshot), lerp otherwise.
        const jump = Math.hypot(target.x - cur.x, target.y - cur.y);
        if (jump > 3) {
          cur.x = target.x;
          cur.y = target.y;
        } else {
          const k = Math.min(1, dt * 10);
          cur.x += (target.x - cur.x) * k;
          cur.y += (target.y - cur.y) * k;
        }
        if (!inView(cur)) return;

        const power = fleetPowerOf(f);
        const size = Math.max(
          6 / this.zoom,
          Math.min(0.24, 0.085 + Math.sqrt(Math.max(power, 1)) * 0.013),
        );
        const color = this.ownerColor(f.ownerId, state.selfId, state.seatColors);
        const heading = this.fleetHeading(f, state);

        ctx.save();
        ctx.translate(cur.x, cur.y);
        ctx.rotate(heading);

        ctx.beginPath();
        ctx.moveTo(size * 1.15, 0);
        ctx.lineTo(-size * 0.75, size * 0.8);
        ctx.lineTo(-size * 0.4, 0);
        ctx.lineTo(-size * 0.75, -size * 0.8);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(7,9,13,0.75)";
        ctx.lineWidth = size * 0.16;
        ctx.stroke();

        if (state.selectedFleetIds?.has(f.id)) {
          ctx.beginPath();
          ctx.arc(0, 0, size * 1.55, 0, Math.PI * 2);
          ctx.strokeStyle = PALETTE.self;
          ctx.lineWidth = size * 0.22;
          ctx.stroke();
        }

        ctx.restore();

        if (f.invasionPopulation) {
          ctx.beginPath();
          ctx.arc(cur.x + size * 0.9, cur.y - size * 0.9, size * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = PALETTE.self;
          ctx.fill();
          ctx.strokeStyle = PALETTE.void;
          ctx.lineWidth = size * 0.12;
          ctx.stroke();
        }

        if (power > 0 && showLabels) {
          const label = String(power);
          const fs = Math.max(0.1, size * 0.85);
          ctx.font = `700 ${fs}px "Source Sans 3", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "rgba(7,9,13,0.7)";
          ctx.fillText(label, cur.x + 0.012, cur.y + size * 1.05 + 0.012);
          ctx.fillStyle = PALETTE.text;
          ctx.fillText(label, cur.x, cur.y + size * 1.05);
        }
      });
    }

    for (const id of [...this.fleetLerp.keys()]) {
      if (!live.has(id)) this.fleetLerp.delete(id);
    }
  }

  /**
   * Fleets at a node sit in orbit around the rim rather than on top of the
   * disc, so the level numeral and role icon stay readable.
   */
  private fleetAnchor(
    f: Fleet,
    state: RenderState,
    index: number,
    total: number,
  ): Point {
    if (f.location.kind !== "node") {
      const p = fleetWorldPos(f, state.map, (id, m) => this.layoutOf(id, m));
      // Fan transit stacks perpendicular to the lane.
      const a = this.layoutOf(f.location.from, state.map);
      const b = this.layoutOf(f.location.to, state.map);
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const off = (index - (total - 1) / 2) * 0.17;
      return { x: p.x + Math.cos(ang) * off, y: p.y + Math.sin(ang) * off };
    }
    const node = state.view.nodes[f.location.nodeId];
    const gn = state.map.nodes[f.location.nodeId];
    const role = node && !isFoggedNode(node) ? gn?.role : (node as { role?: string } | undefined)?.role;
    const level = node?.level ?? 1;
    const r = this.screenRadius(role ?? "relay", level) + 0.26;
    const base = Math.PI * 0.5;
    const spread = Math.min(Math.PI * 1.4, 0.55 * Math.max(total - 1, 0));
    const ang = base + (total <= 1 ? 0 : spread * (index / (total - 1) - 0.5));
    const p = this.layoutOf(f.location.nodeId, state.map);
    return { x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r };
  }

  private fleetHeading(f: Fleet, state: RenderState): number {
    if (f.location.kind !== "transit") return -Math.PI / 2;
    const a = this.layoutOf(f.location.from, state.map);
    const b = this.layoutOf(f.location.to, state.map);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private drawCargo(state: RenderState, inView: (p: Point) => boolean): void {
    const ctx = this.ctx;
    for (const c of Object.values(state.view.cargoShips) as CargoShip[]) {
      const p = fleetWorldPos(c, state.map, (id, m) => this.layoutOf(id, m));
      if (c.location.kind === "node") p.y += 0.3;
      if (!inView(p)) continue;
      const band = Math.min(1, c.cargoCredits / 40);
      const s = Math.max(4 / this.zoom, 0.075 + band * 0.05);
      ctx.beginPath();
      roundRect(ctx, p.x - s * 1.15, p.y - s * 0.55, s * 2.3, s * 1.1, s * 0.45);
      ctx.fillStyle = PALETTE.cargo;
      ctx.fill();
      ctx.strokeStyle = "rgba(7,9,13,0.6)";
      ctx.lineWidth = s * 0.22;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillRect(p.x - s * 0.7, p.y - s * 0.2, s * 1.4, s * 0.18);
    }
  }

  private drawEffects(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i]!;
      s.t += dt / 0.45;
      if (s.t >= 1) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.15 + s.t * 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245,242,234,${(1 - s.t) * 0.6})`;
      ctx.lineWidth = 0.05 * (1 - s.t);
      ctx.stroke();
    }

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
  }

  /** Screen-space overview; essential once maps reach a few hundred nodes. */
  private drawMinimap(
    state: RenderState,
    w: number,
    h: number,
    visible: Set<NodeId>,
  ): void {
    const b = this.mapBounds;
    if (!b) {
      this.minimapRect = null;
      return;
    }
    const size = Math.min(190, Math.max(120, Math.min(w, h) * 0.19));
    const pad = 14;
    const rect = { x: w - size - pad, y: h - size - pad, w: size, h: size };
    this.minimapRect = rect;
    const ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 3);
    ctx.fillStyle = "rgba(7,9,13,0.82)";
    ctx.fill();
    ctx.strokeStyle = "#2a3344";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();

    const spanX = Math.max(b.maxX - b.minX, 0.001);
    const spanY = Math.max(b.maxY - b.minY, 0.001);
    const inset = 8;
    const scale = Math.min(
      (rect.w - inset * 2) / spanX,
      (rect.h - inset * 2) / spanY,
    );
    const offX = rect.x + (rect.w - spanX * scale) / 2;
    const offY = rect.y + (rect.h - spanY * scale) / 2;
    const toMini = (p: Point) => ({
      x: offX + (p.x - b.minX) * scale,
      y: offY + (p.y - b.minY) * scale,
    });

    // Ghost lanes first, so the minimap shows the shape of the galaxy.
    ctx.strokeStyle = "rgba(58,69,88,0.5)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const gn of Object.values(state.map.nodes)) {
      const a = toMini(this.layoutOf(gn.id, state.map));
      for (const nb of gn.neighbors) {
        if (gn.id > nb) continue;
        const b = toMini(this.layoutOf(nb, state.map));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    for (const gn of Object.values(state.map.nodes)) {
      const vn = state.view.nodes[gn.id];
      const p = toMini(this.layoutOf(gn.id, state.map));
      if (!vn) {
        ctx.fillStyle = "rgba(107,117,133,0.6)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const owner = vn.ownerId;
      const isSelf = owner === state.selfId;
      ctx.fillStyle = owner
        ? this.ownerColor(owner, state.selfId, state.seatColors)
        : "rgba(107,117,133,0.75)";
      const r = isSelf ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, visible.has(gn.id) ? r : r * 0.8, 0, Math.PI * 2);
      ctx.globalAlpha = visible.has(gn.id) ? 1 : 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Viewport rectangle.
    const tl = toMini(this.screenToWorldLocal(0, 0));
    const br = toMini(this.screenToWorldLocal(w, h));
    ctx.strokeStyle = "rgba(240,208,128,0.75)";
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
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

function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseHex(color);
  return `rgba(${r},${g},${b},${alpha})`;
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
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
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
  dim: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.fillStyle = dim ? "rgba(21,26,34,0.85)" : "rgba(7,9,13,0.6)";
  ctx.fill();
  ctx.strokeStyle = dim ? PALETTE.unowned : PALETTE.text;
  ctx.fillStyle = dim ? PALETTE.unowned : PALETTE.text;
  ctx.lineWidth = Math.max(0.018, r * 0.16);
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

function fleetWorldPos(
  f: { location: Fleet["location"] },
  map: MatchStartMessage["map"],
  layoutOf: (id: NodeId, map: MatchStartMessage["map"]) => Point,
): Point {
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
): Record<string, Point> {
  const ids = Object.keys(map.nodes).sort();
  const n = Math.max(ids.length, 1);
  const radius = Math.max(4, Math.sqrt(n) * 1.8);
  const out: Record<string, Point> = {};
  for (let i = 0; i < ids.length; i++) {
    const angle = (2 * Math.PI * i) / n;
    out[ids[i]!] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  return out;
}
