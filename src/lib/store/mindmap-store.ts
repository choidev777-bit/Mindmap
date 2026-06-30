"use client";

/**
 * 마인드맵 편집 상태 + 순수 연산 모듈 (실시간 협업 / Yjs write-through).
 *
 * 핵심 설계(프로젝트 규칙): 트리 구조(parentId, order)만 진실의 원천.
 * 화면 좌표(x,y)는 d3-hierarchy로 파생 계산하므로 여기 상태에는 없다.
 *
 * 실시간 모델(Week 4):
 *  - 진실의 원천 = 바인딩된 Y.Doc 안 Y.Map<id, MindNode>(src/lib/yjs/bind.ts).
 *  - store.nodes/rootId/rev 는 Y.Map 의 "로컬 미러" — observer 가 갱신한다.
 *  - 구조 변경 액션은 doc.transact 안에서 Y.Map 을 수정한다(모든 클라이언트로 전파).
 *    Yjs observer 가 동기적으로 미러를 갱신하므로 로컬 응답도 즉시 반영된다.
 *  - selectedId / editingId 는 **공유하지 않는 사용자별 로컬 상태**.
 *  - doc 미바인딩 시 구조 액션은 no-op(가드).
 */

import { create } from "zustand";
import type { Doc as YDoc } from "yjs";
import type { MindNode } from "@/lib/types";
import { getNodesMap, readNodes, type NodesMap } from "@/lib/yjs/bind";

/* ------------------------------------------------------------------ */
/* 타입                                                                */
/* ------------------------------------------------------------------ */

export interface MindmapState {
  /** 정규화된 노드 맵 (Y.Map 미러) */
  nodes: Record<string, MindNode>;
  /** 루트 노드 id (parentId === null 인 노드). 비어있으면 "" */
  rootId: string;
  /** 현재 선택된 노드 id (없으면 null) — 로컬 전용 */
  selectedId: string | null;
  /** 인라인 편집 중인 노드 id (없으면 null) — 로컬 전용, 키보드 단축키 게이트 */
  editingId: string | null;
  /** 마지막 변경 리비전. 리레이아웃/오토세이브 트리거용 단조 증가 카운터 */
  rev: number;

  /** 바인딩된 Y.Doc(없으면 null) — 비구독 ref */
  doc: YDoc | null;
  /** 노드 Y.Map(없으면 null) — 비구독 ref */
  ymap: NodesMap | null;
  /** observer 해제 함수(내부용) */
  _unobserve: (() => void) | null;
}

export interface MindmapActions {
  /** Y.Doc 을 바인딩하고 Y.Map → 미러 observer 를 등록. 캔버스 마운트 시 1회. */
  bindDoc: (doc: YDoc) => void;
  /** 바인딩 해제(observer 제거 + 미러 비움). 언마운트 시. */
  unbindDoc: () => void;

  /** 자식 추가 → 새 노드 선택 + 편집 진입. 반환: 새 노드 id */
  addChild: (parentId: string) => string | null;
  /** 형제 추가(같은 parent 아래) → 새 노드 선택 + 편집 진입. 반환: 새 노드 id */
  addSibling: (siblingId: string) => string | null;

  rename: (id: string, title: string) => void;
  /** 노드 + 모든 자손 삭제. 부모를 재선택. 루트는 삭제 불가(무시) */
  remove: (id: string) => void;
  /**
   * 재부모화. newParentId 가 자기 자신이거나 자손이면 거부(사이클 가드).
   * 반환: 성공 여부
   */
  reparent: (childId: string, newParentId: string) => boolean;

  toggleCollapse: (id: string) => void;
  /** 루트 직계 브랜치의 좌/우 측을 지정(드래그로 측 전환). 자손은 layout 이 따라가게 함. */
  setSide: (id: string, side: "left" | "right") => void;
  setSelected: (id: string | null) => void;

  beginEdit: (id: string) => void;
  /** 편집 커밋. title 트림 후 빈 문자열이면 이전 값 유지 */
  commitEdit: (title: string) => void;
  cancelEdit: () => void;
}

