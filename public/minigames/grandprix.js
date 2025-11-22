// public/minigames/grandprix.js
// Phase-aware Grandprix: never restarts audio on lock, only enables buzz in listening.

let audio = null;
let lastUrl = null;
let startTimer = null;
let starting = false;

function ensureAudio(url) {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    window.__grandprixAudio = audio; // for buzz position, if you want it
  }
  if (url && url !== lastUrl) {
    audio.src = url;
    lastUrl = url;
  }
  return audio;
}

function clearTimers() {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  starting = false;
}

export function stopGrandprix() {
  clearTimers();
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }
}

export function renderGrandprix(challenge, api) {
  const url = challenge.audioUrl || challenge.url || "";

  // Always stop / disable buzz if not listening
  if (challenge.phase !== "listening") {
    stopGrandprix();
    api.setBuzzEnabled(false);
    api.showStatus("");
    return;
  }

  // LISTENING PHASE
  const a = ensureAudio(url);

  api.setBuzzEnabled(false); // re-enable only when actually playing

  // If already playing, do NOTHING (important!)
  if (!a.paused && !starting) {
    api.setBuzzEnabled(true);
    return;
  }

  // Start at shared startAt (3 sec pre-countdown already in admin)
  clearTimers();
  starting = true;

  const delay = Math.max(0, (challenge.startAt || Date.now()) - Date.now());

  api.showStatus("🎵 Musik starter om lidt…");

  startTimer = setTimeout(async () => {
    try {
      await a.play();     // may be blocked until user gesture
      api.showStatus("");
      api.setBuzzEnabled(true);
    } catch (e) {
      // Autoplay blocked → show a simple banner button
      api.showStatus("👉 Tryk på BUZZ-knappen én gang for at starte lyden.");
      api.setBuzzEnabled(true); // allow first click to also start play
    } finally {
      starting = false;
    }
  }, delay);

  // If they click buzz while autoplay blocked, attempt play once
  // (team.js buzz click triggers play because buzz is enabled)
}
