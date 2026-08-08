import type {
  Intent,
  LobbySeat,
  MatchStartMessage,
  NodeId,
  PlayerId,
  PlayerView,
  ScoreRank,
  ServerMessage,
  TechId,
  TickUpdateMessage,
} from "@starfall/sim";
import {
  TECH_IDS,
  TECH_TIER,
  applyPlayerViewDelta,
  isFoggedNode,
} from "@starfall/sim";
import { NetClient, loadStoredClientId, storeClientId } from "./net.js";
import { MapRenderer, type RenderState } from "./renderer.js";

const TECH_BLURB: Record<TechId, string> = {
  advanced_propulsion: "War fleets move faster",
  fortified_colonies: "Stronger garrisons",
  survey_drones: "+1 vision hop",
  heavy_warships: "Unlock Battleships",
  lane_logistics: "Faster cargo",
  population_efficiency: "More core pop",
  orbital_shielding: "Flat garrison boost",
  rapid_deployment: "Faster builds",
  relic_scanning: "See all relics",
};

const app = document.getElementById("app")!;
app.innerHTML = `
  <section class="lobby" id="lobby">
    <h1 class="lobby-brand">Starfall</h1>
    <p class="lobby-tag">Graph conquest. Claim lanes. Raid the sky.</p>
    <form class="lobby-form" id="join-form">
      <input id="name" maxlength="24" placeholder="Display name" autocomplete="nickname" required />
      <div class="lobby-actions">
        <button type="submit" id="join-btn">Join</button>
        <button type="button" id="ready-btn" disabled>Ready</button>
        <button type="button" id="start-btn" disabled>Start</button>
      </div>
    </form>
    <p class="lobby-capacity" id="lobby-capacity"></p>
    <ul class="lobby-seats" id="seats"></ul>
    <p class="lobby-error" id="lobby-error"></p>
  </section>
  <section class="match hidden" id="match">
    <canvas id="map"></canvas>
    <div class="hud-top-left" id="res"><span>CR</span><b id="credits">0</b> &nbsp; <span>POP</span><b id="pop">0</b></div>
    <div class="hud-top-right"><div id="timer">—</div><div id="rank">Rank —</div></div>
    <button class="hud-btn tech-toggle" id="tech-toggle" type="button">Tech</button>
    <div class="hud-diplo" id="diplo">
      <h3>Diplomacy</h3>
      <div id="diplo-body"></div>
    </div>
    <div class="hud-ranks" id="ranks-panel"></div>
    <div class="hud-wordmark">Starfall</div>
    <div class="hud-strip hidden" id="strip">
      <div class="meta" id="strip-meta"></div>
      <div class="actions" id="strip-actions"></div>
      <div class="split-row">
        <label for="split">Split</label>
        <input type="range" id="split" min="0" max="100" value="100" />
        <span id="split-label">100%</span>
      </div>
    </div>
    <aside class="hud-tech hidden" id="tech-panel">
      <h2>Empire tech</h2>
      <div class="tech-grid" id="tech-grid"></div>
    </aside>
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
let match: MatchStartMessage | null = null;
let view: PlayerView | null = null;
let ranks: ScoreRank[] = [];
let selectedNode: NodeId | null = null;
let pathPreview: NodeId[] = [];
let selectedFleetId: string | null = null;
let roundTicks = 3600;

const lobbyEl = document.getElementById("lobby")!;
const matchEl = document.getElementById("match")!;
const seatsEl = document.getElementById("seats")!;
const errEl = document.getElementById("lobby-error")!;
const readyBtn = document.getElementById("ready-btn") as HTMLButtonElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const canvas = document.getElementById("map") as HTMLCanvasElement;
const renderer = new MapRenderer(canvas);

const renderState: RenderState = {
  map: { nodes: {} },
  view: emptyView(),
  seatColors: {},
  selfId: "p0",
  selectedNode: null,
  pathPreview: [],
  ownershipPulse: new Map(),
  combatFlash: 0,
};

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

net.onMessage = handleServer;
net.onClose = () => {
  if (!match) errEl.textContent = "Disconnected from server";
};

document.getElementById("join-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = (document.getElementById("name") as HTMLInputElement).value.trim();
  if (!name) return;
  errEl.textContent = "";
  if (!joined) {
    net.connect();
    net.onOpen = () => {
      net.hello(name, clientId);
      joined = true;
      readyBtn.disabled = false;
      (document.getElementById("join-btn") as HTMLButtonElement).disabled = true;
    };
  } else {
    net.hello(name, clientId);
  }
});

readyBtn.addEventListener("click", () => {
  ready = !ready;
  net.setReady(ready);
  readyBtn.textContent = ready ? "Unready" : "Ready";
});

startBtn.addEventListener("click", () => net.startMatch());

document.getElementById("tech-toggle")!.addEventListener("click", () => {
  document.getElementById("tech-panel")!.classList.toggle("hidden");
});

const splitInput = document.getElementById("split") as HTMLInputElement;
splitInput.addEventListener("input", () => {
  document.getElementById("split-label")!.textContent = `${splitInput.value}%`;
});

renderer.bindPanZoom((nodeId, shift) => {
  if (!match || !view) return;
  if (!nodeId) {
    selectedNode = null;
    pathPreview = [];
    updateStrip();
    return;
  }

  if (shift && pathPreview.length > 0) {
    const last = pathPreview[pathPreview.length - 1]!;
    const neighbors = match.map.nodes[last]?.neighbors ?? [];
    if (neighbors.includes(nodeId)) {
      pathPreview = [...pathPreview, nodeId];
    } else {
      flashIllegal();
    }
    commitPathIfReady();
    updateStrip();
    return;
  }

  if (pathPreview.length === 0) {
    selectedNode = nodeId;
    pathPreview = [nodeId];
    selectedFleetId =
      Object.values(view.fleets).find(
        (f) =>
          f.ownerId === view!.self.id &&
          f.location.kind === "node" &&
          f.location.nodeId === nodeId,
      )?.id ?? null;
  } else {
    const last = pathPreview[pathPreview.length - 1]!;
    const neighbors = match.map.nodes[last]?.neighbors ?? [];
    if (neighbors.includes(nodeId)) {
      pathPreview = [...pathPreview, nodeId];
      commitPathIfReady();
    } else if (nodeId === selectedNode) {
      pathPreview = [nodeId];
    } else {
      selectedNode = nodeId;
      pathPreview = [nodeId];
      selectedFleetId =
        Object.values(view.fleets).find(
          (f) =>
            f.ownerId === view!.self.id &&
            f.location.kind === "node" &&
            f.location.nodeId === nodeId,
        )?.id ?? null;
    }
  }
  updateStrip();
});

function commitPathIfReady(): void {
  if (!view || pathPreview.length < 2 || !selectedFleetId) return;
  sendMove(pathPreview);
  pathPreview = [pathPreview[pathPreview.length - 1]!];
  selectedNode = pathPreview[0]!;
}

function sendMove(path: NodeId[]): void {
  if (!selectedFleetId || path.length < 2 || !view) return;
  const fleet = view.fleets[selectedFleetId];
  if (!fleet) return;
  const pct = Number(splitInput.value) / 100;
  let intent: Intent = { type: "MoveFleet", fleetId: selectedFleetId, path: [...path] };
  if (pct < 0.999) {
    const composition: Record<string, number> = {};
    for (const [k, n] of Object.entries(fleet.composition)) {
      const take = Math.floor((n ?? 0) * pct);
      if (take > 0) composition[k] = take;
    }
    if (Object.keys(composition).length === 0) {
      flashIllegal();
      return;
    }
    intent = {
      type: "MoveFleet",
      fleetId: selectedFleetId,
      path: [...path],
      composition,
    };
  }
  net.intent(intent);
}

function flashIllegal(): void {
  renderState.combatFlash = 0.35;
}

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
      break;
    default:
      break;
  }
}

function renderLobby(seats: LobbySeat[]): void {
  document.getElementById("lobby-capacity")!.textContent =
    `${seats.length} / ${lobbyCapacity} seats`;
  seatsEl.innerHTML = seats
    .map(
      (s) =>
        `<li><span>${escapeHtml(s.displayName)}${s.host ? " · host" : ""}</span><span>${
          s.ready ? "ready" : "…"
        }${s.connected ? "" : " (dc)"}</span></li>`,
    )
    .join("");
  const me = seats.find((s) => s.clientId === clientId);
  isHost = Boolean(me?.host);
  startBtn.disabled = !isHost || seats.length < 2;
}

function beginMatch(msg: MatchStartMessage): void {
  match = msg;
  view = msg.view;
  roundTicks = msg.roundTicks;
  clientId = msg.clientId;
  storeClientId(msg.clientId);
  lobbyEl.classList.add("hidden");
  matchEl.classList.remove("hidden");
  renderState.map = msg.map;
  renderState.seatColors = msg.seatColors;
  renderState.selfId = msg.playerId;
  renderState.view = msg.view;
  if (msg.view.self.homeworldId) {
    renderer.centerOn(msg.map, msg.view.self.homeworldId);
  }
  updateHud();
  updateTech();
  updateStrip();
  updateDiplo();
  updateRanksPanel();
}

function applyTickUpdate(msg: TickUpdateMessage): void {
  if (msg.full) {
    view = msg.full;
  } else if (msg.delta && view) {
    view = applyPlayerViewDelta(view, msg.delta);
  } else if (msg.delta) {
    // Should not happen without prior full; ignore
    return;
  }
  if (!view) return;
  renderState.view = view;
  if (msg.ranks) ranks = msg.ranks;
  if (msg.events.combats.length) renderState.combatFlash = 1;
  for (const a of msg.events.annexations) {
    if (a.success) renderState.ownershipPulse.set(a.nodeId, 1);
  }
  updateHud();
  updateTech();
  updateStrip();
  updateDiplo();
  updateRanksPanel();
}

function updateHud(): void {
  if (!view) return;
  document.getElementById("credits")!.textContent = String(view.self.credits);
  let pop = 0;
  for (const n of Object.values(view.nodes)) {
    if (isFoggedNode(n)) continue;
    if (n.ownerId === view.self.id) pop += n.population;
  }
  document.getElementById("pop")!.textContent = String(pop);
  const remain = Math.max(0, roundTicks - view.tick);
  if (roundTicks <= 0) {
    const elapsedSec = Math.floor(view.tick / 10);
    const m = Math.floor(elapsedSec / 60);
    const s = elapsedSec % 60;
    document.getElementById("timer")!.textContent =
      `${m}:${String(s).padStart(2, "0")} · FFA`;
  } else {
    const sec = Math.ceil(remain / 10);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    document.getElementById("timer")!.textContent =
      `${m}:${String(s).padStart(2, "0")}`;
  }
  const mine = ranks.find((r) => r.playerId === view!.self.id);
  document.getElementById("rank")!.textContent = mine
    ? `Rank ${mine.rank} · ${mine.score}`
    : `Score ${view.self.score}`;
}

function updateDiplo(): void {
  if (!view || !match) return;
  const body = document.getElementById("diplo-body")!;
  const parts: string[] = [];

  const allies = view.self.allies;
  if (allies.length) {
    parts.push("<strong>Allies</strong><ul>");
    for (const id of allies) {
      const name = match.players[id]?.displayName ?? id;
      parts.push(
        `<li><span>${escapeHtml(name)}</span><button type="button" class="hud-btn" data-break="${id}">Break</button></li>`,
      );
    }
    parts.push("</ul>");
  }

  const props = view.self.allianceProposals;
  if (props.length) {
    parts.push("<strong>Incoming</strong><ul>");
    for (const id of props) {
      const name = match.players[id]?.displayName ?? id;
      parts.push(
        `<li><span>${escapeHtml(name)}</span><button type="button" class="hud-btn" data-accept="${id}">Accept</button></li>`,
      );
    }
    parts.push("</ul>");
  }

  if (!parts.length) {
    parts.push("<span>No alliances. Propose from ranks.</span>");
  }
  body.innerHTML = parts.join("");
  body.querySelectorAll("[data-break]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const withPlayerId = (btn as HTMLElement).dataset.break!;
      net.intent({ type: "BreakAlliance", withPlayerId });
    });
  });
  body.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fromPlayerId = (btn as HTMLElement).dataset.accept!;
      net.intent({ type: "AcceptAlliance", fromPlayerId });
    });
  });
}

function updateRanksPanel(): void {
  if (!match) return;
  const el = document.getElementById("ranks-panel")!;
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
  el.innerHTML = rows
    .slice(0, 20)
    .map((r) => {
      const self = r.playerId === view?.self.id;
      const ally = view?.self.allies.includes(r.playerId);
      return `<button type="button" data-propose="${r.playerId}" ${
        self ? "disabled" : ""
      }>#${r.rank} ${escapeHtml(r.displayName)} · ${r.score}${
        ally ? " ★" : ""
      }</button>`;
    })
    .join("");
  el.querySelectorAll("[data-propose]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const toPlayerId = (btn as HTMLElement).dataset.propose as PlayerId;
      if (!view || toPlayerId === view.self.id) return;
      if (view.self.allies.includes(toPlayerId)) {
        net.intent({ type: "BreakAlliance", withPlayerId: toPlayerId });
      } else {
        net.intent({ type: "ProposeAlliance", toPlayerId });
      }
    });
  });
}

function updateTech(): void {
  if (!view) return;
  const grid = document.getElementById("tech-grid")!;
  const owned = new Set(view.self.researched);
  grid.innerHTML = TECH_IDS.map((id) => {
    const has = owned.has(id);
    return `<button type="button" class="tech-cell${has ? " owned" : ""}" data-tech="${id}" ${
      has ? "disabled" : ""
    }><strong>T${TECH_TIER[id]} ${id.replaceAll("_", " ")}</strong><br/>${TECH_BLURB[id]}</button>`;
  }).join("");
  grid.querySelectorAll("[data-tech]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const techId = (btn as HTMLElement).dataset.tech as TechId;
      net.intent({ type: "ResearchTech", techId });
    });
  });
}

function updateStrip(): void {
  const strip = document.getElementById("strip")!;
  renderState.selectedNode = selectedNode;
  renderState.pathPreview = pathPreview;
  if (!selectedNode || !view || !match) {
    strip.classList.add("hidden");
    return;
  }
  strip.classList.remove("hidden");
  const vn = view.nodes[selectedNode];
  const gn = match.map.nodes[selectedNode];
  if (!vn || !gn) {
    strip.classList.add("hidden");
    return;
  }
  const fogged = isFoggedNode(vn);
  const role = fogged ? vn.role : gn.role;
  const level = fogged ? vn.level : vn.level;
  const owner = fogged ? vn.ownerId : vn.ownerId;
  const ownerName =
    owner === view.self.id
      ? "You"
      : owner
        ? (match.players[owner]?.displayName ?? owner)
        : "Unowned";
  document.getElementById("strip-meta")!.innerHTML =
    `<strong>${role.replaceAll("_", " ")}</strong> · L${level} · ${escapeHtml(ownerName)}` +
    (fogged ? " · last known" : "") +
    (selectedFleetId ? ` · fleet ${selectedFleetId}` : "");

  const actions = document.getElementById("strip-actions")!;
  actions.innerHTML = "";
  if (fogged) return;

  const mine = owner === view.self.id;
  if (mine && (role === "shipyard" || role === "homeworld")) {
    addAction(actions, "Build F", () =>
      net.intent({
        type: "BuildShips",
        nodeId: selectedNode!,
        shipType: "fighter",
        count: 1,
      }),
    );
  }
  if (mine && role === "shipyard") {
    addAction(actions, "Build C", () =>
      net.intent({
        type: "BuildShips",
        nodeId: selectedNode!,
        shipType: "cruiser",
        count: 1,
      }),
    );
    if (view.self.researched.includes("heavy_warships")) {
      addAction(actions, "Build B", () =>
        net.intent({
          type: "BuildShips",
          nodeId: selectedNode!,
          shipType: "battleship",
          count: 1,
        }),
      );
    }
  }
  if (mine) {
    addAction(actions, "Upgrade", () =>
      net.intent({ type: "UpgradeNode", nodeId: selectedNode! }),
    );
  }
  if (
    owner &&
    owner !== view.self.id &&
    !view.self.allies.includes(owner)
  ) {
    addAction(actions, "Ally", () =>
      net.intent({ type: "ProposeAlliance", toPlayerId: owner }),
    );
  }
  if (selectedFleetId && mine) {
    addAction(actions, "Invade", () => {
      const pop = Math.min(
        5,
        Math.floor(
          Object.values(view!.nodes).reduce((n, node) => {
            if (isFoggedNode(node)) return n;
            if (node.id === selectedNode && node.ownerId === view!.self.id)
              return node.population;
            return n;
          }, 0),
        ),
      );
      if (pop < 1) {
        flashIllegal();
        return;
      }
      net.intent({
        type: "CommitInvasion",
        fleetId: selectedFleetId!,
        fromNodeId: selectedNode!,
        population: Math.max(1, pop),
      });
    });
  }
  if (selectedFleetId) {
    addAction(actions, "Cancel move", () =>
      net.intent({ type: "CancelMove", fleetId: selectedFleetId! }),
    );
  }
}

function addAction(parent: HTMLElement, label: string, fn: () => void): void {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "hud-btn";
  b.textContent = label;
  b.addEventListener("click", fn);
  parent.appendChild(b);
}

function showOver(finalRanks: ScoreRank[], winnerId: string | null): void {
  ranks = finalRanks;
  const over = document.getElementById("over")!;
  over.classList.remove("hidden");
  const title = document.getElementById("over-title")!;
  const winner = finalRanks.find((r) => r.playerId === winnerId);
  title.textContent = winner ? `${winner.displayName} wins` : "Match over";
  document.getElementById("over-ranks")!.innerHTML = finalRanks
    .map(
      (r) =>
        `<li>#${r.rank} ${escapeHtml(r.displayName)} — ${r.score}${
          r.disconnected ? " (dc)" : ""
        }</li>`,
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
    renderState.pathPreview = pathPreview;
    renderer.draw(renderState, dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
