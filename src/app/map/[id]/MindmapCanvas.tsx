"use client";

/**
 * Week 2 마인드맵 에디터 캔버스.
 *
 * 구성:
 *  - 진실의 원천: zustand 스토어(src/lib/store/mindmap-store.ts)의 정규화 MindNode 맵.
 *    좌표(x,y)는 저장하지 않고 layout 으로 매번 파생 계산.
 *  - 레이아웃: layoutMindmap(평면 노드, rootId) → 좌/우 균형 수평 마인드맵.
 *  - 커스텀 노드: TopicNode (handles + 인라인 편집 + collapse 토글).
 *  - 키보드: Tab=자식, Enter=형제, F2=편집, Delete/Backspace=서브트리 삭제, Escape=선택해제.
 *    편집 중에는 캔버스 단축키 NO-OP(스토어 핸들러가 게이트).
 *  - 드래그-드롭 재부모화: onNodeDragStop + getIntersectingNodes, 사이클 가드는 스토어가 처리.
 *  - 영속화: rev 변경마다 디바운스 자동저장(useAutosave). 로드는 서버 컴포넌트가 내려준
 *    initialNodes 로 시드/복원.
 *
 * 무한 루프 방지: rfNodes/rfEdges 는 nodes+selectedId+editingId 로부터 useMemo 파생.
 *   onNodesChange 에서 좌표/치수 변화는 스토어에 반영하지 않는다(파생값이므로).
 *   nodeTypes 는 모듈 스코프 고정 참조.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type Edge,
  type NodeTypes,
  type DefaultEdgeOptions,
  type OnNodesChange,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { MindNode } from "@/lib/types";
import {
  layoutMindmap,
  type TopicNode as TopicNodeType,
  type NodeSize,
} from "@/lib/layout";
import {
  useMindmap,
  toList,
  createKeydownHandler,
} from "@/lib/store/mindmap-store";
import { useAutosave } from "@/lib/useAutosave";
import { TopicNode, topicCallbacks } from "./TopicNode";

/* 모듈 스코프 고정 참조(무한 업데이트/플리커 방지). */
const nodeTypes: NodeTypes = { topic: TopicNode };
const defaultEdgeOptions: DefaultEdgeOptions = { type: "default" };

