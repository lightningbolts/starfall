import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from "three";
import {
  flavorSystems,
  type EmpireId,
  type InterpolatedSnapshot,
  type MacroSnapshot,
  type RegionId,
} from "@starfall/macro-sim";

/** Starfall visuals.md tokens — muted ownership fills, not candy pastels. */
const VOID = 0x07090d;
const WILDERNESS = new Color(0x121820);
const WILDERNESS_EDGE = 0x1a2230;
const BORDER = 0x2a3344;
const FLASH = new Color(0xf5f2ea);

function empireFill(h: number): Color {
  const c = new Color();
  // Cool, muted fills — readable on void without candy pastels
  c.setHSL((((h % 360) + 360) % 360) / 360, 0.42, 0.28);
  return c;
}

function empireAccent(h: number): Color {
  const c = new Color();
  c.setHSL((((h % 360) + 360) % 360) / 360, 0.7, 0.55);
  return c;
}

export interface MapViewOptions {
  focusEmpireId: EmpireId | null;
  showContested: boolean;
  showDiplomacy: boolean;
  showFrontiers: boolean;
  seed: number;
}

export class MacroMapView {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: OrthographicCamera;
  private regionMesh: Mesh | null = null;
  private borderLines: LineSegments | null = null;
  private ownedOutlines: LineSegments | null = null;
  private contestedLines: LineSegments | null = null;
  private diplomacyLines: LineSegments | null = null;
  private starfield: Points | null = null;
  private capitalPoints: Points | null = null;
  private flavorPoints: Points | null = null;
  private colorAttr: BufferAttribute | null = null;
  private capitalColorAttr: BufferAttribute | null = null;
  private regionVertexRanges: { id: RegionId; start: number; count: number }[] =
    [];
  private capitalIds: RegionId[] = [];
  private pulseRegions = new Map<RegionId, number>();
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private dragging = false;
  private lastMx = 0;
  private lastMy = 0;
  private extent = 40;
  private disposed = false;
  private empireHues = new Map<EmpireId, number>();
  private capitalByEmpire = new Map<EmpireId, RegionId>();
  private flavorFrame = 0;
  private staticBorders: Float32Array = new Float32Array(0);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(VOID, 1);
    this.renderer.sortObjects = true;
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.camera.position.z = 100;

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  setStaticGalaxy(snapshot: MacroSnapshot): void {
    this.empireHues.clear();
    this.capitalByEmpire.clear();
    for (const id of snapshot.empireOrder) {
      const e = snapshot.empires[id]!;
      this.empireHues.set(id, e.colorHue);
      this.capitalByEmpire.set(id, e.capitalRegionId);
    }

    let maxR = 1;
    for (const id of snapshot.regionOrder) {
      const s = snapshot.regions[id]!.site;
      maxR = Math.max(maxR, Math.hypot(s.x, s.y));
    }
    this.extent = maxR * 1.15;
    this.zoom = 1;
    this.camX = 0;
    this.camY = 0;

    this.rebuildMeshes(snapshot);
    this.buildStarfield();
    this.updateCamera();
  }

  pulseRegion(regionId: RegionId): void {
    this.pulseRegions.set(regionId, 1);
  }

