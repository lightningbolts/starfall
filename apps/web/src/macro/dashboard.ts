import { archetypeLabel, type EmpireId, type InterpolatedSnapshot, type MacroEvent } from "@starfall/macro-sim";

export type OverlayId = "contested" | "diplomacy" | "frontiers";
export type RosterSort = "territory" | "population" | "credits" | "garrison" | "name";

export interface DashboardState {
  focusEmpireId: EmpireId | null;
  pinTopN: number;
  rosterSort: RosterSort;
  rosterAsc: boolean;
  overlays: Record<OverlayId, boolean>;
  panels: {
    roster: boolean;
    feed: boolean;
    trends: boolean;
    overlays: boolean;
  };
  paused: boolean;
  speed: 1 | 2 | 4;
}

export interface TrendHistory {
  /** empireId -> ring buffers */
  territory: Map<EmpireId, number[]>;
  population: Map<EmpireId, number[]>;
  credits: Map<EmpireId, number[]>;
}

const TREND_LEN = 48;

export function createDashboardState(): DashboardState {
  return {
    focusEmpireId: null,
    pinTopN: 8,
    rosterSort: "territory",
    rosterAsc: false,
    overlays: { contested: true, diplomacy: false, frontiers: true },
    // Map-first: only roster + feed open by default
    panels: { roster: true, feed: true, trends: false, overlays: false },
    paused: false,
    speed: 1,
  };
}

export function createTrendHistory(): TrendHistory {
  return {
    territory: new Map(),
    population: new Map(),
    credits: new Map(),
  };
}

export function pushTrends(history: TrendHistory, view: InterpolatedSnapshot): void {
  for (const id of view.empireOrder) {
    const e = view.empires[id]!;
    push(history.territory, id, e.territory);
    push(history.population, id, e.population);
    push(history.credits, id, e.credits);
  }
}

function push(map: Map<EmpireId, number[]>, id: EmpireId, v: number): void {
  let arr = map.get(id);
  if (!arr) {
    arr = [];
    map.set(id, arr);
  }
  arr.push(v);
  if (arr.length > TREND_LEN) arr.shift();
}

export class MacroDashboard {
  readonly root: HTMLElement;
  private state: DashboardState;
  private trends: TrendHistory;
  private onChange: (s: DashboardState) => void;
  private lastFeedLen = 0;

  constructor(
    parent: HTMLElement,
    state: DashboardState,
    trends: TrendHistory,
    onChange: (s: DashboardState) => void,
  ) {
    this.state = state;
    this.trends = trends;
    this.onChange = onChange;
    this.root = document.createElement("div");
    this.root.className = "chronicle-dash";
    this.root.innerHTML = shellHtml();
    parent.appendChild(this.root);
    this.bind();
    this.syncChrome();
  }

  dispose(): void {
    this.root.remove();
  }

  getState(): DashboardState {
    return this.state;
  }