function Flow({
  mapId,
  title,
  initialNodes,
  initialUpdatedAt,
}: {
  mapId: string;
  title: string;
  initialNodes: MindNode[] | null;
  initialUpdatedAt: string | null;
}) {
  const rf = useReactFlow<TopicNodeType, Edge>();

  // 노드 실측 크기(가변 너비/높이). React Flow 측정값을 모아 레이아웃에 반영한다.
  const sizesRef = useRef<Map<string, NodeSize>>(new Map());
  const [sizeTick, setSizeTick] = useState(0);

  // ── 스토어 구독 ─────────────────────────────────────────────
  const nodes = useMindmap((s) => s.nodes);
  const rootId = useMindmap((s) => s.rootId);
  const selectedId = useMindmap((s) => s.selectedId);
  const editingId = useMindmap((s) => s.editingId);
  const rev = useMindmap((s) => s.rev);

  const setSelected = useMindmap((s) => s.setSelected);
  const beginEdit = useMindmap((s) => s.beginEdit);
  const commitEdit = useMindmap((s) => s.commitEdit);
  const cancelEdit = useMindmap((s) => s.cancelEdit);
  const toggleCollapse = useMindmap((s) => s.toggleCollapse);
  const reparent = useMindmap((s) => s.reparent);
  const load = useMindmap((s) => s.load);
  const seedRoot = useMindmap((s) => s.seedRoot);

  const { status, schedule, flush } = useAutosave({ mapId, initialUpdatedAt });

  // ── 자동저장: 구조 변경(rev) 마다 ──────────────────────────
  // load/seed 가 bump 한 초기 rev 를 baseline 으로 잡아, 마운트 직후 불필요한 재저장을 막는다.
  const lastSavedRev = useRef(-1);

  // ── 로드/시드 (마운트 1회) ─────────────────────────────────
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialNodes && initialNodes.length > 0) {
      load(initialNodes);
      // 막 로드한 노드를 곧바로 되저장하지 않도록 baseline 동기화.
      lastSavedRev.current = useMindmap.getState().rev;
    } else {
      // 빈 맵: 루트 1개 시드 후 최초 1회 저장(서버 nodes 가 null 이었으므로).
      seedRoot(title);
      lastSavedRev.current = useMindmap.getState().rev;
      schedule(toList(useMindmap.getState().nodes));
    }
    // 초기 뷰 맞춤.
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInit.current) return;
    if (rev === lastSavedRev.current) return; // 구조 변경 없음(또는 마운트 baseline)
    lastSavedRev.current = rev;
    schedule(toList(useMindmap.getState().nodes));
  }, [rev, schedule]);

  // ── 탭 종료/숨김 시 즉시 저장 ──────────────────────────────
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", flush);
    };
  }, [flush]);

  // ── TopicNode 콜백 주입(effect 에서 최신값으로 갱신) ──────────
  // data 에 함수를 넣으면 노드 identity 가 매 렌더 바뀌므로, 모듈 ref 로 전달한다.
  // 모듈 객체 변경은 렌더 중이 아니라 effect 안에서 수행(React 19 immutability 규칙 준수).
  // 편집 상태(editing)는 콜백이 아니므로 노드 data 로 전달한다(아래 rfNodes 참고).
  useEffect(() => {
    topicCallbacks.onToggleCollapse = toggleCollapse;
    topicCallbacks.onCommitTitle = (_id, t) => commitEdit(t);
    topicCallbacks.onCancelEdit = cancelEdit;
  }, [toggleCollapse, commitEdit, cancelEdit]);

  // ── 중심 토픽(루트) 제목 → 문서 제목 동기화 ──────────────────
  // 루트 노드 이름을 바꾸면 헤더/최근목록/공유에 쓰이는 documents.title 도 갱신한다.
  // (rename_map RPC, ~800ms 디바운스. useAutosave 와 동일하게 raw fetch 로 호출.)
  const rootTitle = useMindmap((s) =>
    s.rootId ? s.nodes[s.rootId]?.title : undefined,
  );
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTitle = useRef<string | null>(null);
  useEffect(() => {
    if (!didInit.current || rootTitle == null) return;
    if (lastTitle.current === null) {
      lastTitle.current = rootTitle; // 마운트 직후 기준점(불필요한 저장 방지)
      return;
    }
    if (rootTitle === lastTitle.current) return;
    lastTitle.current = rootTitle;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return;
      void fetch(`${url}/rest/v1/rpc/rename_map`, {
        method: "POST",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_id: mapId,
          p_title: rootTitle.trim() || "제목 없는 마인드맵",
        }),
      });
    }, 800);
    return () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
    };
  }, [rootTitle, mapId]);

  // ── 레이아웃 파생(평면 노드 + rootId) ──────────────────────
  const flat = useMemo(() => toList(nodes), [nodes]);
  const { nodes: laidNodes, edges: laidEdges } = useMemo(
    () => layoutMindmap(flat, rootId, sizesRef.current),
    [flat, rootId, sizeTick],
  );

  // 선택/편집 상태를 RF 노드에 반영(레이아웃은 selection/editing 을 모름).
  const rfNodes = useMemo<TopicNodeType[]>(
    () =>
      laidNodes.map((n) => {
        const isSelected = n.id === selectedId;
        const isEditing = n.id === editingId;
        if (!isSelected && !isEditing) return n;
        return {
          ...n,
          selected: isSelected,
          data: isEditing ? { ...n.data, editing: true } : n.data,
        };
      }),
    [laidNodes, selectedId, editingId],
  );

  // ── 컨트롤드 변경: 선택만 반영, 좌표/치수는 무시(파생값) ───
  const onNodesChange = useCallback<OnNodesChange<TopicNodeType>>(
    (changes) => {
      let sizeChanged = false;
      for (const c of changes) {
        if (c.type === "select") {
          setSelected(c.selected ? c.id : null);
        } else if (c.type === "dimensions" && c.dimensions) {
          // React Flow 가 측정한 실제 노드 크기를 모은다(가변 크기 레이아웃용).
          const w = Math.round(c.dimensions.width);
          const h = Math.round(c.dimensions.height);
          const prev = sizesRef.current.get(c.id);
          if (!prev || prev.width !== w || prev.height !== h) {
            sizesRef.current.set(c.id, { width: w, height: h });
            sizeChanged = true;
          }
        }
      }
      // 실측 크기가 바뀐 경우에만 재레이아웃(무한 루프 방지: 크기 변화 없으면 no-op).
      if (sizeChanged) setSizeTick((t) => t + 1);
    },
    [setSelected],
  );

  // ── 드래그-드롭 재부모화 ───────────────────────────────────
  // 드래그 시작 좌표(이동 거리 게이트용 — 사소한 클릭/미세 드래그로 인한 오재부모화 방지).
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const onNodeDragStart = useCallback<OnNodeDrag<TopicNodeType>>((_e, node) => {
    dragStart.current = { x: node.position.x, y: node.position.y };
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<TopicNodeType>>(
    (_e, dragged) => {
      const start = dragStart.current;
      dragStart.current = null;
      const moved = start
        ? Math.hypot(dragged.position.x - start.x, dragged.position.y - start.y)
        : 0;
      // 30px 미만 이동은 재부모화로 취급하지 않는다.
      if (moved >= 30) {
        const currentParent =
          useMindmap.getState().nodes[dragged.id]?.parentId ?? null;
        const hits = rf.getIntersectingNodes(dragged, true);
        // 자기 자신·현재 부모는 후보에서 제외. 사이클/루트 가드는 스토어가 처리.
        const target = hits.find(
          (h) => h.id !== dragged.id && h.id !== currentParent,
        );
        if (target) reparent(dragged.id, target.id);
      }
      // 파생 레이아웃이 노드를 제자리로 스냅 → 뷰 재맞춤.
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 200 }));
    },
    [rf, reparent],
  );

  // ── 전역 키보드(선택 기반, 편집 중엔 스토어 핸들러가 NO-OP) ─
  useEffect(() => {
    const handler = createKeydownHandler();
    const onKey = (e: KeyboardEvent) => {
      // 인터랙티브 요소(입력창·버튼·링크·셀렉트·편집영역)에 포커스가 있으면
      // 캔버스 단축키를 발동하지 않는다 — 헤더 링크/공유 버튼/컨트롤 버튼 등에서
      // Delete·Enter 가 노드를 삭제/생성하는 사고를 막는다.
      const el = e.target as HTMLElement | null;
      if (
        el?.closest(
          'input, textarea, select, button, a, [contenteditable="true"]',
        )
      ) {
        return;
      }
      handler(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── 자동 정렬(이미 자동 레이아웃이지만 뷰 재맞춤) ──────────
  const autoArrange = useCallback(() => {
    rf.fitView({ padding: 0.2, duration: 250 });
  }, [rf]);

  const saveLabel =
    status === "saving"
      ? "저장 중…"
      : status === "error"
        ? "저장 실패"
        : status === "saved"
          ? "저장됨"
          : "";
  const saveCls =
    status === "error"
      ? "text-red-500"
      : status === "saving"
        ? "text-amber-500"
        : "text-emerald-600 dark:text-emerald-400";

  return (
    <ReactFlow<TopicNodeType, Edge>
      nodes={rfNodes}
      edges={laidEdges}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={onNodesChange}
      onEdgesChange={() => {}}
      onNodeClick={(_e, n) => setSelected(n.id)}
      onNodeDoubleClick={(_e, n) => beginEdit(n.id)}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => {
        setSelected(null);
        cancelEdit();
      }}
      nodesConnectable={false}
      nodesDraggable
      deleteKeyCode={null} // Delete 는 우리가 직접 처리
      minZoom={0.2}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
      <Panel position="top-right">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
          <button
            type="button"
            onClick={autoArrange}
            className="rounded px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            자동 정렬
          </button>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span className={`min-w-[3.5rem] ${saveCls}`}>{saveLabel}</span>
        </div>
      </Panel>
    </ReactFlow>
  );
}

export function MindmapCanvas({
  mapId,
  title,
  initialNodes,
  initialUpdatedAt,
}: {
  mapId: string;
  title: string;
  initialNodes: MindNode[] | null;
  initialUpdatedAt: string | null;
}) {
  return (
    <ReactFlowProvider>
      <Flow
        mapId={mapId}
        title={title}
        initialNodes={initialNodes}
        initialUpdatedAt={initialUpdatedAt}
      />
    </ReactFlowProvider>
  );
}
