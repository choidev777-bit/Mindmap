"use client";

/**
 * 헤더에 표시하는 접속자 아바타 (실시간 협업).
 * useSelf/useOthers 로 현재 룸 참여자를 색상 원형 + 이니셜로 보여준다.
 * info(name/color)는 인증 토큰의 userInfo(UserMeta)에서 온다.
 */

import { useOthers, useSelf } from "@liveblocks/react";

const MAX = 4;

function initial(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0]!.toUpperCase() : "?";
}

function Avatar({
  name,
  color,
  you = false,
}: {
  name: string;
  color: string;
  you?: boolean;
}) {
  return (
    <div
      title={you ? `${name} (나)` : name}
      className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white dark:ring-zinc-900"
      style={{ backgroundColor: color }}
    >
      {initial(name)}
    </div>
  );
}

export function Avatars() {
  const others = useOthers();
  const self = useSelf();

  const shown = others.slice(0, MAX);
  const overflow = others.length - shown.length;

  return (
    <div className="flex items-center">
      <div className="flex items-center -space-x-2">
        {shown.map(({ connectionId, info }) => (
          <Avatar
            key={connectionId}
            name={info?.name ?? "익명"}
            color={info?.color ?? "#94a3b8"}
          />
        ))}
        {self && (
          <Avatar
            name={self.info?.name ?? "익명"}
            color={self.info?.color ?? "#94a3b8"}
            you
          />
        )}
      </div>
      {overflow > 0 && (
        <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
          +{overflow}
        </span>
      )}
    </div>
  );
}
