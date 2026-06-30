"use client";

import { useEffect } from "react";

type Recent = { id: string; title: string; at: number };

/** 방문한 맵을 브라우저 localStorage의 "최근 맵" 목록에 기록(계정 대용). */
export function RecordVisit({ id, title }: { id: string; title: string }) {
  useEffect(() => {
    try {
      const raw = localStorage.getItem("recentMaps");
      const list: Recent[] = raw ? JSON.parse(raw) : [];
      const next = [
        { id, title, at: Date.now() },
        ...list.filter((r) => r.id !== id),
      ].slice(0, 12);
      localStorage.setItem("recentMaps", JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [id, title]);

  return null;
}
