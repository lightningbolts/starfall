# Starfall — Design Rulings (Recommended Defaults)

**Status:** accepted v1 locks  
**Purpose:** Close open questions that would otherwise force implementers to invent policy  
**Supersedes** vague “TBD / recommended” notes elsewhere when they conflict

---

## 1. Spawn / shipyard fairness

**Lock: fair generator + homeworld Fighter (only) production. No role conversion.**

| Rule | Detail |
|---|---|
| Generator | Every homeworld has ≥1 **shipyard** within **2 hops** (shortest path). Reject/regenerate seeds that fail. |
| Role conversion | **None** in v1 — roles are fixed on the map. |
| Homeworld builds | Homeworld may queue **Fighters only**, at **50% build speed** vs a L1 shipyard (build ticks ×2). No Cruisers/Battleships at homeworld. |
| Shipyards | Still the only place for Cruisers (always) and Battleships (with `heavy_warships`). |

Rationale: preserves shipyards as map objectives; prevents soft-lock if the first yard is contested; avoids a building system in a short FFA.

---

## 2. Vision

**Lock: base vision = 1 hop from every owned node.**

| Rule | Detail |
|---|---|
| Base | See owned nodes + all nodes within **1 hop**; see fleets at those nodes and fleets in transit on lanes touching a visible node. |
| Survey drones | +1 hop (total **2** from owned nodes). |
| Relay upgrade | L3/L5 vision bonus applies **from that relay** only (+1 hop from that node), stacking with empire tech for that origin. |
| Unexplored | Never visible; no live fleets. Explored-but-out-of-vision: last-known silhouette only ([visuals.md](./visuals.md)). |
| Allies | Shared vision = union of both vision sets. |

---

## 3. Invasion logistics

**Lock: population is embarked on a fleet; annexation resolves on arrival at the target node.**

| Rule | Detail |
|---|---|
| Source | `CommitInvasion` deducts pop from `fromNodeId` (must be owned, have enough pop). |
| Carrier | Pop attaches to `fleetId` as `invasionPopulation` (must be owned fleet). |
| Escort | Fleet may be empty of ships **only if** moving onto an **unowned** node with no hostile fleet (see neutrals). Hostile/owned enemy nodes require **≥1 ship** on the escort fleet when the annexation check runs. |
| Path | Fleet moves normally; pop rides along. |
| Resolve | After movement + combat at the destination node: if no defending enemy fleet remains and `invasionPopulation > garrison`, capture succeeds; committed pop is **consumed**. |
| Fail | If check runs and pop ≤ garrison (or escort invalid), committed pop on that fleet at that node is **consumed** (no refund). |
| Cancel | `CancelInvasion` before arrival returns pop to the **nearest owned node** along the reverse path, or origin if still at origin; if no owned node reachable, pop is lost. |

---

## 4. Neutral / unowned nodes

**Lock: neutrals are claimable; light garrison; no free auto-claim by parking ships.**

| Rule | Detail |
|---|---|
| Ownership | `ownerId = null` until annexed. |
| Garrison | Role base garrison at **level 1** (same table as owned), **no** owner tech bonuses. |
| Claim | Same annexation rule: committed pop > garrison. Ships alone never flip ownership. |
| Empty claim | Unowned + no hostile fleet: allow annexation with pop-only fleet (0 ships), still need pop > garrison. |
| Upgrades | Neutrals start at level 1. |

---

## 5. Where ships build

| Location | Allowed |
|---|---|
| Shipyard (owned) | Fighter, Cruiser; Battleship if `heavy_warships` |
| Homeworld (owned) | **Fighter only**, half speed (§1) |
| Any other role | **None** |

---

## 6. Lanes (no capacity limits)

**Lock: unlimited fleets per lane. No congestion cap. No move rejection for “full” lanes.**

| Rule | Detail |
|---|---|
| Capacity | **None.** Any number of fleets may share a lane. |
| Combat | Hostile fleets on the same lane segment in a tick still fight (instant Lanchester). |
| Presentation | Render **every** fleet / cargo marker on the lane (stack or fan sprites — do not hide behind a cap). See [visuals.md](./visuals.md). |
| `lane_logistics` tech | Does **not** affect capacity — improves **cargo** throughput instead ([tech-tree.md](./tech-tree.md)). |

Chokepoints still matter via geography and combat concentration, not traffic lights.

### Multi-side combat at a node or lane

When more than two owners have combat fleets at the same location after movement:

1. **Merge** same-owner fleets (and sum power) first.  
2. **Sort** remaining sides by total power **descending**, then by `PlayerId` ascending for ties.  
3. Resolve as a chain of **instant pairwise** Lanchester fights: strongest vs second, survivors vs next, until one side remains or mutual annihilation clears the location.  
4. Cargo loot uses the post-combat rule in §6b (hostile power left, no friendly power → loot).

Alliance members do not fight each other while allied; their fleets merge for combat strength against hostiles only if design later adds allied joint combat — **v1: allies never auto-merge; they simply do not attack each other**, and each allied side is a separate non-hostile stack. Hostiles fight each allied stack under the pairwise chain (skip fights between allies).

---

## 6b. Cargo economy (credits in transit)

**Lock: resource (and relic) income ships as cargo to the homeworld; credits bank on delivery or loot.**

