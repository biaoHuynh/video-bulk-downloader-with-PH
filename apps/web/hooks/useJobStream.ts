import { useEffect, useRef } from "react";
import type { ServerEvent } from "@vbd/shared";
import { API_BASE } from "@/lib/api";

/** Subscribe to a job's SSE stream; `onEvent` receives parsed ServerEvents. */
export function useJobStream(
  jobId: string | null,
  onEvent: (event: ServerEvent) => void,
): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`${API_BASE}/api/jobs/${jobId}/stream`);
    es.onmessage = (msg) => {
      try {
        cb.current(JSON.parse(msg.data) as ServerEvent);
      } catch {
        /* ignore keep-alive comments */
      }
    };
    return () => es.close();
  }, [jobId]);
}
