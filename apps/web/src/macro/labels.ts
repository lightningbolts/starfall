import type { EmpireId, SystemId } from "@starfall/macro-sim";
import { empireAccent, rgbToCss } from "./palette.js";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface ScreenProjection {
  toScreen(x: number, y: number): { x: number; y: number };
  width: number;
  height: number;
  /** Screen pixels per world unit, so labels can be sized to fit territory. */
  pxPerUnit: number;
}

export interface EmpireLabel {
  id: EmpireId;
  name: string;
  colorHue: number;
  /** Territory centroid in world space. */
  x: number;
  y: number;
  territory: number;
  /** Rough radius of the empire's blob in world units. */
  radius: number;
  focused: boolean;
}

export interface SystemLabel {
  id: SystemId;
  name: string;
  x: number;
  y: number;
  owned: boolean;
}

/**
 * Map text lives in the DOM rather than WebGL so it keeps the Starfall
 * typography and stays crisp at every zoom level.
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private empireNodes = new Map<EmpireId, HTMLDivElement>();
  private systemNodes = new Map<SystemId, HTMLDivElement>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "chronicle-labels";
    parent.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
    this.empireNodes.clear();
    this.systemNodes.clear();
  }

  update(
    empires: EmpireLabel[],
    systems: SystemLabel[],
    projection: ScreenProjection,
    empireOpacity: number,
  ): void {
    this.syncEmpires(empires, projection, empireOpacity);
    this.syncSystems(systems, projection);
  }

  private syncEmpires(
    labels: EmpireLabel[],
    projection: ScreenProjection,
    opacity: number,
  ): void {
    const seen = new Set<EmpireId>();
    // Biggest empires claim screen space first; anything that would collide is
    // dropped, so the map never turns into a pile of overlapping names.
    const ordered = [...labels].sort((a, b) => {
      if (a.focused !== b.focused) return a.focused ? -1 : 1;
      return b.territory - a.territory;
    });
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];

    for (const label of ordered) {
      seen.add(label.id);
      let node = this.empireNodes.get(label.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "ch-map-label ch-map-label-empire";
        this.root.appendChild(node);
        this.empireNodes.set(label.id, node);
      }
      // Long generated names would span whole empires; clip them on the map.
      const text =
        label.name.length > 26 ? `${label.name.slice(0, 24).trimEnd()}…` : label.name;
      if (node.textContent !== text) node.textContent = text;

      const p = projection.toScreen(label.x, label.y);
      // Fit the name inside the blob it names: uppercase display type runs about
      // 0.62em per character, so solve for the size that spans the territory.
      const targetPx = label.radius * projection.pxPerUnit * 1.5;
      const fontPx = clamp(targetPx / Math.max(4, text.length * 0.62), 9, 21);
      const halfW = text.length * fontPx * 0.31;
      const halfH = fontPx * 0.8;
      const box = {
        x0: p.x - halfW,
        y0: p.y - halfH,
        x1: p.x + halfW,
        y1: p.y + halfH,
      };

      const offScreen =
        box.x1 < 0 ||
        box.y1 < 0 ||
        box.x0 > projection.width ||
        box.y0 > projection.height;
      const collides = placed.some(
        (q) =>
          box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0,
      );

      if (offScreen || collides) {
        node.style.display = "none";
        continue;
      }
      placed.push(box);

      node.style.display = "";
      node.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      node.style.fontSize = `${fontPx.toFixed(1)}px`;
      node.style.color = rgbToCss(empireAccent(label.colorHue));
      node.style.opacity = String(label.focused ? 1 : opacity);
      node.classList.toggle("is-focus", label.focused);
    }

    for (const [id, node] of this.empireNodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.empireNodes.delete(id);
    }
  }

  private syncSystems(
    labels: SystemLabel[],
    projection: ScreenProjection,
  ): void {
    const seen = new Set<SystemId>();
    for (const label of labels) {
      seen.add(label.id);
      let node = this.systemNodes.get(label.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "ch-map-label ch-map-label-system";
        this.root.appendChild(node);
        this.systemNodes.set(label.id, node);
      }
      if (node.textContent !== label.name) node.textContent = label.name;
      const p = projection.toScreen(label.x, label.y);
      node.style.transform = `translate(-50%, 0) translate(${p.x.toFixed(1)}px, ${(p.y + 7).toFixed(1)}px)`;
      node.classList.toggle("is-owned", label.owned);
    }
    for (const [id, node] of this.systemNodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.systemNodes.delete(id);
    }
  }
}
