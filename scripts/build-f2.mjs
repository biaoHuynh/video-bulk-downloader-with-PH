// Builds bin/f2.exe — a PyInstaller one-file bundle of scripts/f2_wrapper/vbd_f2.py
// (the f2 library + our CLI bridge) used as the Douyin/TikTok engine.
//
// Requires Python >= 3.10 (f2's requirement) on PATH, or via the `py` launcher.
// Run manually after cloning / when bumping f2:  pnpm build:f2
//
// This is intentionally NOT part of `pnpm setup` (it needs Python + builds a
// ~30-60MB exe). The app runs fine without it — the engine registry falls back
// to yt-dlp when bin/f2.exe is absent.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin");
const WRAPPER = path.join(__dirname, "f2_wrapper", "vbd_f2.py");
const F2_VERSION = process.env.VBD_F2_VERSION || ""; // "" = latest; pin e.g. "0.0.1.7"
const isWin = os.platform() === "win32";

/** Find a Python >= 3.10 interpreter. Returns the argv prefix to invoke it. */
function findPython() {
  const candidates = isWin
    ? [["py", "-3.12"], ["py", "-3.11"], ["py", "-3.10"], ["python"], ["python3"]]
    : [["python3.12"], ["python3.11"], ["python3.10"], ["python3"], ["python"]];
  for (const c of candidates) {
    const r = spawnSync(c[0], [...c.slice(1), "-c", "import sys;print('%d.%d'%sys.version_info[:2])"], {
      encoding: "utf8",
    });
    if (r.status === 0) {
      const [maj, min] = r.stdout.trim().split(".").map(Number);
      if (maj === 3 && min >= 10) return c;
    }
  }
  return null;
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

function main() {
  if (!fs.existsSync(WRAPPER)) throw new Error(`Wrapper not found: ${WRAPPER}`);
  const py = findPython();
  if (!py) {
    throw new Error(
      "No Python >= 3.10 found (f2 requires it). Install Python 3.10+ and retry, " +
        "or skip — the app falls back to yt-dlp when bin/f2.exe is absent.",
    );
  }
  console.log(`• Using Python: ${py.join(" ")}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vbd-f2-"));
  const venv = path.join(work, "venv");
  const venvBin = path.join(venv, isWin ? "Scripts" : "bin");
  const pyExe = path.join(venvBin, isWin ? "python.exe" : "python");

  try {
    run(py[0], [...py.slice(1), "-m", "venv", venv]);
    run(pyExe, ["-m", "pip", "install", "--upgrade", "pip"]);
    run(pyExe, ["-m", "pip", "install", `f2${F2_VERSION ? "==" + F2_VERSION : ""}`, "pyinstaller", "httpx"]);

    const dist = path.join(work, "dist");
    run(pyExe, [
      "-m",
      "PyInstaller",
      "--onefile",
      "--name",
      "f2",
      "--distpath",
      dist,
      "--workpath",
      path.join(work, "build"),
      "--specpath",
      work,
      // f2 ships data files (configs, signing assets); bundle the package wholesale.
      "--collect-all",
      "f2",
      WRAPPER,
    ]);

    fs.mkdirSync(BIN, { recursive: true });
    const out = path.join(dist, isWin ? "f2.exe" : "f2");
    const dest = path.join(BIN, isWin ? "f2.exe" : "f2");
    fs.copyFileSync(out, dest);
    if (!isWin) fs.chmodSync(dest, 0o755);
    console.log(`\n✓ Built ${dest}`);
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

try {
  main();
} catch (err) {
  console.error("\n✗ build-f2 failed:", err.message);
  process.exit(1);
}
