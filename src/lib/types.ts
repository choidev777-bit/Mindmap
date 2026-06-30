/** DB / 도메인 타입 */

export interface DocumentRow {
  id: string;
  title: string;
  /** Yjs 스냅샷 (Week 4에서 채워짐) */
  ydoc_snapshot: string | null;
  /** 아웃라인/검색/내보내기용 직렬화 트리 (Week 4~6) */
  outline_json: OutlineNode | null;
  created_at: string;
  updated_at: string;
}

/** get_map RPC가 돌려주는 최소 정보 */
export interface MapMeta {
  id: string;
  title: string;
  updated_at: string;
}

/** get_map_full RPC 반환행 (메타 + 평면 노드). nodes 가 null 이면 빈 맵. */
export interface MapFull {
  id: string;
  title: string;
  nodes: MindNode[] | null;
  updated_at: string;
}

/**
 * 마인드맵 토픽 노드.
 * 핵심 설계: 트리 구조(parentId, order)만 진실의 원천으로 저장한다.
 * 화면 좌표(x,y)는 d3-hierarchy로 클라이언트가 결정적으로 계산하는 파생값이므로
 * 이 타입에는 포함하지 않는다. (Week 3에서 Yjs Y.Map<string, MindNode>로 옮겨짐)
 */
export interface MindNode {
  id: string;
  title: string;
  parentId: string | null;
  /** 형제 정렬키 (프랙셔널 인덱싱 권장) */
  order: number;
  markers: string[];
  note: string;
  collapsed: boolean;
  /** 중심 토픽 기준 좌/우 가지 (자동 레이아웃용, optional) */
  side?: "left" | "right";
}

/** 내보내기/아웃라인용 중첩 트리 표현 */
export interface OutlineNode {
  id: string;
  title: string;
  note?: string;
  markers?: string[];
  children: OutlineNode[];
}
