// public/team.js (v23) — Grandprix popup includes answer field for buzzing team

import { renderGrandprix, stopGrandprix } from "./minigames/grandprix.js";

const socket = io();
const el = (id) => document.getElementById(id);

// DOM
const codeInput = el("codeInput");
const codeBtn = el("codeBtn");
const nameRow = el("nameRow");
const nameInput = el("nameInput");
const nameBtn = el("nameBtn");
const joinMsg = el("joinMsg");
const joinSection = el("joinSection");

const codeDisplay = el("codeDisplay");
const teamListEl = el("teamList");
const challengeTitle = el("challengeTitle");
const challengeText = el("challengeText");
const buzzBtn = el("buzzBtn");
const statusEl = el("status");
const teamNameLabel = el("teamNameLabel");

// Grandprix popup elements (already in your HTML)
const gpPopup = el("grandprixPopup");
const gpPopupCountdown = el("grandprixPopupCountdown");

// ---------- STATE ----------
let joined = false;
let joinedCode = null;
let myTeamName = null;

// ---------- Mini-game API ----------
const api = {
  setBuzzEnabled(enabled) {
    if (buzzBtn) buzzBtn.disabled = !enabled;
  },
  showStatus(text) {
    if (statusEl) statusEl.textContent = text;
  },
  clearMiniGame() {
    if (statusEl) statusEl.textContent = "";
    if (buzzBtn) buzzBtn.disabled = true;
    hideGrandprixPopup();
    hideNisseGaadenAnswer();
  }
};

// ===========================
// JOIN step 1
// ===========================
codeBtn?.addEventListener("click", tryCode);
codeInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryCode();
});

function tryCode() {
  const code = codeInput.value.trim();
  if (!code) {
    joinMsg.textContent = "Skriv en kode først.";
    return;
  }
  joinedCode = code;
  codeDisplay.textContent = code;
  joinMsg.textContent = "Kode accepteret. Skriv jeres teamnavn.";
  nameRow.style.display = "flex";
  nameInput.focus();
}

// ===========================
// JOIN step 2
// ===========================
nameBtn?.addEventListener("click", tryJoin);
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoin();
});

function tryJoin() {
  const name = nameInput.value.trim();
  if (!name) {
    joinMsg.textContent = "Skriv et teamnavn.";
    return;
  }

  socket.emit("joinGame", { code: joinedCode, teamName: name }, (res) => {
    if (!res?.ok) {
      joinMsg.textContent = res?.message || "Kunne ikke joine.";
      return;
    }

    joined = true;
    myTeamName = res.team.name;

    if (teamNameLabel) teamNameLabel.textContent = myTeamName;
    joinSection.style.display = "none";

    api.clearMiniGame();
  });
}

// ===========================
// BUZZ (also retries audio if autoplay blocked)
// ===========================
buzzBtn?.addEventListener("click", async () => {
  if (!joined) return;

  if (window.__grandprixAudio && window.__grandprixAudio.paused) {
    try { await window.__grandprixAudio.play(); } catch {}
  }

  const audioPosition = window.__grandprixAudio
    ? window.__grandprixAudio.currentTime
    : null;

  socket.emit("buzz", { audioPosition });
});

// stop audio forced
socket.on("gp-stop-audio-now", () => {
  stopGrandprix();
  api.clearMiniGame();
});

// ===========================
// LEADERBOARD
// ===========================
function renderLeaderboard(teams) {
  if (!teamListEl) return;

  const sorted = [...teams].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  teamListEl.innerHTML = "";
  sorted.forEach((t, i) => {
    const li = document.createElement("li");
    li.className = "team-item";
    li.innerHTML = `
      <span>${i + 1}. ${t.name}</span>
      <span class="pts">${t.points ?? 0}</span>
    `;
    teamListEl.appendChild(li);
  });
}

// ===========================
// NISSE GÅDEN answer (small box under text)
// ===========================
let ngWrap = null, ngInput = null, ngBtn = null;

function ensureNisseGaadenAnswer() {
  if (ngWrap) return;

  ngWrap = document.createElement("div");
  ngWrap.style.cssText =
    "margin-top:12px; display:flex; gap:8px; justify-content:center;";

  ngInput = document.createElement("input");
  ngInput.placeholder = "Skriv jeres svar her…";
  ngInput.style.cssText =
    "font-size:1.1rem; padding:8px; width:260px;";

  ngBtn = document.createElement("button");
  ngBtn.textContent = "Send svar";
  ngBtn.style.cssText =
    "font-size:1.1rem; padding:8px 12px; font-weight:700; cursor:pointer;";

  ngBtn.onclick = () => {
    const text = (ngInput.value || "").trim();
    if (!text) return;
    socket.emit("submitCard", text);
    ngInput.value = "";
    api.showStatus("✅ Svar sendt til læreren.");
  };

  ngWrap.append(ngInput, ngBtn);
  challengeText.parentElement.appendChild(ngWrap);
}

function showNisseGaadenAnswer() {
  ensureNisseGaadenAnswer();
  ngWrap.style.display = "flex";
  ngInput.disabled = false;
  ngBtn.disabled = false;
}
function hideNisseGaadenAnswer() {
  if (!ngWrap) return;
  ngWrap.style.display = "none";
  ngInput.disabled = true;
  ngBtn.disabled = true;
}

