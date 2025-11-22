// public/team.js (EVENT-SAFE: Grandprix NO mic, teams type answer)

import { renderGrandprix, stopGrandprix } from "./minigames/grandprix.js";

const socket = io();

function el(id) {
  const node = document.getElementById(id);
  if (!node) console.warn(`Missing element with id="${id}" in team.html`);
  return node;
}

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

// Grandprix answer popup
const gpPopup = el("grandprixPopup");
const gpPopupCountdown = el("grandprixPopupCountdown");

// NEW: input for typed answer when locked
let gpAnswerInput = null;
let gpAnswerBtn = null;

function ensureAnswerUI() {
  if (gpAnswerInput) return;

  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px; display:flex; gap:8px; justify-content:center;";

  gpAnswerInput = document.createElement("input");
  gpAnswerInput.placeholder = "Skriv jeres svar her…";
  gpAnswerInput.style.cssText = "font-size:1.1rem; padding:8px; width:260px;";

  gpAnswerBtn = document.createElement("button");
  gpAnswerBtn.textContent = "Send svar";
  gpAnswerBtn.style.cssText = "font-size:1.1rem; padding:8px 12px; font-weight:700; cursor:pointer;";

  gpAnswerBtn.onclick = () => {
    const text = (gpAnswerInput.value || "").trim();
    if (!text) return;
    socket.emit("gp-typed-answer", { text });
    gpAnswerInput.value = "";
    statusEl.textContent = "✅ Svar sendt til læreren.";
  };

  wrap.appendChild(gpAnswerInput);
  wrap.appendChild(gpAnswerBtn);

  // place under buzz button
  buzzBtn.parentElement.appendChild(wrap);
}

// STATE
let joined = false;
let joinedCode = null;
let myTeamName = null;

// Mini-game API
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
    if (gpAnswerInput) gpAnswerInput.disabled = true;
    if (gpAnswerBtn) gpAnswerBtn.disabled = true;
  }
};

// ---- Join step 1: code ----
codeBtn?.addEventListener("click", tryCode);
codeInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryCode();
});

function tryCode() {
  const code = (codeInput?.value || "").trim();
  if (!code) {
    if (joinMsg) joinMsg.textContent = "Skriv en kode først.";
    return;
  }

  joinedCode = code;
  if (codeDisplay) codeDisplay.textContent = code;
  if (joinMsg) joinMsg.textContent = "Kode accepteret. Skriv jeres teamnavn.";

  if (nameRow) nameRow.style.display = "flex";
  nameInput?.focus();
}

// ---- Join step 2: team name ----
nameBtn?.addEventListener("click", tryJoinTeam);
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoinTeam();
});

function tryJoinTeam() {
  if (!joinedCode) {
    if (joinMsg) joinMsg.textContent = "Indtast kode først.";
    return;
  }

  const teamName = (nameInput?.value || "").trim();
  if (!teamName) {
    if (joinMsg) joinMsg.textContent = "Skriv et teamnavn.";
    return;
  }

  socket.emit("joinGame", { code: joinedCode, teamName }, (res) => {
    if (!res?.ok) {
      if (joinMsg) joinMsg.textContent = res?.message || "Kunne ikke joine.";
      return;
    }

    joined = true;
    myTeamName = res.team.name;

    if (joinMsg) joinMsg.textContent = `✅ I er nu med som: ${myTeamName}`;
    if (teamNameLabel) teamNameLabel.textContent = myTeamName;

    if (joinSection) joinSection.style.display = "none";

    api.clearMiniGame();
    ensureAnswerUI();
  });
}

// ---- Buzz ----
buzzBtn?.addEventListener("click", () => {
  if (!joined) return;

  let audioPosition = null;
  if (window.__grandprixAudio) {
    audioPosition = window.__grandprixAudio.currentTime;
  }

  socket.emit("buzz", { audioPosition });
});

socket.on("buzzed", (teamName) => {
  if (statusEl) statusEl.textContent = `${teamName} buzzede først!`;
});

// Admin forced stop
socket.on("gp-stop-audio-now", () => {
  stopGrandprix();
  api.clearMiniGame();
  if (gpPopup) gpPopup.style.display = "none";
});

// ---- Leaderboard ----
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

// ---- Challenge render ----
function renderChallenge(challenge) {
  buzzBtn && (buzzBtn.disabled = true);

  if (!challenge) {
    stopGrandprix();
    if (challengeTitle) challengeTitle.textContent = "Ingen udfordring endnu";
    if (challengeText) challengeText.textContent = "Vent på læreren…";
    api.clearMiniGame();
    return;
  }

  if (challengeTitle) challengeTitle.textContent = challenge.type || "Udfordring";
  if (challengeText) challengeText.textContent = challenge.text || "";

  if (challenge.type === "Nisse Grandprix") {
    renderGrandprix(challenge, api);
    return;
  }

  stopGrandprix();
  api.clearMiniGame();
}

// ---- 5-sec Grandprix answer popup ----
let gpPopupTimer = null;

function showGrandprixPopup(startAtMs, seconds) {
  if (!gpPopup || !gpPopupCountdown) return;
  if (gpPopupTimer) clearInterval(gpPopupTimer);

  gpPopup.style.display = "flex";

  function tick() {
    const elapsed = Math.floor((Date.now() - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    gpPopupCountdown.textContent = left;

    if (left <= 0) {
      clearInterval(gpPopupTimer);
      setTimeout(() => (gpPopup.style.display = "none"), 400);
    }
  }

  tick();
  gpPopupTimer = setInterval(tick, 100);
}

// ---- State from server ----
socket.on("state", (s) => {
  if (!s) return;

  if (s.gameCode && codeDisplay) codeDisplay.textContent = s.gameCode;

  renderLeaderboard(s.teams || []);
  renderChallenge(s.currentChallenge);

  const ch = s.currentChallenge;

  const isLockedGrandprix =
    ch &&
    ch.type === "Nisse Grandprix" &&
    ch.phase === "locked";

  // enable typed answer only for buzzing team during lock
  if (gpAnswerInput && gpAnswerBtn) {
    const iAmBuzzedFirst =
      joined &&
      isLockedGrandprix &&
      ch.firstBuzz &&
      ch.firstBuzz.teamName === myTeamName;

    gpAnswerInput.disabled = !iAmBuzzedFirst;
    gpAnswerBtn.disabled = !iAmBuzzedFirst;
  }

  if (
    joined &&
    isLockedGrandprix &&
    ch.firstBuzz &&
    ch.firstBuzz.teamName === myTeamName &&
    ch.countdownStartAt
  ) {
    showGrandprixPopup(ch.countdownStartAt, ch.countdownSeconds || 5);
  } else {
    if (gpPopup) gpPopup.style.display = "none";
  }
});