export type MindmapStore = MindmapState & MindmapActions;

/* ------------------------------------------------------------------ */
/* 순수 헬퍼 (테스트 가능, store 밖에서도 재사용)                       */
/* ------------------------------------------------------------------ */

/** SSR 안전한 고유 id. 클라이언트에서만 호출됨("use client" 모듈). */
function newId(): string {
  return crypto.randomUUID();
}

function childrenOf(
  nodes: Record<string, MindNode>,
  parentId: string,
): MindNode[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

/**
 * 형제 정렬키 전략: **max + 1** (단순 append).
 * - 새 노드는 항상 형제들 끝에 붙는다 → order = (현재 형제 최대 order) + 1.
 * - 정수 간격이라 미래에 "사이 삽입"이 필요하면 프랙셔널 인덱싱으로 교체 가능
 *   (그 때는 (prev.order + next.order)/2 사용). 지금은 끝에만 추가하므로 max+1로 충분.
 * - 빈 형제 집합이면 0.
 */
function nextOrder(nodes: Record<string, MindNode>, parentId: string): number {
  const sibs = childrenOf(nodes, parentId);
  if (sibs.length === 0) return 0;
  return Math.max(...sibs.map((s) => s.order)) + 1;
}

/** 한 노드와 그 모든 자손의 id 집합 (자기 자신 포함). */
function collectSubtree(
  nodes: Record<string, MindNode>,
  id: string,
): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const child of Object.values(nodes)) {
      if (child.parentId === cur) stack.push(child.id);
    }
  }
  return out;
}

/** ancestor 가 node 의 (자기 자신 포함) 조상인가? 사이클 가드용. */
function isSelfOrDescendant(
  nodes: Record<string, MindNode>,
  ancestor: string,
  node: string,
): boolean {
  return collectSubtree(nodes, ancestor).has(node);
}

/** 정규화 맵에서 루트(parentId === null) 찾기. */
function findRootId(nodes: Record<string, MindNode>): string {
  for (const n of Object.values(nodes)) {
    if (n.parentId === null) return n.id;
  }
  return "";
}

function makeNode(parentId: string | null, order: number): MindNode {
  return {
    id: newId(),
    title: "",
    parentId,
    order,
    markers: [],
    note: "",
    collapsed: false,
  };
}

/* ------------------------------------------------------------------ */
/* 직렬화 헬퍼 (load/save 어댑터에서 사용)                              */
/* ------------------------------------------------------------------ */

/** 플랫 배열 → 정규화 맵 */
export function toRecord(list: MindNode[]): Record<string, MindNode> {
  const rec: Record<string, MindNode> = {};
  for (const n of list) rec[n.id] = n;
  return rec;
}

/** 정규화 맵 → 플랫 배열(저장용 jsonb). order 안정화를 위해 정렬. */
export function toList(nodes: Record<string, MindNode>): MindNode[] {
  return Object.values(nodes).sort((a, b) => {
    if (a.parentId === b.parentId) return a.order - b.order;
    // 루트 먼저, 그 외엔 parentId 기준 안정 정렬
    if (a.parentId === null) return -1;
    if (b.parentId === null) return 1;
    return a.parentId < b.parentId ? -1 : 1;
  });
}

/* ------------------------------------------------------------------ */
/* 스토어                                                              */
/* ------------------------------------------------------------------ */

