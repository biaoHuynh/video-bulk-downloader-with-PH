"use client";

import { Download, RotateCw, X } from "lucide-react";
import type { Video } from "@vbd/shared";
import { Thumb } from "./Thumb";
import { PlatformBadge, StatusBadge } from "./badges";
import { formatBytes } from "@/lib/format";

interface Props {
  videos: Video[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDownloadOne: (id: string) => void;
}

const iconBtn =
  "inline-flex items-center justify-center rounded p-1 text-slate-400 hover:bg-[var(--color-surface-2)] hover:text-slate-200";

export function VideoList({
  videos,
  selected,
  onToggle,
  onCancel,
  onRetry,
  onDownloadOne,
}: Props) {
  if (videos.length === 0) {
    return (
      <p className="rounded-lg border border-[var(--color-border)] px-4 py-8 text-center text-xs text-slate-500">
        No videos. Paste a channel or video URL above and click Scan.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)]">
      {videos.map((v) => {
        const active = v.downloadStatus === "downloading" || v.downloadStatus === "queued";
        const isSel = selected.has(v.id);
        return (
          <li
            key={v.id}
            className={`flex items-center gap-2.5 px-3 py-1.5 ${
              isSel ? "bg-indigo-500/5" : "hover:bg-[var(--color-surface)]"
            }`}
          >
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => onToggle(v.id)}
              className="size-3.5 shrink-0 accent-indigo-500"
            />
            <Thumb video={v} />

            <div className="min-w-0 flex-1">
              <a
                href={v.webpageUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-[13px] font-medium leading-tight hover:text-indigo-300"
                title={v.title}
              >
                {v.title}
              </a>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <PlatformBadge platform={v.platform} />
                {v.uploader && <span className="truncate">{v.uploader}</span>}
              </div>

              {active && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${Math.max(3, v.progress)}%` }}
                  />
                </div>
              )}
              {v.downloadStatus === "error" && v.error && (
                <div className="mt-0.5 truncate text-[11px] text-red-400" title={v.error}>
                  {v.error}
                </div>
              )}
            </div>

            <div className="flex w-32 shrink-0 flex-col items-end leading-tight">
              <StatusBadge status={v.downloadStatus} />
              {v.downloadStatus === "downloading" ? (
                <span className="text-[10px] tabular-nums text-slate-400">
                  {v.progress.toFixed(0)}%{v.speed ? ` · ${v.speed}` : ""}
                  {v.eta ? ` · ${v.eta}` : ""}
                </span>
              ) : v.downloadStatus === "completed" && v.filesize ? (
                <span className="text-[10px] text-slate-500">{formatBytes(v.filesize)}</span>
              ) : null}
            </div>

            <div className="flex w-7 shrink-0 justify-end">
              {active ? (
                <button onClick={() => onCancel(v.id)} className={iconBtn} title="Cancel">
                  <X size={14} />
                </button>
              ) : v.downloadStatus === "error" || v.downloadStatus === "canceled" ? (
                <button onClick={() => onRetry(v.id)} className={iconBtn} title="Retry">
                  <RotateCw size={14} />
                </button>
              ) : (
                <button
                  onClick={() => onDownloadOne(v.id)}
                  className={iconBtn}
                  title={v.downloadStatus === "completed" ? "Download again" : "Download"}
                >
                  <Download size={14} />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