  sync(view: InterpolatedSnapshot, newEvents: MacroEvent[]): void {
    this.renderRoster(view);
    this.renderFeed(view, newEvents);
    this.renderTrends(view);
    this.renderFilters(view);
    const tickEl = this.root.querySelector("#ch-tick");
    if (tickEl) tickEl.textContent = `Tick ${view.tick}`;
    const statusEl = this.root.querySelector("#ch-status");
    if (statusEl) {
      statusEl.textContent =
        view.status === "ended" ? "Ended" : this.state.paused ? "Paused" : `${this.state.speed}×`;
    }
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-panel-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.panelToggle as keyof DashboardState["panels"];
        this.state.panels[key] = !this.state.panels[key];
        this.syncChrome();
        this.onChange(this.state);
      });
    });

    this.root.querySelectorAll<HTMLInputElement>("[data-overlay]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.overlay as OverlayId;
        this.state.overlays[key] = input.checked;
        this.onChange(this.state);
      });
    });

    this.root.querySelector("#ch-pause")?.addEventListener("click", () => {
      this.state.paused = !this.state.paused;
      this.syncChrome();
      this.onChange(this.state);
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.speed = Number(btn.dataset.speed) as 1 | 2 | 4;
        this.state.paused = false;
        this.syncChrome();
        this.onChange(this.state);
      });
    });

    this.root.querySelector("#ch-pin-n")?.addEventListener("change", (e) => {
      this.state.pinTopN = Number((e.target as HTMLSelectElement).value);
      this.onChange(this.state);
    });

    this.root.querySelector("#ch-sort")?.addEventListener("change", (e) => {
      this.state.rosterSort = (e.target as HTMLSelectElement).value as RosterSort;
      this.onChange(this.state);
    });

    this.root.querySelector("#ch-sort-dir")?.addEventListener("click", () => {
      this.state.rosterAsc = !this.state.rosterAsc;
      this.syncChrome();
      this.onChange(this.state);
    });

    this.root.querySelector("#ch-clear-focus")?.addEventListener("click", () => {
      this.state.focusEmpireId = null;
      this.onChange(this.state);
    });
  }

  private syncChrome(): void {
    for (const key of Object.keys(this.state.panels) as (keyof DashboardState["panels"])[]) {
      const panel = this.root.querySelector(`[data-panel="${key}"]`);
      if (!panel) continue;
      const show = this.state.panels[key];
      panel.classList.toggle("hidden", !show);
      if (show) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      const btn = this.root.querySelector(`[data-panel-toggle="${key}"]`);
      btn?.classList.toggle("is-active", show);
    }
    const pause = this.root.querySelector("#ch-pause");
    if (pause) pause.textContent = this.state.paused ? "Resume" : "Pause";
    this.root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.speed) === this.state.speed && !this.state.paused);
    });
    const dir = this.root.querySelector("#ch-sort-dir");
    if (dir) dir.textContent = this.state.rosterAsc ? "↑" : "↓";
    for (const key of Object.keys(this.state.overlays) as OverlayId[]) {
      const input = this.root.querySelector<HTMLInputElement>(`[data-overlay="${key}"]`);
      if (input) input.checked = this.state.overlays[key];
    }
  }

  private renderRoster(view: InterpolatedSnapshot): void {
    const body = this.root.querySelector("#ch-roster-body");
    if (!body) return;

    const rows = view.empireOrder.map((id) => ({ id, ...view.empires[id]! }));
    const sort = this.state.rosterSort;
    rows.sort((a, b) => {
      const av = sort === "name" ? a.name : a[sort];
      const bv = sort === "name" ? b.name : b[sort];
      if (typeof av === "string" && typeof bv === "string") {
        return this.state.rosterAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return this.state.rosterAsc
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });

    const pinned = rows.slice(0, this.state.pinTopN);
    body.innerHTML = pinned
      .map((e) => {
        const focused = this.state.focusEmpireId === e.id;
        const dead = !e.alive ? " is-dead" : "";
        const hue = ((e.colorHue % 360) + 360) % 360;
        return `<button type="button" class="ch-roster-row${focused ? " is-focus" : ""}${dead}" data-empire="${e.id}">
          <span class="ch-swatch" style="background:hsl(${hue} 62% 48%)"></span>
          <span class="ch-name">${escapeHtml(e.name)}</span>
          <span class="ch-arch">${archetypeLabel(e.archetype)}</span>
          <span class="ch-num">${Math.round(e.territory)}</span>
          <span class="ch-num">${fmt(e.population)}</span>
          <span class="ch-num">${fmt(e.credits)}</span>
          <span class="ch-num">${fmt(e.garrison)}</span>
        </button>`;
      })
      .join("");

    body.querySelectorAll<HTMLButtonElement>("[data-empire]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.empire as EmpireId;
        this.state.focusEmpireId = this.state.focusEmpireId === id ? null : id;
        this.onChange(this.state);
      });
    });
  }

  private renderFeed(view: InterpolatedSnapshot, newEvents: MacroEvent[]): void {
    const feed = this.root.querySelector("#ch-feed");
    if (!feed) return;
    if (view.events.length === this.lastFeedLen && newEvents.length === 0) return;
    this.lastFeedLen = view.events.length;
    const recent = view.events.slice(-40).reverse();
    feed.innerHTML = recent
      .map(
        (ev) =>
          `<div class="ch-feed-line" data-kind="${ev.kind}"><span class="ch-feed-tick">t${ev.tick}</span> ${escapeHtml(ev.text)}</div>`,
      )
      .join("");
  }

  private renderTrends(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector("#ch-trends");
    if (!host) return;
    const focus =
      this.state.focusEmpireId ??
      view.empireOrder
        .slice()
        .sort((a, b) => view.empires[b]!.territory - view.empires[a]!.territory)[0];
    if (!focus) {
      host.innerHTML = "";
      return;
    }
    const e = view.empires[focus]!;
    host.innerHTML = `
      <div class="ch-trend-title">${escapeHtml(e.name)}</div>
      <div class="ch-spark-row"><span>Territory</span>${sparkSvg(this.trends.territory.get(focus) ?? [])}</div>
      <div class="ch-spark-row"><span>Population</span>${sparkSvg(this.trends.population.get(focus) ?? [])}</div>
      <div class="ch-spark-row"><span>Credits</span>${sparkSvg(this.trends.credits.get(focus) ?? [])}</div>
    `;
  }

  private renderFilters(view: InterpolatedSnapshot): void {
    const label = this.root.querySelector("#ch-focus-label");
    if (!label) return;
    if (!this.state.focusEmpireId) {
      label.textContent = "All empires";
      return;
    }
    label.textContent = view.empires[this.state.focusEmpireId]?.name ?? "—";
  }
}

