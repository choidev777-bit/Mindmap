"use client";

/**
 * 커스텀 토픽 노드 (Week 2).
 *
 * - data 페이로드는 src/lib/layout.ts 의 TopicNodeData 와 동일 계약을 따른다.
 * - 좌/우 가지에 맞춰 source/target Handle 을 렌더한다.
 *   · 루트는 양쪽으로 가지를 뻗으므로 source Handle 을 좌(id="left")/우(id="right") 둘 다 둔다.
 *     (layout 이 루트→자식 엣지에 sourceHandle: "left"|"right" 를 지정하기 때문에 id 가 일치해야 함)
 *   · 비루트는 한쪽 source + 반대쪽 target Handle 하나씩(id 없음 = 기본 핸들).
 * - 인라인 편집: 편집 상태(editing)에서 input 을 띄우고 'nodrag nopan' + stopPropagation 으로
 *   캔버스 드래그/팬/전역 단축키가 발동하지 않게 한다. Enter=커밋, Escape=취소, blur=커밋.
 * - 자식이 있으면(collapse 가능) 접기/펼치기 토글 버튼 노출.
 *
 * 좌표(x,y)는 이 컴포넌트에서 다루지 않는다 — 전적으로 layout 의 파생값.
 */

import { memo, useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TopicNode as TopicNodeType } from "@/lib/layout";

/**
 * MindmapCanvas 가 nodeTypes 로 등록할 때 노드 콜백들을 주입하기 위한 컨텍스트.
 * (data 에 함수를 넣으면 매 렌더마다 identity 가 바뀌어 노드가 재생성되므로,
 *  콜백은 data 가 아닌 모듈 레벨 ref 를 통해 전달한다.)
 */
export interface TopicNodeCallbacks {
  onToggleCollapse: (id: string) => void;
  onCommitTitle: (id: string, title: string) => void;
  onCancelEdit: () => void;
}

/**
 * 콜백 전달용 가변 컨테이너. MindmapCanvas 가 effect 에서 최신값으로 갱신한다.
 * (편집 상태 editing 은 콜백이 아니라 노드 data.editing 으로 전달된다.)
 */
export const topicCallbacks: TopicNodeCallbacks = {
  onToggleCollapse: () => {},
  onCommitTitle: () => {},
  onCancelEdit: () => {},
};

function TopicNodeImpl({ id, data, selected }: NodeProps<TopicNodeType>) {
  const { title, side, hasChildren, collapsed, isRoot } = data;
  const editing = data.editing === true;

  // 비제어(uncontrolled) input — editing 진입마다 key 로 remount 되어 defaultValue 가 초기화된다.
  // (제어 컴포넌트 + effect-setState 의 cascading-render 안티패턴을 피한다.)
  const inputRef = useRef<HTMLInputElement>(null);

  // 편집 진입 시 포커스/전체선택.
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const commit = () =>
    topicCallbacks.onCommitTitle(id, inputRef.current?.value ?? title);

  // 좌/우 가지에 따른 핸들 위치.
  const sourcePos = side === "left" ? Position.Left : Position.Right;
  const targetPos = side === "left" ? Position.Right : Position.Left;

  return (
    <div
      style={{ maxWidth: 320 }}
      className={[
        "group relative inline-flex min-w-[84px] items-center gap-1.5 rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors",
        isRoot
          ? "bg-blue-600 font-semibold text-white"
          : "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
        selected
          ? "border-blue-500 ring-2 ring-blue-400/50"
          : isRoot
            ? "border-blue-600"
            : "border-zinc-300 dark:border-zinc-700",
      ].join(" ")}
    >
      {/* ── Handles ──────────────────────────────────────────── */}
      {isRoot ? (
        <>
          {/* 루트는 양쪽으로 가지를 뻗는다. id 는 layout 의 sourceHandle 과 일치. */}
          <Handle
            id="left"
            type="source"
            position={Position.Left}
            isConnectable={false}
            className="!h-2 !w-2 !border-0 !bg-blue-300"
          />
          <Handle
            id="right"
            type="source"
            position={Position.Right}
            isConnectable={false}
            className="!h-2 !w-2 !border-0 !bg-blue-300"
          />
          {/* 루트는 부모가 없으므로 target 은 형식상만(연결 안 됨). */}
          <Handle
            type="target"
            position={Position.Top}
            isConnectable={false}
            className="!opacity-0"
          />
        </>
      ) : (
        <>
          <Handle
            type="target"
            position={targetPos}
            isConnectable={false}
            className="!h-2 !w-2 !border-0 !bg-zinc-400"
          />
          <Handle
            type="source"
            position={sourcePos}
            isConnectable={false}
            className="!h-2 !w-2 !border-0 !bg-zinc-400"
          />
        </>
      )}

      {/* ── 본문 ─────────────────────────────────────────────── */}
      {editing ? (
        <input
          key={`edit-${id}`}
          ref={inputRef}
          defaultValue={title}
          // React Flow 의 드래그/팬/전역 키 처리를 막는다.
          className="nodrag nopan w-[200px] max-w-[260px] bg-transparent outline-none placeholder:text-zinc-400"
          placeholder="토픽 입력…"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation(); // 캔버스 단축키 발동 금지
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              topicCallbacks.onCancelEdit();
            }
          }}
          onBlur={commit}
        />
      ) : (
        <span className="min-w-0 whitespace-normal break-words">
          {title || (
            <span className={isRoot ? "text-blue-200" : "text-zinc-400"}>
              제목 없음
            </span>
          )}
        </span>
      )}

      {/* ── 접기/펼치기 토글 (자식이 있을 때만) ───────────────── */}
      {hasChildren && (
        <button
          type="button"
          className={[
            "nodrag nopan grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs leading-none transition-colors",
            isRoot
              ? "border-blue-300 text-blue-100 hover:bg-blue-500"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800",
          ].join(" ")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            topicCallbacks.onToggleCollapse(id);
          }}
          title={collapsed ? "펼치기" : "접기"}
          aria-label={collapsed ? "펼치기" : "접기"}
        >
          {collapsed ? "+" : "−"}
        </button>
      )}
    </div>
  );
}

export const TopicNode = memo(TopicNodeImpl);
