import type {
  Fleet,
  Intent,
  LobbySeat,
  MatchStartMessage,
  NodeId,
  NodeRole,
  PlayerId,
  PlayerView,
  ScoreRank,
  ServerMessage,
  ShipType,
  TechId,
  TickUpdateMessage,
} from "@starfall/sim";
import {
  DEFAULT_BALANCE,
  TECH_IDS,
  TECH_TIER,
  applyPlayerViewDelta,
  buildSlots,
  effectiveCombatPower,
  effectiveGarrison,
  empireProduction,
  fleetPower,
  isFoggedNode,
  nodeProduction,
  techCost,
  upgradeBoostLabel,
  upgradeCost,
} from "@starfall/sim";
import { NetClient, loadStoredClientId, storeClientId } from "./net.js";
import { MapRenderer, type RenderState } from "./renderer.js";
import {
  readChronicleHash,
  startChronicle,
  writeChronicleHash,
} from "./macro/chronicle.js";

const BAL = DEFAULT_BALANCE;

/** Client-only macro spectator — skip competitive lobby entirely. */
const chronicleBoot = readChronicleHash();
if (chronicleBoot) {
  const appRoot = document.getElementById("app")!;
  startChronicle(appRoot, chronicleBoot);
} else {
  bootCompetitive();
}

