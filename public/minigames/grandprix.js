// public/minigames/grandprix.js
// Team-side Nisse Grandprix
// - synced start/resume using absolute timestamps
// - big pre-start countdown overlay
// - fallback "tap for sound" ONLY if autoplay is blocked

let audio = null;
let loadedUrl = null;

let startTimer = null;
let resumeTimer = null;
let lastPhase = null;

// ---------- Overlay helpers (created dynamically) ----------
let preOverlay = null;
let preNumber = null;

let tapOverlay = null;
let tapWired = false;

function ensurePreOverlay() {
  if (preOverlay) return;

  preOverlay = document.createElement("div");
  preOverlay.id = "gpPreOverlay";
  preOverlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9998;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.8); color: white; text-align: center;
    font-family: system-ui, sans-serif; padding: 20px;
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    background: rgba(0,0,0,0.25);
    padding: 24px 28px; border-radius: 18px;
    max-width: 520px; width: 100%;
  `;

  const title = document.createElement("div");
  title.textContent = "🎵 Musikken starter om";
  title.style.cssText = `
    font-size: 2rem; font-weight: 900; margin-bottom: 8px;
  `;

  preNumber = document.createElement("div");
  preNumber.textContent = "—";
  preNumber.style.cssText = `
    font-size: 6rem; font-weight: 900; line-height: 1;
    margin: 6px 0 10px;
  `;

  const hint = document.createElement("div");
  hint.textContent = "Hvis der ikke kommer lyd, tryk én gang på skærmen.";
  hint.style.cssText = `
    font-size: 1.1rem; opacity: 0.95;
  `;

  box.appendChild(title);
  box.appendChild(preNumber);
  box.appendChild(hint);
  preOverlay.appendChild(box);

  document.body.appendChild(preOverlay);
}

function showPreOverlay() {
  ensurePreOverlay();
  preOverlay.style.display = "flex";
}

function hidePreOverlay() {
  if (preOverlay) preOverlay.style.display = "none";
}

// Tap overlay only when autoplay fails
function ensureTapOverlay() {
  if (tapOverlay) return;

  tapOverlay = document.createElement("div");
  tapOverlay.id = "gpTapOverlay";
  tapOverlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.85); color: white; text-align: center;
    font-family: system-ui, sans-serif; padding: 20px;
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    padding: 24px 28px; border-radius: 18px;
    max-width: 520px; width: 100%;
  `;

  const title = document.createElement("div");
  title.textContent = "🔊 Tryk for lyd";
  title.style.cssText = `
    font-size: 2.4rem; font-weight: 900; margin-bottom: 8px;
  `;

  const text = document.createElement("div");
  text.textContent = "Nogle enheder kræver et tryk før musikken må starte.";
  text.style.cssText = `font-size: 1.2rem;`;

  box.appendChild(title);
  box.appendChild(text);
  tapOverlay.appendChild(box);
  document.body.appendChild(tapOverlay);
}

function showTapOverlay(onTap) {
  ensureTapOverlay();
  tapOverlay.style.display = "flex";

  if (!tapWired) {
    tapWired = true;
    const handler = async () => {
      try {
        await onTap();
        hideTapOverlay();
      } catch {
        // still blocked, keep overlay visible
      }
    };

    tapOverlay.addEventListener("pointerdown", handler);
    tapOverlay.addEventListener("keydown", handler);
  }
}

function hideTapOverlay() {
  if (tapOverlay) tapOverlay.style.display = "none";
}

// ---------- Timers ----------
function clearTimers() {
  if (startTimer) clearTimeout(startTimer);
  if (resumeTimer) clearTimeout(resumeTimer);
  startTimer = null;
  resumeTimer = null;
}

// ---------- Audio ----------
function ensureAudio(url, api) {
  if (!url) return null;

  if (!audio || loadedUrl !== url) {
    if (audio) {
      try { audio.pause(); } catch {}
    }
    audio = new Audio(url);
    audio.preload = "auto";
    loadedUrl = url;

    api.showStatus("🎵 Lyd klargøres…");
  }

  // expose for buzz timing
  window.__grandprixAudio = audio;
  return audio;
}

async function setTimeSafely(t) {
  if (!audio) return;

  if (audio.readyState >= 1) {
    try { audio.currentTime = t; } catch {}
    return;
  }

  await new Promise((resolve) => {
    audio.addEventListener("loadedmetadata", resolve, { once: true });
  });

  try { audio.currentTime = t; } catch {}
}

