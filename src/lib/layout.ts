/**
 * LENS — 자동 레이아웃 엔진.
 *
 * 입력: 평면 MindNode[] (parentId/order/collapsed가 진실의 원천) + rootId
 * 출력: React Flow nodes(좌표 포함) + edges, 그리고 Map<id, {x,y}>.
 *
 * 레이아웃: 좌/우 균형 수평 마인드맵.
 *  - 루트는 원점(0,0)에 위치.
 *  - 루트의 직계 자식을 좌/우 두 그룹으로 분할(자손 수 기준 균형).
 *  - 오른쪽 그룹: x가 양수로 깊이만큼 바깥으로 확장.
 *  - 왼쪽 그룹: 오른쪽 트리를 x축 대칭(음수)으로 미러링.
 *  - 수직 분리는 d3 tree의 nodeSize로 결정.
 *  - collapsed 노드의 자손은 레이아웃/렌더에서 완전히 제외.
 *
 * 핵심 설계 원칙: x,y는 절대 저장하지 않는다. 매 변경마다 결정적으로 재계산한다.
 */

import { stratify, tree, type HierarchyNode } from "d3-hierarchy";
import { Position, type Node as RFNode, type Edge as RFEdge } from "@xyflow/react";
import type { MindNode } from "./types";

/* ────────────────────────────────────────────────────────────────────────── */
/* 상수 — 고정 노드 크기(가변 폭/높이는 이 상수로 근사). 커스텀 노드 CSS와 일치시킬 것. */

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 44;

/** 형제 간 수직 간격(노드 높이 포함). d3 nodeSize의 첫 번째 값. */
const V_GAP = NODE_HEIGHT + 24; // 68
/** 깊이(레벨) 간 수평 간격(노드 폭 포함). d3 nodeSize의 두 번째 값. */
const H_GAP = NODE_WIDTH + 80; // 260

/* ────────────────────────────────────────────────────────────────────────── */
/* 공개 타입 */

/** 커스텀 토픽 노드의 data 페이로드. MindmapCanvas의 nodeTypes와 맞춤. */
export interface TopicNodeData extends Record<string, unknown> {
  title: string;
  /** 좌/우 가지 — 핸들/엣지 방향 결정에 사용. */
  side: "left" | "right" | "root";
  /** 접을 수 있는 자식이 있는가(접힘 여부와 무관). */
  hasChildren: boolean;
  collapsed: boolean;
  isRoot: boolean;
  /** 보이는(접히지 않은) 직계 자식 수. */
  childCount: number;
  /**
   * 인라인 편집 중인지 여부.
   * layout 은 항상 false 로 채우고, MindmapCanvas 가 렌더 직전 노드별로 덮어쓴다.
   * (편집 상태가 바뀌면 해당 노드 data 가 바뀌어 재렌더 → input 즉시 표시.)
   */
  editing?: boolean;
}

export type TopicNode = RFNode<TopicNodeData, "topic">;

export interface LayoutResult {
  nodes: TopicNode[];
  edges: RFEdge[];
  /** id → 화면 좌표. 디버깅/포커싱/테스트용. */
  positions: Map<string, { x: number; y: number }>;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 내부 헬퍼 */

interface Strat {
  id: string;
  parentId: string | null;
  node: MindNode;
}

/**
 * 평면 노드를 부모→자식 인접 리스트로 인덱싱한다.
 * collapsed 처리/자식 수 계산 등 여러 곳에서 재사용.
 */
function indexChildren(nodes: MindNode[]): Map<string, MindNode[]> {
  const byParent = new Map<string, MindNode[]>();
  for (const n of nodes) {
    if (n.parentId == null) continue;
    const arr = byParent.get(n.parentId);
    if (arr) arr.push(n);
    else byParent.set(n.parentId, [n]);
  }
  // 형제는 order로 정렬(안정).
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }
  return byParent;
}

/**
 * rootId에서 도달 가능하고 collapsed 경계를 넘지 않는 노드만 수집한다.
 * collapsed 노드 자신은 포함하지만 그 자손은 제외한다.
 * 고아/사이클 안전.
 */
function collectVisible(
  rootId: string,
  byParent: Map<string, MindNode[]>,
  byId: Map<string, MindNode>,
): MindNode[] {
  const root = byId.get(rootId);
  if (!root) return [];
  const out: MindNode[] = [];
  const seen = new Set<string>();
  const stack: MindNode[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur.id)) continue; // 사이클 가드
    seen.add(cur.id);
    out.push(cur);
    if (cur.collapsed) continue; // 접힘: 자손 제외
    const kids = byParent.get(cur.id);
    if (kids) for (const k of kids) stack.push(k);
  }
  return out;
}

