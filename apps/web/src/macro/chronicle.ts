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
import { eventPulseColor } from "./palette.js";

export interface ChronicleLaunchOptions {
  mapSize?: MapSizeTier;
  seed?: number;
}

export interface ChronicleHooks {
  /** Called when the viewer leaves Chronicle, so the host can show its own UI. */
  onExit?: () => void;
}

interface ActiveChronicle {
  stop: () => void;
  options: ChronicleLaunchOptions;
  hooks: ChronicleHooks;
}

let active: ActiveChronicle | null = null;
let hashListenerInstalled = false;

export function isChronicleActive(): boolean {
  return active !== null;
}

export function stopChronicle(): void {
  const current = active;
  active = null;
  current?.stop();
}

/** Leave Chronicle and hand control back to the host page. */
export function exitChronicle(): void {
  const hooks = active?.hooks;
  stopChronicle();
  if (location.hash.startsWith("#/chronicle")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  hooks?.onExit?.();
}

export function startChronicle(
  host: HTMLElement,
  opts: ChronicleLaunchOptions = {},
  hooks: ChronicleHooks = {},
): void {
  stopChronicle();
  installHashListener();

  const mapSize = opts.mapSize ?? "medium";
  const { state, config, snapshot } = createMacroMatch({
    seed: opts.seed,
    mapSize,
  });

  const section = document.createElement("section");
  section.className = "chronicle";
  section.id = "chronicle";
  section.innerHTML = `<canvas id="chronicle-map"></canvas>`;
  host.appendChild(section);
  document.body.classList.add("chronicle-active");

  const canvas = section.querySelector<HTMLCanvasElement>("#chronicle-map")!;
  const dashState = createDashboardState();
  const trends = createTrendHistory();

  const map = new MacroMapView(canvas, section, {
    onSelectSystem: (systemId) => {
      dash.setSelectedSystem(systemId);
      if (systemId) {
        const owner = next.systems[systemId]?.ownerId ?? null;
        if (owner) dash.setFocus(owner);
      }
    },
  });
  map.setGalaxy(snapshot);

  let prev: MacroSnapshot = snapshot;
  let next: MacroSnapshot = snapshot;
  let sim: MacroState = state;
  const cfg: MacroConfig = config;
  let logicStartedAt = performance.now();
  let pendingEvents: MacroEvent[] = [];

  pushTrends(trends, lerpSnapshot(prev, next, 1));

  const dash = new MacroDashboard(section, dashState, trends, () => {
    // Control changes take effect on the next frame's render options; the
    // dashboard re-renders itself immediately via `invalidate`.
    dash.invalidate();
  });
  dash.setSeedLabel(sim.seed);

  const launchOptions: ChronicleLaunchOptions = { mapSize, seed: sim.seed };
  writeChronicleHash(launchOptions, true);

  dash.root.querySelector("#ch-exit")?.addEventListener("pointerdown", (e) => {
    if ((e as PointerEvent).button !== 0) return;
    e.preventDefault();
    exitChronicle();
  });
  dash.root.querySelector("#ch-fit")?.addEventListener("pointerdown", (e) => {
    if ((e as PointerEvent).button !== 0) return;
    e.preventDefault();
    map.fit();
  });
  dash.root.querySelector("#ch-restart")?.addEventListener("pointerdown", (e) => {
    if ((e as PointerEvent).button !== 0) return;
    e.preventDefault();
    startChronicle(host, { mapSize }, hooks);
  });

  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA")
    ) {
      return;
    }
    const st = dash.getState();
    switch (e.key) {
      case " ":
        e.preventDefault();
        st.paused = !st.paused;
        break;
      case "1":
      case "2":
      case "4":
        st.speed = Number(e.key) as 1 | 2 | 4;
        st.paused = false;
        break;
      case "0":
      case "5":
        st.speed = 10;
        st.paused = false;
        break;
      case "f":
      case "F":
        map.fit();
        break;
      case "Escape":
        dash.setSelectedSystem(null);
        dash.setFocus(null);
        break;
      default:
        return;
    }
    // Keyboard changes bypass the panel handlers, so push button state manually.
    dash.refreshChrome();
  };
  window.addEventListener("keydown", onKey);

  let raf = 0;
  let stopped = false;
  let wasPaused = false;

  const frame = (now: number): void => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);

    const st = dash.getState();
    const interval = cfg.logicIntervalMs / st.speed;

    if (!st.paused && next.status === "running") {
      if (wasPaused) {
        // Resume from a clean phase so we don't inherit a wrapped pause offset.
        logicStartedAt = now;
        wasPaused = false;
      }
      if (now - logicStartedAt >= interval) {
        prev = next;
        const result = stepLogic(sim, cfg);
        sim = result.state;
        next = result.snapshot;
        pendingEvents = result.newEvents;
        pushTrends(trends, lerpSnapshot(prev, next, 1, (t) => t));
        for (const ev of result.newEvents) {
          if (!ev.systemId) continue;
          if (
            ev.kind === "front_collapse" ||
            ev.kind === "capital_fallen" ||
            ev.kind === "relic_discovery" ||
            ev.kind === "fleet_battle" ||
            ev.kind === "border_clash" ||
            ev.kind === "offensive_blitz" ||
            ev.kind === "defensive_stronghold" ||
            ev.kind === "plague" ||
            ev.kind === "rebellion" ||
            ev.kind === "territory_abandoned" ||
            ev.kind === "pirate_raid" ||
            ev.kind === "robbery" ||
            ev.kind === "tech_breakthrough" ||
            ev.kind === "coup" ||
            ev.kind === "planetary_built"
          ) {
            map.pulseSystem(ev.systemId, eventPulseColor(ev.kind));
          }
        }
        logicStartedAt = now;
      }
    } else if (st.paused) {
      wasPaused = true;
    }

    // While paused, pin to the latest snapshot — wrapping the lerp phase made
    // contested fronts and power figures flicker between two states.
    const rawT = st.paused ? 1 : Math.min(1, (now - logicStartedAt) / interval);
    const view = lerpSnapshot(prev, next, rawT, easeInOutCubic);

    map.render(view, {
      focusEmpireId: st.focusEmpireId,
      showContested: st.overlays.contested,
      showDiplomacy: st.overlays.diplomacy,
      showFrontiers: st.overlays.frontiers,
      showLanes: st.overlays.lanes,
      showLabels: st.overlays.labels,
    });
    dash.sync(view, pendingEvents);
    pendingEvents = [];
  };

  raf = requestAnimationFrame(frame);

  active = {
    options: launchOptions,
    hooks,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      map.dispose();
      dash.dispose();
      section.remove();
      document.body.classList.remove("chronicle-active");
    },
  };
}

