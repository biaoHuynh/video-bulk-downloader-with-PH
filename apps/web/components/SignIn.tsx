"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, Loader2 } from "lucide-react";
import type { Job, Platform } from "@vbd/shared";
import { platformLabel } from "@vbd/shared";
import { updateJob } from "@/lib/api";

const PLATFORMS: Platform[] = ["bilibili", "douyin", "tiktok", "youtube"];

/**
 * Electron-only: per-platform "Sign in" that opens an embedded login window,
 * captures the session cookies into a cookies.txt, and switches the job to file
 * mode. Renders nothing in the plain web app.
 */
export function SignIn({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState<Platform | null>(null);
  const [done, setDone] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  if (!mounted || !window.electronAPI) return null;

  const login = async (p: Platform) => {
    setBusy(p);
    setError(null);
    try {
      const { path, loggedIn } = await window.electronAPI!.login(p);
      if (path && loggedIn) {
        // Real session cookie captured → switch to file mode and show ✓.
        await updateJob(job.id, { cookieMode: "file", cookieFilePath: path });
        qc.invalidateQueries({ queryKey: ["workspace"] });
        setDone(p);
      } else if (path) {
        // Got cookies but no logged-in session → still use them (helps anti-bot)
        // but don't claim success: the user likely closed before finishing login.
        await updateJob(job.id, { cookieMode: "file", cookieFilePath: path });
        qc.invalidateQueries({ queryKey: ["workspace"] });
        setError(`No signed-in session for ${platformLabel(p)} — finish logging in, then close the window.`);
      } else {
        setError(`No cookies captured for ${platformLabel(p)} (did you log in?)`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
      <span className="inline-flex items-center gap-1">
        <LogIn size={13} /> Sign in:
      </span>
      {PLATFORMS.map((p) => (
        <button
          key={p}
          onClick={() => login(p)}
          disabled={busy !== null}
          title={`Open ${platformLabel(p)} login — log in, then close that window`}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {busy === p && <Loader2 size={11} className="animate-spin" />}
          {platformLabel(p)}
          {done === p ? " ✓" : ""}
        </button>
      ))}
      {error && <span className="text-amber-400">{error}</span>}
    </div>
  );
}