/**
 * 한쪽(왼쪽 또는 오른쪽)의 평면 노드 집합으로 d3 tree 레이아웃을 실행한다.
 * 반환된 HierarchyPointNode에서 .x(수직), .y(수평)을 읽는다.
 * subset은 반드시 루트(rootId) + 그 한쪽 자손들을 포함해야 한다.
 */
function layoutSide(
  subset: MindNode[],
  rootId: string,
): HierarchyNode<Strat> & { x: number; y: number } {
  const data: Strat[] = subset.map((n) => ({
    id: n.id,
    // 루트의 부모는 null, 그 외는 실제 부모(단, subset 안에 존재해야 함).
    parentId: n.id === rootId ? null : n.parentId,
    node: n,
  }));

  const root = stratify<Strat>()
    .id((d) => d.id)
    .parentId((d) => d.parentId)(data);

  // 형제 순서를 MindNode.order로 안정화.
  root.sort(
    (a, b) =>
      a.data.node.order - b.data.node.order ||
      (a.data.id < b.data.id ? -1 : 1),
  );

  // nodeSize: [수직(형제 간), 수평(레벨 간)]. 화면축은 호출부에서 스왑.
  // separation: 다른 부모를 둔 인접 노드는 한 칸 더 띄움 → 서브트리 겹침 방지.
  const layout = tree<Strat>()
    .nodeSize([V_GAP, H_GAP])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.25));

  return layout(root) as HierarchyNode<Strat> & { x: number; y: number };
}

/**
 * 루트 직계 자식을 좌/우로 균형 분할한다.
 * 균형 기준: 각 자식 서브트리의 "보이는 노드 수"의 합이 양쪽이 비슷하도록
 * 큰 것부터 가벼운 쪽에 배정(greedy). 동률이면 오른쪽 우선.
 * MindNode.side가 명시돼 있으면 그 힌트를 우선 존중한다.
 */
function partitionSides(
  rootId: string,
  byParent: Map<string, MindNode[]>,
  visibleIds: Set<string>,
): { left: MindNode[]; right: MindNode[] } {
  const directChildren = (byParent.get(rootId) ?? []).filter((c) =>
    visibleIds.has(c.id),
  );

  // 각 직계 자식 서브트리의 보이는 노드 수(가중치) 계산.
  const weight = (start: MindNode): number => {
    let count = 0;
    const stack = [start];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id) || !visibleIds.has(cur.id)) continue;
      seen.add(cur.id);
      count++;
      if (cur.collapsed) continue;
      for (const k of byParent.get(cur.id) ?? []) stack.push(k);
    }
    return count;
  };

  const left: MindNode[] = [];
  const right: MindNode[] = [];
  let leftW = 0;
  let rightW = 0;

  // side 힌트가 있는 노드 먼저 고정 배치.
  const hinted = directChildren.filter((c) => c.side === "left" || c.side === "right");
  const free = directChildren.filter((c) => c.side !== "left" && c.side !== "right");
  for (const c of hinted) {
    if (c.side === "left") {
      left.push(c);
      leftW += weight(c);
    } else {
      right.push(c);
      rightW += weight(c);
    }
  }

  // 나머지는 가중치 큰 것부터 가벼운 쪽에 greedy 배정.
  free
    .map((c) => ({ c, w: weight(c) }))
    .sort((a, b) => b.w - a.w || a.c.order - b.c.order)
    .forEach(({ c, w }) => {
      if (rightW <= leftW) {
        right.push(c);
        rightW += w;
      } else {
        left.push(c);
        leftW += w;
      }
    });

  // 출력 형제 순서는 order로 다시 정렬(트리 빌드 안정성).
  left.sort((a, b) => a.order - b.order);
  right.sort((a, b) => a.order - b.order);
  return { left, right };
}

/**
 * 한쪽 자식 그룹 + 그 자손들을 평면으로 모은다(접힘 경계 존중).
 * 루트는 별도로 더해진다(layoutSide가 루트를 필요로 함).
 */
function collectSideSubset(
  rootNode: MindNode,
  sideRoots: MindNode[],
  byParent: Map<string, MindNode[]>,
  visibleIds: Set<string>,
): MindNode[] {
  const out: MindNode[] = [rootNode];
  const seen = new Set<string>([rootNode.id]);
  const stack = [...sideRoots];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur.id) || !visibleIds.has(cur.id)) continue;
    seen.add(cur.id);
    out.push(cur);
    if (cur.collapsed) continue;
    for (const k of byParent.get(cur.id) ?? []) stack.push(k);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 공개 API */

/**
 * 평면 MindNode[]를 좌/우 균형 수평 마인드맵 레이아웃으로 변환한다.
 *
 * @param allNodes 문서의 모든 MindNode(평면).
 * @param rootId   중심 토픽 id.
 * @returns React Flow nodes/edges + id→좌표 맵.
 *
 * 엣지 케이스:
 *  - rootId 미존재 → 빈 결과.
 *  - 루트만 존재 → 루트 노드 하나, 엣지 없음.
 *  - 한쪽이 비어 있음(자식이 전부 반대편) → 정상 동작.
 *  - 접힌 노드 → 자손 제외, 노드는 hasChildren=true/collapsed=true로 표시.
 */
