# Starfall — Visual / Graphics Design (Normative)

**Status:** v1 design lock  
**Audience:** `apps/web` implementers and anyone authoring map/HUD chrome  
**Companions:** [mechanics.md](./mechanics.md) (UX requirements), [tech-tree.md](./tech-tree.md), [domain.md](./domain.md), [macro-spectator.md](./macro-spectator.md) (Chronicle)

---

## 1. Direction

**One composition.** The play surface is a full-bleed galaxy **graph** (starfield + nodes + lanes). It must not read as a dashboard. The map is the product.

**Brand.** During a match, “Starfall” is a quiet corner wordmark. The lobby is brand-forward: full-bleed starfield, large wordmark, one short line, one CTA group — no inset hero image, no promo cards.

**Look.** Deep ink / near-black space with a cool, desaturated starfield (subtle dust). The graph stays the visual authority — no nebula wallpaper competing with nodes and lanes.

**Avoid (hard):** purple-on-white or purple-to-indigo glow themes; warm cream + terracotta editorial; broadsheet / newspaper chrome; emoji; multi-layer drop shadows; pill-cluster HUD clutter.

**Art style.** Flat vector / vector-ish UI. All systems are **circles** with role-colored fills and ownership rings. Not realistic 3D ships, not illustrated planet portraits. Must stay readable at 150–300 nodes when zoomed out.

**Typography**

| Role | Face | Use |
|---|---|---|
| Display / brand | **Syne** | Wordmark, lobby title, panel titles |
| Body / numerals | **Source Sans 3** | HUD values, labels, tech names |

No Inter, Roboto, Arial, or system-only stacks as the designed UI faces.

---

## 2. Color tokens

CSS variables for `apps/web` (seed values — tune in implementation, keep roles stable):

```css
:root {
  /* Space */
  --sf-void: #07090d;
  --sf-starfield: #0c1018;
  --sf-dust: #1a2230;
  --sf-lane: #3a4558;
  --sf-cargo: #7aafc4;      /* cargo ship marker */
  --sf-unowned: #6b7585;
  --sf-fog-ghost: #151a22;

  /* Self / focus */
  --sf-self: #e8a838;       /* warm amber — you */
  --sf-focus: #f0d080;
  /* Role fills (circle interior — not ownership) */
  --sf-role-home: #4a6fa5;
  --sf-role-core: #3d8f6e;
  --sf-role-resource: #c4a035;
  --sf-role-shipyard: #8b5a9e;
  --sf-role-relay: #6b7c8f;
  --sf-role-relic: #d4c07a;

  /* Feedback */
  --sf-danger: #c45c4a;     /* undefended warning — use sparingly */
  --sf-combat-flash: #f5f2ea;
  --sf-text: #e6eaf0;
  --sf-text-dim: #9aa3b2;

  /* Chrome */
  --sf-hud-bg: color-mix(in srgb, var(--sf-void) 82%, transparent);
  --sf-hud-border: #2a3344;
}
```

### Player palette (50–100 FFA)

Procedural HSL palette, one slot per seat:

- Saturation ~65–80%, lightness ~45–55%
- Minimum hue distance between any two seats (~360° / N with jitter)
- Never assign pure purple-glow neon as the default “accent system”; seat colors are for **ownership rings**, not global theme
- Local player always remaps to `--sf-self` for their own rings/fleets (other players keep seat colors)

Allies: thin shared outline hatch or linked glow between allied seat colors (subtle — not a third theme).

---

## 3. Map graphics

### Starfield

Full-bleed background. Sparse static stars + very slow parallax dust (optional). No animated nebulae behind the graph.

### Lanes (edges)

| State | Look |
|---|---|
| Default | Thin luminous line (`--sf-lane`) |
| Path preview | Brighter stroke along selected move path |
| Busy | Unchanged stroke — density comes from **markers**, not a “congested” style |
| Fogged | Faint ghost segment or omitted until explored |

### Nodes (all circles)

Every system is a **circle**. Roles are **not** distinguished by shape.

**Two color layers**

| Layer | Meaning | Rule |
|---|---|---|
| **Fill** | Role | Fixed role palette (below) — same for all players |
| **Stroke / ring** | Ownership | Seat color; self → `--sf-self` amber; unowned → `--sf-unowned` |

Selected: additional bright focus ring (`--sf-focus`) outside the ownership stroke.

**Role symbol (required)**

