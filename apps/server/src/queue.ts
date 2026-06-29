import fs from "node:fs";
import path from "node:path";
import PQueue from "p-queue";
import { platformLabel, type Platform } from "@vbd/shared";
import { jobs, videos } from "./repo.js";
import { bus } from "./events.js";
import type { DownloadHandle } from "./ytdlp.js";
import { downloadEngineFor } from "./engines/registry.js";
import { humanizeYtDlpError } from "./yterrors.js";
import {
  cooldownRemainingMs,
  formatRemaining,
  isBlockError,
  noteBlock,
  noteSuccess,
} from "./ratelimit.js";

/** One global queue → videos download strictly sequentially (concurrency 1). */
const queue = new PQueue({ concurrency: 1 });

const activeHandles = new Map<string, DownloadHandle>();
const pendingFolder = new Map<string, string>();
const attempts = new Map<string, number>();
const cooldownWaits = new Map<string, number>();
const canceledIds = new Set<string>();
let currentVideoId: string | null = null;

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [3000, 8000];
const MAX_COOLDOWN_WAITS = 8;
const MAX_WAIT_CHUNK_MS = 30 * 60_000;

/** Errors we should NOT retry (gone / access-gated). Block errors are handled separately. */
function isPermanent(message: string): boolean {
  return /private|members-only|unavailable|removed|deleted|terminated|copyright|not available|geo|sign in to confirm|age-?restrict|login required|requires authentication|HTTP Error 4(0[0-46-9]|1[13-9])/i.test(
    message,
  );
}

function emitVideoStatus(videoId: string): void {
  const v = videos.get(videoId);
  if (v) bus.emit(v.jobId, { type: "video:status", video: v });
}

function emitQueueState(jobId: string): void {
  bus.emit(jobId, {
    type: "queue:state",
    jobId,
    queued: queue.size + queue.pending,
    active: currentVideoId,
  });
}

function cleanup(videoId: string): void {
  pendingFolder.delete(videoId);
  attempts.delete(videoId);
  cooldownWaits.delete(videoId);
}

/** Enqueue (or re-enqueue) a video for download into `folder`. */
export function enqueueDownload(videoId: string, folder: string): void {
  const video = videos.get(videoId);
  if (!video) return;
  if (video.downloadStatus === "downloading" || video.downloadStatus === "queued") return;

  pendingFolder.set(videoId, folder);
  attempts.delete(videoId);
  cooldownWaits.delete(videoId);
  canceledIds.delete(videoId);
  videos.setStatus(videoId, "queued", { progress: 0, error: null, speed: null, eta: null });
  emitVideoStatus(videoId);
  emitQueueState(video.jobId);

  void queue.add(() => runDownload(videoId));
}

/** Hold a video until its platform's cooldown elapses, then re-queue it. */
function waitForCooldown(videoId: string, platform: Platform): void {
  const waits = (cooldownWaits.get(videoId) ?? 0) + 1;
  const video = videos.get(videoId);
  if (waits > MAX_COOLDOWN_WAITS) {
    cleanup(videoId);
    videos.setStatus(videoId, "error", {
      error: `${platformLabel(platform)} is still rate-limited after waiting. Try later, add cookies, or switch network.`,
    });
    emitVideoStatus(videoId);
    if (video) emitQueueState(video.jobId);
    return;
  }
  cooldownWaits.set(videoId, waits);
  const rem = cooldownRemainingMs(platform);
  const delay = Math.min(Math.max(rem, 5000) + 2000, MAX_WAIT_CHUNK_MS);
  videos.setStatus(videoId, "queued", {
    progress: 0,
    speed: null,
    eta: null,
    error: `Waiting for ${platformLabel(platform)} cooldown (~${formatRemaining(rem)})`,
  });
  emitVideoStatus(videoId);
  if (video) emitQueueState(video.jobId);
  setTimeout(() => {
    if (!canceledIds.has(videoId)) void queue.add(() => runDownload(videoId));
  }, delay);
}

