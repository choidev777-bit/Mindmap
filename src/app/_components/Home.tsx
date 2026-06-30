"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createMap } from "../actions";

type Recent = { id: string; title: string; at: number };

export function Home() {
  const [recent, setRecent] = useState<Recent[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("recentMaps");
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  function removeRecent(id: string) {
    const next = recent.filter((r) => r.id !== id);
    setRecent(next);
    localStorage.setItem("recentMaps", JSON.stringify(next));
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">collab-mindmap</h1>
      <p className="mt-2 text-zinc-500">
        링크 하나로 함께 편집하는 마인드맵. 로그인 없이 바로 시작하세요.
      </p>

      <form action={createMap} className="mt-8" onSubmit={() => setCreating(true)}>
        <button
          type="submit"
          disabled={creating}
          className="rounded-xl bg-zinc-900 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {creating ? "만드는 중..." : "+ 새 마인드맵 만들기"}
        </button>
      </form>

      <section className="mt-12">
        <h2 className="text-sm font-medium text-zinc-400">최근 작업한 맵</h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">
            아직 없어요. 위 버튼으로 첫 맵을 만들어 보세요. (이 목록은 이
            브라우저에만 저장됩니다.)
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <Link
                  href={`/map/${r.id}`}
                  className="flex-1 truncate text-sm font-medium hover:underline"
                >
                  {r.title || "제목 없는 마인드맵"}
                </Link>
                <span className="text-xs text-zinc-400">
                  {new Date(r.at).toLocaleDateString("ko-KR")}
                </span>
                <button
                  onClick={() => removeRecent(r.id)}
                  className="text-xs text-zinc-400 hover:text-red-500"
                  title="목록에서 제거(맵은 삭제되지 않음)"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
