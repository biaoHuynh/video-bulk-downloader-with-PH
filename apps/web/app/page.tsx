"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Clock, Download, FolderOpen, Loader2, Search } from "lucide-react";
import type { DownloadStatus, Scan, ServerEvent, Video } from "@vbd/shared";
import { platformLabel } from "@vbd/shared";
import {
  abortScan,
  cancelDownload,
  cancelScan,
  deleteScan,
  getCooldowns,
  getScan,
  getWorkspace,
  pickFolder,
  retryDownload,
  scanJob,
  startDownload,
  updateJob,
} from "@/lib/api";
import { useJobStream } from "@/hooks/useJobStream";
import { TopBar } from "@/components/TopBar";
import { CookieSelector } from "@/components/CookieSelector";
import { QualitySelector } from "@/components/QualitySelector";
import { SignIn } from "@/components/SignIn";
import { VideoList } from "@/components/VideoList";
import { HistoryPanel } from "@/components/HistoryPanel";

type StatusFilter = "all" | "pending" | "active" | "completed" | "failed";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Done" },
  { key: "failed", label: "Failed" },
];

function matchesFilter(status: DownloadStatus, f: StatusFilter): boolean {
  switch (f) {
    case "pending":
      return status === "idle";
    case "active":
      return status === "downloading" || status === "queued";
    case "completed":
      return status === "completed";
    case "failed":
      return status === "error" || status === "canceled";
    default:
      return true;
  }
}

const field =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 outline-none focus:border-indigo-500";

