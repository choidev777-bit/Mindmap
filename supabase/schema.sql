-- =============================================================
--  collab-mindmap : URL 기반(로그인 없음) 스키마
--  누구나 마인드맵 URL(추측 불가한 id)만 알면 보고 편집할 수 있다.
--  모든 접근은 SECURITY DEFINER 함수(RPC)로만 → 테이블 직접 열람/열거 불가.
--  ⚠️ Supabase SQL Editor 에 통째로 다시 붙여넣어 실행하세요 (이전 스키마를 대체).
-- =============================================================

-- 0) 이전(인증 기반) 스키마 정리
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.handle_new_document() cascade;
drop function if exists public.is_document_owner(uuid, uuid) cascade;
drop function if exists public.is_document_member(uuid, uuid) cascade;
drop function if exists public.is_document_editor(uuid, uuid) cascade;
drop table if exists public.invites cascade;
drop table if exists public.document_members cascade;
drop table if exists public.profiles cascade;
drop table if exists public.documents cascade;

create extension if not exists "pgcrypto";

-- 1) 문서 테이블 (소유자/멤버 개념 없음)
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default '제목 없는 마인드맵',
  ydoc_snapshot bytea,          -- Yjs 스냅샷 (Week 4)
  outline_json  jsonb,          -- 아웃라인/검색/내보내기용 중첩 트리(파생값, Week 4~6)
  nodes         jsonb,          -- ⭐ Week 2: 평면 MindNode[] 진실의 원천(좌표는 저장 안 함)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 기존 DB 에 컬럼이 없을 수 있으니 멱등 보강(클린 재provision 시엔 위 create 가 이미 포함).
alter table public.documents
  add column if not exists nodes jsonb;

-- RLS 를 켜되 정책은 두지 않는다 → 익명/직접 테이블 접근 전면 차단(열거 불가).
-- 접근은 오직 아래 SECURITY DEFINER 함수를 통해서만 이뤄진다.
alter table public.documents enable row level security;

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- 2) 접근 함수 (capability = id 를 아는 것)
create or replace function public.create_map(p_title text default '제목 없는 마인드맵')
returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.documents (title)
  values (coalesce(nullif(btrim(p_title), ''), '제목 없는 마인드맵'))
  returning id into new_id;
  return new_id;
end; $$;

create or replace function public.get_map(p_id uuid)
returns table (id uuid, title text, updated_at timestamptz)
language sql security definer set search_path = public stable as $$
  select d.id, d.title, d.updated_at
  from public.documents d
  where d.id = p_id;
$$;

create or replace function public.rename_map(p_id uuid, p_title text)
returns void
language sql security definer set search_path = public as $$
  update public.documents
  set title = coalesce(nullif(btrim(p_title), ''), title)
  where id = p_id;
$$;

create or replace function public.delete_map(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.documents where id = p_id;
$$;

-- 2-b) Week 2 노드 영속화 RPC (평면 MindNode[] 를 documents.nodes jsonb 에 저장/로드)

-- 로드: 메타 + 노드를 한 번에. (TABLE 반환 → JS 에서 data[0])
create or replace function public.get_map_full(p_id uuid)
returns table (id uuid, title text, nodes jsonb, updated_at timestamptz)
language sql security definer set search_path = public stable as $$
  select d.id, d.title, d.nodes, d.updated_at
  from public.documents d
  where d.id = p_id;
$$;

-- 저장: 평면 MindNode[] 를 통째로 last-write-wins 로 덮어쓰고,
--       set_updated_at() 트리거가 갱신한 updated_at 을 돌려준다. (스칼라 반환 → JS 에서 data 그대로)
create or replace function public.save_map_nodes(p_id uuid, p_nodes jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare new_ts timestamptz;
begin
  -- jsonb 배열만 허용(방어). null/비배열이면 거부.
  if p_nodes is null or jsonb_typeof(p_nodes) <> 'array' then
    raise exception 'p_nodes must be a jsonb array';
  end if;

  update public.documents
     set nodes = p_nodes        -- updated_at 은 트리거가 자동 갱신
   where id = p_id
  returning updated_at into new_ts;

  -- 존재하지 않는 문서면 new_ts 가 null → 호출측에서 처리.
  return new_ts;
end; $$;

-- 3) 익명 사용자가 함수를 호출할 수 있도록 실행 권한 부여
grant execute on function public.create_map(text)         to anon, authenticated;
grant execute on function public.get_map(uuid)            to anon, authenticated;
grant execute on function public.rename_map(uuid, text)   to anon, authenticated;
grant execute on function public.delete_map(uuid)         to anon, authenticated;
grant execute on function public.get_map_full(uuid)       to anon, authenticated;
grant execute on function public.save_map_nodes(uuid, jsonb) to anon, authenticated;