A small icon sits **on or just outside** the circle (prefer top-right of the rim, or centered above the level numeral if the number sits low). It encodes role even when fill color is hard to read (zoom, colorblind, overlapping).

| Role | Symbol (flat vector, 1-stroke) |
|---|---|
| Homeworld | House / planet-with-ring mark |
| Core world | People / population mark |
| Resource | Hex crystal / coin mark |
| Shipyard | Wrench / drydock mark |
| Relay | Signal / antenna mark |
| Relic | Star / artifact mark |

- Size: ~30–40% of circle radius; scales with the node but clamps so overview zoom stays readable.
- Color: high-contrast on the fill (near-white or near-ink), **not** seat-colored — role only.
- Does not replace the level number; numeral stays centered (or lower-center if the icon shares the disc).
- Cargo ships and war fleets keep their own markers; these symbols are **system-only**.

**Role fill palette (seed)**

| Role | Fill token | Seed hex |
|---|---|---|
| Homeworld | `--sf-role-home` | `#4a6fa5` |
| Core world | `--sf-role-core` | `#3d8f6e` |
| Resource | `--sf-role-resource` | `#c4a035` |
| Shipyard | `--sf-role-shipyard` | `#8b5a9e` |
| Relay | `--sf-role-relay` | `#6b7c8f` |
| Relic | `--sf-role-relic` | `#d4c07a` |

Ownership ring must stay readable on these fills (darken fill slightly if needed; never replace seat colors with role colors on the ring).

**Level number**

- Draw the integer **level** centered on the circle (Source Sans 3, high contrast), clear of the role symbol.
- No pip strips, no level cap in the UI.
- At overview zoom, number remains legible (scale type with radius; minimum ~9px).

**Size**

- Base radius varies slightly by role (e.g. homeworld / relic a bit larger, relay a bit smaller).
- Radius also grows with level:  
  `r = r_role × (1 + 0.04 × min(level − 1, 12))`  
  Visual soft-cap at level **12** so megabases don’t cover the map; the **level number** still climbs with no mechanical cap.
- Upgraded / high-level nodes read as larger circles + bigger numerals — clear high-value targets.

### Undefended high-value (owner-only)

Your nodes at level **≥ 3** with **no friendly fleet**: soft `--sf-danger` pulse on the ownership ring. Not shown to enemies.

### Fog of war

**Topology is public; state is fogged.** The server sends the full `GalaxyMap` at
match start, so hiding the graph shape buys no secrecy — it only leaves the
player staring at empty space with no sense of where the galaxy goes. Unexplored
systems therefore render as dim ghosts: you can see that a system is *there* and
how the lanes run, but not its role, owner, level, population, or fleets.

| Knowledge | Render |
|---|---|
| Unexplored | Dim ghost circle + ghost lane. No role fill, no symbol, no owner ring, no level number |
| Explored, not currently visible | Last-known circle (role fill + symbol + last owner ring + last level number), desaturated, no live fleets |
| Visible | Live node + fleets, full saturation |
| Relic scanning | All relic circles visible (role fill + owner) regardless of hop distance |

The three tiers must be distinguishable at a glance by brightness alone, so the
frontier between known and unknown space reads without labels.

No fog “cards,” overlays, or stickers on top of the map.

### Camera

Pan + zoom. Default zoom shows a regional cluster; pinch/wheel to overview. Minimap optional later — not required for v1 skeleton.

---

## 4. Fleets and combat

### At a node

One **power marker** (chevron or short bar), sized by total fleet power — not one sprite per ship. Optional thin tier ticks (F / C / B count or proportion) on the marker.

### In transit / lane battles

**Show every fleet and cargo marker** on the lane — fan or slight offset so stacks remain readable; never cull to a cap. Interpolate positions smoothly between 100ms ticks.

- War fleets: chevrons (seat color / amber for self), sized by power.
- Cargo ships: distinct capsule / crate glyph (`--sf-cargo`), sized by cargo value band.
- Lane combat: flash all participating sprites, then update survivors — same instant Lanchester as nodes.

Split fleets = multiple markers. Cargo never merges into war-fleet glyphs (separate sprite always).

### Invasion

Secondary pip / badge on the escort fleet for committed population.

### Combat VFX

On Lanchester contact: brief white flash (`--sf-combat-flash`) + short particle burst, then immediate survivor marker update. **No** prolonged battle bars, HP drains, or screen shake.

