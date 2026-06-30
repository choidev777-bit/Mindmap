"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * Week 1 캔버스 — 중심 토픽 1개만 보여주는 정적 플레이스홀더.
 * Week 2: 커스텀 토픽 노드 + 노드 CRUD(Tab/Enter) + d3-hierarchy 자동 레이아웃
 * Week 3: Yjs Y.Map ↔ React Flow 동기화 어댑터
 * Week 4: Liveblocks 실시간 + 커서/아바타
 */
export function MindmapCanvas({ title }: { title: string }) {
  const nodes: Node[] = [
    {
      id: "root",
      position: { x: 0, y: 0 },
      data: { label: title },
      type: "default",
      draggable: false,
    },
  ];
  const edges: Edge[] = [];

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable />
    </ReactFlow>
  );
}
