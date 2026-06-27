import Fastify from "fastify";
import cors from "@fastify/cors";
import { initDb } from "./db.js";
import { registerRoutes } from "./routes.js";
import { HOST, PORT, ensureDirs, ytdlpExists, YTDLP_PATH } from "./config.js";

async function main(): Promise<void> {
  ensureDirs();
  initDb();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 5 * 1024 * 1024,
  });

  // Local tool: allow the Next.js dev server (and any localhost port) to call us.
  await app.register(cors, { origin: true });

  registerRoutes(app);

  if (!ytdlpExists()) {
    app.log.warn(
      `yt-dlp not found at ${YTDLP_PATH}. Run \`pnpm setup\` to download binaries.`,
    );
  }

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`VideoBulkDownloader API ready on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
