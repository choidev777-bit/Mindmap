"use client";

/**
 * 원격 사용자 커서 (실시간 협업).
 *
 * presence.cursor 는 **flow 좌표**(노드 좌표계)로 저장된다([MindmapCanvas] 의 pointer 핸들러).
 * React Flow 의 <ViewportPortal> 안에 렌더하면 팬/줌 변환이 자동 적용되어,
 * 각 사용자의 화면 줌/위치와 무관하게 같은 맵 지점에 커서가 정렬된다.
 */

import { useOthers } from "@liveblocks/react";
import { ViewportPortal } from "@xyflow/react";

function CursorSvg({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M2 2 L2 14 L6 10.5 L8.5 16 L11 15 L8.5 9.5 L14 9.5 Z"
        fill={color}
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Cursors() {
  const others = useOthers();

  return (
    <ViewportPortal>
      {others.map(({ connectionId, presence, info }) => {
        const cursor = presence.cursor;
        if (!cursor) return null;
        const color = info?.color ?? "#94a3b8";
        return (
          <div
            key={connectionId}
            className="pointer-events-none absolute left-0 top-0 z-50 select-none"
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
          >
            <CursorSvg color={color} />
            <span
              className="ml-3 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
              style={{ backgroundColor: color }}
            >
              {info?.name ?? "익명"}
            </span>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
