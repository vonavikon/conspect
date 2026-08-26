// Страница опций self-host: настройка подключения к серверу (адрес + пароль доступа)
// + архив конспектов из локального кэша chrome.storage (listDigests, полный markdown
// уже в кэше — по сети подтягивать нечего). Входа/оплаты нет: сервер stateless,
// доступ защищён общим токеном в .env.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings, type Digest } from "./lib/store";
import {
  AMBER,
  BORDER,
  CARD,
  CELL,
  CELL2,
  EASE,
  ERR,
  FONT_MONO,
  FONT_SANS,
  INPUT_BG,
  LINE,
  LINE2,
  MUT,
  OK,
  SEC,
  SHADOW_CARD,
  SURFACE,
  SURFACE_HEAD,
  TEXT,
  YT_BLUE,
  panelBox,
  mdBodyCss,
  panelBodyCss,
  skeuoCss,
  pageTexCss,
  focusRingCss,
  reducedMotionCss,
  swapCss,
} from "./theme/conspectTheme";
import { Clogo, IconCheck, IconClock, IconDownload, IconRead, IconSearch, IconTrash, IconYoutube } from "./theme/icons";
import { fmtDuration, fileName, pluralRu, extractTeasers, savedMinutes, splitTldr, totalSaved, wrapFrontmatter, downloadBlob, fmtDate, hashUrl } from "./panel/format";
import { renderMarkdown } from "./lib/markdown";
import { injectFonts } from "./lib/fonts";
import { SkelSwap, Skeleton } from "./screens/cards";
import { useStream } from "./useStream";

type Status = { configured?: boolean; baseUrl?: string };
type Msg = { text: string; kind: "ok" | "err" | "muted" };
type Health = { state: "idle" | "checking" | "ok" | "err"; text: string };

function shortUrl(u: string): string {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + x.pathname + (x.search || ""); } catch { return u; }
}