export const useMindmap = create<MindmapStore>((set, get) => ({
  nodes: {},
  rootId: "",
  selectedId: null,
  editingId: null,
  rev: 0,
  doc: null,
  ymap: null,
  _unobserve: null,

  bindDoc: (doc) => {
    // 이전 바인딩이 있으면 정리(맵 간 이동 시).
    get()._unobserve?.();

    const ymap = getNodesMap(doc);
    // Y.Map 변경(로컬/원격) → 미러 갱신. 노드를 통째 set/delete 하므로 얕은 observe 로 충분.
    const sync = () => {
      const nodes = readNodes(ymap);
      set({ nodes, rootId: findRootId(nodes), rev: get().rev + 1 });
    };
    ymap.observe(sync);

    set({
      doc,
      ymap,
      _unobserve: () => ymap.unobserve(sync),
    });
    sync(); // 현재 상태 즉시 미러링
  },

  unbindDoc: () => {
    get()._unobserve?.();
    set({
      doc: null,
      ymap: null,
      _unobserve: null,
      nodes: {},
      rootId: "",
      selectedId: null,
      editingId: null,
    });
  },

  addChild: (parentId) => {
    const { nodes, ymap, doc } = get();
    if (!ymap || !doc) return null;
    if (!nodes[parentId]) return null;
    const node = makeNode(parentId, nextOrder(nodes, parentId));
    doc.transact(() => {
      // 부모가 접혀 있었다면 새 자식이 보이도록 펼친다
      ymap.set(parentId, { ...nodes[parentId], collapsed: false });
      ymap.set(node.id, node);
    });
    // 추가 즉시 인라인 편집 진입(로컬 상태)
    set({ selectedId: node.id, editingId: node.id });
    return node.id;
  },

  addSibling: (siblingId) => {
    const { nodes, ymap, doc } = get();
    if (!ymap || !doc) return null;
    const sib = nodes[siblingId];
    if (!sib) return null;
    // 루트에는 형제를 만들 수 없다 → 자식으로 폴백
    if (sib.parentId === null) return get().addChild(siblingId);

    const parentId = sib.parentId;
    const node = makeNode(parentId, nextOrder(nodes, parentId));
    doc.transact(() => {
      ymap.set(node.id, node);
    });
    set({ selectedId: node.id, editingId: node.id });
    return node.id;
  },

  rename: (id, title) => {
    const { nodes, ymap, doc } = get();
    if (!ymap || !doc) return;
    const node = nodes[id];
    if (!node) return;
    doc.transact(() => {
      ymap.set(id, { ...node, title });
    });
  },

  remove: (id) => {
    const { nodes, rootId, ymap, doc } = get();
    if (!ymap || !doc) return;
    const target = nodes[id];
    if (!target) return;
    if (id === rootId || target.parentId === null) return; // 루트는 삭제 금지

    const doomed = collectSubtree(nodes, id); // 자기 + 자손
    const parentId = target.parentId;
    doc.transact(() => {
      for (const did of doomed) ymap.delete(did);
    });
    // 부모 재선택(로컬). 미러는 observer 가 이미 갱신함.
    set({
      selectedId: get().nodes[parentId] ? parentId : rootId,
      editingId: null,
    });
  },

  reparent: (childId, newParentId) => {
    const { nodes, ymap, doc } = get();
    if (!ymap || !doc) return false;
    const child = nodes[childId];
    const newParent = nodes[newParentId];
    if (!child || !newParent) return false;
    if (childId === newParentId) return false; // 자기 자신 거부
    if (child.parentId === null) return false; // 루트는 이동 불가
    if (child.parentId === newParentId) return false; // 변화 없음

    // 사이클 가드: newParent 가 child 자신 또는 child 의 자손이면 거부
    if (isSelfOrDescendant(nodes, childId, newParentId)) return false;

    doc.transact(() => {
      ymap.set(childId, {
        ...child,
        parentId: newParentId,
        order: nextOrder(nodes, newParentId), // 새 부모 끝에 붙임
      });
      // 새 부모가 접혀 있었으면 펼쳐서 옮긴 노드가 보이게
      ymap.set(newParentId, { ...newParent, collapsed: false });
    });
    return true;
  },

  toggleCollapse: (id) => {
    const { nodes, ymap, doc } = get();
    if (!ymap || !doc) return;
    const n = nodes[id];
    if (!n) return;
    // 자식이 없으면 토글 의미 없음
    if (childrenOf(nodes, id).length === 0) return;
    doc.transact(() => {
      ymap.set(id, { ...n, collapsed: !n.collapsed });
    });
  },

  setSide: (id, side) => {
    const { nodes, ymap, doc } = get();
    if (!ymap || !doc) return;
    const n = nodes[id];
    if (!n || n.side === side) return;
    doc.transact(() => {
      ymap.set(id, { ...n, side });
    });
  },

  setSelected: (id) => {
    if (id !== null && !get().nodes[id]) return;
    set({ selectedId: id });
  },

  beginEdit: (id) => {
    if (!get().nodes[id]) return;
    set({ selectedId: id, editingId: id });
  },

  commitEdit: (title) => {
    const { editingId, nodes, ymap, doc } = get();
    if (!editingId) return;
    const node = nodes[editingId];
    if (!node) {
      set({ editingId: null });
      return;
    }
    const trimmed = title.trim();
    // 빈 제목이면 기존 값 유지(새 노드의 경우 placeholder가 남음).
    const finalTitle = trimmed.length > 0 ? trimmed : node.title;
    // 변경이 없으면 편집만 종료(불필요한 재저장/깜빡임 방지).
    if (finalTitle === node.title || !ymap || !doc) {
      set({ editingId: null });
      return;
    }
    doc.transact(() => {
      ymap.set(editingId, { ...node, title: finalTitle });
    });
    set({ editingId: null });
  },

  cancelEdit: () => {
    set({ editingId: null });
  },
}));

