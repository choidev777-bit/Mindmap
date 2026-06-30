"use client";

import { useMindmap } from "@/lib/store/mindmap-store";

/**
 * 헤더의 맵 제목.
 * 중심 토픽(루트 노드) 제목을 실시간으로 반영한다(스토어 구독).
 * 스토어가 아직 로드되기 전엔 서버가 내려준 initialTitle 을 보여준다.
 */
export function MapTitle({ initialTitle }: { initialTitle: string }) {
  const rootTitle = useMindmap((s) =>
    s.rootId ? s.nodes[s.rootId]?.title : undefined,
  );
  const title =
    (rootTitle && rootTitle.trim()) || initialTitle || "제목 없는 마인드맵";
  return <h1 className="truncate text-sm font-medium">{title}</h1>;
}
