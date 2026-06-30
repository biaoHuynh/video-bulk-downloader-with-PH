// Build the distributable Windows installer end-to-end, so the app can be
// installed and launched from the Start menu without a terminal or the dev
// toolchain.
//
//   pnpm dist:app            full build
//   pnpm dist:app --skip-f2  skip the optional Douyin (f2) engine
//
// Steps:
//   1. Fetch binaries (yt-dlp, ffmpeg, BBDown) into ./bin   (idempotent)
//   2. Build the Douyin engine bin/f2.exe                   (optional, needs Python >= 3.10)
//   3. Rebuild better-sqlite3 for the Electron ABI
//   4. Build the web export + bundle the Electron main/server  (pnpm app:build)
//   5. Package the NSIS installer with electron-builder        (pnpm dist)
//
// Output: release/<product>-<version>-setup.exe
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const isWin = os.platform() === "win32";
const SKIP_F2 = process.argv.includes("--skip-f2");

function step(msg) {
  console.log(`\n=== ${msg} ===`);
}

/** Run a command, inheriting stdio. Exits the process on failure. */
function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, shell: true });
  if (r.status !== 0) {
    console.error(`\nBuild step failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

if (!isWin) {
  console.error(
    "This installer build targets Windows (NSIS + bundled BBDown/ffmpeg/f2). " +
      "Run it on Windows, or use `pnpm dev` for the web app on other platforms.",
  );
  process.exit(1);
}

// 1. Binaries — fetch-binaries skips anything already present.
step("1/5 Fetching binaries (yt-dlp, ffmpeg, BBDown)");
run("node", ["scripts/fetch-binaries.mjs"]);

// 2. Douyin engine (optional). Keep going if it can't be built — the app simply
// falls back to yt-dlp for Douyin.
const f2Path = path.join(ROOT, "bin", isWin ? "f2.exe" : "f2");
if (fs.existsSync(f2Path)) {
  step("2/5 Douyin engine (f2) already present — skipping");
} else if (SKIP_F2) {
  step("2/5 Skipping Douyin engine (f2) — --skip-f2");
  console.warn("Douyin will fall back to yt-dlp (currently unreliable).");
} else {
  step("2/5 Building Douyin engine (f2) — optional, needs Python >= 3.10");
  const r = spawnSync("node", ["scripts/build-f2.mjs"], { stdio: "inherit", cwd: ROOT, shell: true });
  if (r.status !== 0) {
    console.warn(
      "\nWARNING: could not build bin/f2.exe (Python >= 3.10 required). " +
        "Continuing — Douyin will fall back to yt-dlp. Install Python 3.10+ and re-run, " +
        "or pass --skip-f2 to silence this.\n",
    );
  }
}

// 3. The native module must match Electron's ABI, or the packaged app crashes on
// launch. (Switch back to the Node ABI with `pnpm rebuild:node` for web dev.)
step("3/5 Rebuilding better-sqlite3 for the Electron ABI");
run("pnpm", ["app:rebuild"]);

// 4 + 5. `pnpm dist` chains app:build (web export + electron bundle) and
// electron-builder (with code-signing discovery disabled).
step("4/5 + 5/5 Building and packaging the installer");
run("pnpm", ["dist"]);

// Report the artifact.
step("Done");
const releaseDir = path.join(ROOT, "release");
const installer = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).find((f) => /setup\.exe$/i.test(f))
  : null;
if (installer) {
  console.log(`Installer: ${path.join(releaseDir, installer)}`);
} else {
  console.log("Build complete — see the release/ folder.");
}
console.log("Install it once; the app then launches from the Start menu / desktop shortcut.");
console.log("Note: the better-sqlite3 ABI is now set for Electron. For web dev, run `pnpm rebuild:node`.");
