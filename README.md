# collab-mindmap

XMind 스타일 **실시간 협업 마인드맵** — **링크만 있으면 누구나** 들어와 함께 편집하는 웹앱. (로그인 없음)

## 접근 모델

- 로그인/계정 없음. 누구나 마인드맵을 만들 수 있다.
- 맵을 만들면 `/map/<무작위 uuid>` URL이 생긴다. **이 URL이 곧 열쇠**(capability) — 추측이 불가능하다.
- URL을 받은 사람은 로그인 없이 바로 보고 편집한다.
- 내가 만든/방문한 맵은 브라우저 `localStorage`의 "최근 맵"에 기록된다(계정 대용).
- 모든 DB 접근은 `SECURITY DEFINER` 함수(RPC)로만 → id를 모르면 목록 열거조차 불가.

## 스택

| 레이어 | 기술 |
| --- | --- |
| 프론트 | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 |
| 캔버스 | React Flow (`@xyflow/react`) + d3-hierarchy 자동 레이아웃 |
| 실시간 | Yjs + Liveblocks *(Week 4~)* |
| DB | Supabase (Postgres). 접근은 anon 키 + RPC 함수만 |
| 배포 | Vercel + Supabase (운영 서버 0개) |

## 로드맵 (6주)

- [x] **1주** URL 기반 맵 생성/열기/이름변경/삭제 · 링크 공유 · 빈 캔버스
- [x] **2주** React Flow 커스텀 노드 · 노드 CRUD(Tab/Enter) · d3 자동 레이아웃 · 접기
- [x] **3주** Yjs 데이터 모델(Y.Map) · store write-through 어댑터
- [x] **4주** Liveblocks 실시간 동시 편집 · 커서/아바타 · Supabase 스냅샷 미러 ← **현재**
- [ ] **5주** 마커/아이콘 · 노드 노트 · 아웃라인 뷰
- [ ] **6주** 내보내기(PNG/Markdown) · 다듬기 · 출시

## 로컬 실행

### 1. Supabase 준비

1. [supabase.com](https://supabase.com) 프로젝트 생성.
2. **SQL Editor** 에 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여넣고 실행.
   (이전 인증 기반 스키마를 자동으로 정리하고 새 스키마로 교체합니다.)

### 2. 환경 변수

```bash
cp .env.local.example .env.local   # 그 뒤 값 입력
```

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/publishable 키).
- **Liveblocks**(실시간 협업): [liveblocks.io](https://liveblocks.io) 프로젝트 → API keys 의 **Secret key**(`sk_...`)를 `LIVEBLOCKS_SECRET_KEY` 에 입력.
  - 시크릿 키는 `/api/liveblocks-auth` 라우트(서버)에서만 쓰이고 클라이언트에 노출되지 않는다.
  - 인증은 "room id(=맵 id)를 아는 사람에게 그 룸 full access" → 기존 **URL=열쇠** 모델과 동일. 로그인은 여전히 없다.

> Supabase 는 **anon 키만**, Liveblocks 는 서버 전용 시크릿 키만 쓴다.
> 사용자 로그인 토큰을 쓰지 않으므로 JWT 서명 키(ES256/HS256) 이슈와도 무관하다.

### 3. 개발 서버

```bash
npm install
npm run dev
# http://localhost:3000
```

## 현재 동작 (Week 4)

- 홈에서 **새 마인드맵 만들기** → `/map/<id>` 로 이동
- 맵 헤더의 **🔗 링크로 초대** 버튼으로 URL 복사 → 친구에게 전달 → 친구도 바로 접속
- **노드 편집**: Tab=자식 / Enter=형제 / F2=이름변경 / Delete=삭제, 드래그로 재부모화·좌/우 전환, 접기
- **실시간 동시 편집(구글 Docs 식)**: 같은 링크를 연 사람들이 같은 마인드맵을 동시에 편집
  - 변경이 즉시 서로에게 반영(Yjs CRDT — 마지막 저장자가 덮어쓰지 않음)
  - 참여자 **커서**가 캔버스에 보이고, 헤더에 **아바타** 표시
  - 첫 접속 시 **표시 이름** 입력(브라우저에 저장, 재방문 시 생략)
- **영속화**: Liveblocks 가 실시간 원천, 변경분을 Supabase(`documents.nodes`)에 디바운스 미러 저장 → 새로고침/재접속 시 복원

### 동작 원리(요약)

- 진실의 원천(실시간) = Liveblocks 룸의 `Y.Doc` 안 `Y.Map<id, MindNode>` (룸 id = 맵 id)
- zustand store 는 그 **로컬 미러**, 좌표(x,y)는 `layout.ts` 가 파생 계산(동기화 대상 아님)
- 구조 변경은 store 액션이 `doc.transact` 로 Y.Map 에 기록 → 모든 클라이언트로 전파
