import { createClient } from "@supabase/supabase-js";

/**
 * 로그인 없는 anon 클라이언트.
 * 모든 DB 접근은 SECURITY DEFINER RPC(create_map/get_map/...)로만 이뤄지므로
 * 사용자 세션/쿠키가 필요 없다. (anon 키는 공개되어도 안전한 값)
 */
export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
