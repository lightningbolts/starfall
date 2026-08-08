import {
  createMacroMatch,
  easeInOutCubic,
  lerpSnapshot,
  stepLogic,
  type MacroConfig,
  type MacroEvent,
  type MacroSnapshot,
  type MacroState,
  type MapSizeTier,
} from "@starfall/macro-sim";
import {
  createDashboardState,
  createTrendHistory,
  MacroDashboard,
  pushTrends,
} from "./dashboard.js";
import { MacroMapView } from "./mapView.js";

export interface ChronicleLaunchOptions {
  mapSize?: MapSizeTier;
  seed?: number;
}

let active: { stop: () => void } | null = null;

export function isChronicleActive(): boolean {
  return active !== null;
}

export function stopChronicle(): void {
  active?.stop();
  active = null;
}

export function startChronicle(
  app: HTMLElement,
  opts: ChronicleLaunchOptions = {},
): void {
  stopChronicle();

  const mapSize = opts.mapSize ?? "medium";
  const { state, config, snapshot } = createMacroMatch({
    seed: opts.seed,
    mapSize,
  });

  app.innerHTML = `
    <section class="chronicle" id="chronicle">
      <canvas id="chronicle-map"></canvas>
    </section>
  `;

  const canvas = app.querySelector<HTMLCanvasElement>("#chronicle-map")!;
  const section = app.querySelector<HTMLElement>("#chronicle")!;
  const map = new MacroMapView(canvas);
  map.setStaticGalaxy(snapshot);

  let prev: MacroSnapshot = snapshot;
  let next: MacroSnapshot = snapshot;
  let sim: MacroState = state;
  const cfg: MacroConfig = config;
  let logicStartedAt = performance.now();
  let pendingEvents: MacroEvent[] = [];
  const dashState = createDashboardState();
  const trends = createTrendHistory();
  pushTrends(trends, lerpSnapshot(prev, next, 1));

  const dash = new MacroDashboard(section, dashState, trends, () => {
    /* dashboard mutates dashState in place */
  });

  dash.root.querySelector("#ch-exit")?.addEventListener("click", () => {
    stopChronicle();
    location.hash = "";
    location.reload();
  });

  let raf = 0;
  let stopped = false;

  const frame = (now: number): void => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);

    const st = dash.getState();
    const interval = cfg.logicIntervalMs / st.speed;

    if (!st.paused && next.status === "running") {
      if (now - logicStartedAt >= interval) {
        prev = next;
        const result = stepLogic(sim, cfg);
        sim = result.state;
        next = result.snapshot;
        pendingEvents = result.newEvents;
        pushTrends(trends, lerpSnapshot(prev, next, 1, (t) => t));
        for (const ev of result.newEvents) {
          if (
            ev.regionId &&
            (ev.kind === "front_collapse" ||
              ev.kind === "capital_fallen" ||
              ev.kind === "relic_discovery")
          ) {
            map.pulseRegion(ev.regionId);
          }
        }
        logicStartedAt = now;
      }
    } else if (st.paused) {
      logicStartedAt = now - ((now - logicStartedAt) % interval);
    }

    const rawT = Math.min(1, (now - logicStartedAt) / interval);
    const view = lerpSnapshot(prev, next, rawT, easeInOutCubic);

    map.render(view, {
      focusEmpireId: st.focusEmpireId,
      showContested: st.overlays.contested,
      showDiplomacy: st.overlays.diplomacy,
      showFrontiers: st.overlays.frontiers,
      seed: sim.seed,
    });
    dash.sync(view, pendingEvents);
    pendingEvents = [];
  };

  raf = requestAnimationFrame(frame);

  active = {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      map.dispose();
      dash.dispose();
    },
  };
}

export function readChronicleHash(): ChronicleLaunchOptions | null {
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith("/chronicle")) return null;
  const qs = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(qs);
  const mapSize = (params.get("size") as MapSizeTier | null) ?? "medium";
  const seedParam = params.get("seed");
  return {
    mapSize: ["small", "medium", "large"].includes(mapSize) ? mapSize : "medium",
    ...(seedParam ? { seed: Number(seedParam) >>> 0 } : {}),
  };
}

export function writeChronicleHash(opts: ChronicleLaunchOptions): void {
  const params = new URLSearchParams();
  params.set("size", opts.mapSize ?? "medium");
  if (opts.seed != null) params.set("seed", String(opts.seed));
  location.hash = `/chronicle?${params.toString()}`;
}