  render(view: InterpolatedSnapshot, opts: MapViewOptions): void {
    if (this.disposed || !this.colorAttr) return;
    this.updateRegionColors(view, opts);
    this.updateCapitals(view);
    this.flavorFrame++;
    if (this.flavorFrame % 3 === 0) this.updateOwnedOutlines(view);
    if (this.flavorFrame % 4 === 0) {
      this.updateContested(view, opts.showContested);
      this.updateDiplomacy(view, opts.showDiplomacy);
    }
    if (this.flavorFrame % 10 === 0) this.updateFlavor(view, opts.seed);
    this.decayPulses();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.onResize);
    this.clearMeshes();
    this.renderer.dispose();
  }

  private clearMeshes(): void {
    for (const obj of [
      this.regionMesh,
      this.borderLines,
      this.ownedOutlines,
      this.contestedLines,
      this.diplomacyLines,
      this.starfield,
      this.capitalPoints,
      this.flavorPoints,
    ]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
    this.regionMesh = null;
    this.borderLines = null;
    this.ownedOutlines = null;
    this.contestedLines = null;
    this.diplomacyLines = null;
    this.starfield = null;
    this.capitalPoints = null;
    this.flavorPoints = null;
    this.colorAttr = null;
    this.capitalColorAttr = null;
    this.regionVertexRanges = [];
    this.capitalIds = [];
  }

  private rebuildMeshes(snapshot: MacroSnapshot): void {
    this.clearMeshes();
    const positions: number[] = [];
    const colors: number[] = [];
    const borderPts: number[] = [];
    this.regionVertexRanges = [];

    for (const id of snapshot.regionOrder) {
      const r = snapshot.regions[id]!;
      const poly = r.polygon;
      if (poly.length < 3) continue;
      const start = positions.length / 3;
      const cx = r.site.x;
      const cy = r.site.y;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        // Fan from site (guaranteed inside cell)
        positions.push(cx, cy, 0, a.x, a.y, 0, b.x, b.y, 0);
        for (let k = 0; k < 3; k++) {
          colors.push(WILDERNESS.r, WILDERNESS.g, WILDERNESS.b);
        }
        borderPts.push(a.x, a.y, 0.2, b.x, b.y, 0.2);
      }
      this.regionVertexRanges.push({
        id,
        start,
        count: positions.length / 3 - start,
      });
    }

    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.colorAttr = new BufferAttribute(new Float32Array(colors), 3);
    geo.setAttribute("color", this.colorAttr);
    this.regionMesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        vertexColors: true,
        side: FrontSide,
        transparent: false,
        depthWrite: true,
      }),
    );
    this.regionMesh.renderOrder = 1;
    this.scene.add(this.regionMesh);

    const emptyGeo = (): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(0), 3));
      return g;
    };

    // Faint wilderness tessellation
    this.staticBorders = new Float32Array(borderPts);
    const borderGeo = new BufferGeometry();
    borderGeo.setAttribute(
      "position",
      new BufferAttribute(this.staticBorders.slice(), 3),
    );
    this.borderLines = new LineSegments(
      borderGeo,
      new LineBasicMaterial({
        color: WILDERNESS_EDGE,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    this.borderLines.renderOrder = 2;
    this.scene.add(this.borderLines);

    this.ownedOutlines = new LineSegments(
      emptyGeo(),
      new LineBasicMaterial({
        color: 0x3d4a60,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.ownedOutlines.renderOrder = 3;
    this.scene.add(this.ownedOutlines);

    this.contestedLines = new LineSegments(
      emptyGeo(),
      new LineBasicMaterial({
        color: 0xc45c4a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.contestedLines.renderOrder = 4;
    this.scene.add(this.contestedLines);

    this.diplomacyLines = new LineSegments(
      emptyGeo(),
      new LineBasicMaterial({
        color: 0x7aafc4,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    this.diplomacyLines.renderOrder = 3;
    this.scene.add(this.diplomacyLines);

    // Capital markers
    this.capitalIds = snapshot.empireOrder.map(
      (eid) => snapshot.empires[eid]!.capitalRegionId,
    );
    const capPos = new Float32Array(this.capitalIds.length * 3);
    const capCol = new Float32Array(this.capitalIds.length * 3);
    for (let i = 0; i < this.capitalIds.length; i++) {
      const site = snapshot.regions[this.capitalIds[i]!]!.site;
      capPos[i * 3] = site.x;
      capPos[i * 3 + 1] = site.y;
      capPos[i * 3 + 2] = 1;
      const hue = snapshot.empires[snapshot.empireOrder[i]!]!.colorHue;
      const c = empireAccent(hue);
      capCol[i * 3] = c.r;
      capCol[i * 3 + 1] = c.g;
      capCol[i * 3 + 2] = c.b;
    }
    const capGeo = new BufferGeometry();
    capGeo.setAttribute("position", new BufferAttribute(capPos, 3));
    this.capitalColorAttr = new BufferAttribute(capCol, 3);
    capGeo.setAttribute("color", this.capitalColorAttr);
    this.capitalPoints = new Points(
      capGeo,
      new PointsMaterial({
        size: 5,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    this.capitalPoints.renderOrder = 5;
    this.scene.add(this.capitalPoints);

    this.flavorPoints = new Points(
      emptyGeo(),
      new PointsMaterial({
        color: 0xa8b4c4,
        size: 1.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.flavorPoints.renderOrder = 3;
    this.scene.add(this.flavorPoints);
  }

  private buildStarfield(): void {
    const n = 2400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const span = this.extent * 2.4;
    for (let i = 0; i < n; i++) {
      const layer = i % 3;
      pos[i * 3] = (Math.random() - 0.5) * span;
      pos[i * 3 + 1] = (Math.random() - 0.5) * span;
      pos[i * 3 + 2] = -4 - layer;
      const b = 0.35 + layer * 0.18 + Math.random() * 0.15;
      col[i * 3] = b * 0.85;
      col[i * 3 + 1] = b * 0.9;
      col[i * 3 + 2] = b;
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("color", new BufferAttribute(col, 3));
    this.starfield = new Points(
      geo,
      new PointsMaterial({
        size: 1.1,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.starfield.renderOrder = 0;
    this.scene.add(this.starfield);
  }

  private updateRegionColors(
    view: InterpolatedSnapshot,
    opts: MapViewOptions,
  ): void {
    if (!this.colorAttr) return;
    const arr = this.colorAttr.array as Float32Array;
    const tmpA = new Color();
    const tmpB = new Color();
    const out = new Color();

    // Soften border opacity when zoomed out
    if (this.borderLines) {
      const mat = this.borderLines.material as LineBasicMaterial;
      mat.color.setHex(this.zoom < 1.2 ? WILDERNESS_EDGE : BORDER);
      mat.opacity = this.zoom < 1.2 ? 0.35 : 0.6;
    }

    for (const range of this.regionVertexRanges) {
      const r = view.regions[range.id];
      if (!r) continue;
      fillColor(
        r.ownerId,
        r.ownerIdB,
        r.ownerBlend,
        this.empireHues,
        tmpA,
        tmpB,
        out,
      );

      let dim = 1;
      if (opts.focusEmpireId) {
        const owned =
          r.ownerId === opts.focusEmpireId ||
          (r.ownerIdB === opts.focusEmpireId && r.ownerBlend > 0.4);
        dim = owned ? 1 : 0.22;
        if (opts.showFrontiers && owned) {
          const frontier = r.neighbors.some((nid) => {
            const n = view.regions[nid];
            return (
              n &&
              ((n.ownerId && n.ownerId !== opts.focusEmpireId) || !n.ownerId)
            );
          });
          if (frontier) out.offsetHSL(0, 0.05, 0.07);
        }
      }

      const pulse = this.pulseRegions.get(range.id) ?? 0;
      if (pulse > 0) out.lerp(FLASH, pulse * 0.4);

      out.multiplyScalar(dim);
      for (let i = 0; i < range.count; i++) {
        const o = (range.start + i) * 3;
        arr[o] = out.r;
        arr[o + 1] = out.g;
        arr[o + 2] = out.b;
      }
    }
    this.colorAttr.needsUpdate = true;
  }

  private updateCapitals(view: InterpolatedSnapshot): void {
    if (!this.capitalPoints || !this.capitalColorAttr) return;
    const pos = this.capitalPoints.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    const col = this.capitalColorAttr.array as Float32Array;
    for (let i = 0; i < view.empireOrder.length; i++) {
      const eid = view.empireOrder[i]!;
      const e = view.empires[eid]!;
      const site = view.regions[e.capitalRegionId]?.site;
      if (site) {
        pos.setXYZ(i, site.x, site.y, 1);
      }
      const c = empireAccent(e.colorHue);
      const live = e.alive ? 1 : 0.25;
      col[i * 3] = c.r * live;
      col[i * 3 + 1] = c.g * live;
      col[i * 3 + 2] = c.b * live;
    }
    pos.needsUpdate = true;
    this.capitalColorAttr.needsUpdate = true;
    const mat = this.capitalPoints.material as PointsMaterial;
    mat.size = Math.max(3, Math.min(8, 4.5 * Math.sqrt(this.zoom)));
  }

  private updateOwnedOutlines(view: InterpolatedSnapshot): void {
    if (!this.ownedOutlines) return;
    const pts: number[] = [];
    for (const id of view.regionOrder) {
      const r = view.regions[id]!;
      if (!r.ownerId && !r.ownerIdB) continue;
      const poly = r.polygon;
      if (poly.length < 3) continue;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        pts.push(a.x, a.y, 0.35, b.x, b.y, 0.35);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(pts), 3),
    );
    this.ownedOutlines.geometry.dispose();
    this.ownedOutlines.geometry = geo;
  }

  private updateContested(view: InterpolatedSnapshot, show: boolean): void {
    if (!this.contestedLines) return;
    if (!show) {
      this.contestedLines.visible = false;
      return;
    }
    this.contestedLines.visible = true;
    const pts: number[] = [];
    const seen = new Set<string>();
    for (const id of view.regionOrder) {
      const r = view.regions[id]!;
      if (!r.contested || r.contested.pct < 0.08 || !r.ownerId) continue;
      for (const nid of r.neighbors) {
        const n = view.regions[nid]!;
        if (n.ownerId !== r.contested.vs) continue;
        const key = id < nid ? `${id}|${nid}` : `${nid}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Draw along the shared border midpoint approximation
        const mx = (r.site.x + n.site.x) / 2;
        const my = (r.site.y + n.site.y) / 2;
        const dx = n.site.y - r.site.y;
        const dy = r.site.x - n.site.x;
        const len = Math.hypot(dx, dy) || 1;
        const s = (0.15 + r.contested.pct * 0.35) * (this.extent * 0.02);
        pts.push(
          mx - (dx / len) * s,
          my - (dy / len) * s,
          0.5,
          mx + (dx / len) * s,
          my + (dy / len) * s,
          0.5,
        );
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(pts), 3),
    );
    this.contestedLines.geometry.dispose();
    this.contestedLines.geometry = geo;
  }

  private updateDiplomacy(view: InterpolatedSnapshot, show: boolean): void {
    if (!this.diplomacyLines) return;
    if (!show) {
      this.diplomacyLines.visible = false;
      return;
    }
    this.diplomacyLines.visible = true;
    const pts: number[] = [];
    const seen = new Set<string>();
    for (const id of view.empireOrder) {
      const e = view.empires[id]!;
      if (!e.alive) continue;
      const cap = view.regions[e.capitalRegionId];
      if (!cap) continue;
      for (const ally of e.allies) {
        const key = id < ally ? `${id}|${ally}` : `${ally}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const other = view.empires[ally];
        if (!other?.alive) continue;
        const ocap = view.regions[other.capitalRegionId];
        if (!ocap) continue;
        pts.push(cap.site.x, cap.site.y, 0.8, ocap.site.x, ocap.site.y, 0.8);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(pts), 3),
    );
    this.diplomacyLines.geometry.dispose();
    this.diplomacyLines.geometry = geo;
  }

  private updateFlavor(view: InterpolatedSnapshot, seed: number): void {
    if (!this.flavorPoints) return;
    const show = this.zoom > 2.8;
    this.flavorPoints.visible = show;
    if (!show) return;

    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfH = this.extent / this.zoom;
    const halfW = halfH * aspect;
    const pts: number[] = [];
    let budget = 0;
    for (const id of view.regionOrder) {
      if (budget > 80) break;
      const r = view.regions[id]!;
      if (!r.ownerId) continue;
      if (
        Math.abs(r.site.x - this.camX) > halfW * 1.1 ||
        Math.abs(r.site.y - this.camY) > halfH * 1.1
      ) {
        continue;
      }
      const systems = flavorSystems(seed, id, r.site, r.polygon, 3);
      for (const s of systems) pts.push(s.x, s.y, 0.6);
      budget++;
    }
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(pts), 3),
    );
    this.flavorPoints.geometry.dispose();
    this.flavorPoints.geometry = geo;
  }

  private decayPulses(): void {
    for (const [id, v] of this.pulseRegions) {
      const next = v - 0.045;
      if (next <= 0) this.pulseRegions.delete(id);
      else this.pulseRegions.set(id, next);
    }
  }

  private updateCamera(): void {
    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfH = this.extent / this.zoom;
    const halfW = halfH * aspect;
    this.camera.left = this.camX - halfW;
    this.camera.right = this.camX + halfW;
    this.camera.top = this.camY + halfH;
    this.camera.bottom = this.camY - halfH;
    this.camera.updateProjectionMatrix();
  }

  private onResize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.updateCamera();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastMx = e.clientX;
    this.lastMy = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastMx;
    const dy = e.clientY - this.lastMy;
    this.lastMx = e.clientX;
    this.lastMy = e.clientY;
    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfH = this.extent / this.zoom;
    const halfW = halfH * aspect;
    this.camX -= (dx / this.canvas.clientWidth) * halfW * 2;
    this.camY += (dy / this.canvas.clientHeight) * halfH * 2;
    this.updateCamera();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoom = Math.min(14, Math.max(0.4, this.zoom * factor));
    this.updateCamera();
  };
}

function fillColor(
  ownerA: EmpireId | null,
  ownerB: EmpireId | null,
  blend: number,
  hues: Map<EmpireId, number>,
  tmpA: Color,
  tmpB: Color,
  out: Color,
): void {
  if (ownerA) tmpA.copy(empireFill(hues.get(ownerA) ?? 0));
  else tmpA.copy(WILDERNESS);
  if (ownerB) {
    tmpB.copy(empireFill(hues.get(ownerB) ?? 0));
    out.copy(tmpA).lerp(tmpB, blend);
  } else {
    out.copy(tmpA);
  }
}

