import {
  archetypeLabel,
  effectiveCombatPower,
  formatComposition,
  MACRO_SHIP_TYPES,
  MACRO_TECH_IDS,
  militaryTechScore,
  PLANETARY_LABEL,
  REPEATABLE_BLURB,
  REPEATABLE_LABEL,
  REPEATABLE_TECH_IDS,
  TECH_BLURB,
  TECH_LABEL,
  TECH_TIER,
  type EmpireId,
  type EmpireTraits,
  type InterpolatedSnapshot,
  type MacroEvent,
  type MacroShipType,
  type MacroTechId,
  type PlanetaryDevId,
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
  | "name"
  | "archetype";

export type MilitarySort =
  | "name"
  | "power"
  | "tech"
  | "doctrine"
  | MacroShipType;

const SHIP_COL: Record<MacroShipType, string> = {
  corvette: "Cv",
  destroyer: "D",
  cruiser: "Cr",
  battleship: "B",
  carrier: "Ca",
  raider: "R",
  dreadnought: "Dr",
  defense_platform: "P",
};

export interface DashboardState {
  focusEmpireId: EmpireId | null;
  selectedSystemId: SystemId | null;
  pinTopN: number;
  rosterSort: RosterSort;
  rosterAsc: boolean;
  militarySort: MilitarySort;
  militaryAsc: boolean;
  overlays: Record<OverlayId, boolean>;
  panels: {
    roster: boolean;
    feed: boolean;
    trends: boolean;
    overlays: boolean;
    military: boolean;
    battles: boolean;
    empire: boolean;
    tech: boolean;
  };
  paused: boolean;
  speed: 1 | 2 | 4 | 10 | 20;
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
    militarySort: "power",
    militaryAsc: false,
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
      battles: false,
      empire: false,
      tech: false,
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
  private lastPauseToggleAt = 0;
  /** >0 while a pointer is down on the HUD — skip DOM rebuilds that cancel clicks. */
  private pointerDepth = 0;
  private lastMilitarySig = "";
  private lastBattlesSig = "";
  private lastEmpireSig = "";
  private lastTrendsSig = "";
  private lastSelectionSig = "";
  private lastTechSig = "";
  private lastView: InterpolatedSnapshot | null = null;

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
    this.root.removeEventListener("pointerdown", this.onHudPointerDown, true);
    window.removeEventListener("pointerup", this.onHudPointerUp, true);
    window.removeEventListener("pointercancel", this.onHudPointerUp, true);
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
    this.lastView = view;
    // Never rebuild interactive DOM mid-gesture — that drops clicks (sort, focus, speed).
    const allowHeavy = this.pointerDepth === 0;
    if (
      allowHeavy &&
      (this.dirty || now - this.lastRosterAt >= ROSTER_INTERVAL_MS)
    ) {
      this.lastRosterAt = now;
      this.dirty = false;
      this.renderRoster(view);
      this.renderTrends(view);
      this.renderMilitary(view);
      this.renderBattles(view);
      this.renderEmpireDetail(view);
      this.renderTechCatalog(view);
      this.renderFocusLabel(view);
      this.renderSelection(view);
    } else if (!allowHeavy) {
      // Keep tick chrome live; defer the heavy panels until pointer-up.
      this.dirty = true;
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
    // Capture so we freeze HUD rebuilds for the whole press, even if target is replaced.
    this.root.addEventListener("pointerdown", this.onHudPointerDown, true);
    window.addEventListener("pointerup", this.onHudPointerUp, true);
    window.addEventListener("pointercancel", this.onHudPointerUp, true);

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-panel-toggle]")
      .forEach((btn) => {
        btn.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const key = btn.dataset.panelToggle as keyof DashboardState["panels"];
          const next = !this.state.panels[key];
          // Right-dock insight panels share one slot — opening one closes the others.
          if (next && isExclusivePanel(key)) {
            for (const other of EXCLUSIVE_PANELS) {
              this.state.panels[other] = other === key;
            }
          } else {
            this.state.panels[key] = next;
          }
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

    this.root.querySelector("#ch-pause")?.addEventListener("pointerdown", (e) => {
      if ((e as PointerEvent).button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - this.lastPauseToggleAt < 250) return;
      this.lastPauseToggleAt = now;
      this.state.paused = !this.state.paused;
      this.changed();
    });

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-speed]")
      .forEach((btn) => {
        btn.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          this.state.speed = Number(btn.dataset.speed) as 1 | 2 | 4 | 10 | 20;
          this.state.paused = false;
          this.changed();
        });
      });

    this.root.querySelector("#ch-pin-n")?.addEventListener("change", (e) => {
      this.state.pinTopN = Number((e.target as HTMLSelectElement).value);
      this.changed();
    });

    this.root
      .querySelector("#ch-clear-focus")
      ?.addEventListener("pointerdown", (e) => {
        if ((e as PointerEvent).button !== 0) return;
        e.preventDefault();
        this.state.focusEmpireId = null;
        this.state.panels.empire = false;
        this.changed();
      });

    // Act on pointerdown so a mid-frame DOM rebuild cannot cancel the gesture.
    this.root.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;

        const rosterHead = target.closest<HTMLElement>("[data-roster-sort]");
        if (rosterHead) {
          e.preventDefault();
          const key = rosterHead.dataset.rosterSort as RosterSort;
          if (this.state.rosterSort === key) {
            this.state.rosterAsc = !this.state.rosterAsc;
          } else {
            this.state.rosterSort = key;
            this.state.rosterAsc = key === "name" || key === "archetype";
          }
          this.changed();
          return;
        }

        const milHead = target.closest<HTMLElement>("[data-mil-sort]");
        if (milHead) {
          e.preventDefault();
          const key = milHead.dataset.milSort as MilitarySort;
          if (this.state.militarySort === key) {
            this.state.militaryAsc = !this.state.militaryAsc;
          } else {
            this.state.militarySort = key;
            this.state.militaryAsc = key === "name" || key === "doctrine";
          }
          this.changed();
          return;
        }

        const milRow = target.closest<HTMLElement>("[data-mil-empire]");
        if (milRow) {
          e.preventDefault();
          const id = milRow.dataset.milEmpire as EmpireId;
          this.setFocus(this.state.focusEmpireId === id ? null : id);
          return;
        }

        const battle = target.closest<HTMLElement>("[data-battle-system]");
        if (battle) {
          e.preventDefault();
          const sid = battle.dataset.battleSystem as SystemId;
          this.setSelectedSystem(sid);
          const owner = this.lastView?.systems[sid]?.ownerId ?? null;
          if (owner) this.setFocus(owner);
          return;
        }

        const closeEmpire = target.closest("#ch-close-empire");
        if (closeEmpire) {
          e.preventDefault();
          this.state.panels.empire = false;
          this.changed();
          return;
        }

        const clearSel = target.closest("#ch-clear-selection");
        if (clearSel) {
          e.preventDefault();
          this.setSelectedSystem(null);
          return;
        }

        const row = target.closest<HTMLElement>("[data-empire]");
        if (row && this.rosterBody?.contains(row)) {
          e.preventDefault();
          const id = row.dataset.empire as EmpireId;
          this.setFocus(this.state.focusEmpireId === id ? null : id);
        }
      },
      true,
    );
  }

  private onHudPointerDown = (): void => {
    this.pointerDepth += 1;
  };

  private onHudPointerUp = (): void => {
    if (this.pointerDepth > 0) this.pointerDepth -= 1;
    if (this.pointerDepth === 0) this.dirty = true;
  }

  setFocus(id: EmpireId | null): void {
    this.state.focusEmpireId = id;
    if (id) {
      for (const other of EXCLUSIVE_PANELS) {
        this.state.panels[other] = other === "empire";
      }
    } else {
      this.state.panels.empire = false;
    }
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
    if (pause) {
      const label = this.state.paused ? "Resume" : "Pause";
      if (pause.textContent !== label) pause.textContent = label;
    }
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-speed]")
      .forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          Number(btn.dataset.speed) === this.state.speed && !this.state.paused,
        );
      });
    for (const key of Object.keys(this.state.overlays) as OverlayId[]) {
      const input = this.root.querySelector<HTMLInputElement>(
        `[data-overlay="${key}"]`,
      );
      if (input) input.checked = this.state.overlays[key];
    }
    const pin = this.root.querySelector<HTMLSelectElement>("#ch-pin-n");
    if (pin && pin.value !== String(this.state.pinTopN)) {
      pin.value = String(this.state.pinTopN);
    }
    this.syncRosterHeaders();
  }

  private syncRosterHeaders(): void {
    this.root.querySelectorAll<HTMLElement>("[data-roster-sort]").forEach((el) => {
      const key = el.dataset.rosterSort as RosterSort;
      const active = key === this.state.rosterSort;
      el.classList.toggle("is-sorted", active);
      el.dataset.sortDir = active ? (this.state.rosterAsc ? "asc" : "desc") : "";
      const label = el.dataset.label ?? el.textContent?.replace(/[↑↓]\s*$/, "").trim() ?? "";
      el.dataset.label = label;
      el.textContent = active
        ? `${label} ${this.state.rosterAsc ? "↑" : "↓"}`
        : label;
    });
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
      let cmp = 0;
      if (sort === "name") cmp = ea.name.localeCompare(eb.name);
      else if (sort === "archetype") {
        cmp = archetypeLabel(ea.archetype).localeCompare(
          archetypeLabel(eb.archetype),
        );
      } else cmp = ea[sort] - eb[sort];
      return this.state.rosterAsc ? cmp : -cmp;
    });

    const pinned = ordered.slice(0, this.state.pinTopN);
    const pinnedSet = new Set(pinned);

    let insertBefore: ChildNode | null = body.firstChild;
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
      // Only move the node when order actually changed — re-append cancels clicks.
      if (row.root !== insertBefore) {
        body.insertBefore(row.root, insertBefore);
      }
      insertBefore = row.root.nextSibling;
    }

    for (const [id, row] of this.rows) {
      if (!pinnedSet.has(id)) row.root.style.display = "none";
    }
    this.syncRosterHeaders();
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
      this.lastSelectionSig = "";
      return;
    }
    const system = view.systems[id];
    const geo = view.geometry.byId[id];
    if (!system || !geo) {
      card.hidden = true;
      this.lastSelectionSig = "";
      return;
    }
    card.hidden = false;

    // Keep the × button mounted — only rebuild chrome when the selected system changes.
    if (card.dataset.selId !== id || !card.querySelector("#ch-clear-selection")) {
      card.dataset.selId = id;
      card.innerHTML = `
        <div class="ch-sel-head">
          <strong data-sel-name></strong>
          <button type="button" class="btn btn-compact" id="ch-clear-selection">×</button>
        </div>
        <div class="ch-sel-body"></div>
      `;
      this.lastSelectionSig = "";
    }

    const nameEl = card.querySelector<HTMLElement>("[data-sel-name]");
    if (nameEl) setText(nameEl, geo.name);

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
    const bodyHtml = `
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
    const sig = `${id}|${bodyHtml}`;
    if (sig === this.lastSelectionSig) return;
    this.lastSelectionSig = sig;
    const body = card.querySelector(".ch-sel-body");
    if (body) body.innerHTML = bodyHtml;
  }

  private renderTechCatalog(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector<HTMLElement>("#ch-tech");
    if (!host) return;

    const focusId = this.state.focusEmpireId;
    const empire = focusId ? view.empires[focusId] : null;
    const researched = new Set<MacroTechId>(empire?.researched ?? []);
    const repeatLevels = empire?.repeatableLevels ?? {};

    const ownershipSig = empire
      ? `${empire.name}|${[...researched].sort().join(",")}|${REPEATABLE_TECH_IDS.map((t) => `${t}:${repeatLevels[t] ?? 0}`).join(",")}`
      : "catalog";
    if (ownershipSig === this.lastTechSig && host.childElementCount > 0) return;
    this.lastTechSig = ownershipSig;

    const byTier = new Map<number, MacroTechId[]>();
    for (const t of MACRO_TECH_IDS) {
      const tier = TECH_TIER[t];
      let list = byTier.get(tier);
      if (!list) {
        list = [];
        byTier.set(tier, list);
      }
      list.push(t);
    }

    const focusLine = empire
      ? `<p class="ch-hint">Showing ownership for <b>${escapeHtml(empire.name)}</b>.</p>`
      : `<p class="ch-hint">Full tech catalog. Focus an empire to mark researched / available / locked.</p>`;

    const tiersHtml = [...byTier.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tier, techs]) => {
        const rows = techs
          .map((t) => {
            let status = "catalog";
            let statusLabel = "";
            if (empire) {
              if (researched.has(t)) {
                status = "owned";
                statusLabel = "Researched";
              } else if (techAvailable(researched, t)) {
                status = "available";
                statusLabel = "Available";
              } else {
                status = "locked";
                statusLabel = "Locked";
              }
            }
            return `<div class="ch-tech-row is-${status}">
              <span class="ch-chip ch-chip-tier-${tier}">T${tier}</span>
              <div class="ch-tech-meta">
                <div class="ch-tech-name">${escapeHtml(TECH_LABEL[t])}${statusLabel ? ` · <span class="ch-muted">${statusLabel}</span>` : ""}</div>
                <div class="ch-muted">${escapeHtml(TECH_BLURB[t])}</div>
              </div>
            </div>`;
          })
          .join("");
        return `<h3 class="ch-emp-section">Tier ${tier}</h3><div class="ch-tech-list">${rows}</div>`;
      })
      .join("");

    const repeatHtml = REPEATABLE_TECH_IDS.map((t) => {
      const level = repeatLevels[t] ?? 0;
      const levelLine = empire
        ? ` · Level <b>${level}</b>`
        : " · Open-ended";
      return `<div class="ch-tech-row is-repeatable">
        <span class="ch-chip ch-chip-tier-5">∞</span>
        <div class="ch-tech-meta">
          <div class="ch-tech-name">${escapeHtml(REPEATABLE_LABEL[t])}${levelLine}</div>
          <div class="ch-muted">${escapeHtml(REPEATABLE_BLURB[t])}</div>
        </div>
      </div>`;
    }).join("");

    host.innerHTML = `
      ${focusLine}
      ${tiersHtml}
      <h3 class="ch-emp-section">Repeatable tracks</h3>
      <div class="ch-tech-list">${repeatHtml}</div>
    `;
  }

  private renderMilitary(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector("#ch-military");
    if (!host) return;

    const sort = this.state.militarySort;
    const alive = [...view.empireOrder]
      .filter((id) => view.empires[id]!.alive)
      .sort((a, b) => {
        const ea = view.empires[a]!;
        const eb = view.empires[b]!;
        let cmp = 0;
        if (sort === "name") cmp = ea.name.localeCompare(eb.name);
        else if (sort === "power") cmp = ea.fleetPower - eb.fleetPower;
        else if (sort === "tech") {
          cmp =
            militaryTechScore(ea.researched) - militaryTechScore(eb.researched);
        } else if (sort === "doctrine") {
          cmp = archetypeLabel(ea.archetype).localeCompare(
            archetypeLabel(eb.archetype),
          );
        } else {
          cmp = (ea.fleet[sort] ?? 0) - (eb.fleet[sort] ?? 0);
        }
        return this.state.militaryAsc ? cmp : -cmp;
      });

    const focus = this.state.focusEmpireId;
    const head = (key: MilitarySort, label: string): string => {
      const active = this.state.militarySort === key;
      const arrow = active ? (this.state.militaryAsc ? " ↑" : " ↓") : "";
      return `<th class="ch-sortable${active ? " is-sorted" : ""}" data-mil-sort="${key}" title="Sort by ${label}">${label}${arrow}</th>`;
    };

    const shipHeads = MACRO_SHIP_TYPES.map((t) =>
      head(t, SHIP_COL[t]),
    ).join("");

    const rows = alive
      .slice(0, Math.max(this.state.pinTopN, 16))
      .map((id) => {
        const e = view.empires[id]!;
        const tech = militaryTechScore(e.researched);
        const ships = MACRO_SHIP_TYPES.map(
          (t) => `<td class="ch-mono">${e.fleet[t] ?? 0}</td>`,
        ).join("");
        return `<tr class="${focus === id ? "is-focus" : ""}" data-mil-empire="${id}">
          <td><span class="ch-swatch" style="background:${empireCss(e)}"></span>${escapeHtml(e.name)}</td>
          <td>${fmt(e.fleetPower)}</td>
          ${ships}
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

    host.innerHTML = `
      <div class="ch-mil-scroll">
        <table class="ch-mil-table">
          <thead><tr>
            ${head("name", "Empire")}
            ${head("power", "Power")}
            ${shipHeads}
            ${head("tech", "Tech")}
            ${head("doctrine", "Doctrine")}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="ch-hint">Click a column header to sort; click again to reverse.</p>
      ${matchup}
    `;
  }

  private renderBattles(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector("#ch-battles");
    const badge = this.root.querySelector<HTMLElement>("#ch-battles-badge");
    if (!host) return;

    type EngRow = {
      intensity: number;
      html: string;
    };
    const rows: EngRow[] = [];
    for (const sid of view.systemOrder) {
      const eng = view.systems[sid]!.engagement;
      if (!eng) continue;
      const name = view.geometry.byId[sid]?.name ?? sid;
      const total =
        eng.ticksElapsed + eng.ticksRemaining || 1;
      const progress = Math.round((eng.ticksElapsed / total) * 100);
      rows.push({
        intensity: eng.intensity,
        html: `<button type="button" class="ch-battle-card" data-battle-system="${sid}" style="--battle-intensity:${eng.intensity}">
          <div class="ch-battle-mode">${escapeHtml(eng.mode)} · ${Math.round(eng.intensity * 100)}%</div>
          <div class="ch-battle-name">${escapeHtml(name)}</div>
          <div class="ch-battle-sides">${escapeHtml(view.empires[eng.attackerId]?.name ?? "?")} vs ${escapeHtml(view.empires[eng.defenderId]?.name ?? "?")}</div>
          <div class="ch-battle-mix ch-muted">${escapeHtml(formatComposition(eng.committedA))} vs ${escapeHtml(formatComposition(eng.committedB))}</div>
          <div class="ch-battle-meta">${eng.ticksRemaining}t left · ${progress}%</div>
        </button>`,
      });
    }
    rows.sort((a, b) => b.intensity - a.intensity);

    if (badge) {
      badge.textContent = rows.length ? String(rows.length) : "";
      badge.hidden = rows.length === 0;
    }

    host.innerHTML = rows.length
      ? `<div class="ch-battles-list">${rows.map((r) => r.html).join("")}</div>`
      : `<p class="ch-hint">No active engagements.</p>`;
  }

  private renderEmpireDetail(view: InterpolatedSnapshot): void {
    const host = this.root.querySelector<HTMLElement>("#ch-empire-detail");
    if (!host) return;

    const id = this.state.focusEmpireId;
    if (!id || !view.empires[id]) {
      host.innerHTML = `<p class="ch-hint">Click an empire on the roster, military table, or map to inspect it.</p>`;
      this.lastEmpireSig = "";
      delete host.dataset.empId;
      return;
    }

    const e = view.empires[id]!;
    const color = empireCss(e);
    const capital = view.geometry.byId[e.capitalSystemId]?.name ?? e.capitalSystemId;
    const allyNames = e.allies
      .map((aid) => view.empires[aid]?.name)
      .filter(Boolean) as string[];

    const devCounts = new Map<PlanetaryDevId, number>();
    let frontier = 0;
    let contested = 0;
    let engCount = 0;
    const engLines: string[] = [];
    for (const sid of view.systemOrder) {
      const s = view.systems[sid]!;
      if (s.ownerId !== id) {
        if (
          s.engagement &&
          (s.engagement.attackerId === id || s.engagement.defenderId === id)
        ) {
          engCount++;
          const name = view.geometry.byId[sid]?.name ?? sid;
          engLines.push(
            `${s.engagement.mode} at ${name} (${s.engagement.ticksRemaining}t)`,
          );
        }
        continue;
      }
      for (const d of s.developments) {
        devCounts.set(d, (devCounts.get(d) ?? 0) + 1);
      }
      if (s.contested) contested++;
      const lanes = view.geometry.byId[sid]?.hyperlanes ?? [];
      const hasWild = lanes.some((nid) => !view.systems[nid]!.ownerId);
      if (hasWild) frontier++;
      if (s.engagement) {
        engCount++;
        const name = view.geometry.byId[sid]?.name ?? sid;
        engLines.push(
          `${s.engagement.mode} at ${name} (${s.engagement.ticksRemaining}t)`,
        );
      }
    }

    const techs = [...e.researched].sort(
      (a, b) => TECH_TIER[a] - TECH_TIER[b] || a.localeCompare(b),
    );
    const techHtml =
      techs.length > 0
        ? techs
            .map(
              (t) =>
                `<span class="ch-chip ch-chip-tier-${TECH_TIER[t]}">${escapeHtml(TECH_LABEL[t] ?? t)}</span>`,
            )
            .join("")
        : `<span class="ch-muted">None yet</span>`;

    const ships = MACRO_SHIP_TYPES.filter((t) => (e.fleet[t] ?? 0) > 0)
      .map(
        (t) =>
          `<span class="ch-chip">${SHIP_COL[t]} <b>${e.fleet[t]}</b></span>`,
      )
      .join("");

    const mods = activeModifiers(e.modifiers);
    const traitKeys: (keyof EmpireTraits)[] = [
      "aggression",
      "ambition",
      "risk",
      "curiosity",
      "greed",
      "xenophobia",
      "loyalty",
    ];

    const bodyHtml = `
      <div class="ch-emp-stats">
        <span>Sys <b>${Math.round(e.territory)}</b></span>
        <span>Pop <b>${fmt(e.population)}</b></span>
        <span>¢ <b>${fmt(e.credits)}</b></span>
        <span>Gar <b>${fmt(e.garrison)}</b></span>
        <span>Power <b>${fmt(e.fleetPower)}</b></span>
        <span>Tech <b>${militaryTechScore(e.researched)}</b></span>
      </div>
      <div class="ch-emp-meta">Capital <b>${escapeHtml(capital)}</b> · Frontier <b>${frontier}</b> · Contested <b>${contested}</b></div>

      <h3 class="ch-emp-section">Personality</h3>
      <div class="ch-trait-grid">
        ${traitKeys
          .map((k) => traitBar(k, e.traits[k]))
          .join("")}
      </div>

      <h3 class="ch-emp-section">Fleet</h3>
      <div class="ch-chip-row">${ships || `<span class="ch-muted">No hulls listed</span>`}</div>
      <div class="ch-muted ch-emp-fleet-mix">${escapeHtml(formatComposition(e.fleet))}</div>

      <h3 class="ch-emp-section">Technology</h3>
      <div class="ch-chip-row">${techHtml}</div>

      <h3 class="ch-emp-section">Planetary developments</h3>
      <div class="ch-chip-row">${
        devCounts.size
          ? [...devCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(
                ([d, n]) =>
                  `<span class="ch-chip">${escapeHtml(PLANETARY_LABEL[d] ?? d)} <b>×${n}</b></span>`,
              )
              .join("")
          : `<span class="ch-muted">No developments yet</span>`
      }</div>

      <h3 class="ch-emp-section">Diplomacy</h3>
      <div class="ch-emp-allies">${
        allyNames.length
          ? allyNames
              .map((n) => `<span class="ch-chip">${escapeHtml(n)}</span>`)
              .join("")
          : `<span class="ch-muted">No allies</span>`
      }</div>

      <h3 class="ch-emp-section">Active modifiers</h3>
      <div class="ch-emp-mods">${
        mods.length
          ? mods.map((m) => `<div class="ch-mod-line">${escapeHtml(m)}</div>`).join("")
          : `<span class="ch-muted">None</span>`
      }</div>

      <h3 class="ch-emp-section">Engagements</h3>
      <div class="ch-emp-eng">${
        engCount
          ? engLines
              .slice(0, 8)
              .map((l) => `<div class="ch-mod-line">${escapeHtml(l)}</div>`)
              .join("")
          : `<span class="ch-muted">None active</span>`
      }</div>
    `;

    const sig = `${id}|${bodyHtml}`;
    if (host.dataset.empId !== id || !host.querySelector("#ch-close-empire")) {
      host.dataset.empId = id;
      host.innerHTML = `
        <div class="ch-emp-head">
          <span class="ch-swatch ch-swatch-lg" data-emp-swatch style="background:${color}"></span>
          <div>
            <div class="ch-emp-name" data-emp-name style="color:${color}">${escapeHtml(e.name)}</div>
            <div class="ch-muted" data-emp-arch>${escapeHtml(archetypeLabel(e.archetype))}${e.alive ? "" : " · eliminated"}</div>
          </div>
          <button type="button" class="btn btn-compact" id="ch-close-empire" title="Close">×</button>
        </div>
        <div class="ch-emp-body"></div>
      `;
      this.lastEmpireSig = "";
    } else {
      const swatch = host.querySelector<HTMLElement>("[data-emp-swatch]");
      if (swatch) swatch.style.background = color;
      const nameEl = host.querySelector<HTMLElement>("[data-emp-name]");
      if (nameEl) {
        setText(nameEl, e.name);
        nameEl.style.color = color;
      }
      const archEl = host.querySelector<HTMLElement>("[data-emp-arch]");
      if (archEl) {
        setText(
          archEl,
          `${archetypeLabel(e.archetype)}${e.alive ? "" : " · eliminated"}`,
        );
      }
    }

    if (sig === this.lastEmpireSig) return;
    this.lastEmpireSig = sig;
    const body = host.querySelector(".ch-emp-body");
    if (body) body.innerHTML = bodyHtml;
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

function techAvailable(
  researched: ReadonlySet<MacroTechId>,
  tech: MacroTechId,
): boolean {
  if (researched.has(tech)) return false;
  const tier = TECH_TIER[tech];
  if (tier === 1) return true;
  for (const id of researched) {
    if (TECH_TIER[id] === tier - 1) return true;
  }
  return false;
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

function traitBar(key: keyof EmpireTraits, value: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return `<div class="ch-trait"><span>${label}</span><div class="ch-trait-track"><i style="width:${pct}%"></i></div><b>${pct}</b></div>`;
}

function activeModifiers(m: {
  productionMult: number;
  productionTicksLeft: number;
  garrisonMult: number;
  garrisonTicksLeft: number;
  attackPressure: number;
  attackPressureTicksLeft: number;
}): string[] {
  const out: string[] = [];
  if (m.productionTicksLeft > 0) {
    out.push(
      `Production ×${m.productionMult.toFixed(2)} (${m.productionTicksLeft}t)`,
    );
  }
  if (m.garrisonTicksLeft > 0) {
    out.push(
      `Garrison ×${m.garrisonMult.toFixed(2)} (${m.garrisonTicksLeft}t)`,
    );
  }
  if (m.attackPressureTicksLeft > 0) {
    out.push(
      `Attack pressure ×${m.attackPressure.toFixed(2)} (${m.attackPressureTicksLeft}t)`,
    );
  }
  return out;
}

const EXCLUSIVE_PANELS = ["empire", "trends", "military", "battles", "tech"] as const;
type ExclusivePanel = (typeof EXCLUSIVE_PANELS)[number];

function isExclusivePanel(
  key: keyof DashboardState["panels"],
): key is ExclusivePanel {
  return (EXCLUSIVE_PANELS as readonly string[]).includes(key);
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
        <button type="button" class="btn" data-speed="20">20×</button>
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
      <button type="button" class="rail-tab" data-panel-toggle="empire">Empire</button>
      <button type="button" class="rail-tab" data-panel-toggle="military">Military</button>
      <button type="button" class="rail-tab" data-panel-toggle="tech">Tech</button>
      <button type="button" class="rail-tab" data-panel-toggle="battles">Battles <span id="ch-battles-badge" class="ch-rail-badge" hidden></span></button>
      <button type="button" class="rail-tab" data-panel-toggle="overlays">Overlays</button>
    </nav>
    <div class="chronicle-left">
      <aside class="chronicle-panel" data-panel="roster">
        <div class="ch-panel-head">
          <h2>Empires</h2>
          <div class="ch-tools">
            <select id="ch-pin-n" aria-label="How many empires to pin">
              <option value="5">Top 5</option>
              <option value="8">Top 8</option>
              <option value="12">Top 12</option>
              <option value="20">Top 20</option>
              <option value="48">All</option>
            </select>
          </div>
        </div>
        <div class="ch-roster-head" role="row">
          <span></span>
          <button type="button" class="ch-sortable" data-roster-sort="name" data-label="Name">Name</button>
          <button type="button" class="ch-sortable" data-roster-sort="archetype" data-label="Archetype">Archetype</button>
          <button type="button" class="ch-sortable" data-roster-sort="territory" data-label="Sys">Sys</button>
          <button type="button" class="ch-sortable" data-roster-sort="population" data-label="Pop">Pop</button>
          <button type="button" class="ch-sortable" data-roster-sort="credits" data-label="¢">¢</button>
          <button type="button" class="ch-sortable" data-roster-sort="garrison" data-label="Gar">Gar</button>
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
    <div class="chronicle-right">
      <aside class="chronicle-panel chronicle-dock-panel" data-panel="trends" hidden>
        <h2>Trends</h2>
        <div id="ch-trends"></div>
      </aside>
      <aside class="chronicle-panel chronicle-dock-panel" data-panel="empire" hidden>
        <h2>Empire dossier</h2>
        <div id="ch-empire-detail" class="ch-empire-detail"></div>
      </aside>
      <aside class="chronicle-panel chronicle-dock-panel" data-panel="military" hidden>
        <h2>Military</h2>
        <div id="ch-military"></div>
      </aside>
      <aside class="chronicle-panel chronicle-dock-panel" data-panel="tech" hidden>
        <h2>Technology</h2>
        <div id="ch-tech" class="ch-tech"></div>
      </aside>
      <aside class="chronicle-panel chronicle-dock-panel" data-panel="battles" hidden>
        <h2>Active engagements</h2>
        <div id="ch-battles" class="ch-battles"></div>
      </aside>
      <aside class="chronicle-panel chronicle-overlays-panel" data-panel="overlays" hidden>
        <h2>Overlays</h2>
        <label class="ch-check"><input type="checkbox" data-overlay="contested" /> Contested fronts</label>
        <label class="ch-check"><input type="checkbox" data-overlay="lanes" /> Hyperlanes</label>
        <label class="ch-check"><input type="checkbox" data-overlay="labels" /> Names</label>
        <label class="ch-check"><input type="checkbox" data-overlay="diplomacy" /> Diplomatic pacts</label>
        <label class="ch-check"><input type="checkbox" data-overlay="frontiers" /> Highlight frontiers</label>
        <p class="ch-hint">Click a star to inspect it. Scroll to zoom, drag to pan.</p>
      </aside>
    </div>
    <div class="chronicle-selection" id="ch-selection" hidden></div>
    </div>
  `;
}
