"use client";

import { useState } from "react";

/** 현재 맵 URL을 클립보드에 복사 — 이 링크가 곧 초대장이다. */
export function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // 클립보드 권한이 없으면 주소창 URL을 그대로 안내
      window.prompt("이 링크를 복사해 친구에게 보내세요:", window.location.href);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={copy}
      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {copied ? "✓ 링크 복사됨" : "🔗 링크로 초대"}
    </button>
  );
}
