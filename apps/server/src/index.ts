import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { initDb } from "./db.js";
import { registerRoutes } from "./routes.js";
import { HOST, PORT, WEB_DIR, ensureDirs, ytdlpExists, YTDLP_PATH } from "./config.js";

/**
 * Create, configure, and start the Fastify server. Used both by the standalone
 * entry (`serve.ts`, web/dev) and by the Electron main process (in-process).
 */
export async function startServer(): Promise<FastifyInstance> {
  ensureDirs();
  initDb();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 5 * 1024 * 1024,
  });

  // Allow the Next.js dev server (web mode); harmless same-origin inside Electron.
  await app.register(cors, { origin: true });

  registerRoutes(app);

  // Serve the built static UI (Next export) when present — used inside Electron.
  if (fs.existsSync(WEB_DIR)) {
    await app.register(fastifyStatic, { root: WEB_DIR, prefix: "/" });
    app.log.info(`Serving UI from ${WEB_DIR}`);
  }

  if (!ytdlpExists()) {
    app.log.warn(`yt-dlp not found at ${YTDLP_PATH}. Run \`pnpm setup\` to download binaries.`);
  }

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`VideoBulkDownloader API ready on http://${HOST}:${PORT}`);
  return app;
}

// Surface what the Electron main process needs (it imports @vbd/server).
export { PORT, HOST } from "./config.js";
export type { ScanEntry, ScanHandle, CookieConfig } from "./ytdlp.js";