export default function WorkspacePage() {
  const qc = useQueryClient();
  const wsQuery = useQuery({ queryKey: ["workspace"], queryFn: getWorkspace });
  const cooldownsQuery = useQuery({
    queryKey: ["cooldowns"],
    queryFn: getCooldowns,
    refetchInterval: 8000,
  });
  const cooldowns = cooldownsQuery.data ?? [];
  const job = wsQuery.data?.job;
  const jobId = job?.id ?? null;
  const scans: Scan[] = wsQuery.data?.scans ?? [];

  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState("");
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [liveScanId, setLiveScanId] = useState<string | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanFound, setScanFound] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const activeScanRef = useRef<string | null>(null);

  const scanQuery = useQuery({
    queryKey: ["scan", activeScanId],
    queryFn: () => getScan(activeScanId as string),
    enabled: !!activeScanId && activeScanId !== liveScanId,
  });

  useEffect(() => {
    if (!activeScanId && scans.length > 0) selectScan(scans[0]!.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scans, activeScanId]);

  useEffect(() => {
    if (scanQuery.data && scanQuery.data.scan.id === activeScanId) {
      setVideos(scanQuery.data.videos);
    }
  }, [scanQuery.data, activeScanId]);

  function selectScan(scanId: string, live: string | null = liveScanId) {
    // Already viewing this scan → keep its list; re-clicking shouldn't unload it.
    if (scanId === activeScanRef.current) return;
    activeScanRef.current = scanId;
    setActiveScanId(scanId);
    if (scanId !== live) setVideos([]);
    setSelected(new Set());
  }

  useJobStream(jobId, (e: ServerEvent) => {
    switch (e.type) {
      case "scan:started":
        activeScanRef.current = e.scan.id;
        setActiveScanId(e.scan.id);
        setLiveScanId(e.scan.id);
        setVideos([]);
        setSelected(new Set());
        setScanFound(0);
        qc.invalidateQueries({ queryKey: ["workspace"] });
        break;
      case "scan:progress":
        if (e.scanId === activeScanRef.current) setScanFound(e.found);
        break;
      case "video:added":
        if (e.video.scanId === activeScanRef.current)
          setVideos((prev) =>
            prev.some((v) => v.id === e.video.id) ? prev : [...prev, e.video],
          );
        break;
      case "scan:done":
      case "scan:error":
        setLiveScanId(null);
        qc.invalidateQueries({ queryKey: ["workspace"] });
        if (e.type === "scan:done") qc.invalidateQueries({ queryKey: ["scan", e.scan.id] });
        break;
      case "download:progress":
        setVideos((prev) =>
          prev.map((v) =>
            v.id === e.videoId ? { ...v, progress: e.progress, speed: e.speed, eta: e.eta } : v,
          ),
        );
        break;
      case "video:status":
        setVideos((prev) => prev.map((v) => (v.id === e.video.id ? e.video : v)));
        if (["completed", "error", "canceled"].includes(e.video.downloadStatus))
          qc.invalidateQueries({ queryKey: ["workspace"] });
        break;
    }
  });

  // Fallback: if an SSE terminal event is ever missed, poll the live scan so the
  // "scanning…" state always resolves and the final list loads.
  useEffect(() => {
    if (!liveScanId) return;
    const t = setInterval(async () => {
      try {
        const { scan } = await getScan(liveScanId);
        if (scan.status === "done" || scan.status === "error") {
          setLiveScanId(null);
          qc.invalidateQueries({ queryKey: ["workspace"] });
          qc.invalidateQueries({ queryKey: ["scan", liveScanId] });
        }
      } catch {
        /* ignore transient errors */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [liveScanId, qc]);

  /* -------------------------------- actions -------------------------------- */
  // Switch the view to a freshly-started scan (shared by Scan + Re-scan) so the
  // loading state shows instantly, even before the first SSE frame arrives.
  function applyNewScan(scanRow: Scan) {
    activeScanRef.current = scanRow.id;
    setActiveScanId(scanRow.id);
    setLiveScanId(scanRow.id);
    setVideos([]);
    setSelected(new Set());
    setScanFound(0);
    qc.invalidateQueries({ queryKey: ["workspace"] });
  }

  const scan = useMutation({
    mutationFn: () => scanJob(jobId as string, url.trim(), limit ? Number(limit) : undefined),
    onSuccess: (scanRow) => {
      setUrl("");
      applyNewScan(scanRow);
    },
  });

  // Re-run a past scan's URL (from a History card).
  const rescan = useMutation({
    mutationFn: (s: Scan) => scanJob(jobId as string, s.sourceUrl, limit ? Number(limit) : undefined),
    onSuccess: (scanRow) => applyNewScan(scanRow),
  });

  // Delete a past scan (and its videos).
  const del = useMutation({
    mutationFn: (scanId: string) => deleteScan(scanId),
    onSuccess: (_d, scanId) => {
      if (scanId === liveScanId) setLiveScanId(null);
      if (scanId === activeScanRef.current) {
        // Cleared the active scan → drop the view; the auto-select effect picks
        // the next remaining scan after the workspace refetches.
        activeScanRef.current = null;
        setActiveScanId(null);
        setVideos([]);
        setSelected(new Set());
      }
      qc.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const abort = useMutation({
    mutationFn: () => abortScan(activeScanId as string),
    onSuccess: () => {
      // Resolve the scanning state immediately; the scan:done SSE/poll follows.
      setLiveScanId(null);
      qc.invalidateQueries({ queryKey: ["workspace"] });
      if (activeScanId) qc.invalidateQueries({ queryKey: ["scan", activeScanId] });
    },
  });

  async function ensureFolder(): Promise<string | null> {
    if (job?.defaultFolder) return job.defaultFolder;
    const { path } = await pickFolder();
    if (path) {
      await updateJob(jobId as string, { defaultFolder: path });
      qc.invalidateQueries({ queryKey: ["workspace"] });
    }
    return path;
  }

  async function changeFolder() {
    const { path } = await pickFolder(job?.defaultFolder ?? undefined);
    if (path) {
      await updateJob(jobId as string, { defaultFolder: path });
      qc.invalidateQueries({ queryKey: ["workspace"] });
    }
  }

  const download = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) throw new Error("Select at least one video");
      const folder = await ensureFolder();
      if (!folder) return;
      await startDownload(jobId as string, ids, folder);
    },
  });

  /* ------------------------------- derived --------------------------------- */
  const activeScan = scans.find((s) => s.id === activeScanId);
  const isScanning =
    (liveScanId !== null && liveScanId === activeScanId) || activeScan?.status === "scanning";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter(
      (v) =>
        matchesFilter(v.downloadStatus, statusFilter) &&
        (!q ||
          v.title.toLowerCase().includes(q) ||
          (v.uploader ?? "").toLowerCase().includes(q)),
    );
  }, [videos, search, statusFilter]);

  const counts = useMemo(() => {
    let done = 0;
    let failed = 0;
    for (const v of videos) {
      if (v.downloadStatus === "completed") done++;
      else if (v.downloadStatus === "error") failed++;
    }
    return { total: videos.length, done, failed };
  }, [videos]);

  const selectedCount = useMemo(
    () => videos.filter((v) => selected.has(v.id)).length,
    [videos, selected],
  );

  // Active downloads in the CURRENT scan only (cancel is scoped to this view).
  const hasActive = useMemo(
    () =>
      videos.some(
        (v) => v.downloadStatus === "downloading" || v.downloadStatus === "queued",
      ),
    [videos],
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));
  const someFilteredSelected = filtered.some((v) => selected.has(v.id));

  function setSelectedForFiltered(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const v of filtered) checked ? next.add(v.id) : next.delete(v.id);
      return next;
    });
  }

  /* --------------------------------- render -------------------------------- */
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />

      {/* scan bar */}
      <div className="border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="mx-auto max-w-7xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (jobId) scan.mutate();
            }}
            className="flex gap-2"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a channel URL (lists all videos) or a single video URL, then Scan"
              className={`flex-1 ${field} py-2`}
            />
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
              placeholder="Max"
              title="Max videos to list (blank = all)"
              className={`w-16 text-center ${field} py-2`}
            />
            <button
              type="submit"
              disabled={scan.isPending || !url.trim() || !jobId}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {scan.isPending || isScanning ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Search size={15} />
              )}
              Scan
            </button>
            {isScanning && (
              <button
                type="button"
                onClick={() => activeScanId && abort.mutate()}
                disabled={abort.isPending}
                title="Stop scanning (keeps videos found so far)"
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600/90 px-4 py-2 font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Ban size={15} /> Stop
              </button>
            )}
          </form>

          {/* settings strip */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {job && <QualitySelector job={job} />}
            {job && <SignIn job={job} />}
            {job && <CookieSelector job={job} />}
            <button
              onClick={changeFolder}
              className="inline-flex items-center gap-1 hover:text-slate-200"
              title="Choose download folder"
            >
              <FolderOpen size={13} />
              {job?.defaultFolder ? (
                <span className="max-w-[280px] truncate">{job.defaultFolder}</span>
              ) : (
                <span>Choose folder… (asked on first download)</span>
              )}
            </button>
            {scan.error && (
              <span className="text-red-400">{(scan.error as Error).message}</span>
            )}
          </div>
        </div>
      </div>

      {/* cooldown banner */}
      {cooldowns.length > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <Clock size={13} className="shrink-0" />
            <span className="font-medium">
              {cooldowns
                .map((c) => `${platformLabel(c.platform)} paused ~${Math.ceil(c.remainingMs / 60000)}m`)
                .join(" · ")}
            </span>
            <span className="text-amber-300/70">
              — rate-limited; queued downloads resume automatically. Use cookies (From browser) or
              switch network/VPN.
            </span>
          </div>
        </div>
      )}

      {/* main + history */}
      <div className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 gap-4 overflow-hidden px-4 py-3">
        {/* main column */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
              }}
              checked={allFilteredSelected}
              onChange={(e) => setSelectedForFiltered(e.target.checked)}
              className="size-3.5 accent-indigo-500"
              title="Select all (filtered)"
            />
            <span className="text-xs text-slate-400">
              {selectedCount}/{counts.total}
            </span>
            <span className="hidden text-[11px] text-slate-600 sm:inline">
              · {counts.done} done{counts.failed ? ` · ${counts.failed} failed` : ""}
            </span>
            <div className="ml-1 flex items-center gap-1 text-[11px] text-slate-400">
              <button className="hover:text-slate-200" onClick={() => setSelected(new Set())}>
                None
              </button>
              <span className="text-slate-700">|</span>
              <button
                className="hover:text-slate-200"
                title="Select all not-yet-downloaded"
                onClick={() =>
                  setSelected(
                    new Set(filtered.filter((v) => v.downloadStatus !== "completed").map((v) => v.id)),
                  )
                }
              >
                Not done
              </button>
            </div>

            <div className="relative ml-2">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter…"
                className={`w-36 pl-6 ${field} py-1`}
              />
            </div>

            <div className="flex items-center gap-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    statusFilter === f.key
                      ? "bg-indigo-600 text-white"
                      : "text-slate-400 hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {hasActive && (
                <button
                  onClick={() => activeScanId && cancelScan(activeScanId)}
                  title="Cancel queued + in-progress downloads in this scan"
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-600/90 px-3 py-1.5 font-medium text-white hover:bg-red-500"
                >
                  <Ban size={15} /> Cancel
                </button>
              )}
              <button
                onClick={() =>
                  download.mutate(videos.filter((v) => selected.has(v.id)).map((v) => v.id))
                }
                disabled={download.isPending || selectedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {download.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Download size={15} />
                )}
                Download{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
            </div>
          </div>

          {download.error && (
            <p className="pb-1 text-right text-xs text-red-400">
              {(download.error as Error).message}
            </p>
          )}
          {activeScan?.status === "error" && (
            <p className="pb-1 text-xs text-red-400">Scan failed: {activeScan.error}</p>
          )}

          {/* scrollable list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isScanning && videos.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] py-10 text-sm text-indigo-300">
                <Loader2 size={16} className="animate-spin" /> Scanning… {scanFound} found
              </div>
            ) : (
              <>
                {isScanning && (
                  <div className="mb-2 flex items-center gap-2 rounded-md bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300">
                    <Loader2 size={13} className="animate-spin" /> Scanning… {scanFound} found
                    (you can already select &amp; download, or press Stop)
                  </div>
                )}
                <VideoList
                  videos={filtered}
                  selected={selected}
                  onToggle={(vid) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      next.has(vid) ? next.delete(vid) : next.add(vid);
                      return next;
                    })
                  }
                  onCancel={(vid) => cancelDownload(vid)}
                  onRetry={(vid) => retryDownload(vid)}
                  onDownloadOne={(vid) => download.mutate([vid])}
                />
              </>
            )}
          </div>
        </main>

        {/* history */}
        <aside className="hidden w-72 shrink-0 overflow-hidden md:flex md:flex-col">
          <HistoryPanel
            scans={scans}
            activeScanId={activeScanId}
            liveScanId={liveScanId}
            onSelect={(id) => selectScan(id)}
            onRescan={(s) => rescan.mutate(s)}
            onDelete={(id) => del.mutate(id)}
            rescanningId={rescan.isPending ? (rescan.variables as Scan).id : null}
            deletingId={del.isPending ? (del.variables as string) : null}
          />
        </aside>
      </div>

      {wsQuery.error && (
        <p className="px-4 pb-2 text-xs text-red-400">
          Cannot reach the backend ({(wsQuery.error as Error).message}). Is the server running
          on port 4319?
        </p>
      )}
    </div>
  );
}
