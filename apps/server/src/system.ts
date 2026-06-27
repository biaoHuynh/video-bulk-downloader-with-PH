import { spawn } from "node:child_process";
import { isWindows } from "./config.js";

/**
 * Open a native folder picker on the machine running the backend (= the user's
 * machine in local mode). Resolves to the chosen absolute path, or null if the
 * user cancelled. In the Electron build this is replaced by dialog.showOpenDialog.
 */
export async function pickFolder(initialDir?: string): Promise<string | null> {
  if (isWindows) return pickFolderWindows(initialDir);
  return pickFolderUnix(initialDir);
}

function pickFolderWindows(initialDir?: string): Promise<string | null> {
  const seed = initialDir ? `$f.SelectedPath = ${psQuote(initialDir)};` : "";
  const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = 'Select download folder'
$f.ShowNewFolderButton = $true
${seed}
$top = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($f.SelectedPath)
}
$top.Dispose()
`.trim();

  return new Promise((resolve) => {
    let out = "";
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      { windowsHide: true },
    );
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out.trim() || null));
  });
}

/** PowerShell single-quoted string literal (escape embedded quotes). */
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Fallback for non-Windows dev: try zenity/osascript, else null. */
function pickFolderUnix(initialDir?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "darwin"
        ? ["osascript", ["-e", 'POSIX path of (choose folder)']]
        : ["zenity", ["--file-selection", "--directory"]];
    const child = spawn(cmd[0] as string, cmd[1] as string[]);
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out.trim() || null));
    void initialDir;
  });
}
