// Downloads yt-dlp + ffmpeg/ffprobe into ./bin for the current platform.
// Usage: node scripts/fetch-binaries.mjs [--force]
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "../bin");
const FORCE = process.argv.includes("--force");
const platform = os.platform();
const isWin = platform === "win32";

const YTDLP_ASSET = isWin
  ? "yt-dlp.exe"
  : platform === "darwin"
    ? "yt-dlp_macos"
    : "yt-dlp_linux";
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`;
const YTDLP_OUT = path.join(BIN, isWin ? "yt-dlp.exe" : "yt-dlp");

const FFMPEG_ZIP_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  console.log(`↓ ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`✓ ${path.basename(dest)}`);
}

async function fetchYtDlp() {
  if (!FORCE && (await exists(YTDLP_OUT))) {
    console.log("• yt-dlp already present (use --force to re-download)");
    return;
  }
  await download(YTDLP_URL, YTDLP_OUT);
  if (!isWin) await fs.chmod(YTDLP_OUT, 0o755);
}

async function fetchFfmpegWindows() {
  const ffmpegOut = path.join(BIN, "ffmpeg.exe");
  const ffprobeOut = path.join(BIN, "ffprobe.exe");
  if (!FORCE && (await exists(ffmpegOut)) && (await exists(ffprobeOut))) {
    console.log("• ffmpeg already present (use --force to re-download)");
    return;
  }
  const tmp = path.join(BIN, "_ffmpeg_tmp");
  const zip = path.join(BIN, "_ffmpeg.zip");
  await download(FFMPEG_ZIP_URL, zip);
  await fs.rm(tmp, { recursive: true, force: true });
  console.log("⧉ extracting ffmpeg…");
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force`,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("Expand-Archive failed");

  // BtbN zip layout: ffmpeg-*/bin/{ffmpeg,ffprobe}.exe
  const root = (await fs.readdir(tmp)).find((d) => d.startsWith("ffmpeg"));
  if (!root) throw new Error("Could not locate extracted ffmpeg folder");
  const srcBin = path.join(tmp, root, "bin");
  await fs.copyFile(path.join(srcBin, "ffmpeg.exe"), ffmpegOut);
  await fs.copyFile(path.join(srcBin, "ffprobe.exe"), ffprobeOut);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(zip, { force: true });
  console.log("✓ ffmpeg.exe, ffprobe.exe");
}

async function main() {
  await fs.mkdir(BIN, { recursive: true });
  await fetchYtDlp();
  if (isWin) {
    await fetchFfmpegWindows();
  } else {
    console.log(
      "• Non-Windows: install ffmpeg via your package manager (brew install ffmpeg / apt install ffmpeg).",
    );
  }
  console.log(`\nDone. Binaries in ${BIN}`);
}

main().catch((err) => {
  console.error("\n✗ fetch-binaries failed:", err.message);
  process.exit(1);
});
