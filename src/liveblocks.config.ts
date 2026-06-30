/**
 * Liveblocks 전역 타입 (Week 4 / 실시간 협업).
 *
 * 선언 병합으로 Presence / UserMeta 타입을 지정한다.
 * - Presence: 사용자별 라이브 상태. 여기선 마인드맵 캔버스의 커서 위치(flow 좌표).
 * - UserMeta: 인증 토큰(userInfo)에 실려 오는 불변 신원 — 아바타/커서 라벨에 쓰임.
 *
 * Storage 는 쓰지 않는다(문서 상태는 Yjs Y.Doc 가 담당).
 */
declare global {
  interface Liveblocks {
    /** 사용자별 라이브 상태 — 커서는 React Flow 의 flow 좌표(팬/줌 무관). */
    Presence: {
      cursor: { x: number; y: number } | null;
    };
    /** 인증 라우트가 토큰에 심는 불변 신원. */
    UserMeta: {
      id: string;
      info: {
        name: string;
        color: string;
      };
    };
  }
}

export {};
