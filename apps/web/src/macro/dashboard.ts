import {
  archetypeLabel,
  effectiveCombatPower,
  formatComposition,
  militaryTechScore,
  PLANETARY_LABEL,
  type EmpireId,
  type InterpolatedSnapshot,
  type MacroEvent,
  type SystemId,
} from "@starfall/macro-sim";
import { empireSwatchCss } from "./palette.js";

function empireCss(e: { colorHue: number; colorSat: number; colorLight: number }): string {
  return empireSwatchCss({
    hue: e.colorHue,
    sat: e.colorSat,
    light: e.colorLight,
  });
}

export type OverlayId =
  | "contested"
  | "diplomacy"
  | "frontiers"
  | "lanes"
  | "labels";
export type RosterSort =
  | "territory"
  | "population"
  | "credits"
  | "garrison"
  | "name";

export interface DashboardState {
  focusEmpireId: EmpireId | null;
  selectedSystemId: SystemId | null;
  pinTopN: number;
  rosterSort: RosterSort;
  rosterAsc: boolean;
  overlays: Record<OverlayId, boolean>;
  panels: {
    roster: boolean;
    feed: boolean;
    trends: boolean;
    overlays: boolean;
    military: boolean;
  };
  paused: boolean;
  speed: 1 | 2 | 4 | 10;
}

export interface TrendHistory {
  /** empireId -> ring buffers */
  territory: Map<EmpireId, number[]>;
  population: Map<EmpireId, number[]>;
  credits: Map<EmpireId, number[]>;
  fleetPower: Map<EmpireId, number[]>;
}

const TREND_LEN = 64;
/** Roster refresh cadence; the sim runs far faster than anyone can read. */
const ROSTER_INTERVAL_MS = 140;
const FEED_MAX_LINES = 60;

export function createDashboardState(): DashboardState {
  return {
    focusEmpireId: null,
    selectedSystemId: null,
    pinTopN: 8,
    rosterSort: "territory",
    rosterAsc: false,
    overlays: {
      contested: true,
      diplomacy: true,
      frontiers: false,
      lanes: true,
      labels: true,
    },
    // Map-first: only roster + feed open by default
    panels: {
      roster: true,
      feed: true,
      trends: false,
      overlays: false,
      military: false,
    },
    paused: false,
    speed: 1,
  };
}

export function createTrendHistory(): TrendHistory {
  return {
    territory: new Map(),
    population: new Map(),
    credits: new Map(),
    fleetPower: new Map(),
  };
}

