"use client";

/**
 * 마인드맵 에디터 캔버스 (실시간 협업 / Yjs + Liveblocks).
 *
 * 구성:
 *  - 진실의 원천(실시간): 바인딩된 Liveblocks 룸의 Y.Doc 안 Y.Map<id, MindNode>.
 *    store(mindmap-store)는 그 로컬 미러이고, 좌표(x,y)는 저장하지 않고 layout 으로 파생.
 *  - 레이아웃: layoutMindmap(평면 노드, rootId) → 좌/우 균형 수평 마인드맵.
 *  - 커스텀 노드: TopicNode (handles + 인라인 편집 + collapse 토글).
 *  - 키보드: Tab=자식, Enter=형제, F2=편집, Delete/Backspace=서브트리 삭제, Escape=선택해제.
 *  - 드래그-드롭 재부모화: onNodeDragStop + 중심점 히트테스트, 사이클 가드는 스토어가 처리.
 *  - 실시간: useRoom → getYjsProviderForRoom → Y.Doc 을 store 에 bindDoc.
 *    sync 완료 시 seedIfEmpty 로 최초 1회 시드(기존 노드 복원 또는 루트 생성).
 *  - 영속화: 변경(rev)마다 디바운스로 평면 nodes 를 Supabase 에 미러 저장(useAutosave).
 *  - 프레즌스: 포인터 이동을 flow 좌표로 변환해 presence.cursor 갱신 → 타인은 <Cursors/> 로 표시.
 *
 * 무한 루프 방지: 로컬 쓰기는 doc.transact 로 묶고, Y.Map observer 가 미러만 갱신(단방향).
 *   rfNodes/rfEdges 는 nodes+selectedId+editingId 로부터 useMemo 파생. nodeTypes 는 모듈 스코프 고정.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { useRoom, useUpdateMyPresence } from "@liveblocks/react";
import { getYjsProviderForRoom } from "@liveblocks/yjs";

import type { MindNode } from "@/lib/types";
import { layoutMindmap, type TopicNode as TopicNodeType } from "@/lib/layout";
import {
  useMindmap,
  toList,
  createKeydownHandler,
} from "@/lib/store/mindmap-store";
import { getNodesMap, seedIfEmpty } from "@/lib/yjs/bind";
import { useAutosave } from "@/lib/useAutosave";
import { TopicNode, topicCallbacks } from "./TopicNode";
import { Cursors } from "./Cursors";

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
  const room = useRoom();
  const updateMyPresence = useUpdateMyPresence();

  // ── Yjs provider/doc (룸당 캐시됨) ──────────────────────────
  const provider = useMemo(() => getYjsProviderForRoom(room), [room]);
  const doc = useMemo(() => provider.getYDoc(), [provider]);

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
  const setSide = useMindmap((s) => s.setSide);
  const reparent = useMindmap((s) => s.reparent);
  const bindDoc = useMindmap((s) => s.bindDoc);
  const unbindDoc = useMindmap((s) => s.unbindDoc);

  const { status, schedule, flush } = useAutosave({ mapId, initialUpdatedAt });

  // ── 실시간 바인딩 + 최초 시드 (마운트 1회) ──────────────────
  // sync 가 baseline 을 잡기 전까진 저장하지 않도록 didInit 로 게이트.
  const didInit = useRef(false);
  const lastSavedRev = useRef(-1);

  useEffect(() => {
    bindDoc(doc);

    const onSync = (isSynced: boolean) => {
      if (!isSynced || didInit.current) return;
      didInit.current = true;

      const ymap = getNodesMap(doc);
      // 시드 전에 "브랜드 뉴" 여부 판정(원격에도 없고 서버 복원 노드도 없음).
      const brandNew = ymap.size === 0 && !(initialNodes && initialNodes.length);

      seedIfEmpty(ymap, initialNodes, mapId, title);

      // 막 시드/복원한 상태를 곧바로 되저장하지 않도록 baseline 동기화.
      lastSavedRev.current = useMindmap.getState().rev;
      // 새 맵이면 생성된 루트를 Supabase 미러에도 1회 영속화.
      if (brandNew) schedule(toList(useMindmap.getState().nodes));

      requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 0 }));
    };

    if (provider.synced) onSync(true);
    provider.on("sync", onSync);

    return () => {
      provider.off("sync", onSync);
      unbindDoc();
      didInit.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, provider]);

  // ── 자동저장: 변경(rev) 마다 디바운스 미러 저장 ──────────────
  // 로컬/원격 모두 동일 수렴 상태를 저장 → 중복은 동일 데이터(무해).
  useEffect(() => {
    if (!didInit.current) return;
    if (rev === lastSavedRev.current) return;
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
  useEffect(() => {
    topicCallbacks.onToggleCollapse = toggleCollapse;
    topicCallbacks.onCommitTitle = (_id, t) => commitEdit(t);
    topicCallbacks.onCancelEdit = cancelEdit;
  }, [toggleCollapse, commitEdit, cancelEdit]);

  // ── 중심 토픽(루트) 제목 → 문서 제목 동기화 ──────────────────
  // 루트 노드 이름을 바꾸면 헤더/최근목록/공유에 쓰이는 documents.title 도 갱신한다.
  const rootTitle = useMindmap((s) =>
    s.rootId ? s.nodes[s.rootId]?.title : undefined,
  );
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTitle = useRef<string | null>(null);
  useEffect(() => {
    if (!didInit.current || rootTitle == null) return;
    if (lastTitle.current === null) {
      lastTitle.current = rootTitle; // 기준점(불필요한 저장 방지)
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
    () => layoutMindmap(flat, rootId),
    [flat, rootId],
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
      for (const c of changes) {
        if (c.type === "select") setSelected(c.selected ? c.id : null);
      }
    },
    [setSelected],
  );

  // ── 드래그-드롭 재부모화 ───────────────────────────────────
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
        const st = useMindmap.getState();
        const currentParent = st.nodes[dragged.id]?.parentId ?? null;
        const cx = dragged.position.x;
        const cy = dragged.position.y;
        // 드롭 "중심점"이 실제로 어떤 노드 안에 들어있을 때만 그 노드를 대상으로 삼는다.
        const target = rf.getNodes().find((h) => {
          if (h.id === dragged.id || h.id === currentParent) return false;
          const w = h.width ?? h.measured?.width ?? 160;
          const hh = h.height ?? h.measured?.height ?? 40;
          return (
            Math.abs(cx - h.position.x) <= w / 2 &&
            Math.abs(cy - h.position.y) <= hh / 2
          );
        });
        if (target) {
          reparent(dragged.id, target.id);
        } else if (currentParent === st.rootId) {
          setSide(dragged.id, cx >= 0 ? "right" : "left");
        }
      }
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 200 }));
    },
    [rf, reparent, setSide],
  );

  // ── 전역 키보드(선택 기반, 편집 중엔 스토어 핸들러가 NO-OP) ─
  useEffect(() => {
    const handler = createKeydownHandler();
    const onKey = (e: KeyboardEvent) => {
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

  // ── 프레즌스: 포인터를 flow 좌표로 변환해 커서 공유 ──────────
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      updateMyPresence({ cursor: { x: p.x, y: p.y } });
    },
    [rf, updateMyPresence],
  );
  const onPointerLeave = useCallback(() => {
    updateMyPresence({ cursor: null });
  }, [updateMyPresence]);

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
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
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
      <Cursors />
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
