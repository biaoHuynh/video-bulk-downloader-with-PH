import type { DownloadStatus, Platform } from "@vbd/shared";
import { platformLabel } from "@vbd/shared";

const PLATFORM_STYLES: Record<Platform, string> = {
  youtube: "bg-red-500/15 text-red-300 border-red-500/30",
  tiktok: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  douyin: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  bilibili: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  unknown: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[10px] font-medium ${PLATFORM_STYLES[platform]}`}
    >
      {platformLabel(platform)}
    </span>
  );
}

const STATUS_STYLES: Record<DownloadStatus, { label: string; cls: string }> = {
  idle: { label: "Idle", cls: "text-slate-400" },
  queued: { label: "Queued", cls: "text-amber-300" },
  downloading: { label: "Downloading", cls: "text-indigo-300" },
  completed: { label: "Completed", cls: "text-emerald-300" },
  error: { label: "Error", cls: "text-red-300" },
  skipped: { label: "Skipped", cls: "text-slate-400" },
  canceled: { label: "Canceled", cls: "text-slate-400" },
};

export function StatusBadge({ status }: { status: DownloadStatus }) {
  const s = STATUS_STYLES[status];
  return <span className={`text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
