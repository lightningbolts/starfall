# Starfall — Macro-scale Spectator Mode (Chronicle)

**Status:** v1 design lock  
**Audience:** `packages/macro-sim` and `apps/web` Chronicle implementers  
**Companions:** [visuals.md](./visuals.md) (shared palette + Chronicle map look), [ADR 003](../adr/003-macro-tick-split.md)

A separate mode from the competitive real-time game — same universe theme, different engine. The viewer does not act; they watch AI empires expand, ally, betray, and collapse across a galaxy of individual star systems linked by planar hyperlanes, with a toggleable dashboard for following the story.

## 1. Scale and entity model

- **Simulated unit: star systems.** Each system holds: owner, population, credits, garrison strength, planetary developments, defense mix, optional active engagement, persistent name, star class, hyperlane links, and (if on a frontier) a contested-% value.
- **Territory cells are render-only.** Voronoi cells around each star rasterize into a soft empire coverage field (blobby fills + glowing rims). Cell edges are never stroked.
- **Hyperlanes** form a planar, connected graph. Combat and colonization only travel along these links.
- **AI empire count stays modest** — roughly a dozen to a few dozen empires so each grows a readable blob of territory.
- **Fleets** are empire-level compositions (corvette → dreadnought + defense platforms). Contested fronts remain the territorial mechanism; engagements resolve combat over many ticks. Logistics soft-cap hull counts from territory + shipyards; shipyards spend credits and taper as fleets overstretch so late-game power stays in the high-thousands / low-hundreds-of-thousands — not planetary-scale millions.

### Playtest defaults

| Parameter | Value |
|---|---|
| Logic tick interval | **100ms** at 1× (pause / 1× / 2× / 4× / **10×** / **20×**) |
| Economy pulse | every **10** logic ticks (~1s) |
| Bot cadence | every **5** logic ticks |
| Production variance | **±14%** per economy pulse |
| Systems (small / medium / large) | **600 / 1200 / 2400** |
| Empire count | `clamp(round(systems / 50), 12, 48)` |
| Starting territory | **capital system only** |
| Contested flip | ~**0.78**; drift scale ~**0.008**; force-ratio gates for fortress/capital worlds |
| Event chance / tick | ~**0.02** |
| Render interpolation | ease-in-out cubic between last and next snapshots |

## 2. Bot personalities

Twelve archetypes: conqueror, aggressive, reckless, cautious, strategist, opportunistic, diplomat, loyal, xenophobe, technocrat, isolationist, wildcard.

Traits ∈ [0, 1]: `aggression`, `loyalty`, `risk`, `greed`, `ambition`, `xenophobia`, `curiosity`.

- **No hard ally cap.** Soft pressure raises break chance as webs grow; xenophobes / isolationists rarely pact; diplomats accumulate many allies.
- Conquerors / high ambition keep expanding and finishing wounded empires.
- Technocrats prioritize research; isolationists reinforce and avoid war.

## 3. Tech (empire + planetary)

**Empire tech** (~34 named techs, 5 flat tiers): permanent `Empire.researched` unlocks — industry, colony admin, militia, archives, megafarms, fortress worlds, diplomacy, scanners, escorts, medical corps, logistics, war mobilization, planetary shields, capital shipyards, xenology, singularity labs, tactical AI, fleet logistics, terraforming, espionage, warp doctrine, hegemony, eternal archives, iron curtain, pax federation, supercapital frame, advanced shields, sensor grid, medical nanites, stellar engineering, quantum command, living metal, void navigation, genesis protocols.

**Repeatable late-game tracks** (unlimited): Applied Sciences, Fleet Doctrine Ex, Industrial Excellence — escalate in cost and stack small permanent bonuses so research never hard-caps.

**Planetary developments** (max 4 per system): agro domes, mining spires, orbital batteries, shipyard ring, research campus, fortress complex, trade hub, plague hospitals, hidden arsenals. Civilian developments persist when a system is abandoned; conquest strips military sites (batteries, fortress, arsenals, shipyards) but keeps civilian infrastructure.

Breakthrough events often grant a permanent empire tech or a repeatable level.

Territory that loses hyperlane connectivity to the capital becomes an **enclave**, bleeds garrison/credits, and is abandoned after a short grace — wartime pockets do not persist.

**Capital loss:** surviving empires rehome, then take a succession shock — ~45% production and ~30% garrison growth for a long, variable stretch, ~30% fleet scrap, treasury/garrison bleed on remaining worlds, and some allies may defect. Enough remains to stage a comeback.

## 4. Combat systems

Tick-based **engagements** with variable duration:

| Mode | Cadence |
|---|---|
| Border skirmish | Short |
| Fleet battle | Medium–long; scales with force size / parity |
| Siege | Longest; fortress / capital / platforms |
| Raid | Short burst |

Resolution uses fleet RPS + tactics/tech/doctrine/home advantage so underdogs can win. Map front thickness/brightness scales with engagement **intensity**. Events: `fleet_battle`, `border_clash`, plus existing front/capital collapses.

## 5. Randomization / events

Weighted world events: production surge, rebellion, relic, pirate raid, disaster, offensive blitz, defensive stronghold, plague, robbery, tech breakthrough, coup/regime change. Economy includes sprawl upkeep, ship upkeep, soft pop ceilings / famine. Temporary modifiers last **tens to hundreds of economy pulses** with wide random variance (not blink-length buffs).

## 6. Map presentation

- Seeded nebula + parallax starfield (territory shaders unchanged).
- Empire colors from a curated **HSL swatch bank** (greys, browns, earth, jewel tones) stored as `colorHue` / `colorSat` / `colorLight`.
- Contested fronts intensity-scaled; diplomacy arcs brighter and above stars.
- Event-colored system pulses; elimination banner (5s + progress) at center top.

## 7. Dashboard

Panels: roster, feed, trends, **military**, **tech** (full catalog by tier + repeatables; focus marks ownership), overlays (including toggleable **empire share pie** for systems / population / credits / garrison / fleet power). Speed 1/2/4/10/20. Keyboard: space pause, 1/2/4/0|5→10×, 6|8→20×, F fit, Esc clear focus.

## 8. Empire naming

Procedural word-bank. No live API.

## 9. Hosting

Client-only for v1 — sim runs in the browser.
