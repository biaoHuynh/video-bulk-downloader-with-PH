import { EventEmitter } from "node:events";
import type { ServerEvent } from "@vbd/shared";

/**
 * In-process pub/sub for per-job server events. Routes subscribe a listener that
 * writes SSE frames; producers (scan, download queue) call `emit`.
 */
class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Many concurrent SSE connections + producers; no artificial cap.
    this.emitter.setMaxListeners(0);
  }

  emit(jobId: string, event: ServerEvent): void {
    this.emitter.emit(jobId, event);
  }

  subscribe(jobId: string, listener: (event: ServerEvent) => void): () => void {
    this.emitter.on(jobId, listener);
    return () => this.emitter.off(jobId, listener);
  }
}

export const bus = new EventBus();
