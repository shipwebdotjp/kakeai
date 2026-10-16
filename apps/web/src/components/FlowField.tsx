import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

interface FlowFieldProps {
  label: string;
  fieldKey: string;
  value: string;
  setField: (key: string, value: string) => void;
  maxNodes: number;
  maxEdges: number;
}

interface FlowNodeJson {
  label: string;
  caption?: string;
}

interface FlowEdgeJson {
  from: number;
  to: number;
  label?: string;
}

interface FlowDiagramJson {
  nodes: FlowNodeJson[];
  edges: FlowEdgeJson[];
}

function defaultDiagram(): FlowDiagramJson {
  return {
    nodes: [{ label: "開始" }, { label: "完了" }],
    edges: [{ from: 0, to: 1 }],
  };
}

function parseDiagram(value: string): FlowDiagramJson | null {
  if (value.trim().length === 0) {
    return defaultDiagram();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { nodes?: unknown }).nodes) ||
    !Array.isArray((parsed as { edges?: unknown }).edges)
  ) {
    return null;
  }
  const nodes = (parsed as { nodes: unknown[] }).nodes;
  const edges = (parsed as { edges: unknown[] }).edges;
  const validNodes = nodes.every(
    (node) =>
      typeof node === "object" &&
      node !== null &&
      typeof (node as { label?: unknown }).label === "string",
  );
  const validEdges = edges.every(
    (edge) =>
      typeof edge === "object" &&
      edge !== null &&
      typeof (edge as { from?: unknown }).from === "number" &&
      typeof (edge as { to?: unknown }).to === "number",
  );
  if (!validNodes || !validEdges) {
    return null;
  }
  return parsed as FlowDiagramJson;
}

function nodeName(nodes: readonly FlowNodeJson[], index: number): string {
  const label = nodes[index]?.label;
  return `${index + 1}. ${label !== undefined && label.length > 0 ? label : "（名称なし）"}`;
}

export function FlowField({
  label,
  fieldKey,
  value,
  setField,
  maxNodes,
  maxEdges,
}: FlowFieldProps) {
  const diagram = parseDiagram(value);

  if (diagram === null) {
    return (
      <div className="my-2">
        <span>{label}</span>
        <p className={errorTextClass}>ノードと辺を読み取れませんでした。JSONで修正してください。</p>
        <textarea
          className={`mt-1 block w-full ${textFieldClass}`}
          rows={4}
          value={value}
          onChange={(event) => setField(fieldKey, event.target.value)}
        />
      </div>
    );
  }

  const commit = (next: FlowDiagramJson) => setField(fieldKey, JSON.stringify(next));
  const nodes = diagram.nodes;
  const edges = diagram.edges;

  const setNode = (index: number, patch: Partial<FlowNodeJson>) => {
    commit({
      ...diagram,
      nodes: nodes.map((node, nodeIndex) =>
        nodeIndex === index ? { ...node, ...patch } : node,
      ),
    });
  };

  const removeNode = (index: number) => {
    if (nodes.length <= 1) {
      return;
    }
    const nextNodes = nodes.filter((_node, nodeIndex) => nodeIndex !== index);
    const nextEdges = edges
      .filter((edge) => edge.from !== index && edge.to !== index)
      .map((edge) => ({
        ...edge,
        from: edge.from > index ? edge.from - 1 : edge.from,
        to: edge.to > index ? edge.to - 1 : edge.to,
      }));
    commit({ nodes: nextNodes, edges: nextEdges });
  };

  const addNode = () => {
    if (nodes.length >= maxNodes) {
      return;
    }
    commit({ ...diagram, nodes: [...nodes, { label: "ノード" }] });
  };

  const setEdge = (index: number, patch: Partial<FlowEdgeJson>) => {
    commit({
      ...diagram,
      edges: edges.map((edge, edgeIndex) =>
        edgeIndex === index ? { ...edge, ...patch } : edge,
      ),
    });
  };

  const addEdge = () => {
    if (edges.length >= maxEdges || nodes.length < 2) {
      return;
    }
    commit({ ...diagram, edges: [...edges, { from: 0, to: 1 }] });
  };

  return (
    <div className="my-2">
      <span>{label}</span>
      <p className={metaTextClass}>
        ノードを並べ、辺でつなぎます。矢印は from から to へ向きます。
      </p>

      <div className="mt-2 rounded border border-border p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs">ノード</span>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={nodes.length >= maxNodes}
            onClick={addNode}
          >
            ノードを追加
          </button>
        </div>
        {nodes.map((node, index) => (
          <div key={index} className="mt-1 flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-xs">{index + 1}</span>
            <input
              className={`flex-1 ${textFieldClass}`}
              value={node.label}
              placeholder="ノード名"
              maxLength={64}
              onChange={(event) => setNode(index, { label: event.target.value })}
            />
            <input
              className={`flex-1 ${textFieldClass}`}
              value={node.caption ?? ""}
              placeholder="補足（任意）"
              maxLength={64}
              onChange={(event) => {
                const caption = event.target.value;
                const next: FlowNodeJson = { ...node };
                if (caption.length === 0) {
                  delete next.caption;
                } else {
                  next.caption = caption;
                }
                setNode(index, { caption: next.caption });
              }}
            />
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={nodes.length <= 1}
              onClick={() => removeNode(index)}
            >
              削除
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 rounded border border-border p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs">辺</span>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={edges.length >= maxEdges || nodes.length < 2}
            onClick={addEdge}
          >
            辺を追加
          </button>
        </div>
        {edges.map((edge, index) => (
          <div key={index} className="mt-1 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5">
              から
              <select
                className={textFieldClass}
                value={String(edge.from)}
                onChange={(event) => setEdge(index, { from: Number(event.target.value) })}
              >
                {nodes.map((_node, nodeIndex) => (
                  <option key={nodeIndex} value={nodeIndex} disabled={nodeIndex === edge.to}>
                    {nodeName(nodes, nodeIndex)}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              へ
              <select
                className={textFieldClass}
                value={String(edge.to)}
                onChange={(event) => setEdge(index, { to: Number(event.target.value) })}
              >
                {nodes.map((_node, nodeIndex) => (
                  <option key={nodeIndex} value={nodeIndex} disabled={nodeIndex === edge.from}>
                    {nodeName(nodes, nodeIndex)}
                  </option>
                ))}
              </select>
            </label>
            <input
              className={`w-32 ${textFieldClass}`}
              value={edge.label ?? ""}
              placeholder="ラベル（任意）"
              maxLength={32}
              onChange={(event) => {
                const next: FlowEdgeJson = { ...edge };
                if (event.target.value.length === 0) {
                  delete next.label;
                } else {
                  next.label = event.target.value;
                }
                setEdge(index, { label: next.label });
              }}
            />
            <button
              type="button"
              className={`ml-auto ${buttonNeutralClass}`}
              onClick={() =>
                commit({
                  ...diagram,
                  edges: edges.filter((_entry, edgeIndex) => edgeIndex !== index),
                })
              }
            >
              削除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