// ===========================
// GRANDPRIX POPUP (FULLSCREEN + answer for buzzing team)
// ===========================
let gpPopupTimer = null;
let gpAnswerInput = null;
let gpAnswerBtn = null;
let gpAnswerWrap = null;

function ensureGpAnswerUI() {
  if (!gpPopup) return;

  if (!gpAnswerWrap) {
    gpAnswerWrap = document.createElement("div");
    gpAnswerWrap.style.cssText = `
      margin-top:18px;
      display:flex;
      flex-direction:column;
      gap:10px;
      width: min(520px, 92vw);
    `;

    gpAnswerInput = document.createElement("input");
    gpAnswerInput.placeholder = "Skriv jeres svar …";
    gpAnswerInput.style.cssText = `
      font-size:1.6rem;
      padding:14px;
      border-radius:10px;
      border:2px solid #222;
      width:100%;
    `;

    gpAnswerBtn = document.createElement("button");
    gpAnswerBtn.textContent = "Send svar";
    gpAnswerBtn.style.cssText = `
      font-size:1.5rem;
      font-weight:900;
      padding:12px;
      border-radius:10px;
      border:none;
      background:#1a7f37;
      color:white;
      cursor:pointer;
    `;

    gpAnswerBtn.onclick = () => {
      const text = (gpAnswerInput.value || "").trim();
      if (!text) return;
      socket.emit("gp-typed-answer", { text });
      gpAnswerInput.value = "";
      api.showStatus("✅ Svar sendt til læreren.");
    };

    gpAnswerWrap.append(gpAnswerInput, gpAnswerBtn);
    gpPopup.appendChild(gpAnswerWrap);
  }
}

function showGrandprixPopup(startAtMs, seconds, showAnswer) {
  if (!gpPopup || !gpPopupCountdown) return;
  if (gpPopupTimer) clearInterval(gpPopupTimer);

  // make sure popup is true overlay
  gpPopup.style.display = "flex";
  gpPopup.style.flexDirection = "column";
  gpPopup.style.justifyContent = "center";
  gpPopup.style.alignItems = "center";
  gpPopup.style.gap = "10px";
  gpPopup.style.padding = "20px";
  gpPopup.style.zIndex = "9999";

  ensureGpAnswerUI();

  if (gpAnswerWrap) {
    gpAnswerWrap.style.display = showAnswer ? "flex" : "none";
    if (gpAnswerInput) gpAnswerInput.disabled = !showAnswer;
    if (gpAnswerBtn) gpAnswerBtn.disabled = !showAnswer;
    if (showAnswer) gpAnswerInput.focus();
  }

  function tick() {
    const elapsed = Math.floor((Date.now() - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    gpPopupCountdown.textContent = left;

    if (left <= 0) {
      clearInterval(gpPopupTimer);
      gpPopupTimer = null;

      // lock input when time out
      if (gpAnswerInput) gpAnswerInput.disabled = true;
      if (gpAnswerBtn) gpAnswerBtn.disabled = true;

      setTimeout(hideGrandprixPopup, 600);
    }
  }

  tick();
  gpPopupTimer = setInterval(tick, 100);
}

function hideGrandprixPopup() {
  if (gpPopupTimer) clearInterval(gpPopupTimer);
  gpPopupTimer = null;
  if (gpPopup) gpPopup.style.display = "none";
  if (gpAnswerWrap) gpAnswerWrap.style.display = "none";
}

// ===========================
// Challenge render
// ===========================
function renderChallenge(ch) {
  api.setBuzzEnabled(false);
  hideNisseGaadenAnswer();

  if (!ch) {
    stopGrandprix();
    challengeTitle.textContent = "Ingen udfordring endnu";
    challengeText.textContent = "Vent på læreren…";
    api.clearMiniGame();
    return;
  }

  challengeTitle.textContent = ch.type || "Udfordring";
  challengeText.textContent = ch.text || "";

  if (ch.type === "Nisse Grandprix") {
    renderGrandprix(ch, api);
    return;
  }

  if (ch.type === "NisseGåden") {
    stopGrandprix();
    showNisseGaadenAnswer();
    return;
  }

  stopGrandprix();
  api.clearMiniGame();
}

// ===========================
// Receive state
// ===========================
socket.on("state", (s) => {
  if (!s) return;

  if (s.gameCode) codeDisplay.textContent = s.gameCode;

  renderLeaderboard(s.teams || []);
  renderChallenge(s.currentChallenge);

  const ch = s.currentChallenge;

  const isLockedGP =
    ch &&
    ch.type === "Nisse Grandprix" &&
    ch.phase === "locked";

  const iAmBuzzedFirst =
    joined &&
    isLockedGP &&
    ch.firstBuzz &&
    ch.firstBuzz.teamName === myTeamName;

  if (isLockedGP && ch.countdownStartAt) {
    // Everyone sees popup, but ONLY buzzing team sees input
    showGrandprixPopup(
      ch.countdownStartAt,
      ch.countdownSeconds || 5,
      iAmBuzzedFirst
    );
  } else {
    hideGrandprixPopup();
  }
});
