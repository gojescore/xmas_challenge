// public/minigames/grandprix.js v4
// Fix: reliable URL compare + audio unlock on first user gesture + better play robustness.
// Keeps the same public API: renderGrandprix(ch, api) + stopGrandprix().

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
      // We don't hard-fail; BUZZ can still trigger a user gesture play attempt.
      // But we keep a hint for the user if needed.
      // console.debug("Audio unlock failed:", err);
      if (api?.showStatus) {
        api.showStatus("⚠️ Klik på skærmen / tryk en tast og prøv igen, hvis musikken ikke starter.");
      }
    } finally {
      audio.muted = wasMuted;
    }
  };

  // Use both pointerdown and keydown to cover mouse/touch/keyboard-only machines.
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
    try { audio.currentTime = 0; } catch {}
    audio = null;
  }

  audioSrcResolved = "";
  window.__grandprixAudio = null;
}

export function renderGrandprix(ch, api) {
  const url = ch?.audioUrl;

  if (!url) {
    api?.showStatus?.("⚠️ Ingen lyd-URL fundet.");
    api?.setBuzzEnabled?.(false);
    stopGrandprix();
    return;
  }

  // Ensure unlock handlers are installed (safe, no UI changes unless needed)
  installUnlockHandlers(api);

  const resolved = resolveUrl(url);

  // If URL changed, rebuild audio cleanly
  if (!audio || audioSrcResolved !== resolved) {
    stopGrandprix();

    audio = new Audio(resolved);
    audio.preload = "auto";
    audio.playsInline = true; // iOS-ish safety; harmless elsewhere

    // Try to force-load metadata early (helps some setups)
    try { audio.load(); } catch {}

    audioSrcResolved = resolved;
    window.__grandprixAudio = audio;

    // Reset unlock flag per new audio instance
    audioUnlocked = false;
  }

  // Always cancel any pending play when state changes
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

      // Start from beginning when entering listening
      try { audio.currentTime = 0; } catch {}

      try {
        await audio.play();
      } catch (err) {
        // Useful debug + user hint
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