function bootCompetitive(): void {

const ROLE_FILL_CSS: Record<string, string> = {
  homeworld: "#4a6fa5",
  core_world: "#3d8f6e",
  resource: "#c4a035",
  shipyard: "#8b5a9e",
  relay: "#6b7c8f",
  relic: "#d4c07a",
};

/** Same glyph family as the canvas role icons, on a 16x16 grid. */
const ROLE_ICON_PATH: Record<string, string> = {
  homeworld: "M2.5 8 8 3.2 13.5 8M4.8 8v4.8h6.4V8",
  core_world:
    "M6.2 5.6a1.7 1.7 0 1 0 .01 0M10.6 6a1.5 1.5 0 1 0 .01 0M2.8 12.6c.9-1.5 2.2-2.2 3.4-2.2s2.2.7 2.6 2.2M8.8 12.6c.5-1.3 1.5-1.9 2.4-1.9s1.7.5 2 1.9",
  resource: "M8 2.6 13 8l-5 5.4L3 8Z",
  shipyard: "M6.6 3v6.1L3.4 12.4M6.6 9.1l5 3.3M9.6 4.2l3 2.6",
  relay: "M8 13.2V7.6M5.6 6.4a3.2 3.2 0 0 1 4.8 0M3.8 4.2a5.8 5.8 0 0 1 8.4 0",
  relic: "M8 2.4v3.2M8 10.4v3.2M2.4 8h3.2M10.4 8h3.2M8 6.6a1.4 1.4 0 1 0 .01 0",
};

const TECH_BLURB: Record<TechId, string> = {
  advanced_propulsion: "War fleets move faster",
  fortified_colonies: "Stronger garrisons",
  survey_drones: "+1 vision hop",
  heavy_warships: "Unlock Battleships",
  lane_logistics: "Faster cargo",
  population_efficiency: "More core pop",
  orbital_shielding: "Flat garrison boost",
  rapid_deployment: "Faster shipyard builds",
  relic_scanning: "See all relics",
};

const SORTED_TECH = [...TECH_IDS].sort(
  (a, b) => TECH_TIER[a] - TECH_TIER[b] || (a < b ? -1 : 1),
);

type PanelId = "standings" | "tech" | "help";

const app = document.getElementById("app")!;
app.innerHTML = `
  <section class="lobby" id="lobby">
    <div class="lobby-inner">
      <h1 class="lobby-brand">Starfall</h1>
      <p class="lobby-tag">Graph conquest. Claim lanes. Raid the sky.</p>
      <form class="lobby-form" id="join-form">
        <label class="field">
          <span>Commander</span>
          <input id="name" maxlength="24" placeholder="Your name" autocomplete="nickname" required />
        </label>
        <button type="button" class="btn btn-primary" id="solo-btn">Play vs AI</button>
        <button type="button" class="btn" id="watch-btn">Watch bots</button>
        <div class="lobby-watch-opts" id="watch-opts">
          <label class="field field-inline">
            <span>Map</span>
            <select id="watch-map-size">
              <option value="small">Small</option>
              <option value="medium" selected>Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label class="field field-inline">
            <span>Bots</span>
            <select id="watch-bot-count">
              <option value="4">4</option>
              <option value="6">6</option>
              <option value="8" selected>8</option>
              <option value="12">12</option>
            </select>
          </label>
        </div>
        <button type="button" class="btn" id="chronicle-btn">Chronicle</button>
        <div class="lobby-watch-opts" id="chronicle-opts">
          <label class="field field-inline">
            <span>Galaxy</span>
            <select id="chronicle-map-size">
              <option value="small">Small (400)</option>
              <option value="medium" selected>Medium (1000)</option>
              <option value="large">Large (2500)</option>
            </select>
          </label>
        </div>
        <div class="lobby-actions">
          <button type="submit" class="btn" id="join-btn">Join lobby</button>
          <button type="button" class="btn" id="ready-btn" disabled>Ready</button>
          <button type="button" class="btn" id="start-btn" disabled>Start</button>
        </div>
      </form>
      <div class="lobby-roster" id="lobby-roster" hidden>
        <div class="lobby-roster-head">
          <h2>Lobby</h2>
          <span id="lobby-capacity"></span>
        </div>
        <ul class="lobby-seats" id="seats"></ul>
      </div>
      <p class="lobby-error" id="lobby-error" role="alert"></p>
    </div>
  </section>

  <section class="match hidden" id="match">
    <canvas id="map"></canvas>
    <div class="hud">
      <div class="hud-zone zone-tl">
        <div class="stat-bar">
          <div class="stat">
            <span>Credits</span>
            <b id="credits">0</b>
            <em class="stat-rate" id="credits-rate">+0/s</em>
          </div>
          <div class="stat">
            <span>Pop</span>
            <b id="pop">0</b>
            <em class="stat-rate" id="pop-rate">+0/s</em>
          </div>
          <div class="stat">
            <span>Systems</span>
            <b id="systems">0</b>
          </div>
        </div>
        <button class="rail-tab" id="diplo-toggle" type="button" aria-expanded="false">
          Diplomacy<span class="badge hidden" id="diplo-badge">0</span>
        </button>
        <aside class="panel hidden" id="diplo-panel">
          <div id="diplo-body"></div>
        </aside>
      </div>

      <div class="hud-zone zone-tc">
        <div class="hud-tip hidden" id="hud-tip"></div>
        <div class="combat-log" id="combat-log" aria-live="polite"></div>
        <div class="spectator-banner hidden" id="spectator-banner">Watching · hard bots</div>
      </div>

      <div class="hud-zone zone-tr">
        <div class="status-chip">
          <div class="clock" id="timer">—</div>
          <div class="rank" id="rank">Rank —</div>
        </div>
        <nav class="rail-tabs" aria-label="Panels">
          <button class="rail-tab is-active" type="button" data-panel="standings">Standings</button>
          <button class="rail-tab" type="button" data-panel="tech">Tech</button>
          <button class="rail-tab" type="button" data-panel="help">Help</button>
        </nav>
        <aside class="panel panel-scroll" id="panel-standings">
          <div id="ranks-body"></div>
        </aside>
        <aside class="panel panel-scroll hidden" id="panel-tech">
          <div class="tech-grid" id="tech-grid"></div>
        </aside>
        <aside class="panel panel-scroll hidden" id="panel-help">
          <h3>How to play</h3>
          <ol class="help-list">
            <li><strong>You</strong> are the amber-ringed homeworld.</li>
            <li><strong>Move:</strong> select a system with your ships, then click where to go. Shift+click fleets to multi-select; <kbd>A</kbd> selects all here.</li>
            <li><strong>Claim:</strong> select your fleet, then click an enemy or neutral system. Population embarks automatically and captures on arrival if it beats the garrison. Ships alone never flip ownership.</li>
            <li><strong>Raid only:</strong> hold <kbd>Alt</kbd> while clicking to send ships without colonists.</li>
            <li><strong>Retarget:</strong> reordering a fleet already in transit needs a second click (or hold <kbd>Ctrl</kbd>) so you don't cancel by accident.</li>
            <li><strong>Build</strong> fighters at home; cruisers need a shipyard. Higher shipyard levels unlock more concurrent build slots. <strong>Credits</strong> buy ships, tech and upgrades. <strong>Pop</strong> only buys territory.</li>
            <li><strong>Ships:</strong> Fighters swarm cheaply, Cruisers counter fighters, Battleships counter cruisers — pick the mix for the fight.</li>
            <li><strong>Grow income:</strong> capture resource nodes for cargo credits, core worlds for population, then press <em>Upgrade</em> on those systems — rates show under Credits / Pop and on the selected system.</li>
          </ol>
          <h3>Shortcuts</h3>
          <dl class="shortcuts">
            <div><dt><kbd>Tab</kbd></dt><dd>Cycle fleets here</dd></div>
            <div><dt><kbd>A</kbd></dt><dd>Select all fleets here</dd></div>
            <div><dt><kbd>Shift</kbd>+click</dt><dd>Add/remove fleet from selection</dd></div>
            <div><dt><kbd>B</kbd></dt><dd>Build fighter</dd></div>
            <div><dt><kbd>U</kbd></dt><dd>Upgrade system</dd></div>
            <div><dt><kbd>C</kbd></dt><dd>Pre-load colonists</dd></div>
            <div><dt><kbd>Alt</kbd>+click</dt><dd>Raid without colonists</dd></div>
            <div><dt><kbd>Ctrl</kbd>+click</dt><dd>Force retarget in transit</dd></div>
            <div><dt><kbd>H</kbd></dt><dd>Jump to homeworld</dd></div>
            <div><dt><kbd>T</kbd></dt><dd>Tech panel</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Clear path / selection / close panel</dd></div>
            <div><dt><kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd></dt><dd>Zoom in / out / fit</dd></div>
          </dl>
        </aside>
      </div>

      <div class="hud-zone zone-bl">
        <div class="zoom-cluster">
          <button class="icon-btn" type="button" id="zoom-in" title="Zoom in (+)">+</button>
          <button class="icon-btn" type="button" id="zoom-out" title="Zoom out (−)">−</button>
          <button class="icon-btn" type="button" id="zoom-fit" title="Fit map (0)">⤢</button>
        </div>
        <div class="hud-wordmark">Starfall</div>
      </div>

      <div class="hud-zone zone-bc">
        <div class="hud-strip hidden" id="strip">
          <div class="strip-head">
            <span class="strip-swatch" id="strip-swatch"></span>
            <div class="strip-title">
              <div class="strip-name"><strong id="strip-role">—</strong><span class="strip-level" id="strip-level">L1</span></div>
              <div class="strip-owner" id="strip-owner">—</div>
            </div>
            <dl class="strip-stats" id="strip-stats"></dl>
          </div>
          <p class="strip-hint" id="strip-hint"></p>
          <div class="strip-actions" id="strip-actions"></div>
          <div class="split-row hidden" id="split-row">
            <label for="split">Send</label>
            <input type="range" id="split" min="5" max="100" step="5" value="100" />
            <output id="split-label">100%</output>
          </div>
        </div>
      </div>
    </div>

    <div class="hud-over hidden" id="over">
      <div class="hud-over-card">
        <h2 id="over-title">Match over</h2>
        <ol id="over-ranks"></ol>
      </div>
    </div>
  </section>
`;

const net = new NetClient();
let clientId: string | null = loadStoredClientId();
let lobbyCapacity = 100;
let isHost = false;
let ready = false;
let joined = false;
let soloRequested = false;
let watchRequested = false;
let isSpectator = false;
let match: MatchStartMessage | null = null;
let view: PlayerView | null = null;
let ranks: ScoreRank[] = [];
let selectedNode: NodeId | null = null;
let pathPreview: NodeId[] = [];
let selectedFleetId: string | null = null;
let selectedFleetIds = new Set<string>();
/** Fleet ids pending retarget confirm (double-click within window). */
let retargetArmed = new Map<string, number>();
let combatLogEntries: { text: string; expires: number }[] = [];
let roundTicks = 3600;
let activePanel: PanelId | null = "standings";
let diploOpen = false;
const lastLevels = new Map<NodeId, number>();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const lobbyEl = $("lobby");
const matchEl = $("match");
const seatsEl = $("seats");
const errEl = $("lobby-error");
const readyBtn = $<HTMLButtonElement>("ready-btn");
const startBtn = $<HTMLButtonElement>("start-btn");
const soloBtn = $<HTMLButtonElement>("solo-btn");
const watchBtn = $<HTMLButtonElement>("watch-btn");
const chronicleBtn = $<HTMLButtonElement>("chronicle-btn");
const nameInput = $<HTMLInputElement>("name");
const splitInput = $<HTMLInputElement>("split");
const canvas = $<HTMLCanvasElement>("map");
const renderer = new MapRenderer(canvas);

const renderState: RenderState = {
  map: { nodes: {} },
  view: emptyView(),
  seatColors: {},
  selfId: "p0",
  selectedNode: null,
  selectedFleetIds: new Set(),
  pathPreview: [],
  ownershipPulse: new Map(),
  upgradePulse: new Map(),
  combatFlash: 0,
  combatBursts: [],
  allies: new Set(),
  showMinimap: window.innerWidth >= 900,
  powerPreview: null,
};

window.addEventListener("resize", () => {
  renderState.showMinimap = window.innerWidth >= 900;
});

function emptyView(): PlayerView {
  return {
    tick: 0,
    turnNumber: 0,
    visibleNodes: [],
    nodes: {},
    fleets: {},
    cargoShips: {},
    self: {
      id: "p0",
      clientId: null,
      displayName: "",
      credits: 0,
      researched: [],
      allies: [],
      allianceProposals: [],
      eliminated: false,
      score: 0,
      homeworldId: null,
    },
    scores: {},
  };
}

// —— Lobby ——————————————————————————————————————————————————————

net.onMessage = handleServer;
net.onClose = () => {
  if (!match) errEl.textContent = "Disconnected from server";
};

nameInput.value = localStorage.getItem("sf-name") ?? "";

function connectAndHello(name: string): void {
  localStorage.setItem("sf-name", name);
  errEl.textContent = "";
  if (joined) {
    net.hello(name, clientId);
    return;
  }
  net.connect();
  net.onOpen = () => {
    net.hello(name, clientId);
    joined = true;
    readyBtn.disabled = false;
    $<HTMLButtonElement>("join-btn").disabled = true;
    $("lobby-roster").hidden = false;
    if (soloRequested) {
      ready = true;
      readyBtn.textContent = "Unready";
      // Give the server a beat to seat us before asking it to fill with bots.
      // Do not setReady first — that used to auto-start with pre-seeded bots.
      setTimeout(() => net.startMatch(7), 120);
    } else if (watchRequested) {
      ready = true;
      readyBtn.textContent = "Unready";
      setTimeout(() => startWatchMatch(), 120);
    }
  };
}

function startWatchMatch(): void {
  const bots = Number(($<HTMLSelectElement>("watch-bot-count").value) || 8);
  const mapSize = $<HTMLSelectElement>("watch-map-size").value as
    | "small"
    | "medium"
    | "large";
  net.startMatch(bots, {
    difficulty: "hard",
    mapSize,
    spectator: true,
  });
}

$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  soloRequested = false;
  watchRequested = false;
  connectAndHello(name);
});

soloBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Commander";
  nameInput.value = name;
  soloRequested = true;
  watchRequested = false;
  soloBtn.disabled = true;
  watchBtn.disabled = true;
  chronicleBtn.disabled = true;
  soloBtn.textContent = "Launching…";
  if (joined) {
    net.startMatch(7);
  } else {
    connectAndHello(name);
  }
});

watchBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Spectator";
  nameInput.value = name;
  watchRequested = true;
  soloRequested = false;
  watchBtn.disabled = true;
  soloBtn.disabled = true;
  chronicleBtn.disabled = true;
  watchBtn.textContent = "Launching…";
  if (joined) {
    startWatchMatch();
  } else {
    connectAndHello(name);
  }
});

chronicleBtn.addEventListener("click", () => {
  const mapSize = $<HTMLSelectElement>("chronicle-map-size").value as
    | "small"
    | "medium"
    | "large";
  writeChronicleHash({ mapSize });
  startChronicle(app, { mapSize });
});

readyBtn.addEventListener("click", () => {
  ready = !ready;
  net.setReady(ready);
  readyBtn.textContent = ready ? "Unready" : "Ready";
});

startBtn.addEventListener("click", () => net.startMatch());

function renderLobby(seats: LobbySeat[]): void {
  $("lobby-roster").hidden = seats.length === 0;
  $("lobby-capacity").textContent = `${seats.length} / ${lobbyCapacity}`;
  seatsEl.innerHTML = seats
    .map((s) => {
      const tags = [
        s.host ? '<span class="tag">host</span>' : "",
        s.connected ? "" : '<span class="tag tag-dim">offline</span>',
      ].join("");
      return `<li class="${s.ready ? "is-ready" : ""}">
        <span class="seat-name">${escapeHtml(s.displayName)}${tags}</span>
        <span class="seat-state">${s.ready ? "Ready" : "Waiting"}</span>
      </li>`;
    })
    .join("");
  const me = seats.find((s) => s.clientId === clientId);
  isHost = Boolean(me?.host);
  startBtn.disabled = !isHost;
}

// —— HUD panels ————————————————————————————————————————————————

function setPanel(id: PanelId | null): void {
  activePanel = id;
  for (const p of ["standings", "tech", "help"] as PanelId[]) {
    $(`panel-${p}`).classList.toggle("hidden", p !== id);
  }
  document.querySelectorAll<HTMLElement>(".rail-tabs .rail-tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.panel === id);
  });
}

document.querySelectorAll<HTMLElement>(".rail-tabs .rail-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.panel as PanelId;
    setPanel(activePanel === id ? null : id);
    if (id === "help") localStorage.setItem("sf-help-seen", "1");
  });
});

function setDiplo(open: boolean): void {
  diploOpen = open;
  $("diplo-panel").classList.toggle("hidden", !open);
  $("diplo-toggle").setAttribute("aria-expanded", String(open));
  $("diplo-toggle").classList.toggle("is-active", open);
}

$("diplo-toggle").addEventListener("click", () => setDiplo(!diploOpen));

$("zoom-in").addEventListener("click", () => renderer.zoomBy(1.25));
$("zoom-out").addEventListener("click", () => renderer.zoomBy(0.8));
$("zoom-fit").addEventListener("click", () => {
  if (match) renderer.fitMap(match.map);
});

function syncSplitFill(): void {
  $("split-label").textContent = `${splitInput.value}%`;
  const min = Number(splitInput.min);
  const pct =
    ((Number(splitInput.value) - min) / (Number(splitInput.max) - min)) * 100;
  splitInput.style.setProperty("--fill", `${pct}%`);
}
splitInput.addEventListener("input", syncSplitFill);
syncSplitFill();

// —— Controls ——————————————————————————————————————————————————

/** BFS over the public topology; unexplored systems are still routable. */
function findPath(from: NodeId, to: NodeId): NodeId[] | null {
  if (!match) return null;
  if (from === to) return [from];
  const nodes = match.map.nodes;
  if (!nodes[from] || !nodes[to]) return null;
  const prev = new Map<NodeId, NodeId>();
  const seen = new Set<NodeId>([from]);
  const q: NodeId[] = [from];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i]!;
    for (const n of nodes[cur]?.neighbors ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path: NodeId[] = [to];
        let step: NodeId | undefined = to;
        while (step !== undefined && step !== from) {
          step = prev.get(step);
          if (step !== undefined) path.push(step);
        }
        return path.reverse();
      }
      q.push(n);
    }
  }
  return null;
}

