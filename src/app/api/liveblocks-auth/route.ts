/**
 * Liveblocks 인증 라우트 (access token 방식).
 *
 * 보안 모델: room id(= 마인드맵 id, 추측 불가한 uuid)를 아는 사람에게 그 룸의 full access 를
 *   부여한다 → 기존 "URL = 열쇠(capability)" 모델과 정확히 일치(로그인 없음).
 * 시크릿 키는 서버에서만 사용하고 클라이언트에 노출하지 않는다.
 *
 * 본문: { room, id, name, color } — 클라이언트(MapRoom)가 localStorage 신원을 실어 보낸다.
 *   신원은 토큰 userInfo 로 박혀 아바타/커서 라벨(UserMeta.info)에 쓰인다.
 */
import { Liveblocks } from "@liveblocks/node";

const secret = process.env.LIVEBLOCKS_SECRET_KEY;

export async function POST(request: Request) {
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "LIVEBLOCKS_SECRET_KEY 가 설정되지 않았습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: { room?: string; id?: string; name?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const { room, id, name, color } = body;
  if (!room || !id) {
    return new Response("room/id 가 필요합니다.", { status: 400 });
  }

  const liveblocks = new Liveblocks({ secret });

  const session = liveblocks.prepareSession(id, {
    userInfo: {
      name: name?.trim() || "익명",
      color: color || "#94a3b8",
    },
  });

  // room id 를 아는 것 자체가 권한 → 해당 룸에 한해 full access.
  session.allow(room, session.FULL_ACCESS);

  const { status, body: authBody } = await session.authorize();
  return new Response(authBody, { status });
}