async function runDownload(videoId: string): Promise<void> {
  const video = videos.get(videoId);
  if (!video) return;

  if (canceledIds.has(videoId)) {
    canceledIds.delete(videoId);
    cleanup(videoId);
    videos.setStatus(videoId, "canceled", { progress: 0 });
    emitVideoStatus(videoId);
    emitQueueState(video.jobId);
    return;
  }

  // Platform is rate-limited right now → hold this item, don't hammer the IP.
  if (cooldownRemainingMs(video.platform) > 0) {
    waitForCooldown(videoId, video.platform);
    return;
  }

  const job = jobs.get(video.jobId);
  const folder = pendingFolder.get(videoId);
  if (!job || !folder) {
    cleanup(videoId);
    videos.setStatus(videoId, "error", { error: "Missing job or target folder" });
    emitVideoStatus(videoId);
    return;
  }

  currentVideoId = videoId;
  videos.setStatus(videoId, "downloading", { progress: 0, error: null });
  emitVideoStatus(videoId);
  emitQueueState(video.jobId);

  const tmpDir = path.join(folder, ".vbd-tmp", videoId);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {
    /* ignore */
  }

  let lastPct = -1;
  const handle = downloadEngineFor(video.platform)(
    {
      webpageUrl: video.webpageUrl,
      folder,
      platform: video.platform,
      quality: job.quality,
      tmpDir,
      cookies: {
        cookieMode: job.cookieMode,
        cookieBrowser: job.cookieBrowser,
        cookieFilePath: job.cookieFilePath,
      },
    },
    {
      onProgress: (progress, speed, eta) => {
        bus.emit(video.jobId, { type: "download:progress", videoId, progress, speed, eta });
        const floored = Math.floor(progress);
        if (floored !== lastPct) {
          lastPct = floored;
          videos.setProgress(videoId, progress, speed, eta);
        }
      },
    },
  );
  activeHandles.set(videoId, handle);

  let rescheduled = false;
  try {
    const result = await handle.promise;
    noteSuccess(video.platform);
    cleanup(videoId);
    videos.setStatus(videoId, "completed", {
      progress: 100,
      filePath: result.filePath,
      filesize: result.filesize,
      speed: null,
      eta: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (canceledIds.has(videoId) || message === "canceled") {
      canceledIds.delete(videoId);
      cleanup(videoId);
      videos.setStatus(videoId, "canceled", { speed: null, eta: null });
    } else if (isBlockError(message)) {
      // Rate-limited mid-download: start a cooldown and hold this item.
      noteBlock(video.platform);
      rescheduled = true;
    } else {
      const short = humanizeYtDlpError(message, { platform: video.platform, sourceType: "video" });
      const tried = attempts.get(videoId) ?? 0;
      if (!isPermanent(message) && tried < MAX_RETRIES) {
        attempts.set(videoId, tried + 1);
        videos.setStatus(videoId, "queued", {
          progress: 0,
          speed: null,
          eta: null,
          error: `Retrying (${tried + 1}/${MAX_RETRIES})… ${short}`,
        });
        const delay = RETRY_BACKOFF_MS[tried] ?? 8000;
        setTimeout(() => {
          if (!canceledIds.has(videoId)) void queue.add(() => runDownload(videoId));
        }, delay);
      } else {
        cleanup(videoId);
        videos.setStatus(videoId, "error", { error: short, speed: null, eta: null });
      }
    }
  } finally {
    activeHandles.delete(videoId);
    currentVideoId = null;
    // Remove leftover partial/fragment files (no-op dir on success), then the
    // parent .vbd-tmp if it's now empty.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmdirSync(path.dirname(tmpDir));
    } catch {
      /* ignore (parent not empty / already gone) */
    }
  }

  // Done outside finally so the cooldown is already recorded.
  if (rescheduled) waitForCooldown(videoId, video.platform);
  emitVideoStatus(videoId);
  emitQueueState(video.jobId);
}

/** Cancel all queued/in-flight downloads of one scan (completed ones are left). */
export function cancelScanDownloads(scanId: string): number {
  let n = 0;
  for (const v of videos.listByScan(scanId)) {
    if (v.downloadStatus === "downloading" || v.downloadStatus === "queued") {
      cancelDownload(v.id);
      n++;
    }
  }
  return n;
}

/** Cancel a queued or in-flight download. */
export function cancelDownload(videoId: string): void {
  const handle = activeHandles.get(videoId);
  if (handle) {
    canceledIds.add(videoId);
    handle.cancel();
    return;
  }
  const video = videos.get(videoId);
  if (video && (video.downloadStatus === "queued" || video.downloadStatus === "idle")) {
    canceledIds.add(videoId);
    cleanup(videoId);
    videos.setStatus(videoId, "canceled", { progress: 0 });
    emitVideoStatus(videoId);
    emitQueueState(video.jobId);
  }
}
