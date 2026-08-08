import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import {
  borderKey,
  createRng,
  type EmpireId,
  type GalaxyGeometry,
  type InterpolatedSnapshot,
  type MacroSnapshot,
  type StarClass,
  type SystemId,
} from "@starfall/macro-sim";
import {
  CARGO,
  COMBAT_FLASH,
  DANGER,
  LANE,
  VOID,
  empireAccent,
  type Rgb,
} from "./palette.js";
import {
  LabelLayer,
  type EmpireLabel,
  type ScreenProjection,
  type SystemLabel,
} from "./labels.js";
import {
  FULLSCREEN_VERT,
  NEBULA_FRAG,
  OWNER_FRAG,
  OWNER_VERT,
  RING_FRAG,
  STAR_FRAG,
  STAR_VERT,
  TERRITORY_FRAG,
} from "./shaders.js";

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 22;
/** Zoom at which individual system names become legible. */
const SYSTEM_LABEL_ZOOM = 4.2;
const MAX_SYSTEM_LABELS = 70;
/**
 * The ownership buffer is world-fixed rather than screen-fixed: territory is
 * rasterized once over the galaxy bounds, so blob shape and rim width stay put
 * while the camera zooms instead of collapsing onto the cell polygons.
 */
const FIELD_TEXELS = 1024;
/** Coverage kernel radius as a fraction of the mean star spacing. */
const FIELD_RADIUS_FACTOR = 0.85;

export interface MapViewOptions {
  focusEmpireId: EmpireId | null;
  showContested: boolean;
  showDiplomacy: boolean;
  showFrontiers: boolean;
  showLanes: boolean;
  showLabels: boolean;
}

export interface MapViewCallbacks {
  /** Fired on a click that lands on (or very near) a star. */
  onSelectSystem?: (systemId: SystemId | null) => void;
}

interface SystemDraw {
  id: SystemId;
  index: number;
  starClass: StarClass;
  x: number;
  y: number;
  /** Vertex range in the cell mesh. */
  start: number;
  count: number;
}

