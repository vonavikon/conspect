// Offscreen-документ (reason AUDIO_PLAYBACK) — единственное место, где расширение
// проигрывает звук из фона без привязки к странице. MV3 service worker не имеет DOM и
// не может создать AudioContext. SW зовёт сюда через runtime.sendMessage({type:"play"}).
// Чим синтезируется Web Audio — своего бинарного ассета нет, звук не храним в репо.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "play") void playChime();
});

let ctx: AudioContext | null = null;

function playChime(): void {
  try {
    // Ленивый AudioContext: первый play создаёт, дальше переиспользуем. Chrome
    // резюмирует приостановленный контекст; offscreen с AUDIO_PLAYBACK автоплей
    // разрешён без свежего жеста пользователя.
    if (!ctx) ctx = new AudioContext();
    const ac = ctx;
    if (ac.state === "suspended") void ac.resume();

    // Короткий «динь-дон»: две ноты (A5 → E6) по ~0.16с, sine, мягкая атака и
    // экспоненциальное затухание — без щелчка на краях огибающей.
    const now = ac.currentTime;
    const notes: { f: number; t: number }[] = [
      { f: 880, t: 0 },
      { f: 1318.51, t: 0.16 },
    ];
    for (const n of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      const start = now + n.t;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    }
  } catch {
    // Аудио недоступно (контекст не резюмировался) — молча, звук не критичен.
  }
}
