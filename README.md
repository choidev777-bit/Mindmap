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

- [x] **1주** URL 기반 맵 생성/열기/이름변경/삭제 · 링크 공유 · 빈 캔버스 ← **현재**
- [ ] **2주** React Flow 커스텀 노드 · 노드 CRUD(Tab/Enter) · d3 자동 레이아웃 · 접기
- [ ] **3주** Yjs 데이터 모델 · Y.Map ↔ React Flow 동기화 어댑터
- [ ] **4주** Liveblocks 실시간 · 커서/아바타 · Postgres 스냅샷 영속화
- [ ] **5주** 마커/아이콘 · 노드 노트 · 아웃라인 뷰
- [ ] **6주** 내보내기(PNG/Markdown) · 다듬기 · 출시

## 로컬 실행

### 1. Supabase 준비

1. [supabase.com](https://supabase.com) 프로젝트 생성.
2. **SQL Editor** 에 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여넣고 실행.
   (이전 인증 기반 스키마를 자동으로 정리하고 새 스키마로 교체합니다.)

### 2. 환경 변수

```bash
cp .env.local.example .env.local   # 그 뒤 Supabase URL / anon 키 입력
```

> 이 모델은 **anon 키만** 쓴다. service_role 같은 비밀 키는 필요 없다.
> 사용자 로그인 토큰을 쓰지 않으므로 JWT 서명 키(ES256/HS256) 이슈와도 무관하다.

### 3. 개발 서버

```bash
npm install
npm run dev
# http://localhost:3000
```

## 현재 동작 (Week 1)

- 홈에서 **새 마인드맵 만들기** → `/map/<id>` 로 이동
- 맵 헤더의 **🔗 링크로 초대** 버튼으로 URL 복사 → 친구에게 전달 → 친구도 바로 접속
- 맵 **이름변경 / 삭제**(RPC), **최근 맵** 목록(브라우저 저장)
- React Flow 빈 캔버스(중심 토픽 1개)

> 노드 편집·실시간 협업은 Week 2 이후 추가됩니다.