function computeStartSeconds(challenge) {
  const now = Date.now();
  const startAt = challenge.startAt || now;
  const basePos = Number(challenge.audioPosition || 0);
  const elapsed = Math.max(0, (now - startAt) / 1000);
  return basePos + elapsed;
}

// Try to play; if blocked show tap overlay
async function safePlay(api) {
  if (!audio) return;

  try {
    await audio.play();
    hideTapOverlay();
  } catch {
    api.showStatus("🔊 Tryk for lyd for at starte musikken.");
    showTapOverlay(async () => audio.play());
  }
}

// ---------- Pre-start / resume countdown ----------
let preCountdownTimer = null;

function startPreCountdown(targetAtMs, api, afterCountdownFn) {
  ensurePreOverlay();
  hideTapOverlay();
  showPreOverlay();

  if (preCountdownTimer) clearInterval(preCountdownTimer);

  const tick = () => {
    const now = Date.now();
    const leftMs = Math.max(0, targetAtMs - now);
    const leftSec = Math.ceil(leftMs / 1000);

    preNumber.textContent = leftSec;

    if (leftMs <= 0) {
      clearInterval(preCountdownTimer);
      preCountdownTimer = null;
      hidePreOverlay();
      afterCountdownFn?.();
    }
  };

  tick();
  preCountdownTimer = setInterval(tick, 100);
}

function stopPreCountdown() {
  if (preCountdownTimer) clearInterval(preCountdownTimer);
  preCountdownTimer = null;
  hidePreOverlay();
}

// ---------- Scheduling ----------
function scheduleStart(challenge, api) {
  clearTimers();
  stopPreCountdown();

  const now = Date.now();
  const startAt = challenge.startAt || now;

  // show pre-countdown if start is in the future
  if (startAt > now) {
    startPreCountdown(startAt, api, async () => {
      const t = computeStartSeconds(challenge);
      await setTimeSafely(t);
      safePlay(api);
    });
  } else {
    // start immediately (late join)
    (async () => {
      const t = computeStartSeconds(challenge);
      await setTimeSafely(t);
      safePlay(api);
    })();
  }

  // also keep a safety timer in case interval drift
  const delayMs = Math.max(0, startAt - now);
  startTimer = setTimeout(async () => {
    const t = computeStartSeconds(challenge);
    await setTimeSafely(t);
    safePlay(api);
  }, delayMs);
}

function scheduleResume(challenge, api) {
  clearTimers();
  stopPreCountdown();

  const now = Date.now();
  const resumeAt = challenge.resumeAt || now;

  if (resumeAt > now) {
    startPreCountdown(resumeAt, api, async () => {
      const basePos = Number(challenge.audioPosition || 0);
      await setTimeSafely(basePos);
      safePlay(api);
    });
  } else {
    (async () => {
      const basePos = Number(challenge.audioPosition || 0);
      await setTimeSafely(basePos);
      safePlay(api);
    })();
  }

  const delayMs = Math.max(0, resumeAt - now);
  resumeTimer = setTimeout(async () => {
    const basePos = Number(challenge.audioPosition || 0);
    await setTimeSafely(basePos);
    safePlay(api);
  }, delayMs);
}

// ---------- Stop ----------
function stopAudio(api, msg) {
  clearTimers();
  stopPreCountdown();
  hideTapOverlay();

  if (audio) {
    try { audio.pause(); } catch {}
  }

  api.setBuzzEnabled(false);
  if (msg) api.showStatus(msg);
}

// ---------- RENDER ----------
export function renderGrandprix(challenge, api) {
  if (!challenge || typeof challenge !== "object") {
    stopAudio(api, "Ingen Grandprix-data endnu.");
    lastPhase = null;
    return;
  }

  const { phase, audioUrl } = challenge;
  ensureAudio(audioUrl, api);

  if (phase === "listening") {
    api.setBuzzEnabled(true);

    if (lastPhase !== "listening") {
      if (challenge.resumeAt) scheduleResume(challenge, api);
      else scheduleStart(challenge, api);
    }

    api.showStatus("🎵 Lyt… tryk STOP når I kender svaret!");
  }
  else if (phase === "locked") {
    stopAudio(api, "⛔ Et hold har trykket STOP! Vent på læreren…");
  }
  else if (phase === "ended") {
    stopAudio(api, "✅ Runden er slut. Vent på næste udfordring.");
  }
  else {
    stopAudio(api, "Vent på læreren…");
  }

  lastPhase = phase;
}

// ---------- Hard stop used by admin stop event / leaving Grandprix ----------
export function stopGrandprix() {
  clearTimers();
  stopPreCountdown();
  hideTapOverlay();

  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }

  lastPhase = null;
}
