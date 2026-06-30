"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase/db";

/** 새 마인드맵 생성 → 에디터로 이동. 누구나 호출 가능(로그인 없음). */
export async function createMap() {
  const { data, error } = await db.rpc("create_map", {});
  if (error || !data) throw new Error(error?.message ?? "마인드맵 생성 실패");
  redirect(`/map/${data}`); // data = 새 문서의 uuid
}

export async function renameMap(id: string, title: string) {
  const { error } = await db.rpc("rename_map", { p_id: id, p_title: title });
  if (error) throw new Error(error.message);
  revalidatePath(`/map/${id}`);
}

export async function deleteMap(id: string) {
  const { error } = await db.rpc("delete_map", { p_id: id });
  if (error) throw new Error(error.message);
  redirect("/");
}
