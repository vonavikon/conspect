// Звук-уведомление при готовом конспекте. Спикер — offscreen-документ (offscreen.ts),
// этот модуль лишь обеспечивает его наличие и шлёт {type:"play"}. Вызывается из
// streamStore на done: короткий чим, когда конспект собрался, а пользователь мог
// отойти от вкладки. Некритично — любой сбой гасим молча, звук не должен ронять стрим.

async function playDoneSound(): Promise<void> {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: "Короткий звук при готовом конспекте",
      });
    }
  } catch {
    // offscreen недоступен (старый Chrome / ограничение) — звука нет, идём дальше.
    return;
  }
  try {
    await chrome.runtime.sendMessage({ type: "play" });
  } catch {
    // Первый play сразу после createDocument: скрипт offscreen мог не успеть навесить
    // слушатель. Ретрай один раз — дальше слушатель уже висит.
    await new Promise((r) => setTimeout(r, 100));
    try { await chrome.runtime.sendMessage({ type: "play" }); } catch { /* молча */ }
  }
}

export { playDoneSound };
