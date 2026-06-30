/**
 * 로그인 없는 사용자 신원 (실시간 협업 커서/아바타용).
 *
 * 계정이 없으므로 브라우저 localStorage 에 { id, name, color } 를 저장해 신원 대용으로 쓴다.
 * - id: 안정적 사용자 식별자(브라우저별). presence/awareness 의 user key.
 * - name: 첫 접속 시 입력받는 표시 이름.
 * - color: 아바타/커서 색(이름 입력 시 팔레트에서 무작위 1개 고정).
 *
 * 모두 클라이언트 전용("use client" 컴포넌트에서만 호출).
 */

export interface Identity {
  id: string;
  name: string;
  color: string;
}

const KEY = "mm:identity";

/** 아바타/커서용 색 팔레트(가독성 좋은 진한 톤). */
export const AVATAR_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // amber
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

function randomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

/** 저장된 신원을 읽는다. 없거나 손상됐으면 null. (SSR 안전) */
export function getIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Identity>;
    if (v && typeof v.id === "string" && typeof v.name === "string") {
      return { id: v.id, name: v.name, color: v.color || randomColor() };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 이름을 받아 신원을 생성/갱신해 저장하고 반환한다.
 * id/color 는 최초 1회 생성 후 유지(재입력해도 같은 사람으로 보이게).
 */
export function saveIdentity(name: string): Identity {
  const prev = getIdentity();
  const identity: Identity = {
    id: prev?.id ?? crypto.randomUUID(),
    name: name.trim() || "익명",
    color: prev?.color ?? randomColor(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* ignore (프라이빗 모드 등) */
  }
  return identity;
}
