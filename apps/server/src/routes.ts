import type { FastifyInstance } from "fastify";
import {
  detectSource,
  platformLabel,
  type CreateJobInput,
  type DownloadInput,
  type Platform,
  type ScanInput,
  type UpdateJobInput,
} from "@vbd/shared";
import {
  activeCooldowns,
  clearCooldowns,
  cooldownRemainingMs,
  formatRemaining,
} from "./ratelimit.js";
import { jobs, scans, videos } from "./repo.js";
import { cancelScan, startScan } from "./scanner.js";
import { cancelDownload, cancelScanDownloads, enqueueDownload } from "./queue.js";
import { bus } from "./events.js";
import { pickFolder } from "./system.js";
import { getVersion, updateYtDlp } from "./ytdlp.js";
import { DEFAULT_DOWNLOAD_DIR, YTDLP_PATH, ytdlpExists } from "./config.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const REFERERS: Record<Platform, string> = {
  youtube: "https://www.youtube.com/",
  tiktok: "https://www.tiktok.com/",
  douyin: "https://www.douyin.com/",
  bilibili: "https://www.bilibili.com/",
  unknown: "",
};

export function registerRoutes(app: FastifyInstance): void {
  /* --------------------------------- health -------------------------------- */
  app.get("/api/health", async () => ({
    ok: true,
    ytdlp: ytdlpExists(),
  }));

  /* -------------------------------- workspace ------------------------------ */
  // The single hidden job the UI uses (no job management surfaced anymore).
  app.get("/api/workspace", async () => {
    const job = jobs.getOrCreateDefault();
    return { job, scans: scans.listByJob(job.id) };
  });

  /* ---------------------------------- jobs --------------------------------- */
  app.post("/api/jobs", async (req, reply) => {
    const body = (req.body ?? {}) as CreateJobInput;
    const job = jobs.create(body.name ?? "Untitled job");
    return reply.code(201).send(job);
  });

  app.get("/api/jobs", async () => jobs.list());

  app.get("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = jobs.get(id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return { job, scans: scans.listByJob(id) };
  });

  app.patch("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as UpdateJobInput;
    const job = jobs.update(id, body);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    // New auth (signed in / changed cookies) → give blocked platforms another chance.
    if (
      body.cookieMode !== undefined ||
      body.cookieFilePath !== undefined ||
      body.cookieBrowser !== undefined
    ) {
      clearCooldowns();
    }
    return job;
  });

  app.delete("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    jobs.remove(id);
    return reply.code(204).send();
  });

  /* ---------------------------------- scans -------------------------------- */
  app.post("/api/jobs/:id/scan", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as ScanInput;
    if (!body.url || !body.url.trim()) {
      return reply.code(400).send({ error: "url is required" });
    }
    if (!ytdlpExists()) {
      return reply.code(503).send({ error: "yt-dlp binary not found. Run `pnpm setup`." });
    }
    // Don't hammer a platform we know is rate-limiting us — fail fast.
    const { platform } = detectSource(body.url);
    const rem = cooldownRemainingMs(platform);
    if (rem > 0) {
      return reply.code(429).send({
        error: `${platformLabel(platform)} is cooling down (rate-limited). Try again in ~${formatRemaining(
          rem,
        )}, or set Cookies (From browser) / switch network.`,
      });
    }
    try {
      const limit =
        typeof body.limit === "number" && body.limit > 0
          ? Math.floor(body.limit)
          : undefined;
      const scan = startScan(id, body.url, limit);
      return reply.code(202).send(scan);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.get("/api/jobs/:id/scans", async (req) => {
    const { id } = req.params as { id: string };
    return scans.listByJob(id);
  });

  // Abort an in-flight scan/enumeration (keeps any videos already found).
  app.post("/api/scans/:scanId/abort", async (req, reply) => {
    const { scanId } = req.params as { scanId: string };
    const stopped = cancelScan(scanId);
    return reply.code(202).send({ stopped });
  });

  // Delete a scan (and its videos). Stops it first if still enumerating.
  app.delete("/api/scans/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    cancelScan(id);
    scans.remove(id);
    return reply.code(204).send();
  });

  app.get("/api/scans/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scan = scans.get(id);
    if (!scan) return reply.code(404).send({ error: "Scan not found" });
    return { scan, videos: videos.listByScan(id) };
  });

  app.get("/api/jobs/:id/videos", async (req) => {
    const { id } = req.params as { id: string };
    return videos.listByJob(id);
  });

  /* -------------------------------- downloads ------------------------------ */
  app.post("/api/jobs/:id/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as DownloadInput;
    if (!Array.isArray(body.videoIds) || body.videoIds.length === 0) {
      return reply.code(400).send({ error: "videoIds is required" });
    }
    if (!body.folder || !body.folder.trim()) {
      return reply.code(400).send({ error: "folder is required" });
    }
    if (!ytdlpExists()) {
      return reply.code(503).send({ error: "yt-dlp binary not found. Run `pnpm setup`." });
    }
    jobs.update(id, { defaultFolder: body.folder });
    const accepted: string[] = [];
    for (const v of videos.listByIds(body.videoIds)) {
      if (v.jobId !== id) continue;
      enqueueDownload(v.id, body.folder);
      accepted.push(v.id);
    }
    return reply.code(202).send({ enqueued: accepted });
  });

  app.post("/api/downloads/:videoId/cancel", async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    cancelDownload(videoId);
    return reply.code(202).send({ ok: true });
  });

  // Cancel all queued/in-flight downloads of one scan (scoped to the current view).
  app.post("/api/scans/:scanId/cancel", async (req, reply) => {
    const { scanId } = req.params as { scanId: string };
    const canceled = cancelScanDownloads(scanId);
    return reply.code(202).send({ canceled });
  });

  app.post("/api/downloads/:videoId/retry", async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const video = videos.get(videoId);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    const job = jobs.get(video.jobId);
    const folder = job?.defaultFolder;
    if (!folder) {
      return reply.code(400).send({ error: "No target folder for this job yet" });
    }
    enqueueDownload(videoId, folder);
    return reply.code(202).send({ ok: true });
  });

  /* ------------------------------ SSE stream ------------------------------- */
  app.get("/api/jobs/:id/stream", (req, reply) => {
    const { id } = req.params as { id: string };
    // hijack() bypasses the CORS plugin, so set CORS headers on the raw response
    // ourselves — otherwise the browser blocks this cross-origin EventSource and
    // no live scan/download updates arrive.
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": req.headers.origin ?? "*",
      "Access-Control-Allow-Credentials": "true",
    });
    reply.raw.write(": connected\n\n");

    const unsub = bus.subscribe(id, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25000);

    req.raw.on("close", () => {
      clearInterval(ping);
      unsub();
    });
    reply.hijack();
  });

  /* --------------------------------- system -------------------------------- */
  app.post("/api/system/pick-folder", async (req) => {
    const body = (req.body ?? {}) as { initialDir?: string };
    const path = await pickFolder(body.initialDir);
    return { path };
  });

  app.get("/api/system/cooldowns", async () => activeCooldowns());

  app.get("/api/system/ytdlp-version", async () => {
    const available = ytdlpExists();
    const version = available ? await getVersion() : null;
    return { version, binaryPath: YTDLP_PATH, available };
  });

  app.post("/api/system/update-ytdlp", async () => {
    if (!ytdlpExists()) return { ok: false, output: "yt-dlp binary not found" };
    return updateYtDlp();
  });

  /* -------------------------------- settings ------------------------------- */
  app.get("/api/settings", async () => ({
    defaultDownloadDir: DEFAULT_DOWNLOAD_DIR,
  }));

  /* --------------------------- thumbnail proxy ----------------------------- */
  app.get("/api/thumb", async (req, reply) => {
    const { u, p } = req.query as { u?: string; p?: Platform };
    if (!u || !/^https?:\/\//.test(u)) {
      return reply.code(400).send({ error: "invalid url" });
    }
    try {
      const referer = p ? REFERERS[p] : "";
      const resp = await fetch(u, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(referer ? { Referer: referer } : {}),
        },
      });
      if (!resp.ok || !resp.body) {
        return reply.code(resp.status || 502).send();
      }
      reply.header("Content-Type", resp.headers.get("content-type") ?? "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(Buffer.from(await resp.arrayBuffer()));
    } catch {
      return reply.code(502).send();
    }
  });
}
