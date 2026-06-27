"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CookieBrowser, CookieMode, Job } from "@vbd/shared";
import { updateJob } from "@/lib/api";

const BROWSERS: CookieBrowser[] = ["chrome", "edge", "firefox", "brave", "opera", "vivaldi"];

const field =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none focus:border-indigo-500";

export function CookieSelector({ job }: { job: Job }) {
  const qc = useQueryClient();
  const mutate = useMutation({
    mutationFn: (patch: Partial<Job>) => updateJob(job.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-400">Cookies:</span>
      <select
        value={job.cookieMode}
        onChange={(e) => mutate.mutate({ cookieMode: e.target.value as CookieMode })}
        className={field}
      >
        <option value="none">None</option>
        <option value="browser">From browser</option>
        <option value="file">cookies.txt file</option>
      </select>

      {job.cookieMode === "browser" && (
        <select
          value={job.cookieBrowser ?? "chrome"}
          onChange={(e) =>
            mutate.mutate({ cookieBrowser: e.target.value as CookieBrowser })
          }
          className={field}
        >
          {BROWSERS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      )}

      {job.cookieMode === "file" && (
        <input
          defaultValue={job.cookieFilePath ?? ""}
          onBlur={(e) => mutate.mutate({ cookieFilePath: e.target.value.trim() || null })}
          placeholder="C:\\path\\to\\cookies.txt"
          className={`${field} w-64`}
        />
      )}
    </div>
  );
}