export function layoutMindmap(
  allNodes: MindNode[],
  rootId: string,
): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const rootNode = byId.get(rootId);

  if (!rootNode) {
    return { nodes: [], edges: [], positions };
  }

  const byParent = indexChildren(allNodes);

  // 1) 접힘 경계까지 보이는 노드 집합.
  const visible = collectVisible(rootId, byParent, byId);
  const visibleIds = new Set(visible.map((n) => n.id));

  // 2) 루트 직계 자식을 좌/우 균형 분할.
  const { left, right } = partitionSides(rootId, byParent, visibleIds);

  // 3) 각 측을 독립 d3 tree로 레이아웃하고 좌표 병합(루트=원점).
  //    d3 tree: hpNode.x = 형제축(수직), hpNode.y = 깊이축(수평).
  //    화면축 매핑: screenX = ±hpNode.y, screenY = hpNode.x.
  positions.set(rootId, { x: 0, y: 0 });

  if (right.length > 0) {
    const subset = collectSideSubset(rootNode, right, byParent, visibleIds);
    const laid = layoutSide(subset, rootId);
    const rootHX = laid.x; // 루트를 y=0에 맞추기 위한 오프셋.
    laid.each((hp) => {
      const h = hp as HierarchyNode<Strat> & { x: number; y: number };
      if (h.data.id === rootId) return;
      positions.set(h.data.id, { x: h.y, y: h.x - rootHX });
    });
  }

  if (left.length > 0) {
    const subset = collectSideSubset(rootNode, left, byParent, visibleIds);
    const laid = layoutSide(subset, rootId);
    const rootHX = laid.x;
    laid.each((hp) => {
      const h = hp as HierarchyNode<Strat> & { x: number; y: number };
      if (h.data.id === rootId) return;
      // x를 음수로 미러링 → 왼쪽으로 확장.
      positions.set(h.data.id, { x: -h.y, y: h.x - rootHX });
    });
  }

  // 4) 각 노드의 side 결정(핸들/엣지 방향용).
  const sideOf = new Map<string, "left" | "right" | "root">();
  sideOf.set(rootId, "root");
  const assignSide = (roots: MindNode[], side: "left" | "right") => {
    const stack = [...roots];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id) || !visibleIds.has(cur.id)) continue;
      seen.add(cur.id);
      sideOf.set(cur.id, side);
      if (cur.collapsed) continue;
      for (const k of byParent.get(cur.id) ?? []) stack.push(k);
    }
  };
  assignSide(left, "left");
  assignSide(right, "right");

  // 5) React Flow 노드 빌드.
  const nodes: TopicNode[] = visible.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const isRoot = n.id === rootId;
    const side = sideOf.get(n.id) ?? "right";
    const rawChildren = byParent.get(n.id) ?? [];
    const hasChildren = rawChildren.length > 0;
    const visibleChildCount = n.collapsed
      ? 0
      : rawChildren.filter((c) => visibleIds.has(c.id)).length;

    // 핸들 방향: 오른쪽 가지는 target=왼쪽/source=오른쪽, 왼쪽 가지는 반대.
    // 루트는 양방향으로 엣지를 내보내야 하므로 커스텀 노드에서 양쪽 핸들 렌더.
    const sourcePosition =
      side === "left" ? Position.Left : Position.Right;
    const targetPosition =
      side === "left" ? Position.Right : Position.Left;

    return {
      id: n.id,
      type: "topic",
      position: pos,
      data: {
        title: n.title,
        side,
        hasChildren,
        collapsed: n.collapsed,
        isRoot,
        childCount: visibleChildCount,
      },
      // 노드 중심을 좌표에 맞춤(루트 센터링/엣지 정렬 안정).
      origin: [0.5, 0.5],
      sourcePosition,
      targetPosition,
      draggable: !isRoot ? true : false,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    } satisfies TopicNode;
  });

  // 6) 엣지 빌드 — 보이는 부모→자식만.
  const edges: RFEdge[] = [];
  for (const n of visible) {
    if (n.parentId == null) continue;
    if (!visibleIds.has(n.parentId)) continue;
    const side = sideOf.get(n.id) ?? "right";
    edges.push({
      id: `e-${n.parentId}-${n.id}`,
      source: n.parentId,
      target: n.id,
      // 루트는 양쪽 핸들을 가지므로 어느 측 핸들에서 나가는지 지정.
      sourceHandle: n.parentId === rootId ? side : undefined,
      type: "default", // bezier
    });
  }

  return { nodes, edges, positions };
}
