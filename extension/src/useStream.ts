// Подписка на глобальный стрим конспекта (streamStore в SW). Любая поверхность
// (попап, кабинет, будущие) подключается одинаково: при connect сразу получает снапшот
// текущего статуса, дальше — каждое изменение. Стрим переживает закрытие окна: на
// повторном открытии снапшот вернёт «идёт/готово» (#11/#16). start/stop — команды в SW.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamStatus } from "./streamStore";

type StreamSnap = {
  status: StreamStatus;
  url: string;
  text: string;
  title: string | null;
  phase: 0 | 1 | 2;
  error: string;
  // errorReason — сырой код причины (not_configured/…) из SW streamStore. Нужен
  // отдельно от человекочитаемого error: попап должен уметь отличить «сервер не
  // настроен» от обычной ошибки и дать CTA в настройки, а не тупик.
  errorReason: string;
};

const IDLE: StreamSnap = { status: "idle", url: "", text: "", title: null, phase: 0, error: "", errorReason: "" };

// Orphaning после обновления расширения: chrome.runtime.id становится undefined,
// connect/sendMessage бросают «Extension context invalidated». Гuard перед вызовами.
function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function useStream(): { s: StreamSnap; start: (url: string) => void; stop: () => void } {
  const [s, setS] = useState<StreamSnap>(IDLE);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  useEffect(() => {
    if (!isExtensionContextValid()) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: "digest-stream" });
    } catch {
      // Контекст стал невалиден (orphaning) — не вешаем слушателей на мёртвый порт.
      return;
    }
    portRef.current = port;
    port.onMessage.addListener((m: { type?: string; status?: string; url?: string; text?: string; title?: string | null; phase?: 0 | 1 | 2; error?: string; errorReason?: string }) => {
      if (!m || m.type !== "state") return;
      setS({
        status: (m.status as StreamStatus) ?? "idle",
        url: m.url ?? "",
        text: m.text ?? "",
        title: m.title ?? null,
        phase: (m.phase as 0 | 1 | 2) ?? 0,
        error: m.error ?? "",
        errorReason: m.errorReason ?? "",
      });
    });
    // SW убил порт (terminator без активного стрима). Без onDisconnect хук зависал бы
    // в застывшем state — стрим шёл, SW умер, новых onMessage нет, статус не меняется.
    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });
    return () => {
      try { port.disconnect(); } catch { /* уже */ }
      portRef.current = null;
    };
  }, []);
  const start = useCallback((url: string) => {
    try { portRef.current?.postMessage({ type: "start", url }); } catch { /* порт ушёл */ }
  }, []);
  const stop = useCallback(() => {
    try { portRef.current?.postMessage({ type: "stop" }); } catch { /* порт ушёл */ }
  }, []);
  return { s, start, stop };
}
