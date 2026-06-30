import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase/db";
import type { MapFull } from "@/lib/types";
import { MindmapCanvas } from "./MindmapCanvas";
import { ShareButton } from "./ShareButton";
import { RecordVisit } from "./RecordVisit";
import { MapTitle } from "./MapTitle";

export default async function MapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // id 를 모르면 접근 불가(열거도 불가). 잘못된 id/없는 문서는 not-found.
  // get_map_full: 메타 + 평면 노드(jsonb)를 한 번에 로드(클라이언트 라운드트립 제거).
  const { data, error } = await db.rpc("get_map_full", { p_id: id });
  const doc = (Array.isArray(data) ? data[0] : null) as MapFull | null;
  if (error || !doc) notFound();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <RecordVisit id={doc.id} title={doc.title} />

      <header className="flex h-14 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← 홈
        </Link>
        <MapTitle initialTitle={doc.title} />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 sm:inline dark:bg-blue-950 dark:text-blue-300">
            Week 2: 편집
          </span>
          <ShareButton />
        </div>
      </header>

      <div className="relative flex-1">
        <MindmapCanvas
          mapId={doc.id}
          title={doc.title}
          initialNodes={doc.nodes}
          initialUpdatedAt={doc.updated_at}
        />
      </div>
    </div>
  );
}
