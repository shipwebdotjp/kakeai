import {
  classifyFlowEdge,
  type FlowDiagram,
  type FlowEdge,
  type FlowLayout,
  type FlowNode,
} from "@kakeai/contracts";

export type FlowNodeJson = FlowNode;
export type FlowEdgeJson = FlowEdge;
export type FlowDiagramJson = FlowDiagram;

/** Sibling field that stores the node-indexed flow effects. */
export const FLOW_EFFECTS_FIELD_KEY = "effects";

/** True when another edge already retries the same node. */
export function hasSelfLoop(
  diagram: FlowDiagramJson,
  nodeIndex: number,
  exceptEdgeIndex = -1,
): boolean {
  return diagram.edges.some(
    (edge, index) =>
      index !== exceptEdgeIndex && edge.from === nodeIndex && edge.to === nodeIndex,
  );
}

/** The first edge pair the editor can add without duplicating a stored edge. */
export function nextFlowEdge(diagram: FlowDiagramJson): FlowEdgeJson | null {
  const used = new Set(
    diagram.edges.map((edge) => `${edge.from}->${edge.to}`),
  );
  for (let from = 0; from < diagram.nodes.length; from += 1) {
    for (let to = 0; to < diagram.nodes.length; to += 1) {
      if (from !== to && !used.has(`${from}->${to}`)) {
        return { from, to };
      }
    }
  }
  for (let node = 0; node < diagram.nodes.length; node += 1) {
    if (!used.has(`${node}->${node}`)) {
      return { from: node, to: node };
    }
  }
  return null;
}

/** Edges whose route the editor should confirm in the preview. */
export function flowNeedsRouteReview(
  diagram: FlowDiagramJson,
  layout: FlowLayout,
): boolean {
  return diagram.edges.some((edge) => {
    const kind = classifyFlowEdge(edge, layout, diagram.nodes.length);
    return layout === "cycle"
      ? kind === "auxiliary" || kind === "loop"
      : kind === "backward" || kind === "loop";
  });
}

/** Swaps two node indexes and leaves every other index untouched. */
export function swapNodeIndex(value: number, first: number, second: number): number {
  if (value === first) {
    return second;
  }
  if (value === second) {
    return first;
  }
  return value;
}

/**
 * Swaps a node with its neighbour and follows the swap in every edge index so
 * that the diagram keeps referring to the same nodes after reordering.
 */
export function moveDiagramNode(
  diagram: FlowDiagramJson,
  index: number,
  direction: -1 | 1,
): FlowDiagramJson {
  if (index < 0 || index >= diagram.nodes.length) {
    return diagram;
  }
  const target = index + direction;
  if (target < 0 || target >= diagram.nodes.length) {
    return diagram;
  }
  const nodes = [...diagram.nodes];
  const moved = nodes[index]!;
  nodes[index] = nodes[target]!;
  nodes[target] = moved;
  const remap = (value: number): number => swapNodeIndex(value, index, target);
  return {
    nodes,
    edges: diagram.edges.map((edge) => ({
      ...edge,
      from: remap(edge.from),
      to: remap(edge.to),
    })),
  };
}

interface FlowEffectJson {
  target?: { kind?: string; index?: number } | null;
  [key: string]: unknown;
}

/**
 * Rewrites the node indexes of `effects` (the sibling form field) so a node
 * reorder or removal keeps each effect on the node the user selected. Returns
 * `null` when the value is empty, unparsable, or not an array; the caller then
 * leaves the effects untouched rather than writing a broken field.
 */
export function remapFlowEffectTargets(
  effectsJson: string,
  remap: (index: number) => number | null,
): string | null {
  const trimmed = effectsJson.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const next = parsed
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return entry;
      }
      const effect = entry as FlowEffectJson;
      const target = effect.target;
      if (
        target === undefined ||
        target === null ||
        target.kind !== "node" ||
        typeof target.index !== "number"
      ) {
        return entry;
      }
      const index = remap(target.index);
      if (index === null) {
        return null;
      }
      return { ...effect, target: { ...target, index } };
    })
    .filter((entry) => entry !== null);
  return JSON.stringify(next);
}