function hexToRgb(hex: number): Rgb {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

/** Uncolonized stars stay dim so claimed space is what draws the eye. */
const UNCOLONIZED_STAR = hexToRgb(0x5d687c);
const FLASH = hexToRgb(COMBAT_FLASH);

export class MacroMapView {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private camera: OrthographicCamera;
  private screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** Behind territory: nebula and parallax starfields. */
  private backScene = new Scene();
  /** The cell mosaic, drawn only into an offscreen ownership buffer. */
  private ownerScene = new Scene();
  /** Offscreen coverage composite, rendered into the world-fixed field. */
  private fieldScene = new Scene();
  /** The composited field, drawn as one quad over the galaxy bounds. */
  private territoryScene = new Scene();
  /** In front of territory: lanes, fronts, stars, capitals, pacts. */
  private frontScene = new Scene();

  private labels: LabelLayer;
  private callbacks: MapViewCallbacks;

  private geometry: GalaxyGeometry | null = null;
  private draws: SystemDraw[] = [];
  private empireHues = new Map<EmpireId, number>();
  private empireNames = new Map<EmpireId, string>();

  private ownerTarget: WebGLRenderTarget | null = null;
  private fieldTarget: WebGLRenderTarget | null = null;
  private ownerCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private ownerMesh: Mesh | null = null;
  private ownerAttr: BufferAttribute | null = null;
  private fieldMaterial: ShaderMaterial | null = null;

  private nebulaMesh: Mesh | null = null;
  private nebulaTarget: WebGLRenderTarget | null = null;
  private starLayers: { points: Points; parallax: number }[] = [];

  private laneLines: LineSegments | null = null;
  private laneColorAttr: BufferAttribute | null = null;
  private frontMesh: Mesh | null = null;
  private pactLines: LineSegments | null = null;
  private systemPoints: Points | null = null;
  private systemSizeAttr: BufferAttribute | null = null;
  private systemColorAttr: BufferAttribute | null = null;
  private capitalPoints: Points | null = null;
  private capitalPosAttr: BufferAttribute | null = null;
  private capitalColorAttr: BufferAttribute | null = null;
  private capitalSizeAttr: BufferAttribute | null = null;

  private pulses = new Map<SystemId, number>();
  private frame = 0;
  private extent = 40;
  /** Half-width of the world square the ownership field covers. */
  private fieldExtent = 40;
  /** Typical distance between neighboring stars; drives world-space widths. */
  private meanSpacing = 2;
  private zoom = 1;
  private camX = 0;
  private camY = 0;
  private dragging = false;
  private dragMoved = 0;
  private lastX = 0;
  private lastY = 0;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    overlayHost: HTMLElement,
    callbacks: MapViewCallbacks = {},
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(VOID, 1);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.camera.position.z = 100;
    this.labels = new LabelLayer(overlayHost);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  // —— Setup ————————————————————————————————————————————————————

  setGalaxy(snapshot: MacroSnapshot): void {
    this.geometry = snapshot.geometry;
    this.empireHues.clear();
    this.empireNames.clear();
    for (const id of snapshot.empireOrder) {
      const e = snapshot.empires[id]!;
      this.empireHues.set(id, e.colorHue);
      this.empireNames.set(id, e.name);
    }

    this.extent = snapshot.geometry.radius * 1.14;
    this.meanSpacing =
      snapshot.geometry.radius *
      Math.sqrt(Math.PI / Math.max(1, snapshot.geometry.systems.length));
    this.fit();

    this.clearScenes();
    this.buildCellMesh(snapshot.geometry);
    this.buildTerritoryPass(snapshot.geometry);
    this.bakeNebula(snapshot.geometry);
    this.buildStarfields(snapshot.geometry.seed);
    this.buildLanes(snapshot.geometry);
    this.buildFronts();
    this.buildPacts();
    this.buildStars(snapshot);
    this.updateCamera();
  }

  fit(): void {
    this.zoom = 1;
    this.camX = 0;
    this.camY = 0;
    this.updateCamera();
  }

  pulseSystem(systemId: SystemId): void {
    this.pulses.set(systemId, 1);
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.onResize);
    this.clearScenes();
    this.ownerTarget?.dispose();
    this.fieldTarget?.dispose();
    this.nebulaTarget?.dispose();
    this.labels.dispose();
    this.renderer.dispose();
  }

  private clearScenes(): void {
    for (const scene of [
      this.backScene,
      this.ownerScene,
      this.fieldScene,
      this.territoryScene,
      this.frontScene,
    ]) {
      for (const child of [...scene.children]) {
        scene.remove(child);
        const obj = child as Mesh | Points | LineSegments;
        obj.geometry?.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    }
    this.draws = [];
    this.starLayers = [];
    this.ownerMesh = null;
    this.ownerAttr = null;
    this.fieldMaterial = null;
    this.nebulaMesh = null;
    this.laneLines = null;
    this.laneColorAttr = null;
    this.frontMesh = null;
    this.pactLines = null;
    this.systemPoints = null;
    this.systemSizeAttr = null;
    this.systemColorAttr = null;
    this.capitalPoints = null;
    this.capitalPosAttr = null;
    this.capitalColorAttr = null;
    this.capitalSizeAttr = null;
    this.pulses.clear();
  }

  /** Triangle fans over every cell; the fill color is rewritten each frame. */
  private buildCellMesh(geo: GalaxyGeometry): void {
    const positions: number[] = [];
    this.draws = [];

    for (const sys of geo.systems) {
      const cell = sys.cell;
      if (cell.length < 3) continue;
      const start = positions.length / 3;
      for (let i = 1; i < cell.length - 1; i++) {
        const a = cell[0]!;
        const b = cell[i]!;
        const c = cell[i + 1]!;
        positions.push(a.x, a.y, 0, b.x, b.y, 0, c.x, c.y, 0);
      }
      this.draws.push({
        id: sys.id,
        index: sys.index,
        starClass: sys.starClass,
        x: sys.site.x,
        y: sys.site.y,
        start,
        count: positions.length / 3 - start,
      });
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.ownerAttr = new BufferAttribute(
      new Float32Array((positions.length / 3) * 4),
      4,
    );
    buffer.setAttribute("aOwner", this.ownerAttr);

    this.ownerMesh = new Mesh(
      buffer,
      new ShaderMaterial({
        vertexShader: OWNER_VERT,
        fragmentShader: OWNER_FRAG,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.ownerScene.add(this.ownerMesh);
  }

  private buildTerritoryPass(geo: GalaxyGeometry): void {
    const half = geo.radius * 1.08;
    this.fieldExtent = half;
    this.ownerCamera.left = -half;
    this.ownerCamera.right = half;
    this.ownerCamera.top = half;
    this.ownerCamera.bottom = -half;
    this.ownerCamera.updateProjectionMatrix();

    const texelsPerUnit = FIELD_TEXELS / (2 * half);
    this.fieldMaterial = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TERRITORY_FRAG,
      uniforms: {
        uOwner: { value: null },
        uTexel: { value: new Vector2(1 / FIELD_TEXELS, 1 / FIELD_TEXELS) },
        uRadius: {
          value: Math.max(
            3,
            this.meanSpacing * texelsPerUnit * FIELD_RADIUS_FACTOR,
          ),
        },
        uRimBoost: { value: 0.52 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.fieldScene.add(new Mesh(new PlaneGeometry(2, 2), this.fieldMaterial));

    this.ensureFieldTargets();
    const quad = new Mesh(
      new PlaneGeometry(2 * half, 2 * half),
      new MeshBasicMaterial({
        map: this.fieldTarget!.texture,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.position.z = -1;
    this.territoryScene.add(quad);
  }

  private ensureFieldTargets(): void {
    const options = {
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
    } as const;
    if (!this.ownerTarget) {
      this.ownerTarget = new WebGLRenderTarget(
        FIELD_TEXELS,
        FIELD_TEXELS,
        options,
      );
    }
    if (!this.fieldTarget) {
      this.fieldTarget = new WebGLRenderTarget(
        FIELD_TEXELS,
        FIELD_TEXELS,
        options,
      );
    }
    // Rebind every time: a new galaxy builds a fresh composite material.
    if (this.fieldMaterial) {
      this.fieldMaterial.uniforms.uOwner!.value = this.ownerTarget.texture;
    }
  }

  /** Bake dust clouds once into a texture stretched over the galaxy bounds. */
  private bakeNebula(geo: GalaxyGeometry): void {
    const size = 1024;
    this.nebulaTarget?.dispose();
    this.nebulaTarget = new WebGLRenderTarget(size, size, {
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });

    const bakeScene = new Scene();
    const bakeMaterial = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: NEBULA_FRAG,
      uniforms: {
        uSeed: { value: (geo.seed % 1000) / 37 },
        uArms: { value: 3 + (geo.seed % 3) },
      },
      depthTest: false,
      depthWrite: false,
    });
    bakeScene.add(new Mesh(new PlaneGeometry(2, 2), bakeMaterial));

    this.renderer.setRenderTarget(this.nebulaTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, false, false);
    this.renderer.render(bakeScene, this.screenCamera);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(VOID, 1);
    bakeMaterial.dispose();
    bakeScene.children.forEach((c) => (c as Mesh).geometry.dispose());

    const span = geo.radius * 2.5;
    this.nebulaMesh = new Mesh(
      new PlaneGeometry(span, span),
      new MeshBasicMaterial({
        map: this.nebulaTarget.texture,
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.nebulaMesh.position.z = -20;
    this.backScene.add(this.nebulaMesh);
  }

  /**
   * The dust map is baked at galaxy scale, so magnifying it past a few times
   * only smears it. Fade it out as the viewer dives in.
   */
  private updateNebulaOpacity(): void {
    const material = this.nebulaMesh?.material as MeshBasicMaterial | undefined;
    if (!material) return;
    material.opacity = Math.max(0.05, Math.min(0.5, 0.5 - (this.zoom - 1.6) * 0.16));
  }

  /** Three seeded layers; each drifts at a different rate for depth. */
  private buildStarfields(seed: number): void {
    const layers = [
      { count: 1400, parallax: 0.12, size: 1.1, brightness: 0.42 },
      { count: 900, parallax: 0.06, size: 1.5, brightness: 0.6 },
      { count: 420, parallax: 0.02, size: 2.1, brightness: 0.85 },
    ];
    const span = this.extent * 3.2;

    layers.forEach((layer, li) => {
      const rng = createRng((seed ^ (li * 0x9e3779b9)) >>> 0);
      const pos = new Float32Array(layer.count * 3);
      const col = new Float32Array(layer.count * 3);
      const size = new Float32Array(layer.count);
      for (let i = 0; i < layer.count; i++) {
        pos[i * 3] = (rng() - 0.5) * span;
        pos[i * 3 + 1] = (rng() - 0.5) * span;
        pos[i * 3 + 2] = -10 - li;
        const tint = 0.82 + rng() * 0.18;
        const b = layer.brightness * (0.7 + rng() * 0.5);
        col[i * 3] = b * tint;
        col[i * 3 + 1] = b * (0.92 + rng() * 0.08);
        col[i * 3 + 2] = b;
        size[i] = layer.size * (0.7 + rng() * 0.8);
      }
      const buffer = new BufferGeometry();
      buffer.setAttribute("position", new BufferAttribute(pos, 3));
      buffer.setAttribute("aColor", new BufferAttribute(col, 3));
      buffer.setAttribute("aSize", new BufferAttribute(size, 1));
      const points = new Points(buffer, this.starMaterial(STAR_FRAG));
      points.position.z = -10 - li;
      this.backScene.add(points);
      this.starLayers.push({ points, parallax: layer.parallax });
    });
  }

  private starMaterial(fragment: string): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  private buildLanes(geo: GalaxyGeometry): void {
    const pos = new Float32Array(geo.lanes.length * 6);
    const col = new Float32Array(geo.lanes.length * 6);
    for (let i = 0; i < geo.lanes.length; i++) {
      const lane = geo.lanes[i]!;
      const a = geo.byId[lane.a]!.site;
      const b = geo.byId[lane.b]!.site;
      pos[i * 6] = a.x;
      pos[i * 6 + 1] = a.y;
      pos[i * 6 + 2] = 0.1;
      pos[i * 6 + 3] = b.x;
      pos[i * 6 + 4] = b.y;
      pos[i * 6 + 5] = 0.1;
    }
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(pos, 3));
    this.laneColorAttr = new BufferAttribute(col, 3);
    buffer.setAttribute("color", this.laneColorAttr);
    this.laneLines = new LineSegments(
      buffer,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.frontScene.add(this.laneLines);
  }

  private buildFronts(): void {
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(new Float32Array(0), 3));
    buffer.setAttribute("color", new BufferAttribute(new Float32Array(0), 3));
    this.frontMesh = new Mesh(
      buffer,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.frontScene.add(this.frontMesh);
  }

  private buildPacts(): void {
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(new Float32Array(0), 3));
    this.pactLines = new LineSegments(
      buffer,
      new LineBasicMaterial({
        color: CARGO,
        transparent: true,
        opacity: 0.34,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.frontScene.add(this.pactLines);
  }

  private buildStars(snapshot: MacroSnapshot): void {
    const n = this.draws.length;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const d = this.draws[i]!;
      pos[i * 3] = d.x;
      pos[i * 3 + 1] = d.y;
      pos[i * 3 + 2] = 1;
    }
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(pos, 3));
    this.systemColorAttr = new BufferAttribute(new Float32Array(n * 3), 3);
    this.systemSizeAttr = new BufferAttribute(new Float32Array(n), 1);
    buffer.setAttribute("aColor", this.systemColorAttr);
    buffer.setAttribute("aSize", this.systemSizeAttr);
    this.systemPoints = new Points(buffer, this.starMaterial(STAR_FRAG));
    this.frontScene.add(this.systemPoints);

    const count = snapshot.empireOrder.length;
    const capBuffer = new BufferGeometry();
    this.capitalPosAttr = new BufferAttribute(new Float32Array(count * 3), 3);
    this.capitalColorAttr = new BufferAttribute(new Float32Array(count * 3), 3);
    this.capitalSizeAttr = new BufferAttribute(new Float32Array(count), 1);
    capBuffer.setAttribute("position", this.capitalPosAttr);
    capBuffer.setAttribute("aColor", this.capitalColorAttr);
    capBuffer.setAttribute("aSize", this.capitalSizeAttr);
    this.capitalPoints = new Points(capBuffer, this.starMaterial(RING_FRAG));
    this.frontScene.add(this.capitalPoints);
  }

  // —— Frame ————————————————————————————————————————————————————

  render(view: InterpolatedSnapshot, opts: MapViewOptions): void {
    if (this.disposed || !this.geometry || !this.ownerTarget) return;
    this.frame++;

    const stats = this.updateSystems(view, opts);
    if (this.frame % 3 === 0) this.updateLanes(view, opts);
    if (this.frame % 2 === 0) this.updateFronts(view, opts);
    if (this.frame % 6 === 0) this.updatePacts(view, opts);
    if (this.frame % 4 === 0) this.updateLabels(view, opts, stats);
    this.decayPulses();
    this.updateNebulaOpacity();

    for (const layer of this.starLayers) {
      layer.points.position.x = this.camX * layer.parallax;
      layer.points.position.y = this.camY * layer.parallax;
    }

    // The world-fixed field only changes when ownership does, so it can run at
    // a fraction of the render rate.
    if (this.frame % 3 === 1 && this.fieldTarget) {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setRenderTarget(this.ownerTarget);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.ownerScene, this.ownerCamera);

      this.renderer.setRenderTarget(this.fieldTarget);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.fieldScene, this.screenCamera);
    }

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(VOID, 1);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.backScene, this.camera);
    this.renderer.render(this.territoryScene, this.camera);
    this.renderer.render(this.frontScene, this.camera);
  }

  /**
   * One pass over every star: writes cell ownership colors, star sprites, and
   * accumulates the per-empire centroids the label layer needs.
   */
  private updateSystems(
    view: InterpolatedSnapshot,
    opts: MapViewOptions,
  ): {
    centroids: Map<EmpireId, { x: number; y: number; n: number }>;
  } {
    const centroids = new Map<EmpireId, { x: number; y: number; n: number }>();
    if (!this.ownerAttr || !this.systemColorAttr || !this.systemSizeAttr) {
      return { centroids };
    }

    const owners = this.ownerAttr.array as Float32Array;
    const starColors = this.systemColorAttr.array as Float32Array;
    const starSizes = this.systemSizeAttr.array as Float32Array;
    const pixelRatio = this.renderer.getPixelRatio();
    const zoomBoost = Math.pow(this.zoom, 0.34);
    const focus = opts.focusEmpireId;

    for (let i = 0; i < this.draws.length; i++) {
      const draw = this.draws[i]!;
      const sys = view.systems[draw.id];
      if (!sys) continue;

      const ownerId =
        sys.ownerIdB && sys.ownerBlend > 0.5 ? sys.ownerIdB : sys.ownerId;
      const owned = ownerId !== null;

      let tint: Rgb;
      let cellAlpha: number;
      if (owned) {
        tint = empireAccent(this.empireHues.get(ownerId) ?? 0);
        cellAlpha = 1;
        const c = centroids.get(ownerId) ?? { x: 0, y: 0, n: 0 };
        c.x += draw.x;
        c.y += draw.y;
        c.n += 1;
        centroids.set(ownerId, c);
      } else {
        tint = UNCOLONIZED_STAR;
        cellAlpha = 0;
      }

      let r = tint.r;
      let g = tint.g;
      let b = tint.b;

      // Focus mode dims other empires' territory rather than hiding it.
      if (focus && owned && ownerId !== focus) {
        r *= 0.3;
        g *= 0.3;
        b *= 0.3;
      }

      const pulse = this.pulses.get(draw.id) ?? 0;
      if (pulse > 0) {
        const k = pulse * 0.55;
        r += (FLASH.r - r) * k;
        g += (FLASH.g - g) * k;
        b += (FLASH.b - b) * k;
      }

      for (let v = 0; v < draw.count; v++) {
        const o = (draw.start + v) * 4;
        owners[o] = r;
        owners[o + 1] = g;
        owners[o + 2] = b;
        owners[o + 3] = cellAlpha;
      }

      // Star sprite: colonized stars glow in empire colors and grow with population.
      const frontier =
        opts.showFrontiers && this.isFrontier(view, draw.id, ownerId, focus);
      const development = owned ? Math.min(1, sys.population / 260) : 0;
      let size = baseStarSize(draw.starClass) * (1 + development * 0.5);
      if (draw.id === this.capitalOf(ownerId, view)) size *= 1.15;
      if (frontier) size *= 1.4;
      size *= zoomBoost * pixelRatio;

      let sr = owned ? r : UNCOLONIZED_STAR.r;
      let sg = owned ? g : UNCOLONIZED_STAR.g;
      let sb = owned ? b : UNCOLONIZED_STAR.b;
      if (owned) {
        const lift = 1.25 + development * 0.45;
        sr *= lift;
        sg *= lift;
        sb *= lift;
      } else if (focus) {
        sr *= 0.45;
        sg *= 0.45;
        sb *= 0.45;
      }
      if (frontier) {
        sr = Math.min(1.6, sr * 1.5);
        sg = Math.min(1.6, sg * 1.5);
        sb = Math.min(1.6, sb * 1.5);
      }

      starColors[i * 3] = sr;
      starColors[i * 3 + 1] = sg;
      starColors[i * 3 + 2] = sb;
      starSizes[i] = size;
    }

    this.ownerAttr.needsUpdate = true;
    this.systemColorAttr.needsUpdate = true;
    this.systemSizeAttr.needsUpdate = true;
    this.updateCapitals(view, pixelRatio, zoomBoost);
    return { centroids };
  }

  private capitalOf(
    ownerId: EmpireId | null,
    view: InterpolatedSnapshot,
  ): SystemId | null {
    if (!ownerId) return null;
    return view.empires[ownerId]?.capitalSystemId ?? null;
  }

  private isFrontier(
    view: InterpolatedSnapshot,
    id: SystemId,
    ownerId: EmpireId | null,
    focus: EmpireId | null,
  ): boolean {
    if (!ownerId) return false;
    if (focus && ownerId !== focus) return false;
    const lanes = this.geometry?.byId[id]?.hyperlanes;
    if (!lanes) return false;
    for (const nid of lanes) {
      const n = view.systems[nid];
      if (!n) continue;
      if (n.ownerId !== ownerId) return true;
    }
    return false;
  }

  private updateCapitals(
    view: InterpolatedSnapshot,
    pixelRatio: number,
    zoomBoost: number,
  ): void {
    if (!this.capitalPosAttr || !this.capitalColorAttr || !this.capitalSizeAttr) {
      return;
    }
    const pos = this.capitalPosAttr.array as Float32Array;
    const col = this.capitalColorAttr.array as Float32Array;
    const size = this.capitalSizeAttr.array as Float32Array;

    for (let i = 0; i < view.empireOrder.length; i++) {
      const empire = view.empires[view.empireOrder[i]!]!;
      const geo = this.geometry?.byId[empire.capitalSystemId];
      if (geo) {
        pos[i * 3] = geo.site.x;
        pos[i * 3 + 1] = geo.site.y;
        pos[i * 3 + 2] = 2;
      }
      const accent = empireAccent(empire.colorHue);
      const live = empire.alive ? 1 : 0.2;
      col[i * 3] = accent.r * live;
      col[i * 3 + 1] = accent.g * live;
      col[i * 3 + 2] = accent.b * live;
      size[i] = (empire.alive ? 11 : 7) * zoomBoost * pixelRatio;
    }
    this.capitalPosAttr.needsUpdate = true;
    this.capitalColorAttr.needsUpdate = true;
    this.capitalSizeAttr.needsUpdate = true;
  }

  /** Lanes glow in empire colors inside their space, dim slate elsewhere. */
  private updateLanes(view: InterpolatedSnapshot, opts: MapViewOptions): void {
    if (!this.laneLines || !this.laneColorAttr || !this.geometry) return;
    this.laneLines.visible = opts.showLanes;
    if (!opts.showLanes) return;

    const col = this.laneColorAttr.array as Float32Array;
    const neutral = hexToRgb(LANE);
    // Fade the web out when zoomed far out so it never becomes a gray haze.
    const strength = Math.min(0.72, 0.16 + (this.zoom - MIN_ZOOM) * 0.22);

    for (let i = 0; i < this.geometry.lanes.length; i++) {
      const lane = this.geometry.lanes[i]!;
      const a = view.systems[lane.a];
      const b = view.systems[lane.b];
      const shared =
        a && b && a.ownerId && a.ownerId === b.ownerId ? a.ownerId : null;
      let r = neutral.r * 0.5;
      let g = neutral.g * 0.5;
      let bl = neutral.b * 0.55;
      if (shared) {
        const accent = empireAccent(this.empireHues.get(shared) ?? 0);
        const dim = opts.focusEmpireId && shared !== opts.focusEmpireId ? 0.3 : 1;
        r = accent.r * 0.34 * dim;
        g = accent.g * 0.34 * dim;
        bl = accent.b * 0.34 * dim;
      }
      r *= strength;
      g *= strength;
      bl *= strength;
      for (let v = 0; v < 2; v++) {
        const o = i * 6 + v * 3;
        col[o] = r;
        col[o + 1] = g;
        col[o + 2] = bl;
      }
    }
    this.laneColorAttr.needsUpdate = true;
  }

  /**
   * Fronts are drawn as quads along the real shared cell border, so a fight
   * appears exactly where the two empires meet.
   */
  private updateFronts(view: InterpolatedSnapshot, opts: MapViewOptions): void {
    if (!this.frontMesh || !this.geometry) return;
    this.frontMesh.visible = opts.showContested;
    if (!opts.showContested) return;

    const positions: number[] = [];
    const colors: number[] = [];
    const danger = hexToRgb(DANGER);
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() * 0.006);
    const seen = new Set<string>();
    // Scale to the gap between stars, not to the galaxy, or fronts become slabs.
    const baseWidth = this.meanSpacing * 0.035;

    for (const id of view.systemOrder) {
      const sys = view.systems[id]!;
      const front = sys.contested;
      if (!front || front.pct < 0.05 || !sys.ownerId) continue;
      if (
        opts.focusEmpireId &&
        sys.ownerId !== opts.focusEmpireId &&
        front.vs !== opts.focusEmpireId
      ) {
        continue;
      }
      for (const nid of this.geometry.byId[id]!.hyperlanes) {
        if (view.systems[nid]?.ownerId !== front.vs) continue;
        const key = borderKey(id, nid);
        if (seen.has(key)) continue;
        seen.add(key);
        const edge = this.geometry.borderEdgeByKey[key];
        if (!edge) continue;

        const dx = edge.p1.x - edge.p0.x;
        const dy = edge.p1.y - edge.p0.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * baseWidth * (0.6 + front.pct * 1.9);
        const ny = (dx / len) * baseWidth * (0.6 + front.pct * 1.9);

        positions.push(
          edge.p0.x + nx, edge.p0.y + ny, 0.6,
          edge.p1.x + nx, edge.p1.y + ny, 0.6,
          edge.p1.x - nx, edge.p1.y - ny, 0.6,
          edge.p0.x + nx, edge.p0.y + ny, 0.6,
          edge.p1.x - nx, edge.p1.y - ny, 0.6,
          edge.p0.x - nx, edge.p0.y - ny, 0.6,
        );
        const heat = (0.35 + front.pct * 0.9) * pulse;
        for (let v = 0; v < 6; v++) {
          colors.push(danger.r * heat, danger.g * heat * 0.8, danger.b * heat * 0.7);
        }
      }
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(positions), 3),
    );
    buffer.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    this.frontMesh.geometry.dispose();
    this.frontMesh.geometry = buffer;
  }

  /** Pacts arc between throneworlds instead of cutting straight across. */
  private updatePacts(view: InterpolatedSnapshot, opts: MapViewOptions): void {
    if (!this.pactLines || !this.geometry) return;
    this.pactLines.visible = opts.showDiplomacy;
    if (!opts.showDiplomacy) return;

    const positions: number[] = [];
    const seen = new Set<string>();
    const steps = 16;

    for (const id of view.empireOrder) {
      const empire = view.empires[id]!;
      if (!empire.alive) continue;
      const from = this.geometry.byId[empire.capitalSystemId]?.site;
      if (!from) continue;
      for (const allyId of empire.allies) {
        const key = id < allyId ? `${id}|${allyId}` : `${allyId}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ally = view.empires[allyId];
        if (!ally?.alive) continue;
        const to = this.geometry.byId[ally.capitalSystemId]?.site;
        if (!to) continue;

        // Bow the arc perpendicular to the chord.
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const cx = mx + (-dy / len) * len * 0.18;
        const cy = my + (dx / len) * len * 0.18;

        let px = from.x;
        let py = from.y;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          const qx = u * u * from.x + 2 * u * t * cx + t * t * to.x;
          const qy = u * u * from.y + 2 * u * t * cy + t * t * to.y;
          positions.push(px, py, 0.9, qx, qy, 0.9);
          px = qx;
          py = qy;
        }
      }
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.pactLines.geometry.dispose();
    this.pactLines.geometry = buffer;
  }

  private updateLabels(
    view: InterpolatedSnapshot,
    opts: MapViewOptions,
    stats: { centroids: Map<EmpireId, { x: number; y: number; n: number }> },
  ): void {
    if (!this.geometry) return;
    if (!opts.showLabels) {
      this.labels.update([], [], this.projection(), 0);
      return;
    }

    // Only the significant powers get a name, or the map turns into a word cloud.
    const ranked = [...stats.centroids.entries()]
      .filter(([id, c]) => c.n >= 4 && view.empires[id]?.alive)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 20);
    const empireLabels: EmpireLabel[] = ranked.map(([id, c]) => {
      const empire = view.empires[id]!;
      return {
        id,
        name: empire.name,
        colorHue: empire.colorHue,
        x: c.x / c.n,
        y: c.y / c.n,
        territory: c.n,
        radius: this.territoryRadius(c.n),
        focused: opts.focusEmpireId === id,
      };
    });
    if (opts.focusEmpireId && !empireLabels.some((l) => l.focused)) {
      const c = stats.centroids.get(opts.focusEmpireId);
      const empire = view.empires[opts.focusEmpireId];
      if (c && empire) {
        empireLabels.push({
          id: opts.focusEmpireId,
          name: empire.name,
          colorHue: empire.colorHue,
          x: c.x / c.n,
          y: c.y / c.n,
          territory: c.n,
          radius: this.territoryRadius(c.n),
          focused: true,
        });
      }
    }

    const systemLabels: SystemLabel[] = [];
    if (this.zoom >= SYSTEM_LABEL_ZOOM) {
      const halfH = this.extent / this.zoom;
      const halfW = halfH * this.aspect();
      for (const draw of this.draws) {
        if (systemLabels.length >= MAX_SYSTEM_LABELS) break;
        if (Math.abs(draw.x - this.camX) > halfW) continue;
        if (Math.abs(draw.y - this.camY) > halfH) continue;
        const geo = this.geometry.byId[draw.id]!;
        systemLabels.push({
          id: draw.id,
          name: geo.name,
          x: draw.x,
          y: draw.y,
          owned: view.systems[draw.id]?.ownerId != null,
        });
      }
    }

    // Empire names recede as the viewer dives into individual systems.
    const empireOpacity = this.zoom >= SYSTEM_LABEL_ZOOM ? 0.35 : 0.9;
    this.labels.update(
      empireLabels,
      systemLabels,
      this.projection(),
      empireOpacity,
    );
  }

  /** Each system covers roughly one spacing square, so area gives the radius. */
  private territoryRadius(systemCount: number): number {
    return Math.sqrt(systemCount / Math.PI) * this.meanSpacing;
  }

  private decayPulses(): void {
    for (const [id, v] of this.pulses) {
      const next = v - 0.03;
      if (next <= 0) this.pulses.delete(id);
      else this.pulses.set(id, next);
    }
  }

  // —— Camera ————————————————————————————————————————————————————

  private aspect(): number {
    return (
      (this.canvas.clientWidth || 1) / Math.max(1, this.canvas.clientHeight)
    );
  }

  private projection(): ScreenProjection {
    const halfH = this.extent / this.zoom;
    const halfW = halfH * this.aspect();
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const camX = this.camX;
    const camY = this.camY;
    return {
      width,
      height,
      pxPerUnit: width / (2 * halfW),
      toScreen(x: number, y: number) {
        return {
          x: ((x - (camX - halfW)) / (2 * halfW)) * width,
          y: (1 - (y - (camY - halfH)) / (2 * halfH)) * height,
        };
      },
    };
  }

  private clampPan(): void {
    const limit = this.extent * 1.15;
    this.camX = Math.max(-limit, Math.min(limit, this.camX));
    this.camY = Math.max(-limit, Math.min(limit, this.camY));
  }

  private updateCamera(): void {
    this.clampPan();
    const halfH = this.extent / this.zoom;
    const halfW = halfH * this.aspect();
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
    this.dragMoved = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    const halfH = this.extent / this.zoom;
    const halfW = halfH * this.aspect();
    this.camX -= (dx / (this.canvas.clientWidth || 1)) * halfW * 2;
    this.camY += (dy / (this.canvas.clientHeight || 1)) * halfH * 2;
    this.updateCamera();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging;
    this.dragging = false;
    this.releasePointer(e.pointerId);
    if (!wasDragging || this.dragMoved > 5) return;
    this.pickAt(e.clientX, e.clientY);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.dragging = false;
    this.releasePointer(e.pointerId);
  };

  private releasePointer(pointerId: number): void {
    try {
      this.canvas.releasePointerCapture(pointerId);
    } catch {
      /* pointer already released */
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const my = (e.clientY - rect.top) / Math.max(1, rect.height);

    // Keep the star under the cursor pinned while zooming.
    const halfH = this.extent / this.zoom;
    const halfW = halfH * this.aspect();
    const worldX = this.camX - halfW + mx * 2 * halfW;
    const worldY = this.camY + halfH - my * 2 * halfH;

    const factor = e.deltaY > 0 ? 0.88 : 1 / 0.88;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));

    const nh = this.extent / this.zoom;
    const nw = nh * this.aspect();
    this.camX = worldX + nw - mx * 2 * nw;
    this.camY = worldY - nh + my * 2 * nh;
    this.updateCamera();
  };

  private pickAt(clientX: number, clientY: number): void {
    if (!this.callbacks.onSelectSystem || this.draws.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) / Math.max(1, rect.width);
    const my = (clientY - rect.top) / Math.max(1, rect.height);
    const halfH = this.extent / this.zoom;
    const halfW = halfH * this.aspect();
    const wx = this.camX - halfW + mx * 2 * halfW;
    const wy = this.camY + halfH - my * 2 * halfH;

    let bestId: SystemId | null = null;
    let bestD = Infinity;
    for (const draw of this.draws) {
      const dx = draw.x - wx;
      const dy = draw.y - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestId = draw.id;
      }
    }
    // Only count clicks that land within a comfortable tap radius.
    const tolerance = halfH * 0.06;
    this.callbacks.onSelectSystem(
      bestId && Math.sqrt(bestD) <= tolerance ? bestId : null,
    );
  }
}

function baseStarSize(starClass: StarClass): number {
  switch (starClass) {
    case "core":
      return 3.8;
    case "main":
      return 2.7;
    case "dim":
      return 1.9;
  }
}