### Capture

Ownership wash: ring color crossfades to new seat color over ~300–500ms.

---

## 5. HUD inventory (match)

Keep chrome minimal. Nothing in the HUD should overpower the map.

| Region | Contents |
|---|---|
| Top-left | Credits \| Population (large numerals, Source Sans 3) |
| Top-right | Round timer \| your rank / score |
| Corner | Quiet “Starfall” wordmark |
| Bottom | Selected-node strip: role symbol + color swatch + name, level number, owner, actions (Build / Upgrade / Invade) |
| Slide-over | Tech tree — full **3×3** grid visible at once; one-line effect under each name; purchased = filled |

**No:** hero cards, stat strips, schedule widgets, floating promo badges, multi-panel dashboards.

### Lobby

Full-bleed starfield. Syne wordmark at hero scale. One supporting sentence. One CTA group (Join / Ready). Brand must still read if chrome were removed.

### Intent feedback

- Hover lane/node: lightweight highlight
- Illegal moves (e.g. non-adjacent path): brief flash + no-op (no modal). Lanes are never “full.”
- Research unlock: soft pulse on the tech cell + tiny toast optional (prefer map/HUD pulse over toast spam)

---

## 6. Motion (intentional set)

Ship **at least** these three; avoid extra noise:

1. **Fleet travel** — continuous lane interpolation between ticks  
2. **Ownership wash** — on successful annexation  
3. **Unlock / upgrade pulse** — research purchase or node level-up  

Optional fourth: undefended-node warning pulse (owner-only, already specified).

---

## 7. Accessibility and scale

- Color is not the only cue: **role = fill + small symbol**, **owner = ring**, **level = numeral**; self ring uses amber weight.
- Numerals (credits, pop, timer, **node levels**) contrast ≥ WCAG AA against their backgrounds.
- Touch targets on the selected-node strip ≥ 44px height on mobile.
- At max zoom-out, level numbers, role fills, and role symbols remain distinguishable; size soft-cap keeps the graph readable.

---

## 8. Non-goals (v1 visuals)

- Photoreal planets, cinematic ship models, or cutscenes  
- Purple neon “space game” default skins  
- Card-based map UI or inset hero media in-match  
- Per-ship sprite armies on the graph  
- Prolonged combat animations  
- Emoji status indicators  

---

## 9. Implementation notes (for later `apps/web`)

- Prefer Canvas or WebGL for the graph layer; DOM/HTML for HUD and tech panel.
- Layout positions come from `GalaxyMap.layout` (sim-agnostic); rendering never feeds back into sim.
- Seat colors assigned at match start and stay stable for the round.
- Interpolate render positions client-side; authoritative positions still snap on each `TickUpdate`.

---

## 10. Shared `--sf-*` palette (source of truth)

CSS custom properties in `apps/web/src/styles.css` and the numeric mirrors in
`apps/web/src/macro/palette.ts` are the **shared source of truth** for both the
competitive map (`renderer.ts`) and Chronicle (`mapView.ts` + dashboard).

| Token | Hex | Role |
|---|---|---|
| `--sf-void` | `#07090d` | Deepest clear / page ink |
| `--sf-starfield` | `#0c1018` | Lobby / chrome gradient base |
| `--sf-dust` | `#1a2230` | Panel washes |
| `--sf-lane` | `#3a4558` | Hyperlane / edge stroke |
| `--sf-cargo` | `#7aafc4` | Cargo / diplomacy accent |
| `--sf-unowned` | `#6b7585` | Neutral / unclaimed |
| `--sf-self` | `#e8a838` | Local player / warm chrome accent |
| `--sf-focus` | `#f0d080` | Selection / highlight |
| `--sf-danger` | `#c45c4a` | Contested fronts, warnings |
| `--sf-combat-flash` | `#f5f2ea` | Capture pulse |
| `--sf-hud-border` | `#2a3344` | Panel borders |

**Chronicle empire colors** derive from each empire's `colorHue` via
`empireFill` / `empireAccent` / `empireSwatchCss` in `palette.ts` — the map
territory rim and the roster swatch must always agree.

**Chronicle map stack** (see [macro-spectator.md](./macro-spectator.md)): seeded
nebula + parallax starfield → territory coverage field (blobby fills, glowing
rims, no cell edges) → hyperlanes → contested border quads → star sprites /
capital rings → diplomacy arcs → DOM name labels.
