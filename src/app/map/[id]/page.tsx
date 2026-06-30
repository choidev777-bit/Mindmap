import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase/db";
import { MindmapCanvas } from "./MindmapCanvas";
import { ShareButton } from "./ShareButton";
import { RecordVisit } from "./RecordVisit";

export default async function MapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // id 를 모르면 접근 불가(열거도 불가). 잘못된 id/없는 문서는 not-found.
  const { data, error } = await db.rpc("get_map", { p_id: id });
  const doc = Array.isArray(data) ? data[0] : null;
  if (error || !doc) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <RecordVisit id={doc.id} title={doc.title} />

      <header className="flex h-14 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← 홈
        </Link>
        <h1 className="truncate text-sm font-medium">{doc.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 sm:inline dark:bg-amber-950 dark:text-amber-300">
            Week 1: 보기 전용 캔버스
          </span>
          <ShareButton />
        </div>
      </header>

      <div className="relative flex-1">
        <MindmapCanvas title={doc.title} />
      </div>
    </div>
  );
}