function ownFleetsAt(nodeId: NodeId): Fleet[] {
  if (!view) return [];
  return Object.values(view.fleets)
    .filter(
      (f) =>
        f.ownerId === view!.self.id &&
        f.location.kind === "node" &&
        f.location.nodeId === nodeId,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function selectNode(nodeId: NodeId | null): void {
  selectedNode = nodeId;
  pathPreview = nodeId ? [nodeId] : [];
  const first = nodeId ? (ownFleetsAt(nodeId)[0]?.id ?? null) : null;
  selectedFleetId = first;
  selectedFleetIds = first ? new Set([first]) : new Set();
  syncFleetSelection();
  updateStrip();
}

function syncFleetSelection(): void {
  renderState.selectedFleetIds = selectedFleetIds;
  if (selectedFleetIds.size === 1) {
    selectedFleetId = [...selectedFleetIds][0]!;
  } else if (selectedFleetIds.size === 0) {
    selectedFleetId = null;
  } else if (!selectedFleetId || !selectedFleetIds.has(selectedFleetId)) {
    selectedFleetId = [...selectedFleetIds][0] ?? null;
  }
}

function selectAllFleetsHere(): void {
  if (!selectedNode) return;
  const fleets = ownFleetsAt(selectedNode);
  selectedFleetIds = new Set(fleets.map((f) => f.id));
  syncFleetSelection();
  updateStrip();
}

function cycleFleet(): void {
  if (!selectedNode) return;
  const fleets = ownFleetsAt(selectedNode);
  if (fleets.length < 2) return;
  const idx = fleets.findIndex((f) => f.id === selectedFleetId);
  selectedFleetId = fleets[(idx + 1) % fleets.length]!.id;
  selectedFleetIds = new Set([selectedFleetId]);
  syncFleetSelection();
  updateStrip();
}

function clearPathStaging(): void {
  pathPreview = selectedNode ? [selectedNode] : [];
  updateStrip();
}

renderer.bindPanZoom(
  (nodeId, mods) => {
    if (!match || !view || isSpectator) {
      if (nodeId) {
        selectedNode = nodeId;
        updateStrip();
      }
      return;
    }
    if (!nodeId) {
      selectNode(null);
      return;
    }

    const fleetsHere = ownFleetsAt(nodeId);
    // Shift+click on a system with own fleets toggles multi-select among fleets there.
    if (mods.shift && fleetsHere.length > 0 && selectedNode === nodeId) {
      const fid = fleetsHere[0]!.id;
      if (selectedFleetIds.has(fid) && fleetsHere.length === 1) {
        selectedFleetIds.delete(fid);
      } else {
        for (const f of fleetsHere) {
          if (selectedFleetIds.has(f.id)) selectedFleetIds.delete(f.id);
          else selectedFleetIds.add(f.id);
        }
      }
      if (selectedFleetIds.size === 0 && fleetsHere[0]) {
        selectedFleetIds.add(fleetsHere[0].id);
      }
      selectedNode = nodeId;
      pathPreview = [nodeId];
      syncFleetSelection();
      updateStrip();
      return;
    }

    const anchor = pathPreview[pathPreview.length - 1] ?? selectedNode;

    // Shift extends an explicit route without dispatching it yet.
    if (mods.shift && anchor && selectedFleetIds.size > 0) {
      const seg = findPath(anchor, nodeId);
      if (!seg || seg.length < 2) {
        flashIllegal();
        return;
      }
      pathPreview = [...pathPreview, ...seg.slice(1)];
      updateStrip();
      return;
    }

    if (selectedFleetIds.size === 0 || !anchor || nodeId === selectedNode) {
      selectNode(nodeId);
      return;
    }

    const tail = findPath(anchor, nodeId);
    if (!tail || tail.length < 2) {
      selectNode(nodeId);
      return;
    }
    const full = [...pathPreview, ...tail.slice(1)];
    sendMoves(full, mods.alt, mods.ctrl);
    pathPreview = selectedNode ? [selectedNode] : [];
    updateStrip();
  },
  undefined,
  () => {
    if (pathPreview.length > 1) clearPathStaging();
    else if (selectedFleetIds.size > 1) {
      selectedFleetIds = selectedFleetId
        ? new Set([selectedFleetId])
        : new Set();
      syncFleetSelection();
      updateStrip();
    }
  },
);

window.addEventListener("keydown", (e) => {
  if (!match || !view) return;
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case "Escape":
      if (activePanel) setPanel(null);
      else if (diploOpen) setDiplo(false);
      else if (pathPreview.length > 1) {
        clearPathStaging();
      } else if (selectedFleetIds.size > 1) {
        selectedFleetIds = selectedFleetId
          ? new Set([selectedFleetId])
          : new Set();
        syncFleetSelection();
        updateStrip();
      } else selectNode(null);
      e.preventDefault();
      break;
    case "Tab":
      if (!isSpectator) cycleFleet();
      e.preventDefault();
      break;
    case "a":
    case "A":
      if (!isSpectator) selectAllFleetsHere();
      break;
    case "t":
      setPanel(activePanel === "tech" ? null : "tech");
      break;
    case "r":
      setPanel(activePanel === "standings" ? null : "standings");
      break;
    case "?":
      setPanel(activePanel === "help" ? null : "help");
      break;
    case "d":
      setDiplo(!diploOpen);
      break;
    case "h": {
      const home = view.self.homeworldId;
      if (home && match.map.layout?.[home]) {
        renderer.centerOn(match.map.layout[home]!);
        selectNode(home);
      }
      break;
    }
    case "+":
    case "=":
      renderer.zoomBy(1.25);
      break;
    case "-":
    case "_":
      renderer.zoomBy(0.8);
      break;
    case "0":
      renderer.fitMap(match.map);
      break;
    case "b":
      if (!isSpectator) clickAction("build-fighter");
      break;
    case "u":
      if (!isSpectator) clickAction("upgrade");
      break;
    case "c":
      if (!isSpectator) clickAction("load");
      break;
    default:
      break;
  }
});

function clickAction(key: string): void {
  const btn = document.querySelector<HTMLButtonElement>(
    `#strip-actions [data-action="${key}"]`,
  );
  if (btn && !btn.disabled) btn.click();
  else flashIllegal();
}

function sendMoves(path: NodeId[], raidOnly = false, forceRetarget = false): void {
  if (selectedFleetIds.size === 0 || path.length < 2 || !view || isSpectator)
    return;
  const now = performance.now();
  const pct = Number(splitInput.value) / 100;
  let blocked = 0;

  for (const fleetId of selectedFleetIds) {
    const fleet = view.fleets[fleetId];
    if (!fleet || fleet.ownerId !== view.self.id) continue;

    if (fleet.location.kind === "transit" && !forceRetarget) {
      const armedAt = retargetArmed.get(fleetId) ?? 0;
      if (now - armedAt > 1200) {
        retargetArmed.set(fleetId, now);
        blocked += 1;
        continue;
      }
      retargetArmed.delete(fleetId);
    }

    const fleetPath =
      fleet.location.kind === "node"
        ? (() => {
            const from = fleet.location.nodeId;
            if (from === path[0]) return path;
            const bridge = findPath(from, path[0]!);
            if (!bridge || bridge.length < 1) return null;
            return [...bridge, ...path.slice(1)];
          })()
        : path;

    if (!fleetPath || fleetPath.length < 2) {
      flashIllegal();
      continue;
    }

    let intent: Intent = {
      type: "MoveFleet",
      fleetId,
      path: [...fleetPath],
      ...(raidOnly ? { raidOnly: true } : {}),
    };
    if (pct < 0.999) {
      const composition: Record<string, number> = {};
      for (const [k, n] of Object.entries(fleet.composition)) {
        const take = Math.floor((n ?? 0) * pct);
        if (take > 0) composition[k] = take;
      }
      if (Object.keys(composition).length === 0) {
        flashIllegal();
        continue;
      }
      intent = {
        type: "MoveFleet",
        fleetId,
        path: [...fleetPath],
        composition,
        ...(raidOnly ? { raidOnly: true } : {}),
      };
    }
    net.intent(intent);
  }

  if (blocked > 0) {
    const tip = $("hud-tip");
    tip.textContent =
      blocked === 1
        ? "Fleet in transit — click again to retarget (or Ctrl+click)"
        : `${blocked} fleets in transit — click again to retarget (or Ctrl+click)`;
    tip.classList.remove("hidden");
    setTimeout(() => tip.classList.add("hidden"), 2200);
  }
}

function flashIllegal(): void {
  renderState.combatFlash = 0.35;
  canvas.classList.remove("shake");
  void canvas.offsetWidth;
  canvas.classList.add("shake");
}

// —— Server messages ————————————————————————————————————————————

function handleServer(msg: ServerMessage): void {
  switch (msg.type) {
    case "Welcome":
      clientId = msg.clientId;
      storeClientId(msg.clientId);
      lobbyCapacity = msg.capacity;
      break;
    case "LobbyUpdate":
      lobbyCapacity = msg.capacity;
      renderLobby(msg.seats);
      break;
    case "MatchStart":
      beginMatch(msg);
      break;
    case "TickUpdate":
      applyTickUpdate(msg);
      break;
    case "MatchOver":
      showOver(msg.ranks, msg.winnerId);
      break;
    case "Error":
      errEl.textContent = msg.message;
      soloBtn.disabled = false;
      soloBtn.textContent = "Play vs AI";
      watchBtn.disabled = false;
      watchBtn.textContent = "Watch bots";
      chronicleBtn.disabled = false;
      break;
    default:
      break;
  }
}

function beginMatch(msg: MatchStartMessage): void {
  match = msg;
  view = msg.view;
  roundTicks = msg.roundTicks;
  clientId = msg.clientId;
  storeClientId(msg.clientId);
  isSpectator = Boolean(msg.spectator);
  lobbyEl.classList.add("hidden");
  matchEl.classList.remove("hidden");
  $("spectator-banner").classList.toggle("hidden", !isSpectator);
  // Canvas was 0x0 while the lobby covered it.
  renderer.resize();
  renderer.setMap(msg.map);
  renderState.map = msg.map;
  renderState.seatColors = msg.seatColors;
  renderState.selfId = msg.playerId;
  renderState.view = msg.view;
  renderState.allies = new Set(msg.view.self.allies);
  selectedFleetIds = new Set();
  syncFleetSelection();
  combatLogEntries = [];
  $("combat-log").innerHTML = "";

  const homeId = msg.view.self.homeworldId;
  const focusIds =
    msg.view.visibleNodes.length > 0
      ? msg.view.visibleNodes
      : homeId
        ? [homeId]
        : Object.keys(msg.map.nodes);
  renderer.fitNodes(msg.map, focusIds);

  lastLevels.clear();
  for (const [id, n] of Object.entries(msg.view.nodes)) lastLevels.set(id, n.level);

  if (homeId) selectNode(homeId);
  lastTechKey = "";
  lastDiploKey = "";
  lastRanksKey = "";
  lastStripKey = "";
  lastActionKey = "";
  updateHud();
  updateTech();
  updateStrip();
  updateDiplo();
  updateRanksPanel();
  setPanel(localStorage.getItem("sf-help-seen") === "1" ? "standings" : "help");
}

function applyTickUpdate(msg: TickUpdateMessage): void {
  if (msg.full) {
    view = msg.full;
  } else if (msg.delta && view) {
    view = applyPlayerViewDelta(view, msg.delta);
  } else if (msg.delta) {
    return;
  }
  if (!view) return;
  renderState.view = view;
  renderState.allies = new Set(view.self.allies);
  if (msg.ranks) ranks = msg.ranks;

  const visible = new Set(view.visibleNodes);
  const layout = match?.map.layout ?? {};
  for (const c of msg.events.combats) {
    let wx: number | null = null;
    let wy: number | null = null;
    let seen = false;
    if (c.location.kind === "node") {
      seen = visible.has(c.location.nodeId) || isSpectator;
      const p = layout[c.location.nodeId];
      if (p) {
        wx = p.x;
        wy = p.y;
      }
    } else {
      seen =
        visible.has(c.location.from) ||
        visible.has(c.location.to) ||
        isSpectator;
      const a = layout[c.location.from];
      const b = layout[c.location.to];
      if (a && b) {
        wx = (a.x + b.x) / 2;
        wy = (a.y + b.y) / 2;
      }
    }
    if (seen) {
      renderState.combatFlash = Math.min(1, renderState.combatFlash + 0.45);
      if (wx !== null && wy !== null) {
        renderState.combatBursts = renderState.combatBursts ?? [];
        renderState.combatBursts.push({ x: wx, y: wy });
      }
    }

    const involvesSelf =
      isSpectator ||
      c.winnerId === view.self.id ||
      c.loserId === view.self.id;
    if (involvesSelf) {
      pushCombatLog(c);
    }
  }

  for (const a of msg.events.annexations) {
    if (a.success && visible.has(a.nodeId)) {
      renderState.ownershipPulse.set(a.nodeId, 1);
    }
  }

  for (const [id, n] of Object.entries(view.nodes)) {
    const prev = lastLevels.get(id);
    if (prev !== undefined && n.level > prev) {
      renderState.upgradePulse.set(id, 1);
    }
    lastLevels.set(id, n.level);
  }

  updateHud();
  updateTech();
  updateStrip();
  updateDiplo();
  if (msg.ranks) updateRanksPanel();
}

// —— HUD rendering ——————————————————————————————————————————————

let lastTechKey = "";
let lastDiploKey = "";
let lastRanksKey = "";
let lastStripKey = "";
let lastActionKey = "";
let lastResearchedCount = 0;

function updateHud(): void {
  if (!view || !match) return;
  $("credits").textContent = String(view.self.credits);
  let pop = 0;
  let systems = 0;
  const researched = new Set(view.self.researched);
  const ownedForProd: {
    role: NodeRole;
    level: number;
    population: number;
    ownerId: string | null;
  }[] = [];
  for (const [id, n] of Object.entries(view.nodes)) {
    if (isFoggedNode(n)) continue;
    if (n.ownerId !== view.self.id) continue;
    pop += n.population;
    systems++;
    const role = match.map.nodes[id]?.role as NodeRole | undefined;
    if (role) {
      ownedForProd.push({
        role,
        level: n.level,
        population: n.population,
        ownerId: n.ownerId,
      });
    }
  }
  $("pop").textContent = String(pop);
  $("systems").textContent = String(systems);

  const income = empireProduction(
    ownedForProd,
    view.self.id,
    researched,
    BAL,
  );
  const creditRate = income.bankCreditsPerSec + income.cargoCreditsPerSec;
  const creditsRateEl = $("credits-rate");
  creditsRateEl.textContent =
    creditRate > 0
      ? income.cargoCreditsPerSec > 0 && income.bankCreditsPerSec > 0
        ? `+${creditRate}/s · ${income.cargoCreditsPerSec} cargo`
        : income.cargoCreditsPerSec > 0
          ? `+${creditRate}/s cargo`
          : `+${creditRate}/s`
      : "+0/s";
  creditsRateEl.title =
    income.cargoCreditsPerSec > 0
      ? `${income.bankCreditsPerSec}/s bank + ${income.cargoCreditsPerSec}/s cargo (delivered by freighters)`
      : "Direct credit income from owned systems";
  const popRateEl = $("pop-rate");
  popRateEl.textContent =
    income.populationPerSec > 0
      ? `+${income.populationPerSec}/s`
      : systems > 0
        ? "capped"
        : "+0/s";
  popRateEl.classList.toggle("is-capped", income.populationPerSec === 0 && systems > 0);
  popRateEl.title =
    income.populationPerSec > 0
      ? "Population growth across your systems"
      : "Population at cap — upgrade core worlds or claim more to grow";

  const clock = $("timer");
  if (roundTicks <= 0) {
    const elapsed = Math.floor(view.tick / 10);
    clock.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
    clock.classList.remove("is-urgent");
  } else {
    const sec = Math.ceil(Math.max(0, roundTicks - view.tick) / 10);
    clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    clock.classList.toggle("is-urgent", sec <= 60);
  }

  const mine = ranks.find((r) => r.playerId === view!.self.id);
  $("rank").textContent = mine
    ? `Rank ${mine.rank} · ${mine.score}`
    : `Score ${view.self.score}`;
}

function updateDiplo(): void {
  if (!view || !match) return;
  const props = view.self.allianceProposals;
  const badge = $("diplo-badge");
  badge.textContent = String(props.length);
  badge.classList.toggle("hidden", props.length === 0);

  const key = `${view.self.allies.join(",")}|${props.join(",")}`;
  if (key === lastDiploKey) return;
  lastDiploKey = key;

  const parts: string[] = [];
  if (view.self.allies.length) {
    parts.push('<h4>Allies</h4><ul class="diplo-list">');
    for (const id of view.self.allies) {
      const name = match.players[id]?.displayName ?? id;
      parts.push(
        `<li><span>${escapeHtml(name)}</span><button type="button" class="btn btn-tiny" data-break="${id}">Break</button></li>`,
      );
    }
    parts.push("</ul>");
  }
  if (props.length) {
    parts.push('<h4>Incoming</h4><ul class="diplo-list">');
    for (const id of props) {
      const name = match.players[id]?.displayName ?? id;
      parts.push(
        `<li><span>${escapeHtml(name)}</span><button type="button" class="btn btn-tiny" data-accept="${id}">Accept</button></li>`,
      );
    }
    parts.push("</ul>");
  }
  if (!parts.length) {
    parts.push(
      '<p class="panel-empty">No alliances yet. Propose one from Standings.</p>',
    );
  }

  const body = $("diplo-body");
  body.innerHTML = parts.join("");
  body.querySelectorAll<HTMLElement>("[data-break]").forEach((btn) => {
    btn.addEventListener("click", () =>
      net.intent({ type: "BreakAlliance", withPlayerId: btn.dataset.break! }),
    );
  });
  body.querySelectorAll<HTMLElement>("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", () =>
      net.intent({ type: "AcceptAlliance", fromPlayerId: btn.dataset.accept! }),
    );
  });
}

