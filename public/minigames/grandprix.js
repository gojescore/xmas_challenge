// public/minigames/grandprix.js

let audio = null;
let ui = {
  preOverlay: null,
  tapOverlay: null,
};

// Create overlay helpers
function ensurePreOverlay() {
  if (ui.preOverlay) return ui.preOverlay;
  const el = document.createElement("div");
  el.style.cssText = `
    position:fixed; inset:0; z-index:9998;
    display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.85); color:white; text-align:center;
    font-family:system-ui,sans-serif;
  `;
  el.innerHTML = `
    <div>
      <div style="font-size:2rem; font-weight:900; margin-bottom:8px;">
        Musikken starter om
      </div>
      <div id="gpPreCountdown" style="font-size:6rem; font-weight:900;">3</div>
    </div>
  `;
  document.body.appendChild(el);
  ui.preOverlay = el;
  return el;
}

function ensureTapOverlay(onTap) {
  if (ui.tapOverlay) return ui.tapOverlay;
  const el = document.createElement("div");
  el.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.9); color:white; text-align:center;
    font-family:system-ui,sans-serif; cursor:pointer;
  `;
  el.innerHTML = `
    <div style="max-width:520px; padding:20px;">
      <div style="font-size:2rem; font-weight:900; margin-bottom:10px;">
        Tryk for lyd
      </div>
      <div style="font-size:1.2rem; opacity:0.9;">
        (Browseren kræver et tryk før musik kan starte)
      </div>
      <div style="margin-top:14px; font-size:3rem;">🔊</div>
    </div>
  `;
  el.addEventListener("click", onTap);
  document.body.appendChild(el);
  ui.tapOverlay = el;
  return el;
}

function hideAllOverlays() {
  if (ui.preOverlay) ui.preOverlay.style.display = "none";
  if (ui.tapOverlay) ui.tapOverlay.style.display = "none";
}

export function stopGrandprix() {
  hideAllOverlays();

  if (audio) {
    try { audio.pause(); } catch {}
    try { audio.currentTime = 0; } catch {}
  }
  audio = null;
  window.__grandprixAudio = null;
}

export function renderGrandprix(challenge, api) {
  stopGrandprix();

  const startAt = challenge.startAt || Date.now();
  const url = challenge.audioUrl;

  if (!url) {
    api.showStatus("⚠️ Ingen lyd-URL for denne Grandprix.");
    return;
  }

  audio = new Audio(url);
  audio.preload = "auto";
  window.__grandprixAudio = audio;

  // Buzz enabled only while listening
  api.setBuzzEnabled(challenge.phase === "listening");

  // Pre-start countdown (3 sec sync)
  const preOverlay = ensurePreOverlay();
  const preCountdownEl = preOverlay.querySelector("#gpPreCountdown");
  preOverlay.style.display = "flex";

  const preSeconds = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
  let remaining = preSeconds;

  preCountdownEl.textContent = remaining;

  const preTimer = setInterval(() => {
    remaining -= 1;
    preCountdownEl.textContent = Math.max(0, remaining);

    if (remaining <= 0) {
      clearInterval(preTimer);
      preOverlay.style.display = "none";
      startAudioWithAutoplayGuard(api);
    }
  }, 1000);
}

async function startAudioWithAutoplayGuard(api) {
  if (!audio) return;

  try {
    await audio.play();
    api.showStatus("");
  } catch (e) {
    api.showStatus("⚠️ Kunne ikke starte lyd. Tryk for at starte.");

    const tapOverlay = ensureTapOverlay(async () => {
      if (!audio) return;
      try {
        await audio.play();
        tapOverlay.style.display = "none";
        api.showStatus("");
      } catch {
        api.showStatus("⚠️ Kunne ikke starte lyd. Prøv igen.");
      }
    });

    tapOverlay.style.display = "flex";
  }
}
