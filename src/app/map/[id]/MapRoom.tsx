"use client";

/**
 * Liveblocks 룸 래퍼 (실시간 협업).
 *
 * 헤더 아바타와 캔버스를 **하나의 RoomProvider** 안에 두기 위해 page 의 헤더+캔버스를
 * children 으로 감싼다(React context 는 children 경계를 넘어 흐른다).
 *
 * 흐름:
 *  1) localStorage 신원([identity.ts]) 확인.
 *  2) 이름이 없으면 NamePrompt 로 먼저 받는다(연결 전에 신원 확정 → 토큰 userInfo 고정).
 *  3) 신원이 있으면 LiveblocksProvider(authEndpoint 함수형 — 신원을 본문에 실어 보냄)
 *     + RoomProvider(id = mapId) 로 children 을 감싼다.
 */

import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import { useEffect, useState, type ReactNode } from "react";
import { getIdentity, saveIdentity, type Identity } from "@/lib/identity";
import { NamePrompt } from "./NamePrompt";

export function MapRoom({
  mapId,
  children,
}: {
  mapId: string;
  children: ReactNode;
}) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);

  // 신원은 클라이언트 전용 → 마운트 후 읽어 하이드레이션 불일치를 피한다.
  useEffect(() => {
    setIdentity(getIdentity());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!identity) {
    return <NamePrompt onSubmit={(name) => setIdentity(saveIdentity(name))} />;
  }

  return (
    <LiveblocksProvider
      authEndpoint={async (room) => {
        const res = await fetch("/api/liveblocks-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, ...identity }),
        });
        if (!res.ok) throw new Error("Liveblocks 인증 실패");
        return await res.json();
      }}
    >
      <RoomProvider id={mapId} initialPresence={{ cursor: null }}>
        {children}
      </RoomProvider>
    </LiveblocksProvider>
  );
}
