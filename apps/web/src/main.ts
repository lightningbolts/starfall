import type {
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
  effectiveGarrison,
  fleetPower,
  isFoggedNode,
  techCost,
  upgradeCost,
} from "@starfall/sim";
import { NetClient, loadStoredClientId, storeClientId } from "./net.js";
import { MapRenderer, type RenderState } from "./renderer.js";

const BAL = DEFAULT_BALANCE;

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
    <div class="hud-top-left" id="res"><span>Credits</span><b id="credits">0</b> &nbsp; <span>Pop</span><b id="pop">0</b></div>
    <div class="hud-top-right"><div id="timer">—</div><div id="rank">Rank —</div></div>
    <button class="hud-btn tech-toggle" id="tech-toggle" type="button">Tech</button>
    <button class="hud-btn help-toggle" id="help-toggle" type="button">How to play</button>
    <div class="hud-tip" id="hud-tip"></div>
    <div class="hud-diplo" id="diplo">
      <h3>Diplomacy</h3>
      <div id="diplo-body"></div>
    </div>
    <div class="hud-ranks" id="ranks-panel"></div>
    <div class="hud-wordmark">Starfall</div>
    <div class="hud-strip hidden" id="strip">
      <div class="meta" id="strip-meta"></div>
      <p class="strip-hint" id="strip-hint"></p>
      <div class="actions" id="strip-actions"></div>
      <div class="split-row">
        <label for="split" title="How much of the selected fleet to send">Send</label>
        <input type="range" id="split" min="0" max="100" value="100" />
        <span id="split-label">100%</span>
      </div>
    </div>
    <aside class="hud-help hidden" id="help-panel">
      <h2>How to play</h2>
      <ol>
        <li><strong>You</strong> are the orange-ringed homeworld. Purple nearby is usually a neutral shipyard.</li>
        <li><strong>Move ships:</strong> select your world, then click a linked system. The fleet walks the line.</li>
        <li><strong>Claim land</strong> (ships never capture alone):
          <ol class="help-sub">
            <li>Wait until Pop hits <em>26+</em> (grows on your homeworld).</li>
            <li>Click <em>Load colonists</em> on your world.</li>
            <li>Click the target system — capture on arrival if colonists &gt; garrison.</li>
          </ol>
        </li>
        <li><strong>Build</strong> fighters at home; cruisers only after you own a shipyard.</li>
        <li><strong>Credits</strong> = ships/tech/upgrades. <strong>Pop</strong> = annexations only.</li>
      </ol>
      <p class="help-note">First goal: claim the purple shipyard (garrison 25 → need 26 colonists). Relays (10) and resource nodes (15) are easier snacks. Drag to pan, scroll to zoom.</p>
      <button type="button" class="hud-btn" id="help-close">Got it</button>
    </aside>
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
  const tech = document.getElementById("tech-panel")!;
  tech.classList.toggle("hidden");
  document.getElementById("help-panel")!.classList.add("hidden");
  document.getElementById("ranks-panel")!.classList.toggle(
    "hidden",
    !tech.classList.contains("hidden"),
  );
});

