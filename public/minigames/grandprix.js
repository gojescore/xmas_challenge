// public/minigames/grandprix.js v4
// Fix: reliable URL compare + one-time audio unlock (no random autoplay) + robust play() handling.
// Keeps API: renderGrandprix(ch, api) + stopGrandprix()

let audio = null;
let playTimeout = null;

// Track which resolved src we built audio for (audio.src becomes absolute)
let audioSrcResolved = "";

// One-time unlock so stricter browsers allow later play()
let audioUnlocked = false;
let unlockInstalled = false;

function resolveUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return String(url || "");
  }
}

function installUnlockHandlers(api) {
  if (unlockInstalled) return;
  unlockInstalled = true;

  const unlock = async () => {
    if (audioUnlocked) return;
    if (!audio) return;

    // Attempt a muted micro-play to satisfy autoplay policies
    const wasMuted = audio.muted;
    audio.muted = true;

    try {
      const p = audio.play();
      if (p && typeof p.then === "function") await p;

      audio.pause();
      try { audio.currentTime = 0; } catch {}

      audioUnlocked = true;
    } catch (err) {
      // Do not spam UI; just a gentle hint if needed.
      api?.showStatus?.("⚠️ Klik/tryk en tast hvis musikken ikke starter automatisk.");
    } finally {
      audio.muted = wasMuted;
    }
  };

  // Cover mouse/touch + keyboard-only setups
  document.addEventListener("pointerdown", unlock, { once: true, passive: true });
  document.addEventListener("keydown", unlock, { once: true });
}

export function stopGrandprix() {
  if (playTimeout) {
    clearTimeout(playTimeout);
    playTimeout = null;
  }

  if (audio) {
    try { audio.pause(); } catch {}
    audio = null;
  }

  audioSrcResolved = "";
  window.__grandprixAudio = null;
  audioUnlocked = false;
}

export function renderGrandprix(ch, api) {
  const url = ch?.audioUrl;

  if (!url) {
    api?.showStatus?.("⚠️ Ingen lyd-URL fundet.");
    api?.setBuzzEnabled?.(false);
    stopGrandprix();
    return;
  }

  // Ensure unlock handlers are installed (safe)
  installUnlockHandlers(api);

  const resolved = resolveUrl(url);

  // If URL changed, rebuild audio cleanly
  if (!audio || audioSrcResolved !== resolved) {
    stopGrandprix();

    audio = new Audio(resolved);
    audio.preload = "auto";
    audio.playsInline = true; // harmless on desktop; helps iOS-ish cases

    // Trigger load early (sometimes helps)
    try { audio.load(); } catch {}

    audioSrcResolved = resolved;
    window.__grandprixAudio = audio;

    audioUnlocked = false;
  }

  // Cancel any pending play when state changes
  if (playTimeout) {
    clearTimeout(playTimeout);
    playTimeout = null;
  }

  if (ch.phase === "listening") {
    api?.setBuzzEnabled?.(true);
    api?.showStatus?.("");

    const startAt = ch.startAt || Date.now();
    const waitMs = Math.max(0, startAt - Date.now());

    playTimeout = setTimeout(async () => {
      playTimeout = null;
      if (!audio) return;

      // Optional: start from beginning when entering listening
      try { audio.currentTime = 0; } catch {}

      try {
        await audio.play();
      } catch (err) {
        console.error("Grandprix audio play failed:", err);
        api?.showStatus?.("⚠️ Musik kunne ikke starte automatisk. Tryk BUZZ (eller klik på skærmen) for at starte lyd.");
      }
    }, waitMs);

    return;
  }

  if (ch.phase === "locked") {
    api?.setBuzzEnabled?.(false);
    try { audio.pause(); } catch {}
    return;
  }

  // ended / null etc.
  api?.setBuzzEnabled?.(false);
  stopGrandprix();
}
