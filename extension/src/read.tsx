// Страница чтения конспекта во вкладке (§08 reader). Открывается из архива
// («Читать полностью») — read.html?h=<urlHash>&u=<sourceUrl>. Читает готовый конспект
// из локального кэша chrome.storage (getDigest), рендерит markdown, строит оглавление
// с таймкодами из заголовков «## … (MM:SS)» и прогресс-бар чтения.
//
// Шапка-бар липкая при скролле: назад в архив, заголовок, иконки скопировать/скачать/
// YouTube. Полный текст внизу без отдельного футера — действия собраны в шапке.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderMarkdown } from "./lib/markdown";
import { getDigest, type Digest } from "./lib/store";
import { SkelSwap, Skeleton } from "./screens/cards";
import { fileName, fmtDuration, savedMinutes, splitTldr, wrapFrontmatter, downloadBlob, type Meta } from "./panel/format";
import { Clogo, IconArrowLeft, IconCheck, IconCopy, IconDownload, IconYoutube } from "./theme/icons";
import {
  AMBER,
  BORDER,
  BTN,
  BTN_BORDER,
  CELL,
  CTA,
  DIM,
  EASE,
  FONT_MONO,
  FONT_SANS,
  LINE,
  MUT,
  OK,
  SEC,
  SHADOW_BTN,
  SURFACE_HEAD,
  TEXT,
  TXT_SHADOW,
  YT_BLUE,
  mdBodyCss,
  readerBodyCss,
  focusRingCss,
  reducedMotionCss,
  pageTexCss,
  skeuoCss,
  swapCss,
} from "./theme/conspectTheme";
import { injectFonts } from "./lib/fonts";

type TocItem = { label: string; tc: string; idx: number };