/* ------------------------------------------------------------------ */
/* 파생 셀렉터 (컴포넌트에서 useMindmap(selector)로 구독)               */
/* ------------------------------------------------------------------ */

/** 한 노드의 직접 자식들(정렬됨). */
export function selectChildren(state: MindmapStore, parentId: string) {
  return childrenOf(state.nodes, parentId);
}

/** 노드가 자식을 가지는지(collapse 토글 노출 여부). */
export function selectHasChildren(state: MindmapStore, id: string) {
  return childrenOf(state.nodes, id).length > 0;
}

/* ------------------------------------------------------------------ */
/* 키보드 핸들러                                                       */
/* ------------------------------------------------------------------ */

/**
 * 캔버스 레벨 keydown 핸들러를 생성한다.
 *
 * 규칙:
 * - editingId 가 설정되어 있으면 **NO-OP** (입력창 자체의 onKeyDown이 Enter/Escape 처리).
 *   → 이 핸들러는 캔버스(또는 document)에 붙이고, 노드 인풋에는 stopPropagation 을 건다.
 * - selectedId 가 없으면 대부분 단축키 무시.
 *
 * 매핑 (선택됨 + 비편집 상태):
 *   Tab        → addChild(selected)         (+preventDefault: 포커스 이동 방지)
 *   Enter      → addSibling(selected)
 *   F2         → beginEdit(selected)
 *   Delete/Backspace → remove(selected)
 *   Escape     → setSelected(null)
 *
 * 반환된 함수는 React 의 onKeyDown 또는 window.addEventListener('keydown') 둘 다에 쓸 수 있다.
 */
export function createKeydownHandler(store = useMindmap) {
  return (e: KeyboardEvent | React.KeyboardEvent): void => {
    const s = store.getState();

    // 편집 중이면 캔버스 단축키 전면 NO-OP — 인풋의 자체 핸들러에 위임.
    if (s.editingId !== null) return;

    const selected = s.selectedId;

    switch (e.key) {
      case "Tab": {
        if (!selected) break;
        e.preventDefault(); // 기본 포커스 이동 차단(선택된 노드가 있을 때만)
        s.addChild(selected);
        break;
      }
      case "Enter": {
        if (!selected) break;
        e.preventDefault();
        s.addSibling(selected);
        break;
      }
      case "F2": {
        if (!selected) break;
        e.preventDefault();
        s.beginEdit(selected);
        break;
      }
      case "Delete":
      case "Backspace": {
        if (!selected) break;
        e.preventDefault();
        s.remove(selected);
        break;
      }
      case "Escape": {
        e.preventDefault();
        s.setSelected(null);
        break;
      }
      default:
        break;
    }
  };
}
