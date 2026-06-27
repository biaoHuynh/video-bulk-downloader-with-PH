import type {
  Job,
  Scan,
  Video,
  YtDlpVersion,
  CookieMode,
  CookieBrowser,
  Platform,
} from "@vbd/shared";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:4319";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* workspace (the single hidden job the UI uses) */
export const getWorkspace = () =>
  req<{ job: Job; scans: Scan[] }>("/api/workspace");

/* jobs */
export const listJobs = () => req<Job[]>("/api/jobs");
export const createJob = (name: string) =>
  req<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ name }) });
export const getJob = (id: string) =>
  req<{ job: Job; scans: Scan[] }>(`/api/jobs/${id}`);
export const updateJob = (
  id: string,
  patch: Partial<{
    name: string;
    cookieMode: CookieMode;
    cookieBrowser: CookieBrowser | null;
    cookieFilePath: string | null;
    defaultFolder: string | null;
  }>,
) => req<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteJob = (id: string) =>
  req<void>(`/api/jobs/${id}`, { method: "DELETE" });

/* scans + videos */
export const scanJob = (jobId: string, url: string, limit?: number) =>
  req<Scan>(`/api/jobs/${jobId}/scan`, {
    method: "POST",
    body: JSON.stringify({ url, limit }),
  });
export const getScan = (scanId: string) =>
  req<{ scan: Scan; videos: Video[] }>(`/api/scans/${scanId}`);
export const listScans = (jobId: string) =>
  req<Scan[]>(`/api/jobs/${jobId}/scans`);

/* downloads */
export const startDownload = (jobId: string, videoIds: string[], folder: string) =>
  req<{ enqueued: string[] }>(`/api/jobs/${jobId}/download`, {
    method: "POST",
    body: JSON.stringify({ videoIds, folder }),
  });
export const cancelDownload = (videoId: string) =>
  req<{ ok: boolean }>(`/api/downloads/${videoId}/cancel`, { method: "POST" });
export const retryDownload = (videoId: string) =>
  req<{ ok: boolean }>(`/api/downloads/${videoId}/retry`, { method: "POST" });

/* system */
export const pickFolder = (initialDir?: string) =>
  req<{ path: string | null }>("/api/system/pick-folder", {
    method: "POST",
    body: JSON.stringify({ initialDir }),
  });
export const getYtDlpVersion = () =>
  req<YtDlpVersion>("/api/system/ytdlp-version");

export interface Cooldown {
  platform: Platform;
  remainingMs: number;
  until: number;
}
export const getCooldowns = () => req<Cooldown[]>("/api/system/cooldowns");
export const updateYtDlp = () =>
  req<{ ok: boolean; output: string }>("/api/system/update-ytdlp", {
    method: "POST",
  });

/* thumbnail proxy */
export function thumbUrl(video: { thumbnailUrl: string | null; platform: Platform }) {
  if (!video.thumbnailUrl) return null;
  return `${API_BASE}/api/thumb?u=${encodeURIComponent(video.thumbnailUrl)}&p=${video.platform}`;
}