export function Read() {
  const params = new URLSearchParams(location.search);
  const urlHash = params.get("h");
  const srcUrl = params.get("u");
  const [data, setData] = useState<Digest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      if (!urlHash) { setErr("Ссылка на конспект не передана. Откройте чтение из архива."); setLoading(false); return; }
      const d = await getDigest(urlHash);
      setLoading(false);
      if (!d) { setErr("Конспекта нет в кэше. Нажмите «Конспектировать» в видео, чтобы собрать заново."); return; }
      setData(d);
    })();
  }, [urlHash]);

  // Оглавление — из тех же отрендеренных h2, по которым скроллим. Единый источник
  // (DOM, а не сырой markdown) + сохранённый индекс убирают рассинхрон чипа и цели.
  // Заголовок «## Название (12:34)» рендерится как .rd-sh-t (название) + .tc (таймкод):
  // см. transformSectionHeaders в lib/markdown.ts.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !data?.markdown) { setToc([]); return; }
    const all = Array.from(root.querySelectorAll<HTMLElement>(".md-body h2"));
    const items: TocItem[] = [];
    all.forEach((h, i) => {
      const tc = h.querySelector(".tc")?.textContent?.trim() ?? "";
      const label = (h.querySelector(".rd-sh-t")?.textContent ?? h.textContent ?? "").trim();
      if (label) items.push({ label, tc, idx: i });
    });
    setToc(items);
  }, [data]);

  // Прогресс чтения: доля прокрутки страницы. rAF-дебаунс: без него каждый scroll-tick
  // звал setProgress → ре-рендер корневого Read → перевычисление splitTldr/renderMarkdown.
  useEffect(() => {
    let raf = 0;
    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const d = document.documentElement;
        const p = d.scrollTop / ((d.scrollHeight - d.clientHeight) || 1);
        setProgress(Math.max(0, Math.min(1, p)));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [loading]);

  function scrollToSection(i: number): void {
    const heads = bodyRef.current?.querySelectorAll<HTMLElement>(".md-body h2");
    heads?.[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const meta: Meta = {
    title: data?.title ?? undefined,
    channel: data?.channel ?? undefined,
    durationSec: data?.durationSec ?? undefined,
    lang: data?.lang ?? undefined,
  };
  const fullMd = (): string => wrapFrontmatter({ meta, conspectus: data?.markdown ?? "" }, srcUrl ?? "");

  async function copy(): Promise<boolean> {
    const text = fullMd();
    // Возвращаем промис, чтобы «✓ Скопировано» показывалось только после реальной
    // записи, а не синхронно до settle — иначе при реджекте буфера пользователь
    // видел бы успех при провале. 1:1 с copy() в ConspectPanel.
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Не-secure context / нет фокуса — clipboard API может быть недоступен.
      // Фолбэк на устаревший, но рабочий execCommand поверх основного документа.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }
  function download(): void {
    downloadBlob(fileName(meta.title), fullMd());
  }

  const sv = savedMinutes(data?.durationSec ?? null);
  const lang = data?.lang && data.lang !== "ru" ? data.lang.toUpperCase() : "RU";
  // memo: разбор/рендер markdown тяжёлые, а корневой Read ре-рендерится на каждом
  // scroll-tick (прогресс-бар). Без memo весь конспект ре-парсится каждый кадр.
  const { tldr, body: fullBody } = useMemo(
    () => (data?.markdown ? splitTldr(data.markdown) : { tldr: "", body: "" }),
    [data?.markdown],
  );
  const tldrHtml = useMemo(() => (tldr ? renderMarkdown(tldr, "reader") : ""), [tldr]);
  const bodyHtml = useMemo(() => renderMarkdown(fullBody, "reader"), [fullBody]);
  const cabinetHref = chrome.runtime.getURL("options.html");

  return (
    <>
      <style>{`*{box-sizing:border-box}@keyframes cs-page-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}`}</style>
      <style>{skeuoCss}</style>
      <style>{swapCss}</style>
      <style>{`html,body{margin:0;min-height:100vh;${pageTexCss}color:${TEXT};font:14px/1.55 ${FONT_SANS};}`}</style>
      <style>{mdBodyCss}</style>
      <style>{readerBodyCss}</style>
      <style>{focusRingCss}</style>
      <style>{`.rd-tldr-txt p{margin:0;}`}</style>
      <style>{reducedMotionCss}</style>
      <div style={{ minHeight: "100vh", padding: "40px 16px 64px", display: "flex", justifyContent: "center", animation: `cs-page-in .26s ${EASE} both` }}>
        {/* Карточка без overflow:hidden — иначе position:sticky шапки не липнет
            (overflow:hidden превращает её в scroll-контейнер без прокрутки). */}
        <div className="cs-card" style={{ width: "100%", maxWidth: 720, borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,.55)", display: "flex", flexDirection: "column" }}>
          {/* Липкая шапка: назад в архив · заголовок · скопировать · скачать · YouTube.
              position:sticky липнет к viewport при скролте карточки. */}
          <div className="rd-bar" style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: SURFACE_HEAD, borderBottom: `1px solid ${BORDER}`, borderRadius: "16px 16px 0 0", boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)" }}>
            <a href={cabinetHref} title="Назад в архив" aria-label="Назад в архив" className="cs-mini" style={{ flex: "0 0 auto", textDecoration: "none" }}><IconArrowLeft size={14} /></a>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0, flex: "0 0 auto" }}><Clogo size={16} /></span>
            <span style={{ flex: 1, minWidth: 0, alignSelf: "center", font: `500 12px/1.2 ${FONT_SANS}`, color: SEC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data?.title ?? "Конспект"}</span>
            <button title={copied ? "Скопировано" : "Скопировать"} aria-label={copied ? "Скопировано" : "Скопировать"} onClick={async () => { if (await copy()) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }} className="cs-mini" style={{ flex: "0 0 auto", color: copied ? AMBER : undefined }}><span className={copied ? "cs-swap done" : "cs-swap"}><IconCopy size={14} /><IconCheck size={14} /></span></button>
            <button title="Скачать .md" aria-label="Скачать .md" onClick={download} className="cs-mini" style={{ flex: "0 0 auto" }}><IconDownload size={14} /></button>
            {srcUrl && (
              <a href={srcUrl} target="_blank" rel="noopener noreferrer" title="Открыть на YouTube" aria-label="Открыть на YouTube" className="cs-mini" style={{ flex: "0 0 auto", color: YT_BLUE, textDecoration: "none" }}><IconYoutube size={15} /></a>
            )}
          </div>

          {/* Прогресс чтения — полоса под липкой шапкой */}
          <div style={{ height: 3, background: CELL, boxShadow: "inset 0 1px 2px rgba(0,0,0,.4)", flex: "0 0 auto" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: CTA, boxShadow: "inset 0 1px 0 rgba(255,255,255,.3)", transition: "width .1s linear" }} />
          </div>

          {/* Контент 640 */}
          <div style={{ maxWidth: 640, width: "100%", margin: "0 auto", padding: "28px 24px 8px", boxSizing: "border-box" }}>
            <SkelSwap
              loading={loading}
              skeleton={(
                <div style={{ padding: "8px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16, color: MUT, font: `500 13px ${FONT_SANS}` }}>
                    <Clogo size={18} busy /> Загрузка конспекта…
                  </div>
                  <Skeleton rows={[32, 14, 16, 74, 16, 16, 16, 16, 14, 16]} />
                </div>
              )}
            >
              {err ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: SEC, font: `500 14px ${FONT_SANS}` }}>{err}</div>
            ) : (
              <>
                <h1 style={{ font: `700 25px/1.22 ${FONT_SANS}`, color: TEXT, margin: "0 0 12px" }}>
                  {data?.title ?? "Конспект"}
                </h1>
                <div style={{ display: "flex", alignItems: "center", gap: "6px 12px", flexWrap: "wrap", marginBottom: 24, font: `400 11.5px ${FONT_MONO}`, color: MUT }}>
                  {data?.durationSec != null && <span>видео {fmtDuration(data.durationSec)}</span>}
                  {data?.channel && (<><span style={{ color: DIM }}>·</span><span>{data.channel}</span></>)}
                  <><span style={{ color: DIM }}>·</span><span>{lang}</span></>
                  {sv > 0 && (<><span style={{ color: DIM }}>·</span><span>сэкономлено</span><span style={{ color: OK }}>{sv} мин</span></>)}
                </div>

                {/* Главная мысль — текстом, без обрамления (как в кабинете/попапе) */}
                {tldr && (
                  <div style={{ padding: 0, marginBottom: 26 }}>
                    <span style={{ display: "block", font: `700 9.5px ${FONT_MONO}`, color: YT_BLUE, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>Главная мысль</span>
                    <div
                      className="rd-tldr-txt"
                      style={{ font: `400 14px/1.65 ${FONT_SANS}`, color: SEC, textAlign: "left" }}
                      dangerouslySetInnerHTML={{ __html: tldrHtml }}
                    />
                  </div>
                )}

                {/* Оглавление с таймкодами */}
                {toc.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 26, paddingBottom: 20, borderBottom: `1px solid ${LINE}` }}>
                    {toc.map((t) => (
                      <button key={t.idx} onClick={() => scrollToSection(t.idx)} style={tocChip} {...tocChipHover}>
                        {t.tc && <span className="cs-tc" style={{ fontSize: 10, padding: "2px 6px" }}>{t.tc}</span>}
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Тело конспекта */}
                <div ref={bodyRef}>
                  <article className="md-body rd-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                </div>
              </>
              )}
            </SkelSwap>
          </div>
        </div>
      </div>
    </>
  );
}

// Чип оглавления reader — skeuo-кнопка-переключатель с amber tc-бейджем внутри (.cs-tc).
const tocChip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 10px",
  borderRadius: 7, cursor: "pointer", border: `1px solid ${BTN_BORDER}`, background: BTN, color: SEC,
  font: `500 11.5px ${FONT_SANS}`, textShadow: TXT_SHADOW, boxShadow: SHADOW_BTN,
  transition: `filter .12s ${EASE}, transform .06s ${EASE}`,
};
const tocChipHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.filter = "brightness(1.12)"; },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.filter = "none"; },
};

injectFonts();
createRoot(document.getElementById("root")!).render(<Read />);