function sparkSvg(values: number[]): string {
  if (values.length < 2) return `<svg class="ch-spark" viewBox="0 0 100 24"></svg>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 22 - ((v - min) / span) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="ch-spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`;
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shellHtml(): string {
  return `
    <div class="chronicle-top">
      <div class="chronicle-brand">Starfall <span>Chronicle</span></div>
      <div class="chronicle-meta">
        <span id="ch-tick">Tick 0</span>
        <span id="ch-status">1×</span>
      </div>
      <div class="chronicle-controls">
        <button type="button" class="btn" id="ch-pause">Pause</button>
        <button type="button" class="btn" data-speed="1">1×</button>
        <button type="button" class="btn" data-speed="2">2×</button>
        <button type="button" class="btn" data-speed="4">4×</button>
        <button type="button" class="btn" id="ch-exit">Exit</button>
      </div>
    </div>
    <nav class="chronicle-rail" aria-label="Chronicle panels">
      <button type="button" class="rail-tab is-active" data-panel-toggle="roster">Roster</button>
      <button type="button" class="rail-tab is-active" data-panel-toggle="feed">Feed</button>
      <button type="button" class="rail-tab" data-panel-toggle="trends">Trends</button>
      <button type="button" class="rail-tab" data-panel-toggle="overlays">Overlays</button>
    </nav>
    <aside class="chronicle-panel" data-panel="roster">
      <div class="ch-panel-head">
        <h2>Empires</h2>
        <div class="ch-tools">
          <select id="ch-sort">
            <option value="territory">Territory</option>
            <option value="population">Population</option>
            <option value="credits">Credits</option>
            <option value="garrison">Garrison</option>
            <option value="name">Name</option>
          </select>
          <button type="button" class="btn btn-compact" id="ch-sort-dir">↓</button>
          <select id="ch-pin-n">
            <option value="5">Top 5</option>
            <option value="8" selected>Top 8</option>
            <option value="12">Top 12</option>
            <option value="20">Top 20</option>
          </select>
        </div>
      </div>
      <div class="ch-roster-head">
        <span></span><span>Name</span><span>Archetype</span><span>Terr</span><span>Pop</span><span>¢</span><span>Gar</span>
      </div>
      <div id="ch-roster-body" class="ch-roster-body"></div>
      <div class="ch-focus-row">
        Focus: <strong id="ch-focus-label">All empires</strong>
        <button type="button" class="btn btn-compact" id="ch-clear-focus">Clear</button>
      </div>
    </aside>
    <aside class="chronicle-panel chronicle-feed-panel" data-panel="feed">
      <h2>Event feed</h2>
      <div id="ch-feed" class="ch-feed"></div>
    </aside>
    <aside class="chronicle-panel" data-panel="trends" hidden>
      <h2>Trends</h2>
      <div id="ch-trends"></div>
    </aside>
    <aside class="chronicle-panel" data-panel="overlays" hidden>
      <h2>Overlays</h2>
      <label class="ch-check"><input type="checkbox" data-overlay="contested" checked /> Contested fronts</label>
      <label class="ch-check"><input type="checkbox" data-overlay="diplomacy" /> Diplomatic links</label>
      <label class="ch-check"><input type="checkbox" data-overlay="frontiers" checked /> Focus frontiers</label>
    </aside>
  `;
}

