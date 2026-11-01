// Subscription to the global digest stream (streamStore in the SW). Any surface
// (popup, dashboard, future ones) connects the same way: on connect it immediately gets a snapshot
// of the current status, then every change. The stream survives window closure: on
// reopening, the snapshot returns "running/finished" (#11/#16). start/stop — commands to the SW.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamStatus, QueueItem } from "./streamStore";

type StreamSnap = {
  status: StreamStatus;
  url: string;
  text: string;
  title: string | null;
  phase: 0 | 1 | 2;
  error: string;
  // errorReason — the raw reason code (not_configured/…) from the SW streamStore. Needed
  // separately from the human-readable error: the popup must tell "server not configured"
  // from an ordinary error and offer a CTA to settings, not a dead end.
  errorReason: string;
  // When work on the url began (epoch-ms: click or enqueue) — the timer counts
  // from it and is not reset when the surface reopens.
  startedAt: number | null;
  // Chunking: "part i/N" in the map phase of a long video — the progress bar in the loading card.
  progress: { i: number; n: number } | null;
  // The queue of waiting urls (a snapshot, in add order). The dashboard shows it
  // and allows removing/reordering — that is why the field arrives in the snapshot.
  queue: QueueItem[];
};

const IDLE: StreamSnap = { status: "idle", url: "", text: "", title: null, phase: 0, error: "", errorReason: "", startedAt: null, progress: null, queue: [] };

// Orphaning after an extension update: chrome.runtime.id becomes undefined,
// connect/sendMessage throw "Extension context invalidated" synchronously. Guard before calls.
function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function useStream(): {
  s: StreamSnap;
  start: (url: string) => void;
  stop: () => void;
  removeFromQueue: (url: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
} {
  const [s, setS] = useState<StreamSnap>(IDLE);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  useEffect(() => {
    if (!isExtensionContextValid()) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: "digest-stream" });
    } catch {
      // The context became invalid (orphaning) — do not hang listeners on a dead port.
      return;
    }
    portRef.current = port;
    port.onMessage.addListener((m: { type?: string; status?: string; url?: string; text?: string; title?: string | null; phase?: 0 | 1 | 2; error?: string; errorReason?: string; startedAt?: number | null; progress?: { i: number; n: number } | null; queue?: QueueItem[] }) => {
      if (!m || m.type !== "state") return;
      setS({
        status: (m.status as StreamStatus) ?? "idle",
        url: m.url ?? "",
        text: m.text ?? "",
        title: m.title ?? null,
        phase: (m.phase as 0 | 1 | 2) ?? 0,
        error: m.error ?? "",
        errorReason: m.errorReason ?? "",
        startedAt: m.startedAt ?? null,
        progress: m.progress ?? null,
        queue: m.queue ?? [],
      });
    });
    // The SW killed the port (terminator with no active stream). Without onDisconnect the hook would
    // hang in a frozen state — the stream ran, the SW died, no new onMessage arrive, the status does not change.
    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });
    // Keepalive: keeps the SW alive during a long LLM "first token" — ping frames
    // alone do not reset the SW idle timer; the worker dies and the port breaks.
    const ka = setInterval(() => {
      try { port.postMessage({ type: "keepalive" }); } catch { /* port gone */ }
    }, 20000);
    return () => {
      clearInterval(ka);
      try { port.disconnect(); } catch { /* already */ }
      portRef.current = null;
    };
  }, []);
  const start = useCallback((url: string) => {
    try { portRef.current?.postMessage({ type: "start", url }); } catch { /* port gone */ }
  }, []);
  const stop = useCallback(() => {
    try { portRef.current?.postMessage({ type: "stop" }); } catch { /* port gone */ }
  }, []);
  const removeFromQueue = useCallback((url: string) => {
    try { portRef.current?.postMessage({ type: "removeFromQueue", url }); } catch { /* port gone */ }
  }, []);
  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    try { portRef.current?.postMessage({ type: "reorderQueue", fromIndex, toIndex }); } catch { /* port gone */ }
  }, []);
  return { s, start, stop, removeFromQueue, reorderQueue };
}
