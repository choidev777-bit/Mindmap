"use client";

/**
 * 첫 접속 시 표시 이름을 받는 모달.
 * 로그인이 없으므로 이름+색을 localStorage 신원으로 저장해 커서/아바타에 쓴다([identity.ts]).
 * 이름이 정해지기 전엔 룸에 연결하지 않는다(MapRoom 이 게이트) — 토큰 userInfo 를
 * 연결 후 바꾸는 복잡함을 피한다.
 */

import { useState } from "react";

export function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-white/70 p-4 backdrop-blur dark:bg-zinc-950/70">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          함께 작업할 이름을 정해주세요
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          다른 참여자에게 커서와 아바타로 표시됩니다.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          placeholder="예: 정수"
          className="mt-4 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-400/40 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          시작하기
        </button>
      </form>
    </div>
  );
}