document.getElementById("help-toggle")!.addEventListener("click", () => {
  const help = document.getElementById("help-panel")!;
  help.classList.toggle("hidden");
  document.getElementById("tech-panel")!.classList.add("hidden");
  document.getElementById("ranks-panel")!.classList.remove("hidden");
});
document.getElementById("help-close")!.addEventListener("click", () => {
  document.getElementById("help-panel")!.classList.add("hidden");
  localStorage.setItem("sf-help-seen", "1");
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
  // Canvas was 0×0 while lobby hid the match — resize after unhiding
  renderer.resize();
  renderer.setMap(msg.map);
  renderState.map = msg.map;
  renderState.seatColors = msg.seatColors;
  renderState.selfId = msg.playerId;
  renderState.view = msg.view;
  const homeId = msg.view.self.homeworldId;
  const focusIds =
    msg.view.visibleNodes.length > 0
      ? msg.view.visibleNodes
      : homeId
        ? [homeId]
        : Object.keys(msg.map.nodes);
  renderer.fitNodes(msg.map, focusIds);
  // Auto-select homeworld so the action strip is visible immediately
  if (homeId) {
    selectedNode = homeId;
    pathPreview = [homeId];
    selectedFleetId =
      Object.values(msg.view.fleets).find(
        (f) =>
          f.ownerId === msg.playerId &&
          f.location.kind === "node" &&
          f.location.nodeId === homeId,
      )?.id ?? null;
  }
  lastTechKey = "";
  lastDiploKey = "";
  lastRanksKey = "";
  lastStripKey = "";
  updateHud();
  updateTech();
  updateStrip();
  updateDiplo();
  updateRanksPanel();
  // First match in this browser: open the tutorial
  if (localStorage.getItem("sf-help-seen") !== "1") {
    document.getElementById("help-panel")!.classList.remove("hidden");
  }
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
  if (msg.ranks) ranks = msg.ranks;

  // Only flash for combats the player can see (avoid bot wars lighting the screen)
  const visible = new Set(view.visibleNodes);
  const seenCombat = msg.events.combats.some((c) => {
    if (c.location.kind === "node") return visible.has(c.location.nodeId);
    return visible.has(c.location.from) || visible.has(c.location.to);
  });
  if (seenCombat) renderState.combatFlash = Math.min(1, renderState.combatFlash + 0.45);

  for (const a of msg.events.annexations) {
    if (a.success && visible.has(a.nodeId)) {
      renderState.ownershipPulse.set(a.nodeId, 1);
    }
  }
  updateHud();
  updateTech();
  updateStrip();
  updateDiplo();
  if (msg.ranks) updateRanksPanel();
}

let lastTechKey = "";
let lastDiploKey = "";
let lastRanksKey = "";
let lastStripKey = "";

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
  const key = `${view.self.allies.join(",")}|${view.self.allianceProposals.join(",")}`;
  if (key === lastDiploKey) return;
  lastDiploKey = key;
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
  const key = rows.map((r) => `${r.playerId}:${r.score}:${r.rank}`).join("|");
  if (key === lastRanksKey) return;
  lastRanksKey = key;
  const el = document.getElementById("ranks-panel")!;
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

function techUnlocked(researched: Set<TechId>, techId: TechId): boolean {
  if (researched.has(techId)) return true;
  const tier = TECH_TIER[techId];
  if (tier === 1) return true;
  const need = tier - 1;
  for (const t of researched) {
    if (TECH_TIER[t] === need) return true;
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
  const grid = document.getElementById("tech-grid")!;
  const owned = new Set(researched);
  grid.innerHTML = TECH_IDS.map((id) => {
    const has = owned.has(id);
    const cost = techCost(id, BAL);
    const unlocked = has || techUnlocked(owned, id);
    const afford = credits >= cost;
    const disabled = has || !unlocked || !afford;
    const cls = [
      "tech-cell",
      has ? "owned" : "",
      !has && !afford ? "unaffordable" : "",
      !has && !unlocked ? "locked" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const status = has
      ? "Owned"
      : !unlocked
        ? "Locked"
        : `<span class="cost">${cost}</span>`;
    return `<button type="button" class="${cls}" data-tech="${id}" ${
      disabled ? "disabled" : ""
    }><strong>T${TECH_TIER[id]} ${id.replaceAll("_", " ")}</strong><br/>${TECH_BLURB[id]}<br/>${status}</button>`;
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
  const tip = document.getElementById("hud-tip")!;
  renderState.selectedNode = selectedNode;
  renderState.pathPreview = pathPreview;
  if (!selectedNode || !view || !match) {
    strip.classList.add("hidden");
    tip.classList.remove("hidden");
    tip.textContent =
      "Click your homeworld (orange ring). Open How to play if this is your first match.";
    lastStripKey = "";
    return;
  }
  strip.classList.remove("hidden");
  tip.classList.add("hidden");
  tip.textContent = "";
  const vn = view.nodes[selectedNode];
  const gn = match.map.nodes[selectedNode];
  if (!vn || !gn) {
    strip.classList.add("hidden");
    lastStripKey = "";
    return;
  }
  const fogged = isFoggedNode(vn);
  const role = (fogged ? vn.role : gn.role) as NodeRole;
  const level = fogged ? vn.level : vn.level;
  const owner = fogged ? vn.ownerId : vn.ownerId;
  const credits = view.self.credits;
  const researched = new Set(view.self.researched);
  const ownerName =
    owner === view.self.id
      ? "You"
      : owner
        ? (match.players[owner]?.displayName ?? owner)
        : "Neutral";

  const fleet = selectedFleetId ? view.fleets[selectedFleetId] : null;
  const invPop = fleet?.invasionPopulation ?? 0;
  const roleLabel = role.replaceAll("_", " ");
  const nodePop = fogged ? null : vn.population;
  // Own nodes: include our techs. Neutral/enemy: base role+level only (enemy techs unknown).
  const garrisonShown = garrisonForRole(
    role,
    level,
    owner === view.self.id ? researched : null,
  );
  const shipsHere = fleet
    ? Object.values(fleet.composition).reduce((a, n) => a + (n ?? 0), 0)
    : 0;
  const powerHere = fleet ? fleetPower(fleet.composition, BAL) : 0;
  const queue = !fogged ? vn.buildQueue : [];
  const queueBit =
    queue.length > 0
      ? ` · Building ${queue
          .map(
            (b) =>
              `${b.count}×${b.shipType} (${b.progressTicks}/${b.ticksRequired})`,
          )
          .join(", ")}`
      : "";
  const stockBit =
    !fogged && vn.cargoStockpile > 0 ? ` · Cargo stock ${vn.cargoStockpile}` : "";
  const fleetComp = fleet ? formatComposition(fleet.composition) : "";

  const stripKey = [
    selectedNode,
    selectedFleetId,
    credits,
    level,
    owner,
    nodePop,
    invPop,
    shipsHere,
    powerHere,
    fogged,
    queue.map((b) => `${b.shipType}:${b.progressTicks}`).join(","),
    splitInput.value,
    garrisonShown,
  ].join("|");
  if (stripKey === lastStripKey) return;
  lastStripKey = stripKey;

  const popBit = nodePop !== null ? ` · Pop ${nodePop}` : "";
  const claimBit = !owner
    ? ` · Claim needs &gt;${garrisonShown} colonists`
    : ` · Garrison ${garrisonShown}`;
  const fleetBit = fleet
    ? ` · Fleet ${fleetComp || shipsHere} · P${powerHere}${
        invPop > 0 ? ` · <em>${invPop} colonists aboard</em>` : ""
      }`
    : " · No fleet here";

  document.getElementById("strip-meta")!.innerHTML =
    `<strong>${escapeHtml(roleLabel)}</strong> · L${level} · ${escapeHtml(ownerName)}` +
    popBit +
    claimBit +
    stockBit +
    queueBit +
    (fogged ? " · fogged" : "") +
    fleetBit;

  const hint = document.getElementById("strip-hint")!;
  const actions = document.getElementById("strip-actions")!;
  actions.innerHTML = "";
  if (fogged) {
    hint.textContent = "Out of vision — last known only. Move closer to see live state.";
    return;
  }

  const mine = owner === view.self.id;

  if (!mine) {
    hint.textContent =
      invPop > garrisonShown
        ? `Ready to claim: move your loaded fleet onto this system (need >${garrisonShown}).`
        : `To claim this ${roleLabel}: on your world → Load colonists (need >${garrisonShown}) → click here to move. Ships alone do not capture.`;
  } else if (!selectedFleetId) {
    hint.textContent =
      "No fleet on this system. Build fighters, or select a system where your ships are parked.";
  } else if (invPop > 0) {
    hint.textContent =
      `${invPop} colonists aboard. Click a linked neighbor (highlighted) to move — capture on arrival if pop beats garrison.`;
  } else if ((nodePop ?? 0) <= 25 && role === "homeworld") {
    hint.textContent =
      `Pop ${nodePop}. Wait until Pop ≥ 26, then Load colonists and click the purple shipyard.`;
  } else {
    hint.textContent =
      "Click a highlighted linked system to move ships. To annex: Load colonists first, then move onto the target.";
  }

  if (mine && (role === "shipyard" || role === "homeworld")) {
    addCostAction(actions, "Build fighter", BAL.ships.fighter.creditCost, credits, {
      title: "Queue 1 fighter (credits deducted now)",
      onClick: () =>
        net.intent({
          type: "BuildShips",
          nodeId: selectedNode!,
          shipType: "fighter",
          count: 1,
        }),
    });
  }
  if (mine && role === "shipyard") {
    addCostAction(actions, "Build cruiser", BAL.ships.cruiser.creditCost, credits, {
      title: "Shipyard only — heavier warship",
      onClick: () =>
        net.intent({
          type: "BuildShips",
          nodeId: selectedNode!,
          shipType: "cruiser",
          count: 1,
        }),
    });
    if (view.self.researched.includes("heavy_warships")) {
      addCostAction(
        actions,
        "Build battleship",
        BAL.ships.battleship.creditCost,
        credits,
        {
          title: "Requires heavy warships tech",
          onClick: () =>
            net.intent({
              type: "BuildShips",
              nodeId: selectedNode!,
              shipType: "battleship",
              count: 1,
            }),
        },
      );
    }
  }
  if (mine) {
    const upCost = upgradeCost(role, level, BAL);
    addCostAction(actions, "Upgrade system", upCost, credits, {
      title: `Raise to level ${level + 1}`,
      onClick: () =>
        net.intent({ type: "UpgradeNode", nodeId: selectedNode! }),
    });
  }
  if (
    owner &&
    owner !== view.self.id &&
    !view.self.allies.includes(owner)
  ) {
    addAction(actions, "Propose alliance", "Ask this player to ally", () =>
      net.intent({ type: "ProposeAlliance", toPlayerId: owner }),
    );
  }
  if (selectedFleetId && mine) {
    const loadPop = nodePop ?? 0;
    const canShipyard = loadPop > 25;
    addAction(
      actions,
      loadPop > 0 ? `Load ${loadPop} colonists` : "Load colonists",
      canShipyard
        ? "Put population on this fleet, then move onto a target to annex it"
        : "Need Pop > 25 to take a neutral shipyard. Wait for growth, or claim a relay/resource first.",
      () => {
        if (loadPop < 1) {
          flashIllegal();
          tip.textContent = "Not enough population here to load.";
          return;
        }
        net.intent({
          type: "CommitInvasion",
          fleetId: selectedFleetId!,
          fromNodeId: selectedNode!,
          population: loadPop,
        });
        tip.textContent = canShipyard
          ? `Loaded ${loadPop} colonists. Now click the target system (e.g. purple shipyard) to move and claim it.`
          : `Loaded ${loadPop} — not enough for a shipyard (need 26+). Claim a relay (10) or resource (15), or wait for more pop.`;
      },
      { disabled: loadPop < 1 },
    );
  }
  if (selectedFleetId && fleet?.location.kind === "transit") {
    addAction(actions, "Cancel move", "Abort transit; fleet goes to nearer endpoint", () =>
      net.intent({ type: "CancelMove", fleetId: selectedFleetId! }),
    );
  }
  if (selectedFleetId && invPop > 0) {
    addAction(actions, "Unload colonists", "Cancel invasion and return pop if possible", () =>
      net.intent({ type: "CancelInvasion", fleetId: selectedFleetId! }),
    );
  }
}

/** L1+level garrison; researched techs only when known (own nodes). */
function garrisonForRole(
  role: NodeRole | string,
  level = 1,
  researched: Set<TechId> | null,
): number {
  return effectiveGarrison(
    {
      id: "_",
      ownerId: null,
      level,
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
  for (const t of ["fighter", "cruiser", "battleship"] as ShipType[]) {
    const n = c[t] ?? 0;
    if (n > 0) parts.push(`${n}${t[0]!.toUpperCase()}`);
  }
  return parts.join(" ");
}

function addCostAction(
  parent: HTMLElement,
  label: string,
  cost: number,
  credits: number,
  opts: { title: string; onClick: () => void; disabled?: boolean },
): void {
  const afford = credits >= cost;
  addAction(parent, label, opts.title, opts.onClick, {
    cost,
    disabled: opts.disabled || !afford,
  });
}

function addAction(
  parent: HTMLElement,
  label: string,
  title: string,
  fn: () => void,
  opts?: { cost?: number; disabled?: boolean },
): void {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "hud-btn";
  if (opts?.cost !== undefined) {
    b.innerHTML = `${escapeHtml(label)} <span class="cost">${opts.cost}</span>`;
    if (opts.disabled) b.classList.add("unaffordable");
  } else {
    b.textContent = label;
  }
  b.title =
    opts?.cost !== undefined
      ? `${title} · Cost ${opts.cost} credits`
      : title;
  b.disabled = Boolean(opts?.disabled);
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