| Rule | Detail |
|---|---|
| Production | Owned **resource** and **relic** nodes add to a per-node **cargo stockpile** each economy pulse (they do **not** deposit straight to the bank). |
| Launch | When stockpile ≥ **4** credits (seed), spawn an automatic **cargo ship** bound for the owner’s **cargo sink** (see below). Remainder stays stockpiled. |
| Cargo sink | Prefer the player’s **homeworld** if still owned. If the homeworld is lost: the **oldest still-owned node** (earliest capture/own tick; ties → lowest `NodeId`). If the player owns **no** nodes, existing cargo ships become **lootable derelicts** (any combat fleet that shares their location banks 100%; no new launches). |
| Cargo ship | Special transit entity: carries `cargoCredits`, **0 combat power**, auto-moves each tick toward the sink. Not player-built; no upkeep. |
| Delivery | On arriving at the cargo sink, `cargoCredits` are added to the player’s credit bank; cargo ship despawns. |
| Speed techs | `lane_logistics` → −25% cargo ticks-per-hop. **`advanced_propulsion` does not affect cargo** — war fleets only. |
| Interdiction | After combat at the cargo’s node or lane: cargo is looted (attacker banks **100%**) if **any** hostile combat power remains and **no** friendly combat power remains. If friendlies remain, cargo continues. Mutual annihilation of all combat fleets → cargo is **lost** (nobody banks). |
| Escort | Players may move war fleets along the same path to clear hostiles; cargo does not merge into war fleets (stays a separate marker) but benefits from friendly presence after combat. |
| Direct trickle | Homeworld / core / shipyard small credit pulses still go **directly to bank** (early-game oxygen). Primary wealth is cargo from resource/relic nodes. |

Rationale: lanes become meaningful trade arteries; raiding enemy cargo is a real income strategy; fits “show all the sprites” on busy lanes.

---

## 7. Mixed fleets and splits

**Lock: default move = entire fleet at slowest ship; split is explicit.**

| Rule | Detail |
|---|---|
| Default `MoveFleet` | Moves whole composition; `ticks_per_hop` = max of member types after **war-fleet** techs (`advanced_propulsion`). Cargo ignores that tech. |
| Split | Optional `composition` on intent; remainder stays. New `FleetId` for the moving split. |
| Merge | Same owner, same node, after movement phase → auto-merge into one fleet before combat. |

---

## 8. Cancel in transit

**Lock: divert to the nearer endpoint (destination if ≥50% of hop elapsed, else origin).**

| Rule | Detail |
|---|---|
| `CancelMove` | Active transit execution ends. Fleet is placed on the endpoint that is “closer” in remaining ticks: if `ticksRemaining ≤ half of that hop’s total ticks`, finish to **destination**; else return to **from**. Arrive next tick with no mid-lane linger. |
| Invasion pop | Stays on fleet; use `CancelInvasion` to unload (§3). |

Rationale: simple, no mid-edge parking state, slight commitment once past halfway.

---

## 9. Galaxy generator acceptance (testable)

Seed is **invalid** unless all pass:

| Check | Criterion |
|---|---|
| Connected | Single connected component |
| Home spacing | No two homeworlds adjacent; pairwise shortest-path distance ≥ **3** |
| Shipyard access | Each homeworld ≤ **2** hops from ≥1 shipyard |
| Role mix (≈250 nodes, 100 players) | ~100 homeworlds (or = player count); shipyards ≥ players; resources ≥ players; cores ≥ ⌊players/2⌋; relays ≥ ⌊players/3⌋; relics **5±2** |
| Relics | No relic adjacent to any homeworld |
| Degree | Mean degree in **2.2–3.2**; ≥1 node with degree ≥5; ≥10% nodes degree ≤2 |

Layout: seeded force-directed or similar offline; positions are cosmetic only.

---

## 10. Tooling (Phase 1 scaffold)

| Choice | Default |
|---|---|
| Package manager | **pnpm** workspaces |
| Language | TypeScript **strict** |
| Node | **20 LTS** |
| Tests | **Vitest** |
| Packages | `packages/sim` first; `packages/server` / `apps/web` later |
| License | **MIT** (unless you prefer otherwise) |
| Git | Init on first code scaffold; `.gitignore` for Node |

---

## 11. Phase 2 defaults (defer code, lock intent)

| Topic | Default |
|---|---|
| Identity | Anonymous seats + display name; no accounts in skeleton |
| Disconnect | Orders hold; after **60s** seat marked disconnected; fleets keep last orders; no AI takeover in v1 |
| Scoreboard | Public ranks update every **10 ticks** (1s); full breakdown at match end |
| Spectators | None in v1 |
| Input | Click node to select; shift-click or “split” control for partial fleet; path = click chain of adjacent nodes |
| Audio | **None** in v1 |
| Client lockstep | Authoritative server sim only (ADR 002) |

---

## 12. Still explicitly playtest-only (do not bikeshed now)

- Exact credit/power/build numbers, tech %, garrison integers  
- Relic credit vs score weighting  
- Cargo launch threshold, loot %, cargo speed  
- Transit combat: survivors auto-continue (already v1 lean) vs pause  

---

## Review checklist

- [x] §1 Spawn / homeworld Fighters  
- [x] §2 Vision  
- [x] §3 Invasion  
- [x] §4 Neutrals  
- [x] §5 Build locations  
- [x] §6 Lanes (unlimited) + §6b Cargo  
- [x] §7 Splits  
- [x] §8 Cancel move  
- [x] §9 Generator  
- [x] §10 Tooling  
- [x] §11 Phase 2  

Accepted including gap resolutions: cargo sink on lost homeworld, propulsion≠cargo, multi-side combat chain, split wording lock. 