function updateRanksPanel(): void {
  if (!match) return;
  const rows =
    ranks.length > 0
      ? ranks
      : Object.values(match.players).map((p, i) => ({
          playerId: p.id,
          displayName: p.displayName,
          score: view?.scores[p.id] ?? 0,
          rank: i + 1,
          eliminated: false,
          disconnected: false,
        }));
  const allies = view?.self.allies ?? [];
  const key = `${rows.map((r) => `${r.playerId}:${r.score}:${r.rank}:${r.eliminated}`).join("|")}#${allies.join(",")}`;
  if (key === lastRanksKey) return;
  lastRanksKey = key;

  const top = rows[0]?.score ?? 1;
  $("ranks-body").innerHTML = rows
    .slice(0, 24)
    .map((r) => {
      const self = r.playerId === view?.self.id;
      const ally = allies.includes(r.playerId);
      const color = self
        ? "var(--sf-self)"
        : (match!.seatColors[r.playerId] ?? "var(--sf-unowned)");
      const pct = Math.max(2, Math.round((r.score / Math.max(top, 1)) * 100));
      return `<button type="button" class="rank-row${self ? " is-self" : ""}${
        r.eliminated ? " is-out" : ""
      }" data-propose="${r.playerId}" ${self ? "disabled" : ""} title="${
        self ? "You" : ally ? "Break alliance" : "Propose alliance"
      }">
        <span class="rank-pos">${r.rank}</span>
        <span class="rank-dot" style="background:${color}"></span>
        <span class="rank-name">${escapeHtml(r.displayName)}${ally ? '<span class="tag">ally</span>' : ""}</span>
        <span class="rank-score">${r.score}</span>
        <span class="rank-bar"><i style="width:${pct}%;background:${color}"></i></span>
      </button>`;
    })
    .join("");

  $("ranks-body")
    .querySelectorAll<HTMLElement>("[data-propose]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const toPlayerId = btn.dataset.propose as PlayerId;
        if (!view || toPlayerId === view.self.id) return;
        if (view.self.allies.includes(toPlayerId)) {
          net.intent({ type: "BreakAlliance", withPlayerId: toPlayerId });
        } else {
          net.intent({ type: "ProposeAlliance", toPlayerId });
        }
      });
    });
}

