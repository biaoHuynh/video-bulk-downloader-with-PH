"use client";

import { useState } from "react";
import { AlertCircle, Ban, Check, CheckCircle2, Clock, Loader2, RotateCw, Trash2, X } from "lucide-react";
import type { Scan } from "@vbd/shared";
import { PlatformBadge } from "./badges";
import { formatDate } from "@/lib/format";

interface Props {
  scans: Scan[];
  activeScanId: string | null;
  liveScanId: string | null;
  onSelect: (scanId: string) => void;
  onRescan: (scan: Scan) => void;
  onDelete: (scanId: string) => void;
  /** Scan currently being re-scanned / deleted (for spinner + dimming). */
  rescanningId: string | null;
  deletingId: string | null;
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function HistoryPanel({
  scans,
  activeScanId,
  liveScanId,
  onSelect,
  onRescan,
  onDelete,
  rescanningId,
  deletingId,
}: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Clock size={12} /> History
      </div>

      {scans.length === 0 ? (
        <p className="px-2 py-6 text-center text-[11px] text-slate-600">No scans yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto pr-1">
          {scans.map((s) => {
            const scanning = liveScanId === s.id || s.status === "scanning";
            const active = s.id === activeScanId;
            const deleting = deletingId === s.id;
            return (
              <li key={s.id}>
                <div
                  onClick={() => onSelect(s.id)}
                  title={`${s.sourceUrl}\n${formatDate(s.createdAt)}`}
                  className={`group relative w-full cursor-pointer rounded-md border px-2 py-1.5 text-left transition ${
                    active
                      ? "border-indigo-500/60 bg-indigo-500/10"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-indigo-500/40"
                  } ${deleting ? "pointer-events-none opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-1.5">
                    {scanning ? (
                      <Loader2 size={12} className="shrink-0 animate-spin text-indigo-400" />
                    ) : s.status === "error" ? (
                      <AlertCircle size={12} className="shrink-0 text-red-400" />
                    ) : s.status === "canceled" ? (
                      <Ban size={12} className="shrink-0 text-slate-400" />
                    ) : (
                      <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                    )}
                    <PlatformBadge platform={s.platform} />
                    <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                      {shortTime(s.createdAt)}
                    </span>

                    {/* delete: X → inline confirm (✓ / ✕) */}
                    {confirming === s.id ? (
                      <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            onDelete(s.id);
                            setConfirming(null);
                          }}
                          title="Confirm delete"
                          className="rounded p-0.5 text-red-400 hover:bg-red-500/15"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          title="Keep"
                          className="rounded p-0.5 text-slate-400 hover:bg-[var(--color-surface-2)]"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirming(s.id);
                        }}
                        title="Delete scan"
                        className="rounded p-0.5 text-slate-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  <div className="mt-1 truncate text-[11px] text-slate-300" title={s.sourceUrl}>
                    {s.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {scanning
                      ? "scanning…"
                      : s.status === "error"
                        ? "failed"
                        : `${s.status === "canceled" ? "stopped · " : ""}${s.sourceType} · ${
                            s.videoCount ?? 0
                          } videos`}
                  </div>

                  {/* Re-scan: only on the selected card, when it isn't live-scanning */}
                  {active && !scanning && confirming !== s.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRescan(s);
                      }}
                      disabled={rescanningId === s.id}
                      title="Run this scan again"
                      className="mt-1.5 inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-indigo-300 transition hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                    >
                      {rescanningId === s.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RotateCw size={11} />
                      )}
                      Re-scan
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