export function pushTrends(
  history: TrendHistory,
  view: InterpolatedSnapshot,
): void {
  for (const id of view.empireOrder) {
    const e = view.empires[id]!;
    push(history.territory, id, e.territory);
    push(history.population, id, e.population);
    push(history.credits, id, e.credits);
    push(history.fleetPower, id, e.fleetPower);
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

interface RosterRow {
  root: HTMLButtonElement;
  swatch: HTMLElement;
  name: HTMLElement;
  archetype: HTMLElement;
  cells: HTMLElement[];
}

export class MacroDashboard {
  readonly root: HTMLElement;
  private state: DashboardState;
  private trends: TrendHistory;
  private onChange: (s: DashboardState) => void;

  private rosterBody: HTMLElement | null = null;
  private rows = new Map<EmpireId, RosterRow>();
  private feed: HTMLElement | null = null;
  private lastFeedSeq = 0;
  private lastRosterAt = 0;
  private dirty = true;
  private elimUntil = 0;
  private elimRaf = 0;

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
    this.rosterBody = this.root.querySelector("#ch-roster-body");
    this.feed = this.root.querySelector("#ch-feed");
    this.bind();
    this.syncChrome();
  }

  dispose(): void {
    if (this.elimRaf) cancelAnimationFrame(this.elimRaf);
    this.root.remove();
    this.rows.clear();
  }

  getState(): DashboardState {
    return this.state;
  }

  /** Force the next sync to redraw even inside the throttle window. */
  invalidate(): void {
    this.dirty = true;
  }

  /** For state changed outside the panels, e.g. keyboard shortcuts. */
  refreshChrome(): void {
    this.dirty = true;
    this.syncChrome();
  }

  setSeedLabel(seed: number): void {
    const el = this.root.querySelector("#ch-seed");
    if (el) el.textContent = `Seed ${seed}`;
  }

  sync(view: InterpolatedSnapshot, newEvents: MacroEvent[]): void {
    const now = performance.now();
    if (this.dirty || now - this.lastRosterAt >= ROSTER_INTERVAL_MS) {
      this.lastRosterAt = now;
      this.dirty = false;
      this.renderRoster(view);
      this.renderTrends(view);
      this.renderMilitary(view);
      this.renderFocusLabel(view);
      this.renderSelection(view);
    }
    this.renderFeed(view, newEvents);
    this.handleEliminationAlerts(view, newEvents);

    const tickEl = this.root.querySelector("#ch-tick");
    if (tickEl) tickEl.textContent = `Tick ${view.tick}`;
    const statusEl = this.root.querySelector("#ch-status");
    if (statusEl) {
      statusEl.textContent =
        view.status === "ended"
          ? "Ended"
          : this.state.paused
            ? "Paused"
            : `${this.state.speed}×`;
    }
  }

  private changed(): void {
    this.dirty = true;
    this.syncChrome();
    this.onChange(this.state);
  }

  private bind(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-panel-toggle]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.panelToggle as keyof DashboardState["panels"];
          this.state.panels[key] = !this.state.panels[key];
          this.changed();
        });
      });

    this.root
      .querySelectorAll<HTMLInputElement>("[data-overlay]")
      .forEach((input) => {
        input.addEventListener("change", () => {
          const key = input.dataset.overlay as OverlayId;
          this.state.overlays[key] = input.checked;
          this.changed();
        });
      });

    this.root.querySelector("#ch-pause")?.addEventListener("click", () => {
      this.state.paused = !this.state.paused;
      this.changed();
    });

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-speed]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          this.state.speed = Number(btn.dataset.speed) as 1 | 2 | 4 | 10;
          this.state.paused = false;
          this.changed();
        });
      });

    this.root.querySelector("#ch-pin-n")?.addEventListener("change", (e) => {
      this.state.pinTopN = Number((e.target as HTMLSelectElement).value);
      this.changed();
    });

    this.root.querySelector("#ch-sort")?.addEventListener("change", (e) => {
      this.state.rosterSort = (e.target as HTMLSelectElement)
        .value as RosterSort;
      this.changed();
    });

    this.root.querySelector("#ch-sort-dir")?.addEventListener("click", () => {
      this.state.rosterAsc = !this.state.rosterAsc;
      this.changed();
    });

    this.root.querySelector("#ch-clear-focus")?.addEventListener("click", () => {
      this.state.focusEmpireId = null;
      this.changed();
    });

    // One delegated handler; rows are persistent so clicks never land on a
    // node that was replaced mid-gesture.
    this.rosterBody?.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-empire]");
      if (!row) return;
      const id = row.dataset.empire as EmpireId;
      this.setFocus(this.state.focusEmpireId === id ? null : id);
    });
  }

  setFocus(id: EmpireId | null): void {
    this.state.focusEmpireId = id;
    this.changed();
  }

  setSelectedSystem(id: SystemId | null): void {
    this.state.selectedSystemId = id;
    this.dirty = true;
  }

  private syncChrome(): void {
    for (const key of Object.keys(
      this.state.panels,
    ) as (keyof DashboardState["panels"])[]) {
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
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-speed]")
      .forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          Number(btn.dataset.speed) === this.state.speed && !this.state.paused,
        );
      });
    const dir = this.root.querySelector("#ch-sort-dir");
    if (dir) dir.textContent = this.state.rosterAsc ? "↑" : "↓";
    for (const key of Object.keys(this.state.overlays) as OverlayId[]) {
      const input = this.root.querySelector<HTMLInputElement>(
        `[data-overlay="${key}"]`,
      );
      if (input) input.checked = this.state.overlays[key];
    }
    const sort = this.root.querySelector<HTMLSelectElement>("#ch-sort");
    if (sort && sort.value !== this.state.rosterSort) {
      sort.value = this.state.rosterSort;
    }
    const pin = this.root.querySelector<HTMLSelectElement>("#ch-pin-n");
    if (pin && pin.value !== String(this.state.pinTopN)) {
      pin.value = String(this.state.pinTopN);
    }
  }

  private ensureRow(id: EmpireId): RosterRow {
    const existing = this.rows.get(id);
    if (existing) return existing;
    const root = document.createElement("button");
    root.type = "button";
    root.className = "ch-roster-row";
    root.dataset.empire = id;

    const swatch = document.createElement("span");
    swatch.className = "ch-swatch";
    const name = document.createElement("span");
    name.className = "ch-name";
    const archetype = document.createElement("span");
    archetype.className = "ch-arch";
    root.append(swatch, name, archetype);

    const cells: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement("span");
      cell.className = "ch-num";
      root.appendChild(cell);
      cells.push(cell);
    }

    const row: RosterRow = { root, swatch, name, archetype, cells };
    this.rows.set(id, row);
    return row;
  }

  private renderRoster(view: InterpolatedSnapshot): void {
    const body = this.rosterBody;
    if (!body) return;

    const sort = this.state.rosterSort;
    const ordered = [...view.empireOrder].sort((a, b) => {
      const ea = view.empires[a]!;
      const eb = view.empires[b]!;
      if (sort === "name") {
        return this.state.rosterAsc
          ? ea.name.localeCompare(eb.name)
          : eb.name.localeCompare(ea.name);
      }
      return this.state.rosterAsc
        ? ea[sort] - eb[sort]
        : eb[sort] - ea[sort];
    });

    const pinned = ordered.slice(0, this.state.pinTopN);
    const pinnedSet = new Set(pinned);

    for (const id of pinned) {
      const empire = view.empires[id]!;
      const row = this.ensureRow(id);
      row.swatch.style.background = empireCss(empire);
      setText(row.name, empire.name);
      setText(row.archetype, archetypeLabel(empire.archetype));
      setText(row.cells[0]!, String(Math.round(empire.territory)));
      setText(row.cells[1]!, fmt(empire.population));
      setText(row.cells[2]!, fmt(empire.credits));
      setText(row.cells[3]!, fmt(empire.garrison));
      row.root.classList.toggle("is-focus", this.state.focusEmpireId === id);
      row.root.classList.toggle("is-dead", !empire.alive);
      row.root.style.display = "";
      // Appending an existing node moves it, so this reorders in place.
      body.appendChild(row.root);
    }

    for (const [id, row] of this.rows) {
      if (!pinnedSet.has(id)) row.root.style.display = "none";
    }
  }

  private renderFeed(view: InterpolatedSnapshot, newEvents: MacroEvent[]): void {
    const feed = this.feed;
    if (!feed) return;

    // Sequence ids make this exact: no length heuristics, no duplicates.
    const pending = [...view.events, ...newEvents]
      .filter((ev) => ev.seq > this.lastFeedSeq)
      .sort((a, b) => a.seq - b.seq);
    if (pending.length === 0) return;

    const seen = new Set<number>();
    for (const ev of pending) {
      if (seen.has(ev.seq)) continue;
      seen.add(ev.seq);
      this.lastFeedSeq = Math.max(this.lastFeedSeq, ev.seq);
      const line = document.createElement("div");
      line.className = "ch-feed-line";
      line.dataset.kind = ev.kind;
      const tick = document.createElement("span");
      tick.className = "ch-feed-tick";
      tick.textContent = `t${ev.tick}`;
      line.append(tick, document.createTextNode(` ${ev.text}`));
      feed.insertBefore(line, feed.firstChild);
    }
    while (feed.childElementCount > FEED_MAX_LINES) {
      feed.removeChild(feed.lastElementChild!);
    }
  }

  private renderTrends(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector("#ch-trends");
    if (!host) return;

    const focus = this.state.focusEmpireId;
    if (focus && view.empires[focus]) {
      const empire = view.empires[focus]!;
      const color = empireCss(empire);
      host.innerHTML = `
        <div class="ch-trend-title" style="color:${color}">${escapeHtml(empire.name)}</div>
        ${sparkRow("Systems", this.trends.territory.get(focus) ?? [], color, (v) => String(Math.round(v)))}
        ${sparkRow("Population", this.trends.population.get(focus) ?? [], color, fmt)}
        ${sparkRow("Credits", this.trends.credits.get(focus) ?? [], color, fmt)}
        ${sparkRow("Fleet power", this.trends.fleetPower.get(focus) ?? [], color, fmt)}
      `;
      return;
    }

    // No focus: compare the leaders' territory on one chart.
    const leaders = [...view.empireOrder]
      .filter((id) => view.empires[id]!.alive)
      .sort((a, b) => view.empires[b]!.territory - view.empires[a]!.territory)
      .slice(0, 6);
    const series = leaders.map((id) => ({
      color: empireCss(view.empires[id]!),
      values: this.trends.territory.get(id) ?? [],
    }));
    const legend = leaders
      .map(
        (id) =>
          `<span class="ch-legend-item"><i style="background:${empireCss(
            view.empires[id]!,
          )}"></i>${escapeHtml(view.empires[id]!.name)} <b>${Math.round(
            view.empires[id]!.territory,
          )}</b></span>`,
      )
      .join("");
    host.innerHTML = `
      <div class="ch-trend-title">Systems held — top ${leaders.length}</div>
      ${multiSeriesSvg(series)}
      <div class="ch-legend">${legend}</div>
      <p class="ch-hint">Pick an empire to see its own trends.</p>
    `;
  }

  private renderFocusLabel(view: InterpolatedSnapshot): void {
    const label = this.root.querySelector("#ch-focus-label");
    if (!label) return;
    label.textContent = this.state.focusEmpireId
      ? (view.empires[this.state.focusEmpireId]?.name ?? "—")
      : "All empires";
  }

  private renderSelection(view: InterpolatedSnapshot): void {
    const card = this.root.querySelector<HTMLElement>("#ch-selection");
    if (!card) return;
    const id = this.state.selectedSystemId;
    if (!id) {
      card.hidden = true;
      return;
    }
    const system = view.systems[id];
    const geo = view.geometry.byId[id];
    if (!system || !geo) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const owner = system.ownerId ? view.empires[system.ownerId] : null;
    const ownerLine = owner
      ? `<span class="ch-swatch" style="background:${empireCss(owner)}"></span>${escapeHtml(owner.name)}`
      : "Uncolonized";
    const front = system.contested
      ? `<div class="ch-sel-front">Contested ${Math.round(system.contested.pct * 100)}% vs ${escapeHtml(
          view.empires[system.contested.vs]?.name ?? "—",
        )}</div>`
      : "";
    const eng = system.engagement
      ? `<div class="ch-sel-eng">${escapeHtml(system.engagement.mode)} · ${system.engagement.ticksRemaining}t left · intensity ${Math.round(system.engagement.intensity * 100)}%<br/><span class="ch-muted">${escapeHtml(formatComposition(system.engagement.committedA))} vs ${escapeHtml(formatComposition(system.engagement.committedB))}</span></div>`
      : "";
    const devs =
      system.developments.length > 0
        ? `<div class="ch-sel-devs">${system.developments
            .map((d) => escapeHtml(PLANETARY_LABEL[d] ?? d))
            .join(" · ")}</div>`
        : "";
    card.innerHTML = `
      <div class="ch-sel-head">
        <strong>${escapeHtml(geo.name)}</strong>
        <button type="button" class="btn btn-compact" id="ch-clear-selection">×</button>
      </div>
      <div class="ch-sel-owner">${ownerLine}</div>
      <div class="ch-sel-stats">
        <span>Pop <b>${fmt(system.population)}</b></span>
        <span>¢ <b>${fmt(system.credits)}</b></span>
        <span>Gar <b>${fmt(system.garrison)}</b></span>
        <span>Lanes <b>${geo.hyperlanes.length}</b></span>
      </div>
      <div class="ch-sel-stats"><span>Defense <b>${escapeHtml(formatComposition(system.defenseMix))}</b></span></div>
      ${devs}
      ${front}
      ${eng}
    `;
    card
      .querySelector("#ch-clear-selection")
      ?.addEventListener("click", () => this.setSelectedSystem(null));
  }

  private renderMilitary(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector("#ch-military");
    if (!host) return;
    const alive = [...view.empireOrder]
      .filter((id) => view.empires[id]!.alive)
      .sort(
        (a, b) => view.empires[b]!.fleetPower - view.empires[a]!.fleetPower,
      );
    const focus = this.state.focusEmpireId;
    const rows = alive
      .slice(0, 16)
      .map((id) => {
        const e = view.empires[id]!;
        const tech = militaryTechScore(e.researched);
        return `<tr class="${focus === id ? "is-focus" : ""}" data-mil-empire="${id}">
          <td><span class="ch-swatch" style="background:${empireCss(e)}"></span>${escapeHtml(e.name)}</td>
          <td>${fmt(e.fleetPower)}</td>
          <td class="ch-mono">${escapeHtml(formatComposition(e.fleet))}</td>
          <td>${tech}</td>
          <td>${escapeHtml(archetypeLabel(e.archetype))}</td>
        </tr>`;
      })
      .join("");

    let matchup = "";
    if (focus && view.empires[focus]) {
      const a = view.empires[focus]!;
      const rivals = alive.filter((id) => id !== focus).slice(0, 5);
      matchup = `<div class="ch-mil-matchups"><h3>Matchups vs ${escapeHtml(a.name)}</h3>${rivals
        .map((id) => {
          const b = view.empires[id]!;
          const ab = effectiveCombatPower(a.fleet, b.fleet);
          const ba = effectiveCombatPower(b.fleet, a.fleet);
          const outlook =
            ab > ba * 1.15 ? "favored" : ba > ab * 1.15 ? "underdog" : "toss-up";
          return `<div class="ch-mil-row"><span style="color:${empireCss(b)}">${escapeHtml(b.name)}</span> P${Math.round(ab)} vs P${Math.round(ba)} · ${outlook}</div>`;
        })
        .join("")}</div>`;
    }

    const engagements: string[] = [];
    for (const sid of view.systemOrder) {
      const eng = view.systems[sid]!.engagement;
      if (!eng) continue;
      const name = view.geometry.byId[sid]?.name ?? sid;
      engagements.push(
        `<div class="ch-mil-eng" style="opacity:${0.45 + eng.intensity * 0.55}"><b>${escapeHtml(eng.mode)}</b> ${escapeHtml(name)} · ${eng.ticksRemaining}t · ${escapeHtml(view.empires[eng.attackerId]?.name ?? "?")} vs ${escapeHtml(view.empires[eng.defenderId]?.name ?? "?")}</div>`,
      );
    }
    engagements.sort((a, b) => b.length - a.length);

    host.innerHTML = `
      <table class="ch-mil-table">
        <thead><tr><th>Empire</th><th>Power</th><th>Fleet</th><th>Tech</th><th>Doctrine</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${matchup}
      <div class="ch-mil-active"><h3>Active engagements</h3>${engagements.slice(0, 8).join("") || "<p class='ch-hint'>No major battles right now.</p>"}</div>
    `;
    host.querySelectorAll<HTMLElement>("[data-mil-empire]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.milEmpire as EmpireId;
        this.setFocus(this.state.focusEmpireId === id ? null : id);
      });
    });
  }

  private handleEliminationAlerts(
    view: InterpolatedSnapshot,
    newEvents: MacroEvent[],
  ): void {
    for (const ev of newEvents) {
      if (ev.kind !== "empire_eliminated") continue;
      const eid = ev.empireIds[0];
      const empire = eid ? view.empires[eid] : null;
      this.showEliminationAlert(
        empire?.name ?? "An empire",
        empire ? empireCss(empire) : "var(--sf-danger)",
      );
    }
  }

  private showEliminationAlert(name: string, color: string): void {
    const el = this.root.querySelector<HTMLElement>("#ch-elim-alert");
    if (!el) return;
    const bar = el.querySelector<HTMLElement>(".ch-elim-progress");
    const text = el.querySelector<HTMLElement>(".ch-elim-text");
    if (text) {
      text.innerHTML = `<span class="ch-swatch" style="background:${color}"></span> <strong>${escapeHtml(name)}</strong> has been eliminated`;
    }
    el.hidden = false;
    el.classList.add("is-flashing");
    el.style.setProperty("--elim-accent", color);
    this.elimUntil = performance.now() + 5000;
    if (this.elimRaf) cancelAnimationFrame(this.elimRaf);
    const tick = (now: number): void => {
      const left = this.elimUntil - now;
      if (left <= 0) {
        el.hidden = true;
        el.classList.remove("is-flashing");
        if (bar) bar.style.transform = "scaleX(0)";
        this.elimRaf = 0;
        return;
      }
      if (bar) bar.style.transform = `scaleX(${left / 5000})`;
      this.elimRaf = requestAnimationFrame(tick);
    };
    this.elimRaf = requestAnimationFrame(tick);
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function sparkRow(
  label: string,
  values: number[],
  color: string,
  format: (v: number) => string,
): string {
  const current = values.length ? values[values.length - 1]! : 0;
  return `<div class="ch-spark-row"><span>${label}</span>${sparkSvg(
    values,
    color,
  )}<b>${format(current)}</b></div>`;
}

function sparkSvg(values: number[], color: string): string {
  if (values.length < 2) {
    // Flat baseline reads as "collecting data", not as a broken widget.
    return `<svg class="ch-spark" viewBox="0 0 100 24" preserveAspectRatio="none"><line x1="0" y1="22" x2="100" y2="22" stroke="${color}" stroke-width="1" opacity="0.35"/></svg>`;
  }
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
  return `<svg class="ch-spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}

function multiSeriesSvg(series: { color: string; values: number[] }[]): string {
  const all = series.flatMap((s) => s.values);
  if (all.length < 2) {
    // Baseline placeholder while the first samples arrive.
    return `<svg class="ch-chart" viewBox="0 0 100 46" preserveAspectRatio="none"><line x1="0" y1="44" x2="100" y2="44" stroke="var(--sf-lane)" stroke-width="1" opacity="0.45"/></svg>`;
  }
  const max = Math.max(...all, 1);
  const len = Math.max(...series.map((s) => s.values.length), 2);
  const lines = series
    .map((s) => {
      if (s.values.length < 2) return "";
      const offset = len - s.values.length;
      const pts = s.values
        .map((v, i) => {
          const x = ((i + offset) / (len - 1)) * 100;
          const y = 44 - (v / max) * 42;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      return `<polyline fill="none" stroke="${s.color}" stroke-width="1.4" points="${pts}"/>`;
    })
    .join("");
  return `<svg class="ch-chart" viewBox="0 0 100 46" preserveAspectRatio="none">${lines}</svg>`;
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
        <span id="ch-seed"></span>
      </div>
      <div class="chronicle-controls">
        <button type="button" class="btn" id="ch-pause">Pause</button>
        <button type="button" class="btn" data-speed="1">1×</button>
        <button type="button" class="btn" data-speed="2">2×</button>
        <button type="button" class="btn" data-speed="4">4×</button>
        <button type="button" class="btn" data-speed="10">10×</button>
        <button type="button" class="btn" id="ch-fit" title="Fit galaxy (F)">Fit</button>
        <button type="button" class="btn" id="ch-restart" title="New galaxy">New</button>
        <button type="button" class="btn" id="ch-exit">Exit</button>
      </div>
    </div>
    <div class="chronicle-stage">
    <div id="ch-elim-alert" class="ch-elim-alert" hidden role="alert" aria-live="assertive">
      <div class="ch-elim-text"></div>
      <div class="ch-elim-bar"><div class="ch-elim-progress"></div></div>
    </div>
    <nav class="chronicle-rail" aria-label="Chronicle panels">
      <button type="button" class="rail-tab is-active" data-panel-toggle="roster">Roster</button>
      <button type="button" class="rail-tab is-active" data-panel-toggle="feed">Feed</button>
      <button type="button" class="rail-tab" data-panel-toggle="trends">Trends</button>
      <button type="button" class="rail-tab" data-panel-toggle="military">Military</button>
      <button type="button" class="rail-tab" data-panel-toggle="overlays">Overlays</button>
    </nav>
    <div class="chronicle-left">
      <aside class="chronicle-panel" data-panel="roster">
        <div class="ch-panel-head">
          <h2>Empires</h2>
          <div class="ch-tools">
            <select id="ch-sort" aria-label="Sort empires">
              <option value="territory">Systems</option>
              <option value="population">Population</option>
              <option value="credits">Credits</option>
              <option value="garrison">Garrison</option>
              <option value="name">Name</option>
            </select>
            <button type="button" class="btn btn-compact" id="ch-sort-dir" aria-label="Sort direction">↓</button>
            <select id="ch-pin-n" aria-label="How many empires to pin">
              <option value="5">Top 5</option>
              <option value="8">Top 8</option>
              <option value="12">Top 12</option>
              <option value="20">Top 20</option>
              <option value="48">All</option>
            </select>
          </div>
        </div>
        <div class="ch-roster-head">
          <span></span><span>Name</span><span>Archetype</span><span>Sys</span><span>Pop</span><span>¢</span><span>Gar</span>
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
    </div>
    <aside class="chronicle-panel" data-panel="trends" hidden>
      <h2>Trends</h2>
      <div id="ch-trends"></div>
    </aside>
    <aside class="chronicle-panel" data-panel="military" hidden>
      <h2>Military</h2>
      <div id="ch-military"></div>
    </aside>
    <aside class="chronicle-panel" data-panel="overlays" hidden>
      <h2>Overlays</h2>
      <label class="ch-check"><input type="checkbox" data-overlay="contested" /> Contested fronts</label>
      <label class="ch-check"><input type="checkbox" data-overlay="lanes" /> Hyperlanes</label>
      <label class="ch-check"><input type="checkbox" data-overlay="labels" /> Names</label>
      <label class="ch-check"><input type="checkbox" data-overlay="diplomacy" /> Diplomatic pacts</label>
      <label class="ch-check"><input type="checkbox" data-overlay="frontiers" /> Highlight frontiers</label>
      <p class="ch-hint">Click a star to inspect it. Scroll to zoom, drag to pan.</p>
    </aside>
    <div class="chronicle-selection" id="ch-selection" hidden></div>
    </div>
  `;
}
