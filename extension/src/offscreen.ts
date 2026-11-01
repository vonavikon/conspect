// The offscreen document (reason AUDIO_PLAYBACK) — the only place where the extension
// plays sound from the background without a page. An MV3 service worker has no DOM and
// cannot create an AudioContext. The SW calls in via runtime.sendMessage({type:"play"}).
// The chime is synthesized with Web Audio — no binary asset of our own; no sound is stored in the repo.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "play") void playChime();
});

let ctx: AudioContext | null = null;

function playChime(): void {
  try {
    // Lazy AudioContext: the first play creates it, then we reuse. Chrome
    // resumes a suspended context; offscreen with AUDIO_PLAYBACK has autoplay
    // allowed without a fresh user gesture.
    if (!ctx) ctx = new AudioContext();
    const ac = ctx;
    if (ac.state === "suspended") void ac.resume();

    // A short "ding-dong": two notes (A5 → E6) of ~0.16s each, sine, soft attack and
    // exponential decay — no click at the envelope edges.
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
    // Audio unavailable (context did not resume) — silent; the sound is not critical.
  }
}
