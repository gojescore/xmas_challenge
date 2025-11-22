// public/minigames/grandprix.js
// Team-side Nisse Grandprix (distributed audio + synced start/resume)

let audio = null;
let loadedUrl = null;
let startTimer = null;
let resumeTimer = null;
let lastPhase = null;
let audioUnlocked = false;

function clearTimers() {
  if (startTimer) clearTimeout(startTimer);
  if (resumeTimer) clearTimeout(resumeTimer);
  startTimer = null;
  resumeTimer = null;
}

function unlockAudioOnce(api) {
  if (audioUnlocked || !audio) return;

  const unlock = async () => {
    try {
      // try play + pause inside gesture
      await audio.play();
      audio.pause();
      audioUnlocked = true;
      api.showStatus("🔊 Lyd aktiveret!");
    } catch (e) {
      api.showStatus("⚠️ Tryk én gang mere for at aktivere lyd.");
    }
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  };

  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

function ensureAudio(url, api) {
  if (!url) return null;

  if (!audio || loadedUrl !== url) {
    if (audio) {
      try { audio.pause(); } catch {}
    }
    audio = new Audio(url);
    audio.preload = "auto";
    loadedUrl = url;
    audioUnlocked = false;

    api.showStatus("🎵 Lyd klargøres…");
    unlockAudioOnce(api);
  }

  // expose for buzz timing
  window.__grandprixAudio = audio;

  return audio;
}

async function safePlay(api) {
  if (!audio) return;
  try {
    await audio.play();
  } catch {
    // if blocked, set up unlock
    unlockAudioOnce(api);
    api.showStatus("🔊 Tryk på skærmen for at starte lyd.");
  }
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

function scheduleStart(challenge, api) {
  clearTimers();
  const now = Date.now();
  const startAt = challenge.startAt || now;
  const delayMs = Math.max(0, startAt - now);

  api.showStatus("🎵 Klar… lyt efter musikken!");
  startTimer = setTimeout(async () => {
    const t = computeStartSeconds(challenge);
    await setTimeSafely(t);
    safePlay(api);
  }, delayMs);
}

function scheduleResume(challenge, api) {
  clearTimers();
  const now = Date.now();
  const resumeAt = challenge.resumeAt || now;
  const delayMs = Math.max(0, resumeAt - now);

  api.showStatus("🎵 Musik fortsætter lige om lidt…");
  resumeTimer = setTimeout(async () => {
    const basePos = Number(challenge.audioPosition || 0);
    await setTimeSafely(basePos);
    safePlay(api);
  }, delayMs);
}

function stopAudio(api, msg) {
  clearTimers();
  if (audio) {
    try { audio.pause(); } catch {}
  }
  api.setBuzzEnabled(false);
  if (msg) api.showStatus(msg);
}

export function renderGrandprix(challenge, api) {
  if (!challenge || typeof challenge !== "object") {
    stopAudio(api, "Ingen Grandprix-data endnu.");
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
