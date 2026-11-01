// The notification sound for a finished digest. The speaker is the offscreen document (offscreen.ts);
// this module only ensures it exists and sends {type:"play"}. Called from
// streamStore on done: a short chime when the digest is ready and the user may have
// left the tab. Not critical — any failure is swallowed silently; the sound must not break the stream.

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
    // offscreen unavailable (old Chrome / a restriction) — no sound; carry on.
    return;
  }
  try {
    await chrome.runtime.sendMessage({ type: "play" });
  } catch {
    // The first play right after createDocument: the offscreen script may not have attached its
    // listener yet. One retry — by then the listener hangs.
    await new Promise((r) => setTimeout(r, 100));
    try { await chrome.runtime.sendMessage({ type: "play" }); } catch { /* silently */ }
  }
}

export { playDoneSound };
