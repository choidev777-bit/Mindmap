/**
 * Yjs 바인딩 레이어 (실시간 협업).
 *
 * 진실의 원천(실시간)은 Liveblocks 룸의 Y.Doc 안 Y.Map<id, MindNode> 이다.
 *  - key   = 노드 id
 *  - value = 평면 MindNode 객체(JSON). 노드 단위로 통째 set/delete 한다.
 *
 * 충돌 입도: 노드 단위. 서로 다른 노드 동시 편집은 자동 병합되고,
 *   같은 노드 동시 편집은 노드 단위 last-writer-wins 이다(마인드맵에선 드문 충돌, v1 허용).
 *
 * 이 모듈은 순수 Yjs 헬퍼만 제공한다. store(mindmap-store.ts)가 이 헬퍼로
 *  - 읽기: Y.Map → 미러 record (readNodes)
 *  - 쓰기: 액션이 doc.transact 안에서 set/delete
 *  - 시드: 최초 1회 seedIfEmpty
 * 를 수행한다.
 */

import * as Y from "yjs";
import type { MindNode } from "@/lib/types";

/** 문서 노드 맵의 Yjs 컨테이너 타입. */
export type NodesMap = Y.Map<MindNode>;

/** Y.Doc 에서 노드 맵을 얻는다(없으면 생성). 이름은 모든 클라이언트가 동일해야 함. */
export function getNodesMap(doc: Y.Doc): NodesMap {
  return doc.getMap<MindNode>("nodes");
}

/**
 * Y.Map → 정규화 record(미러).
 * Yjs 내부 값을 직접 들고 있지 않도록 노드를 얕은 복사한다(렌더 불변성).
 */
export function readNodes(ymap: NodesMap): Record<string, MindNode> {
  const rec: Record<string, MindNode> = {};
  ymap.forEach((node, id) => {
    rec[id] = { ...node };
  });
  return rec;
}

/**
 * 빈 문서를 최초 1회 시드한다(sync 완료 후 호출).
 *  - 이미 노드가 있으면(다른 클라이언트가 먼저 만든 경우) 아무것도 하지 않는다.
 *  - initialNodes(서버가 내려준 기존 평면 노드)가 있으면 그대로 복원.
 *  - 비어 있으면 단일 루트를 시드하되 root id = mapId 로 고정한다.
 *    → 두 사용자가 동시에 새 맵을 열어도 같은 key 라 루트가 1개로 수렴(중복 루트 방지).
 *
 * 모든 set 을 하나의 트랜잭션으로 묶어 한 번에 전파/관찰되게 한다.
 */
export function seedIfEmpty(
  ymap: NodesMap,
  initialNodes: MindNode[] | null,
  mapId: string,
  title: string,
): void {
  const doc = ymap.doc;
  if (!doc) return;
  if (ymap.size > 0) return;

  doc.transact(() => {
    if (ymap.size > 0) return; // 트랜잭션 직전 재확인(경쟁 가드)
    if (initialNodes && initialNodes.length > 0) {
      for (const n of initialNodes) ymap.set(n.id, n);
    } else {
      const root: MindNode = {
        id: mapId, // 결정적 root id → 동시 시드 수렴
        title: title.trim() || "Central Topic",
        parentId: null,
        order: 0,
        markers: [],
        note: "",
        collapsed: false,
      };
      ymap.set(root.id, root);
    }
  });
}
