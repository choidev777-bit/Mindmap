"use client";

/**
 * 디바운스 자동저장 훅 (Week 2).
 *
 * flat MindNode[] 를 ~800ms 디바운스로 save_map_nodes RPC 에 저장한다.
 * - last-write-wins: 클라이언트가 보낸 배열이 항상 서버 nodes 를 덮어쓴다.
 * - anon 키 db 클라이언트로 브라우저에서 직접 호출(서버 액션 불필요 — RPC 가 anon 에 grant 됨).
 * - 절대 x,y 를 직렬화하지 않는다. MindNode 필드만 화이트리스트로 직렬화.
 * - schedule(nodes): 구조 변경 시마다 호출. flush(): 즉시 저장(언마운트/탭 종료용).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/supabase/db";
import type { MindNode } from "@/lib/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutosaveOptions {
  mapId: string;
  /** 서버가 알려준 마지막 updated_at (참고용). */
  initialUpdatedAt?: string | null;
  /** 디바운스(ms). 기본 800. */
  delay?: number;
}

interface UseAutosaveResult {
  status: SaveStatus;
  /** 마지막으로 서버가 확정한 updated_at (ISO). */
  updatedAt: string | null;
  /** 구조 변경 시 호출 — 최신 nodes 스냅샷을 넘긴다. */
  schedule: (nodes: MindNode[]) => void;
  /** 디바운스 무시하고 즉시 저장. */
  flush: () => void;
}

/** MindNode 외 필드(파생 좌표 등)가 끼어들지 않도록 화이트리스트 직렬화. */
function clean(nodes: MindNode[]): MindNode[] {
  return nodes.map((n) => ({
    id: n.id,
    title: n.title,
    parentId: n.parentId,
    order: n.order,
    markers: n.markers,
    note: n.note,
    collapsed: n.collapsed,
    ...(n.side ? { side: n.side } : {}),
  }));
}

export function useAutosave({
  mapId,
  initialUpdatedAt,
  delay = 800,
}: UseAutosaveOptions): UseAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [updatedAt, setUpdatedAt] = useState<string | null>(
    initialUpdatedAt ?? null,
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<MindNode[] | null>(null);
  const inflight = useRef(false);
  // doSave 자기 참조(진행 중 누적분 재전송)를 ref 로 우회.
  const doSaveRef = useRef<() => Promise<void>>(async () => {});

  const doSave = useCallback(async () => {
    if (inflight.current) return; // 진행 중이면 끝난 뒤 다시 트리거됨
    const snapshot = pending.current;
    if (!snapshot || snapshot.length === 0) return; // 빈 배열은 저장 금지(루트 1개 보장)
    pending.current = null;
    inflight.current = true;
    setStatus("saving");

    const { data, error } = await db.rpc("save_map_nodes", {
      p_id: mapId,
      p_nodes: clean(snapshot), // jsonb — supabase-js 가 인코딩. stringify 금지.
    });

    inflight.current = false;

    if (error || !data) {
      setStatus("error");
      // 실패분을 잃지 않도록 되돌려 넣는다(다음 schedule/flush 에서 재시도).
      if (!pending.current) pending.current = snapshot;
      return;
    }

    setUpdatedAt(data as string); // 스칼라 timestamptz
    setStatus(pending.current ? "saving" : "saved");

    // 진행 중 동안 새 변경이 쌓였으면 즉시 한 번 더.
    if (pending.current) void doSaveRef.current();
  }, [mapId]);

  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  const schedule = useCallback(
    (nodes: MindNode[]) => {
      if (nodes.length === 0) return; // 안전장치: 빈 맵 저장 금지
      pending.current = nodes;
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void doSave(), delay);
    },
    [doSave, delay],
  );

  // flush: 언로드/탭 숨김에도 살아남도록 keepalive fetch 로 직접 전송한다.
  // (supabase-js 클라이언트 요청은 페이지 언로드 시 브라우저가 취소할 수 있음.)
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const snapshot = pending.current;
    if (!snapshot || snapshot.length === 0) return;
    pending.current = null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;
    try {
      void fetch(`${url}/rest/v1/rpc/save_map_nodes`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_id: mapId, p_nodes: clean(snapshot) }),
      });
    } catch {
      /* best-effort: 언로드 경로라 실패해도 무시 */
    }
  }, [mapId]);

  // 언마운트 시 대기 중 변경 즉시 저장 시도.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void doSave();
    };
  }, [doSave]);

  return { status, updatedAt, schedule, flush };
}
