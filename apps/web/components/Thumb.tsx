"use client";

import { useState } from "react";
import { Film } from "lucide-react";
import type { Video } from "@vbd/shared";
import { thumbUrl } from "@/lib/api";
import { formatDuration } from "@/lib/format";

export function Thumb({ video }: { video: Video }) {
  const [failed, setFailed] = useState(false);
  const url = thumbUrl(video);

  return (
    <div className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded bg-[var(--color-surface-2)]">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={video.title}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-600">
          <Film size={18} />
        </div>
      )}
      {video.duration != null && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] font-medium tabular-nums text-white">
          {formatDuration(video.duration)}
        </span>
      )}
    </div>
  );
}
