"use client";

import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { getYtDlpVersion, updateYtDlp } from "@/lib/api";

export function TopBar() {
  const versionQuery = useQuery({
    queryKey: ["ytdlp-version"],
    queryFn: getYtDlpVersion,
  });

  const update = useMutation({
    mutationFn: updateYtDlp,
    onSettled: () => versionQuery.refetch(),
  });

  const v = versionQuery.data;

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur">
      <div className="mx-auto flex h-11 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <Download size={16} className="text-indigo-400" />
          <span>Video Bulk Downloader</span>
        </Link>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {v && !v.available && (
            <span className="text-amber-300">yt-dlp missing — run `pnpm setup`</span>
          )}
          {v?.available && <span>yt-dlp {v.version ?? "?"}</span>}
          <button
            onClick={() => update.mutate()}
            disabled={update.isPending || !v?.available}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            title="Update yt-dlp"
          >
            <RefreshCw size={12} className={update.isPending ? "animate-spin" : ""} />
            Update
          </button>
        </div>
      </div>
    </header>
  );
}
