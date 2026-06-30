-- =============================================================
--  Week 2 마이그레이션 — 노드 영속화 (기존 데이터 보존, 추가만)
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요.
--  ⚠️ 전체 schema.sql 을 다시 돌리지 마세요(테이블 drop → 기존 맵 삭제).
--     이 파일은 drop 없이 컬럼/함수만 추가하므로 안전합니다.
-- =============================================================

-- 1) 평면 MindNode[] 저장용 컬럼 추가(이미 있으면 무시)
alter table public.documents
  add column if not exists nodes jsonb;

-- 2) 로드: 메타 + 노드를 한 번에 반환
create or replace function public.get_map_full(p_id uuid)
returns table (id uuid, title text, nodes jsonb, updated_at timestamptz)
language sql security definer set search_path = public stable as $$
  select d.id, d.title, d.nodes, d.updated_at
  from public.documents d
  where d.id = p_id;
$$;

-- 3) 저장: 평면 MindNode[] 를 last-write-wins 로 덮어쓰고 updated_at 반환
create or replace function public.save_map_nodes(p_id uuid, p_nodes jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare new_ts timestamptz;
begin
  if p_nodes is null or jsonb_typeof(p_nodes) <> 'array' then
    raise exception 'p_nodes must be a jsonb array';
  end if;
  update public.documents
     set nodes = p_nodes
   where id = p_id
  returning updated_at into new_ts;
  return new_ts;
end; $$;

-- 4) 익명 사용자 실행 권한
grant execute on function public.get_map_full(uuid)         to anon, authenticated;
grant execute on function public.save_map_nodes(uuid, jsonb) to anon, authenticated;