function techUnlocked(researched: Set<TechId>, techId: TechId): boolean {
  if (researched.has(techId)) return true;
  const tier = TECH_TIER[techId];
  if (tier === 1) return true;
  for (const t of researched) {
    if (TECH_TIER[t] === tier - 1) return true;
  }
  return false;
}

function updateTech(): void {
  if (!view) return;
  const credits = view.self.credits;
  const researched = view.self.researched;
  const key = `${researched.slice().sort().join(",")}|${credits}`;
  if (key === lastTechKey) return;
  lastTechKey = key;

  const justUnlocked = researched.length > lastResearchedCount;
  lastResearchedCount = researched.length;

  const owned = new Set(researched);
  const grid = $("tech-grid");
  grid.innerHTML = SORTED_TECH.map((id) => {
    const has = owned.has(id);
    const cost = techCost(id, BAL);
    const unlocked = has || techUnlocked(owned, id);
    const afford = credits >= cost;
    const cls = [
      "tech-cell",
      has ? "owned" : "",
      !has && !afford && unlocked ? "unaffordable" : "",
      !has && !unlocked ? "locked" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const status = has
      ? '<span class="tech-status">Researched</span>'
      : !unlocked
        ? '<span class="tech-status">Locked</span>'
        : `<span class="cost">${cost}</span>`;
    return `<button type="button" class="${cls}" data-tech="${id}" ${
      has || !unlocked || !afford ? "disabled" : ""
    }>
      <span class="tech-tier">T${TECH_TIER[id]}</span>
      <strong>${escapeHtml(id.replaceAll("_", " "))}</strong>
      <span class="tech-blurb">${TECH_BLURB[id]}</span>
      ${status}
    </button>`;
  }).join("");

  grid.querySelectorAll<HTMLElement>("[data-tech]").forEach((btn) => {
    btn.addEventListener("click", () =>
      net.intent({ type: "ResearchTech", techId: btn.dataset.tech as TechId }),
    );
  });
  if (justUnlocked) {
    grid.querySelectorAll(".tech-cell.owned").forEach((cell) => {
      cell.classList.add("pulse");
      setTimeout(() => cell.classList.remove("pulse"), 700);
    });
  }
}

function roleIconSvg(role: string, dim = false): string {
  const d = ROLE_ICON_PATH[role] ?? ROLE_ICON_PATH.relay!;
  return `<svg viewBox="0 0 16 16" aria-hidden="true" class="role-icon${dim ? " dim" : ""}"><path d="${d}"/></svg>`;
}

function statRow(label: string, value: string): string {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function updateStrip(): void {
  const strip = $("strip");
  const tip = $("hud-tip");
  renderState.selectedNode = selectedNode;
  renderState.pathPreview = pathPreview;

  if (!selectedNode || !view || !match) {
    strip.classList.add("hidden");
    tip.classList.remove("hidden");
    tip.textContent = isSpectator
      ? "Watching hard bots — click systems to inspect."
      : "Select your ships, then click a system to move. Claiming takes colonists with you — press ? for help.";
    lastStripKey = "";
    lastActionKey = "";
    return;
  }

  const vn = view.nodes[selectedNode];
  const gn = match.map.nodes[selectedNode];
  if (!gn) {
    strip.classList.add("hidden");
    lastStripKey = "";
    lastActionKey = "";
    return;
  }

  strip.classList.remove("hidden");
  tip.classList.add("hidden");

  const unknown = vn === undefined;
  const fogged = !unknown && isFoggedNode(vn);
  const role = (unknown ? "unknown" : fogged ? vn.role : gn.role) as NodeRole;
  const level = vn?.level ?? 0;
  const owner = vn?.ownerId ?? null;
  const credits = view.self.credits;
  const researched = new Set(view.self.researched);
  const mine = owner === view.self.id;
  const ownerName = unknown
    ? "Unsurveyed"
    : mine
      ? "You"
      : owner
        ? (match.players[owner]?.displayName ?? owner)
        : "Neutral";

  const fleet = selectedFleetId ? view.fleets[selectedFleetId] : null;
  const fleetsHere = ownFleetsAt(selectedNode);
  const invPop = fleet?.invasionPopulation ?? 0;
  const nodePop = unknown || fogged ? null : vn.population;
  const garrisonShown = unknown
    ? null
    : garrisonForRole(role, level, mine ? researched : null);
  const powerHere = fleet ? fleetPower(fleet.composition, BAL) : 0;
  const queue = !unknown && !fogged ? vn.buildQueue : [];

  // Do not rebuild action buttons when only build-progress ticks change —
  // wiping the DOM every 100ms ate clicks between Build / Upgrade / Load.
  const actionKey = [
    selectedNode,
    selectedFleetId,
    fleetsHere.length,
    credits,
    level,
    owner,
    nodePop,
    invPop,
    powerHere,
    unknown,
    fogged,
    queue.map((b) => `${b.shipType}:${b.count}`).join(","),
    splitInput.value,
    garrisonShown,
    view.self.researched.slice().sort().join(","),
    pathPreview.length,
    fleet?.location.kind ?? "",
  ].join("|");

  const displayKey = `${actionKey}|${queue.map((b) => b.progressTicks).join(",")}`;
  if (displayKey === lastStripKey && actionKey === lastActionKey) return;
  lastStripKey = displayKey;

  $("strip-swatch").innerHTML = unknown
    ? '<span class="swatch-unknown">?</span>'
    : `<span class="swatch-disc" style="background:${ROLE_FILL_CSS[role] ?? "#6b7585"}">${roleIconSvg(role)}</span>`;
  $("strip-role").textContent = unknown
    ? "Unsurveyed system"
    : role.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
  const levelEl = $("strip-level");
  levelEl.textContent = unknown ? "" : `L${level}`;
  levelEl.classList.toggle("hidden", unknown);
  $("strip-owner").innerHTML = `${escapeHtml(ownerName)}${
    fogged ? '<span class="tag tag-dim">last known</span>' : ""
  }`;

  const stats: string[] = [];
  const prod =
    !unknown && !fogged
      ? nodeProduction(
          role,
          level,
          nodePop ?? 0,
          mine ? researched : null,
          BAL,
        )
      : null;

  if (nodePop !== null) {
    const cap =
      prod && prod.populationCap > 0 ? ` / ${prod.populationCap}` : "";
    const rate =
      mine && prod
        ? prod.population > 0
          ? ` · +${prod.population}/s`
          : prod.populationCap > 0
            ? " · capped"
            : ""
        : "";
    stats.push(statRow("Pop", `${nodePop}${cap}${rate}`));
  }
  if (garrisonShown !== null) {
    stats.push(
      owner
        ? statRow("Garrison", String(garrisonShown))
        : statRow("To claim", `${garrisonShown + 1}+`),
    );
  }
  if (mine && prod) {
    if (prod.bankCredits > 0) {
      stats.push(statRow("Income", `+${prod.bankCredits}¢/s`));
    } else if (prod.cargoCredits > 0) {
      stats.push(statRow("Cargo out", `+${prod.cargoCredits}/s`));
    }
  }
  if (fleet) {
    stats.push(
      statRow(
        `Fleet${fleetsHere.length > 1 ? ` ${fleetsHere.findIndex((f) => f.id === selectedFleetId) + 1}/${fleetsHere.length}` : ""}`,
        `${formatComposition(fleet.composition) || "—"} · P${powerHere}`,
      ),
    );
  }
  if (invPop > 0) stats.push(statRow("Colonists", String(invPop)));
  if (!unknown && !fogged && vn.cargoStockpile > 0) {
    stats.push(statRow("Cargo", String(vn.cargoStockpile)));
  }
  if (queue.length > 0) {
    const slots =
      mine && (role === "shipyard" || role === "homeworld")
        ? buildSlots(role, level, BAL)
        : 0;
    const active = Math.min(slots, queue.length);
    stats.push(
      statRow(
        slots > 0 ? `Building ${active}/${slots}` : "Building",
        queue
          .map(
            (b) =>
              `${b.count}x ${b.shipType} ${Math.round((b.progressTicks / Math.max(1, b.ticksRequired)) * 100)}%`,
          )
          .join(", "),
      ),
    );
  }
  if (selectedFleetIds.size > 1) {
    stats.push(statRow("Selected", `${selectedFleetIds.size} fleets`));
  }
  $("strip-stats").innerHTML = stats.join("");

  const hint = $("strip-hint");
  $("split-row").classList.toggle("hidden", !fleet);

  if (unknown) {
    hint.textContent =
      "Nothing known here yet. Move a fleet within vision range to survey it.";
  } else if (fogged) {
    hint.textContent =
      "Out of vision — showing last known state. Move closer for live intel.";
  } else if (!mine) {
    hint.textContent =
      invPop > (garrisonShown ?? 0)
        ? `Ready to claim: your fleet's colonists beat garrison ${garrisonShown}.`
        : `Click here with a fleet selected on your land — colonists come along automatically. Alt-click to raid with ships only.`;
  } else if (!selectedFleetId) {
    hint.textContent =
      "No fleet stationed here. Build ships, or select a system where yours are parked.";
  } else if (invPop > 0) {
    hint.textContent = `${invPop} colonists aboard. Click an enemy or neutral system to claim it on arrival.`;
  } else if (pathPreview.length > 1) {
    hint.textContent = `Route staged over ${pathPreview.length - 1} hops. Click a destination to dispatch, or press Escape to clear.`;
  } else {
    hint.textContent = `${upgradeBoostLabel(role)}. Click enemy/neutral land to move and claim — colonists embark automatically. Alt-click = ships only.`;
  }

  if (unknown || fogged) {
    if (actionKey !== lastActionKey) {
      lastActionKey = actionKey;
      $("strip-actions").innerHTML = "";
    }
    return;
  }

  if (actionKey === lastActionKey) return;
  lastActionKey = actionKey;

  const actions = $("strip-actions");
  actions.innerHTML = "";

  if (isSpectator) return;

  if (mine && selectedFleetIds.size > 0) {
    addAction(
      actions,
      "Select all here",
      "Select every fleet at this system",
      () => selectAllFleetsHere(),
      { key: "select-all" },
    );
  }

  if (mine && (role === "shipyard" || role === "homeworld")) {
    addCostAction(actions, "Build fighter", BAL.ships.fighter.creditCost, credits, {
      key: "build-fighter",
      title: "Queue one fighter",
      onClick: () => issueBuild("fighter"),
    });
  }
  if (mine && role === "shipyard") {
    addCostAction(actions, "Build cruiser", BAL.ships.cruiser.creditCost, credits, {
      key: "build-cruiser",
      title: "Shipyards only — heavier warship",
      onClick: () => issueBuild("cruiser"),
    });
    if (researched.has("heavy_warships")) {
      addCostAction(
        actions,
        "Build battleship",
        BAL.ships.battleship.creditCost,
        credits,
        {
          key: "build-battleship",
          title: "Unlocked by heavy warships",
          onClick: () => issueBuild("battleship"),
        },
      );
    }
  }
  if (mine) {
    const boost = upgradeBoostLabel(role);
    addCostAction(
      actions,
      "Upgrade",
      upgradeCost(role, level, BAL),
      credits,
      {
        key: "upgrade",
        title: `Level ${level} → ${level + 1}. ${boost}.`,
        onClick: () => issueUpgrade(),
      },
    );
  }
  if (selectedFleetId && mine && invPop === 0) {
    const loadPop = nodePop ?? 0;
    addAction(
      actions,
      loadPop > 0 ? `Pre-load ${loadPop}` : "Pre-load",
      "Optional — population already embarks when you claim-move.",
      () => issueLoad(loadPop),
      { key: "load", disabled: loadPop < 1 },
    );
  }
  if (selectedFleetId && invPop > 0) {
    addAction(
      actions,
      "Unload colonists",
      "Return population to the nearest owned system",
      () => {
        net.intent({ type: "CancelInvasion", fleetId: selectedFleetId! });
        lastActionKey = "";
      },
      { key: "unload" },
    );
  }
  if (selectedFleetId && fleet?.location.kind === "transit") {
    addAction(
      actions,
      "Cancel move",
      "Abort transit; the fleet falls back to the nearer endpoint",
      () => net.intent({ type: "CancelMove", fleetId: selectedFleetId! }),
      { key: "cancel-move" },
    );
  }
  if (fleetsHere.length > 1) {
    addAction(
      actions,
      `Next fleet (${fleetsHere.length})`,
      "Cycle between fleets stationed here",
      cycleFleet,
      { key: "cycle" },
    );
  }
  if (owner && !mine && !view.self.allies.includes(owner)) {
    addAction(
      actions,
      "Propose alliance",
      "Offer a truce to this player",
      () => net.intent({ type: "ProposeAlliance", toPlayerId: owner }),
      { key: "ally" },
    );
  }
}

/** Optimistic credit spend so successive strip clicks stay responsive. */
function spendCreditsLocal(cost: number): boolean {
  if (!view || view.self.credits < cost) return false;
  view.self.credits -= cost;
  $("credits").textContent = String(view.self.credits);
  lastActionKey = "";
  lastStripKey = "";
  return true;
}

function issueBuild(shipType: ShipType): void {
  if (!selectedNode || !view) return;
  const cost = BAL.ships[shipType].creditCost;
  if (!spendCreditsLocal(cost)) {
    flashIllegal();
    return;
  }
  net.intent({
    type: "BuildShips",
    nodeId: selectedNode,
    shipType,
    count: 1,
  });
  updateStrip();
}

function issueUpgrade(): void {
  if (!selectedNode || !view || !match) return;
  const gn = match.map.nodes[selectedNode];
  const vn = view.nodes[selectedNode];
  if (!gn || !vn || isFoggedNode(vn)) return;
  const cost = upgradeCost(gn.role as NodeRole, vn.level, BAL);
  if (!spendCreditsLocal(cost)) {
    flashIllegal();
    return;
  }
  vn.level += 1;
  net.intent({ type: "UpgradeNode", nodeId: selectedNode });
  updateStrip();
}

function issueLoad(population: number): void {
  if (!selectedFleetId || !selectedNode || !view || population < 1) return;
  const vn = view.nodes[selectedNode];
  const fleet = view.fleets[selectedFleetId];
  if (!vn || isFoggedNode(vn) || !fleet) return;
  const take = Math.min(population, vn.population);
  if (take < 1) return;
  vn.population -= take;
  fleet.invasionPopulation = (fleet.invasionPopulation ?? 0) + take;
  lastActionKey = "";
  lastStripKey = "";
  net.intent({
    type: "CommitInvasion",
    fleetId: selectedFleetId,
    fromNodeId: selectedNode,
    population: take,
  });
  updateStrip();
}

/** Garrison for a role at a level; only apply our techs to systems we own. */
function garrisonForRole(
  role: NodeRole | string,
  level = 1,
  researched: Set<TechId> | null,
): number {
  return effectiveGarrison(
    {
      id: "_",
      ownerId: null,
      level: Math.max(1, level),
      population: 0,
      cargoStockpile: 0,
      buildQueue: [],
      ownedSinceTick: 0,
    },
    role as NodeRole,
    researched,
    BAL,
  );
}

function formatComposition(c: Record<string, number | undefined>): string {
  const parts: string[] = [];
  for (const t of ["fighter", "cruiser", "battleship"] as const) {
    const n = c[t] ?? 0;
    if (n > 0) parts.push(`${n}${t[0]!.toUpperCase()}`);
  }
  return parts.join(" ");
}

function pushCombatLog(c: {
  winnerId: string | null;
  loserId: string | null;
  winnerPowerBefore: number;
  loserPowerBefore: number;
  winnerPowerRemaining: number;
  winnerCompositionBefore?: Record<string, number | undefined>;
  winnerCompositionAfter?: Record<string, number | undefined>;
  loserCompositionBefore?: Record<string, number | undefined>;
}): void {
  const wBefore = Math.round(c.winnerPowerBefore);
  const lBefore = Math.round(c.loserPowerBefore);
  const rem = Math.round(c.winnerPowerRemaining);
  let losses = "";
  if (c.winnerCompositionBefore && c.winnerCompositionAfter) {
    const lost: Record<string, number> = {};
    for (const t of ["fighter", "cruiser", "battleship"] as const) {
      const n =
        (c.winnerCompositionBefore[t] ?? 0) -
        (c.winnerCompositionAfter[t] ?? 0);
      if (n > 0) lost[t] = n;
    }
    const lostStr = formatComposition(lost);
    if (lostStr) losses = ` (lost ${lostStr})`;
  } else if (c.loserCompositionBefore) {
    const wiped = formatComposition(c.loserCompositionBefore);
    if (wiped) losses = ` (wiped ${wiped})`;
  }
  const text = c.winnerId
    ? `${wBefore} vs ${lBefore} → ${rem} remaining${losses}`
    : `${wBefore} vs ${lBefore} → mutual wipe`;
  combatLogEntries.unshift({ text, expires: performance.now() + 4000 });
  combatLogEntries = combatLogEntries.slice(0, 8);
  refreshCombatLog();
}

function refreshCombatLog(): void {
  const el = $("combat-log");
  const now = performance.now();
  combatLogEntries = combatLogEntries.filter((e) => e.expires > now);
  el.innerHTML = combatLogEntries
    .map((e) => `<div class="combat-log-line">${escapeHtml(e.text)}</div>`)
    .join("");
}

function updatePowerPreview(): void {
  renderState.powerPreview = null;
  if (!view || !match || isSpectator || selectedFleetIds.size === 0) return;
  const hover = renderer.hovered;
  if (!hover || hover === selectedNode) return;
  const node = view.nodes[hover];
  if (!node || isFoggedNode(node)) return;

  let myPower = 0;
  let myComp: Record<string, number> = {};
  for (const id of selectedFleetIds) {
    const f = view.fleets[id];
    if (!f) continue;
    myPower += fleetPower(f.composition, BAL);
    for (const [k, n] of Object.entries(f.composition)) {
      myComp[k] = (myComp[k] ?? 0) + (n ?? 0);
    }
  }
  if (myPower <= 0) return;

  let theirPower = 0;
  let theirComp: Record<string, number> = {};
  for (const f of Object.values(view.fleets)) {
    if (f.location.kind !== "node" || f.location.nodeId !== hover) continue;
    if (f.ownerId === view.self.id || view.self.allies.includes(f.ownerId))
      continue;
    theirPower += fleetPower(f.composition, BAL);
    for (const [k, n] of Object.entries(f.composition)) {
      theirComp[k] = (theirComp[k] ?? 0) + (n ?? 0);
    }
  }
  if (theirPower <= 0) return;

  const myEff = effectiveCombatPower(myComp, theirComp, BAL);
  const theirEff = effectiveCombatPower(theirComp, myComp, BAL);
  const outlook =
    myEff > theirEff ? "likely win" : myEff < theirEff ? "likely lose" : "coin flip";
  const layout = match.map.layout?.[hover];
  if (!layout) return;
  renderState.powerPreview = {
    x: layout.x,
    y: layout.y,
    text: `P${Math.round(myEff)} vs P${Math.round(theirEff)} · ${outlook}`,
  };
}

function addCostAction(
  parent: HTMLElement,
  label: string,
  cost: number,
  credits: number,
  opts: { key: string; title: string; onClick: () => void; disabled?: boolean },
): void {
  addAction(parent, label, opts.title, opts.onClick, {
    key: opts.key,
    cost,
    disabled: opts.disabled || credits < cost,
  });
}

function addAction(
  parent: HTMLElement,
  label: string,
  title: string,
  fn: () => void,
  opts: { key: string; cost?: number; disabled?: boolean },
): void {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-action";
  b.dataset.action = opts.key;
  if (opts.cost !== undefined) {
    b.innerHTML = `${escapeHtml(label)} <span class="cost">${opts.cost}</span>`;
    if (opts.disabled) b.classList.add("unaffordable");
    b.title = `${title} · ${opts.cost} credits`;
  } else {
    b.textContent = label;
    b.title = title;
  }
  b.disabled = Boolean(opts.disabled);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
  parent.appendChild(b);
}

function showOver(finalRanks: ScoreRank[], winnerId: string | null): void {
  ranks = finalRanks;
  $("over").classList.remove("hidden");
  const winner = finalRanks.find((r) => r.playerId === winnerId);
  const me = finalRanks.find((r) => r.playerId === view?.self.id);
  $("over-title").textContent = winner
    ? winner.playerId === view?.self.id
      ? "You win"
      : `${winner.displayName} wins`
    : "Match over";
  $("over-ranks").innerHTML = finalRanks
    .map(
      (r) =>
        `<li class="${r.playerId === me?.playerId ? "is-self" : ""}">
          <span>#${r.rank} ${escapeHtml(r.displayName)}</span>
          <span>${r.score}${r.disconnected ? " · offline" : ""}</span>
        </li>`,
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (match && view) {
    renderState.view = view;
    renderState.selectedNode = selectedNode;
    renderState.selectedFleetIds = selectedFleetIds;
    renderState.pathPreview = pathPreview;
    updatePowerPreview();
    if (combatLogEntries.length) refreshCombatLog();
    renderer.draw(renderState, dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
}
