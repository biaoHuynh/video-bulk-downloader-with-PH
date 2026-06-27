"use client";

import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { Scan } from "@vbd/shared";
import { PlatformBadge } from "./badges";
import { formatDate } from "@/lib/format";

interface Props {
  scans: Scan[];
  activeScanId: string | null;
  liveScanId: string | null;
  onSelect: (scanId: string) => void;
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function HistoryPanel({ scans, activeScanId, liveScanId, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Clock size={12} /> History
      </div>

      {scans.length === 0 ? (
        <p className="px-2 py-6 text-center text-[11px] text-slate-600">
          No scans yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto pr-1">
          {scans.map((s) => {
            const scanning = liveScanId === s.id || s.status === "scanning";
            const active = s.id === activeScanId;
            return (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  title={`${s.sourceUrl}\n${formatDate(s.createdAt)}`}
                  className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                    active
                      ? "border-indigo-500/60 bg-indigo-500/10"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-indigo-500/40"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {scanning ? (
                      <Loader2 size={12} className="shrink-0 animate-spin text-indigo-400" />
                    ) : s.status === "error" ? (
                      <AlertCircle size={12} className="shrink-0 text-red-400" />
                    ) : (
                      <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                    )}
                    <PlatformBadge platform={s.platform} />
                    <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                      {shortTime(s.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-300" title={s.sourceUrl}>
                    {s.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {scanning
                      ? "scanning…"
                      : s.status === "error"
                        ? "failed"
                        : `${s.sourceType} · ${s.videoCount ?? 0} videos`}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