/** Back/forward should move in and out of Chronicle like any other route. */
function installHashListener(): void {
  if (hashListenerInstalled) return;
  hashListenerInstalled = true;
  window.addEventListener("hashchange", () => {
    const target = readChronicleHash();
    if (!target) {
      if (active) {
        const hooks = active.hooks;
        stopChronicle();
        hooks.onExit?.();
      }
      return;
    }
    if (!active) return;
    const same =
      active.options.mapSize === target.mapSize &&
      active.options.seed === target.seed;
    if (same) return;
    const host = document.body;
    startChronicle(host, target, active.hooks);
  });
}

export function readChronicleHash(): ChronicleLaunchOptions | null {
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith("/chronicle")) return null;
  const qs = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(qs);
  const size = params.get("size") as MapSizeTier | null;
  const mapSize: MapSizeTier =
    size && ["small", "medium", "large"].includes(size) ? size : "medium";
  const seedParam = params.get("seed");
  const seed = seedParam !== null ? Number(seedParam) >>> 0 : undefined;
  return seed !== undefined ? { mapSize, seed } : { mapSize };
}

export function writeChronicleHash(
  opts: ChronicleLaunchOptions,
  replace = false,
): void {
  const params = new URLSearchParams();
  params.set("size", opts.mapSize ?? "medium");
  if (opts.seed != null) params.set("seed", String(opts.seed));
  const hash = `#/chronicle?${params.toString()}`;
  if (replace) history.replaceState(null, "", location.pathname + location.search + hash);
  else location.hash = hash;
}
