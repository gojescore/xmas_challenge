// public/minigames/grandprix.js v5
// Adds: better diagnostics + safe retry-on-gesture if play() fails.
// Keeps API: renderGrandprix(ch, api) + stopGrandprix()

let audio = null;
let playTimeout = null;

let audioSrcResolved = "";
let unlockInstalled = false;

// If autoplay fails, we arm a retry that runs on the next user gesture.
let needsGestureRetry = false;

function resolveUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return String(url || "");
  }
}

function audioErrorToText(a) {
  // a.error is a MediaError (or null)
  const err = a?.error;
  if (!err) return "Ukendt audio-fejl (ingen MediaError).";
  // MediaError codes: 1..4
  const map = {
    1: "ABORTED (afbrudt)",
    2: "NETWORK (netværk/404/forbindelse)",
    3: "DECODE (kan ikke afkode filen)",
    4: "SRC_NOT_SUPPORTED (format/URL ikke understøttet)",
  };
  return `MediaError ${err.code}: ${map[err.code] || "Ukendt"}`;
}

async function tryPlay(api, why = "") {
  if (!audio) return false;

  try {
    // Make sure it actually has a source and is loading
    // (harmless if already loaded)
    try { audio.load(); } catch {}

    const p = audio.play();
    if (p && typeof p.then === "function") await p;

    needsGestureRetry = false;
    return true;
  } catch (err) {
    // This is the important part: show what kind of failure it is.
    console.error("Grandprix play() failed", { why, err, src: audio?.src });

    // Typical cases:
    // - NotAllowedError: autoplay policy / user gesture needed
    // - NotSupportedError: codec/format not supported
    // - AbortError: interrupted
    const name = err?.name || "Error";
    const msg = err?.message || "";

    if (name === "NotAllowedError") {
      needsGestureRetry = true;
      api?.showStatus?.("⚠️ Browser blokerer afspilning. Klik på siden eller tryk BUZZ igen for at starte musikken.");
    } else {
      // Could be 404/network/decode. We show a more concrete hint.
      api?.showStatus?.(`⚠️ Musik kunne ikke afspilles (${name}). Tjek konsol + Network for 404/codec.`);
      // Also surface MediaError if present:
      setTimeout(() => {
        if (audio) console.warn("Grandprix audio element error:", audioErrorToText(audio), audio.src);
      }, 0);
    }

    return false;
  }
}

function installGestureRetry(api) {
  if (unlockInstalled) return;
  unlockInstalled = true;

  const onGesture = () => {
    if (!needsGestureRetry) return;
    // Retry once on next gesture
    tryPlay(api, "gesture-retry");
  };

  document.addEventListener("pointerdown", onGesture, { passive: true });
  document.addEventListener("keydown", onGesture);
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

  needsGestureRetry = false;
  window.__grandprixTryPlay = null;
}

export function renderGrandprix(ch, api) {
  const url = ch?.audioUrl;

  if (!url) {
    api?.showStatus?.("⚠️ Ingen lyd-URL fundet.");
    api?.setBuzzEnabled?.(false);
    stopGrandprix();
    return;
  }

  installGestureRetry(api);

  const resolved = resolveUrl(url);

  // If URL changed, rebuild audio cleanly
  if (!audio || audioSrcResolved !== resolved) {
    stopGrandprix();

    audio = new Audio(resolved);
    audio.preload = "auto";
    audio.playsInline = true;

    // Optional: can help in some environments (not required)
    // audio.crossOrigin = "anonymous";

    // Log element-level errors (helps diagnose 404/decode)
    audio.addEventListener("error", () => {
      console.error("Grandprix <audio> error:", audioErrorToText(audio), audio.src);
      api?.showStatus?.("⚠️ Musik fejlede at loade (tjek Network: mp3 404?).");
    });

    audioSrcResolved = resolved;
    window.__grandprixAudio = audio;

    // Expose a manual retry hook (BUZZ can call it)
    window.__grandprixTryPlay = () => tryPlay(api, "manual-tryPlay");
  }

  // Cancel pending play on state change
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

      try { audio.currentTime = 0; } catch {}

      // Attempt autoplay (may fail on some machines; then we arm gesture retry)
      await tryPlay(api, "listening-autoplay");
    }, waitMs);

    return;
  }

  if (ch.phase === "locked") {
    api?.setBuzzEnabled?.(false);
    try { audio.pause(); } catch {}
    return;
  }

  // ended / other
  api?.setBuzzEnabled?.(false);
  stopGrandprix();
}