export function Options() {
  const [status, setStatus] = useState<Status | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [health, setHealth] = useState<Health>({ state: "idle", text: "" });
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { s: stream } = useStream();
  const initialExpand = new URLSearchParams(location.search).get("expand");
  // baseUrl подгружаем один раз (на mount), дальше поле редактируется свободно.
  const baseLoaded = useRef(false);

  async function refresh(): Promise<void> {
    const st = (await chrome.runtime.sendMessage({ type: "status" })) as Status | undefined;
    setStatus(st ?? { configured: false, baseUrl: "" });
    if (!baseLoaded.current) {
      const s = await loadSettings();
      setBaseUrl(s.baseUrl || "http://localhost:3000");
      baseLoaded.current = true;
    }
    setLoadingHist(true);
    const r = (await chrome.runtime.sendMessage({ type: "listDigests" })) as { digests?: Digest[] } | undefined;
    setDigests(r?.digests ?? []);
    setLoadingHist(false);
  }

  useEffect(() => {
    void (async () => {
      await refresh();
      const st = (await chrome.runtime.sendMessage({ type: "status" })) as Status | undefined;
      if (st?.configured) await checkHealth();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Сохранить. Код в поле может быть пустым (не хотим светить его в DOM) — тогда
  // оставляем прежний. Читаем текущий sharedToken напрямую из storage.
  async function persist(): Promise<void> {
    const existing = await loadSettings();
    const finalToken = token.trim() ? token.trim() : (existing.sharedToken ?? "");
    await chrome.runtime.sendMessage({ type: "saveSettings", baseUrl, sharedToken: finalToken });
  }

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      await persist();
      setMsg({ text: "Сохранено", kind: "ok" });
    } catch {
      setMsg({ text: "Не получилось сохранить. Попробуйте ещё раз.", kind: "err" });
    } finally {
      setSaving(false);
      void refresh();
    }
  }

  async function checkHealth(): Promise<void> {
    setHealth({ state: "checking", text: "" });
    const r = (await chrome.runtime.sendMessage({ type: "health" })) as { ok?: boolean; error?: string } | undefined;
    if (r?.ok) setHealth({ state: "ok", text: "Сервер доступен" });
    else if (r?.error === "no_baseurl") setHealth({ state: "err", text: "Укажите адрес сервера." });
    else setHealth({ state: "err", text: "Сервер недоступен. Проверьте адрес и токен." });
  }

  async function onCheck(): Promise<void> {
    await persist();
    await checkHealth();
    void refresh();
  }

  async function onClear(): Promise<void> {
    await chrome.runtime.sendMessage({ type: "clearDigests" });
    void refresh();
  }

  async function onDelete(d: Digest): Promise<void> {
    await chrome.runtime.sendMessage({ type: "deleteDigest", urlHash: d.urlHash });
    void refresh();
  }

  async function onDownload(d: Digest): Promise<void> {
    setDownloading(d.urlHash);
    try {
      downloadBlob(
        fileName(d.title ?? undefined),
        wrapFrontmatter({ meta: { title: d.title ?? undefined, channel: d.channel ?? undefined, durationSec: d.durationSec ?? undefined, lang: d.lang ?? undefined }, conspectus: d.markdown }, d.url),
      );
    } finally {
      setDownloading(null);
    }
  }

  const openRead = (d: Digest): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(d.urlHash)}&u=${encodeURIComponent(d.url)}`) });
  };

  // ?expand=<hash> (из попапа «недавние»): раскрыть превью этого конспекта и докрутить.
  useEffect(() => {
    if (!initialExpand || loadingHist) return;
    const row = digests.find((d) => d.urlHash === initialExpand);
    if (!row) return;
    setOpenHash(row.urlHash);
    requestAnimationFrame(() => {
      document.getElementById(`cab-row-${row.urlHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // одноразовое: зависит только от готовности списка
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExpand, loadingHist]);

  const saved = totalSaved(digests.map((d) => d.durationSec));
  const ql = q.trim().toLowerCase();
  const filtered = ql ? digests.filter((d) => (d.title ?? "").toLowerCase().includes(ql) || (d.channel ?? "").toLowerCase().includes(ql)) : digests;
  const cols = "54px 1fr 46px 70px 84px";
  // Индикатор сервера в шапке: зелёный/красный по авто-проверке /health.
  const serverDot = health.state === "err" ? ERR : health.state === "ok" ? OK : status?.configured ? OK : MUT;
  const serverLabel = health.state === "checking" ? "проверяю…" : health.state === "err" ? "ошибка" : health.state === "ok" ? "сервер доступен" : status?.configured ? "подключено" : "не подключено";

  return (
    <div style={{ minHeight: "100vh", background: "transparent", color: TEXT, padding: "48px 20px 64px", display: "flex", flexDirection: "column", alignItems: "center", gap: 22, font: `14px/1.55 ${FONT_SANS}`, animation: `cs-page-in .26s ${EASE} both` }}>
      <style>{`*{box-sizing:border-box}body{margin:0;${pageTexCss}}@keyframes cs-page-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}`}</style>
      <style>{skeuoCss}{swapCss}{focusRingCss}{`.cs-cab-q::placeholder{color:${MUT}}.cs-set-input{width:100%;font:500 12.5px ${FONT_MONO};padding:9px 11px;border-radius:9px;border:1px solid ${BORDER};background:${INPUT_BG};color:${TEXT};box-shadow:inset 0 2px 4px rgba(0,0,0,.5),inset 0 1px 0 rgba(0,0,0,.4);transition:box-shadow .12s ${EASE},border-color .12s ${EASE}}.cs-set-input::placeholder{color:${MUT}}.cs-set-input:focus{outline:none;border-color:${AMBER};box-shadow:inset 0 2px 4px rgba(0,0,0,.5),0 0 0 2px rgba(245,166,35,.55)}.cab-expand{display:grid;grid-template-rows:0fr;opacity:0;padding:0 18px;border-top:1px solid transparent;background:transparent;transition:grid-template-rows .34s ${EASE},opacity .26s ${EASE},padding .34s ${EASE},border-top-color .2s ${EASE},background .3s ${EASE}}.cab-expand>div{overflow:hidden;min-height:0;opacity:0;filter:blur(2px);transition:opacity .26s ${EASE},filter .26s ${EASE}}.cab-expand.open{grid-template-rows:1fr;opacity:1;padding:13px 18px 15px;border-top-color:#161616;background:${CELL}}.cab-expand.open>div{opacity:1;filter:blur(0)}`}</style>
      <style>{reducedMotionCss}</style>

      {/* --- настройка сервера --- */}
      <div style={{ width: 540, maxWidth: "100%", overflow: "hidden", ...panelBox }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 18px", borderBottom: `1px solid ${BORDER}`, background: SURFACE_HEAD, boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)" }}>
          <Clogo size={18} />
          <span style={{ font: `800 15px ${FONT_SANS}` }}>Conspect</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `600 10.5px ${FONT_SANS}`, color: serverDot, letterSpacing: ".04em", textTransform: "uppercase" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: serverDot, boxShadow: "0 0 0 2px rgba(0,0,0,.35)" }} />
            {serverLabel}
          </span>
        </div>
        <div style={{ padding: "16px 18px 18px" }}>
          <div style={{ font: `600 10.5px ${FONT_SANS}`, color: SEC, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 6 }}>Адрес сервера</div>
          <input className="cs-set-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:3000" aria-label="Адрес сервера" spellCheck={false} autoComplete="off" />
          <div style={{ font: `500 10.5px/1.45 ${FONT_SANS}`, color: MUT, margin: "7px 2px 0" }}>Куда расширение отправляет запросы. Без слэша в конце. Локально сервер слушает <code style={{ font: FONT_MONO, color: SEC }}>http://localhost:3000</code>. Если сервер на своём VPS, вставьте адрес вида <code style={{ font: FONT_MONO, color: SEC }}>https://ваш-домен</code>.</div>

          <div style={{ font: `600 10.5px ${FONT_SANS}`, color: SEC, letterSpacing: ".04em", textTransform: "uppercase", margin: "16px 0 6px" }}>Пароль доступа</div>
          <input className="cs-set-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="придумайте пароль" aria-label="Пароль доступа" spellCheck={false} autoComplete="off" />
          <div style={{ font: `500 10.5px/1.45 ${FONT_SANS}`, color: MUT, margin: "7px 2px 0" }}>Придумайте любой пароль. Без него чужой, кто знает адрес, будет тратить ваш платный LLM-ключ. Этот же пароль впишите на сервере в <code style={{ font: FONT_MONO, color: SEC }}>.env</code> (строка <code style={{ font: FONT_MONO, color: SEC }}>SHARED_TOKEN</code>).</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
            <button onClick={() => void onSave()} className="cs-btn filled sm" disabled={saving}>{saving ? "Сохраняю…" : "Сохранить"}</button>
            <button onClick={() => void onCheck()} className="cs-btn sm" disabled={health.state === "checking"}>{health.state === "checking" ? "Проверяю…" : "Проверить"}</button>
            {health.state === "ok" && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: `500 11px ${FONT_SANS}`, color: OK }}><IconCheck size={13} /> {health.text}</span>}
            {health.state === "err" && <span style={{ font: `500 11px ${FONT_SANS}`, color: ERR }}>{health.text}</span>}
            {msg && <span style={{ font: `500 11px ${FONT_SANS}`, color: msg.kind === "err" ? ERR : OK }}>{msg.text}</span>}
          </div>
        </div>
      </div>

      {/* --- архив --- */}
      <div style={{ width: "100%", maxWidth: 540, backgroundColor: CARD, backgroundImage: `${"repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 2px,transparent 2px 4px)"},${"radial-gradient(120% 90% at 50% 42%,rgba(15,15,15,0) 26%,rgba(15,15,15,.86) 100%)"},${SURFACE}`, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: SHADOW_CARD }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 18px", borderBottom: `1px solid ${BORDER}`, background: SURFACE_HEAD, boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)" }}>
          <span style={{ font: `800 15px ${FONT_SANS}` }}>Архив</span>
          <span style={{ font: `600 11px ${FONT_MONO}`, color: MUT }}>{digests.length} {pluralRu(digests.length, ["конспект", "конспекта", "конспектов"])}</span>
          <span style={{ flex: 1 }} />
          {digests.length > 0 && <button onClick={() => void onClear()} className="cs-btn sm">Очистить кэш</button>}
        </div>

        {/* баннер активного стрима: генерация идёт/готова → открыть окно. */}
        {stream.status !== "idle" && (() => {
          const done = stream.status === "done";
          const accent = done ? OK : AMBER;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 18px", borderBottom: `1px solid ${LINE}`, background: done ? "linear-gradient(180deg,rgba(46,166,111,.07),rgba(46,166,111,.02))" : "linear-gradient(180deg,rgba(245,166,35,.07),rgba(245,166,35,.02))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}>
              <span className={done ? "cs-swap done" : "cs-swap"} style={{ width: 26, height: 26, flex: "0 0 auto" }}>
                <span style={{ width: "100%", height: "100%", borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(245,166,35,.14)", border: "1px solid rgba(245,166,35,.4)", color: AMBER }}>
                  <Clogo size={14} busy={!done} spin />
                </span>
                <span style={{ width: "100%", height: "100%", borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(180deg,#3ec47f,#2ea66f 50%,#1f7d52)", border: "1px solid #145c39", color: "#0d2418", boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.4)" }}>
                  <IconCheck size={14} />
                </span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 11px ${FONT_SANS}`, color: accent }}>{done ? "Конспект готов" : "Идёт конспект"}</div>
                <div style={{ font: `500 11px ${FONT_SANS}`, color: SEC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stream.title ?? (stream.url ? shortUrl(stream.url) : "YouTube")}</div>
              </div>
              {done && stream.url && (
                <button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL(`read.html?h=${encodeURIComponent(hashUrl(stream.url))}&u=${encodeURIComponent(stream.url)}`) })} className="cs-btn sm">Читать</button>
              )}
              {stream.url && <button onClick={() => void chrome.tabs.create({ url: stream.url })} className="cs-btn sm">Открыть</button>}
            </div>
          );
        })()}

        {/* сэкономлено за всё время */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: `1px solid ${LINE}`, background: "linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02))", border: `1px solid ${LINE2}`, display: "grid", placeItems: "center", color: SEC, boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)", flex: "0 0 auto" }}><IconClock size={18} /></span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 7px", minWidth: 0 }}>
              <div style={{ font: `600 10.5px ${FONT_SANS}`, color: SEC, letterSpacing: ".04em", textTransform: "uppercase" }}>Сэкономлено за всё время</div>
              <div style={{ font: `700 15px ${FONT_SANS}`, color: TEXT, whiteSpace: "nowrap" }}>{saved.totalMin} мин</div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 7px", minWidth: 0 }}>
              <div style={{ font: `600 10.5px ${FONT_SANS}`, color: SEC, letterSpacing: ".04em", textTransform: "uppercase" }}>в среднем на видео</div>
              <div style={{ font: `700 15px ${FONT_SANS}`, color: TEXT, whiteSpace: "nowrap" }}>{saved.count > 0 ? `${saved.avgMin} мин` : "—"}</div>
            </div>
          </div>
        </div>

        {/* поиск */}
        <div style={{ padding: "11px 18px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, background: INPUT_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 11px", boxShadow: "inset 0 2px 4px rgba(0,0,0,.5), inset 0 1px 0 rgba(0,0,0,.4)" }}>
            <IconSearch size={15} style={{ color: MUT, flex: "0 0 auto" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию или каналу" aria-label="Поиск конспектов по названию или каналу" className="cs-cab-q" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: TEXT, font: `500 12px ${FONT_SANS}`, minWidth: 0 }} />
          </div>
        </div>

        {/* шапка колонок */}
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 11, padding: "10px 18px", font: `600 10px ${FONT_SANS}`, color: MUT, letterSpacing: ".06em", textTransform: "uppercase", borderBottom: `1px solid ${LINE}` }}>
          <span>Дата</span><span>Видео</span><span>Длит.</span><span>Сэкономлено</span><span />
        </div>

        <SkelSwap loading={loadingHist} skeleton={<div style={{ padding: "14px 18px" }}><Skeleton rows={[16, 42, 42, 42, 42]} /></div>}>
          {filtered.length === 0 ? (
          <div style={{ font: `500 12.5px ${FONT_SANS}`, color: MUT, padding: "16px 18px" }}>{ql ? "Ничего не найдено." : "Конспектов пока нет. Откройте видео на YouTube и нажмите кнопку Conspect."}</div>
        ) : (
          filtered.map((d) => {
            const sv = savedMinutes(d.durationSec);
            const open = openHash === d.urlHash;
            const tldr = splitTldr(d.markdown).tldr;
            const teasers = extractTeasers(d.markdown);
            return (
              <div key={d.urlHash}>
                <div
                  id={`cab-row-${d.urlHash}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  aria-label={`${d.title ?? "Без названия"} — развернуть превью`}
                  onClick={() => {
                    const next = open ? null : d.urlHash;
                    setOpenHash(next);
                    // Плавно докручиваем раскрытую строку в центр — иначе превью
                    // раскрывается ниже края вьюпорта и «дёргается» при ручном скролле.
                    if (next) {
                      requestAnimationFrame(() => {
                        document.getElementById(`cab-row-${d.urlHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      });
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenHash(open ? null : d.urlHash); } }}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 11, alignItems: "center", padding: "11px 18px", borderTop: `1px solid #161616`, transition: `background .15s ${EASE}`, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(245,166,35,.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ font: `500 10.5px ${FONT_MONO}`, color: SEC }}>{fmtDate(d.ts)}</span>
                  <div style={{ minWidth: 0 }} title={d.url}>
                    <div style={{ font: `500 11.5px/1.3 ${FONT_SANS}`, color: TEXT, minWidth: 0 }}>{d.title ?? "Без названия"}</div>
                  </div>
                  <span style={{ font: `500 12.5px ${FONT_MONO}`, color: SEC }}>{fmtDuration(d.durationSec ?? undefined)}</span>
                  <span style={{ font: `600 12.5px ${FONT_MONO}`, color: OK }}>{sv > 0 ? `${sv} мин` : "—"}</span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <button type="button" title="Прочитать" aria-label="Прочитать" onClick={() => setOpenHash(open ? null : d.urlHash)} className="cs-mini" style={open ? { background: "rgba(245,166,35,.14)", borderColor: "rgba(245,166,35,.55)", color: AMBER } : undefined}><IconRead size={15} /></button>
                    <button type="button" title="Скачать .md" aria-label="Скачать .md" onClick={() => onDownload(d)} className="cs-mini">{downloading === d.urlHash ? <Clogo size={13} busy /> : <IconDownload size={15} />}</button>
                    <button type="button" title="Открыть на YouTube" aria-label="Открыть на YouTube" onClick={() => void chrome.tabs.create({ url: d.url })} className="cs-mini"><IconYoutube size={15} /></button>
                    <button type="button" title="Удалить" aria-label="Удалить конспект" onClick={() => void onDelete(d)} className="cs-mini" style={{ color: ERR }}><IconTrash size={15} /></button>
                  </span>
                </div>

                <Expand open={open}>
                  <style>{mdBodyCss}{panelBodyCss}</style>
                  {tldr && (
                    <div style={{ background: "none", border: "none", borderRadius: 0, padding: 0, margin: "0 0 10px" }}>
                      <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Главная мысль</span>
                      <div className="md-body" style={{ font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC, textAlign: "left" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(tldr) }} />
                    </div>
                  )}
                  {teasers.length > 0 && (
                    <div style={{ marginBottom: 0 }}>
                      <span style={{ display: "block", font: `700 10.5px ${FONT_SANS}`, color: YT_BLUE, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Основные тезисы</span>
                      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {teasers.map((t, i) => (
                          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "0 0 5px", font: `500 11.5px/1.5 ${FONT_SANS}`, color: SEC }}>
                            <span style={{ flex: "0 0 auto", marginTop: 3, background: CELL2, color: MUT, font: `500 9px ${FONT_MONO}`, padding: "1px 4px", borderRadius: 3, lineHeight: 1.4 }}>{i + 1}</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <button onClick={() => openRead(d)} className="cs-btn filled block" style={{ marginTop: 12 }}><IconRead size={13} /> Читать полностью</button>
                </Expand>
              </div>
            );
          })
          )}
        </SkelSwap>
      </div>
    </div>
  );
}

// Разворот строки архива: grid-rows 0fr/1fr (transitions.dev №21, единый паттерн с
// .cs-pop-expand в попапе) — высота схлопывается точно по контенту, без max-height-
// костыля. При open=true монтируется и в следующем кадре раскрывается; при open=false
// доигрывает закрытие ~340мс, потом размонтируется. Содержимое держим всё это время.
function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  const [cls, setCls] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      const id = requestAnimationFrame(() => setCls(true));
      return () => cancelAnimationFrame(id);
    }
    setCls(false);
    const t = setTimeout(() => setShown(false), 340);
    return () => clearTimeout(t);
  }, [open]);
  if (!shown) return null;
  return <div className={`cab-expand${cls ? " open" : ""}`}><div>{children}</div></div>;
}

injectFonts();
createRoot(document.getElementById("root")!).render(<Options />);
