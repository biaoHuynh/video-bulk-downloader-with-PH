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

/** Recursively find the first file named `name` under `dir`. */
async function findFile(dir, name) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const hit = await findFile(p, name);
      if (hit) return hit;
    } else if (ent.name.toLowerCase() === name.toLowerCase()) {
      return p;
    }
  }
  return null;
}

// Bilibili download engine: nilaoda/BBDown self-contained win-x64 single exe.
// The release asset is version-stamped, so resolve it via the GitHub API.
async function fetchBBDownWindows() {
  const out = path.join(BIN, "BBDown.exe");
  if (!FORCE && (await exists(out))) {
    console.log("• BBDown already present (use --force to re-download)");
    return;
  }
  console.log("↓ resolving BBDown latest release…");
  const rel = await fetch("https://api.github.com/repos/nilaoda/BBDown/releases/latest", {
    headers: { "User-Agent": "vbd-fetch", Accept: "application/vnd.github+json" },
  });
  if (!rel.ok) throw new Error(`GitHub API HTTP ${rel.status}`);
  const json = await rel.json();
  const asset = (json.assets || []).find((a) => /win-x64\.zip$/i.test(a.name));
  if (!asset) throw new Error("No win-x64 asset in latest BBDown release");

  const tmp = path.join(BIN, "_bbdown_tmp");
  const zip = path.join(BIN, "_bbdown.zip");
  await download(asset.browser_download_url, zip);
  await fs.rm(tmp, { recursive: true, force: true });
  console.log("⧉ extracting BBDown…");
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force`],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("Expand-Archive failed");
  const exe = await findFile(tmp, "BBDown.exe");
  if (!exe) throw new Error("BBDown.exe not found in archive");
  await fs.copyFile(exe, out);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(zip, { force: true });
  console.log("✓ BBDown.exe");
}

async function main() {
  await fs.mkdir(BIN, { recursive: true });
  await fetchYtDlp();
  if (isWin) {
    await fetchFfmpegWindows();
    await fetchBBDownWindows();
  } else {
    console.log(
      "• Non-Windows: install ffmpeg via your package manager (brew install ffmpeg / apt install ffmpeg).",
    );
  }
  console.log(
    "\n• Douyin/TikTok engine (bin/f2.exe) is built separately: `pnpm build:f2` (needs Python 3.10+).",
  );
  console.log(`\nDone. Binaries in ${BIN}`);
}

main().catch((err) => {
  console.error("\n✗ fetch-binaries failed:", err.message);
  process.exit(1);
});
