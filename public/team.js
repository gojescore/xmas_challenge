// public/team.js (event-safe)

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

const gpPopup = el("grandprixPopup");
const gpPopupCountdown = el("grandprixPopupCountdown");

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
    disableAnswerUI();
  }
};

// -------------------
// Answer UI (used for NisseGåden)
// -------------------
let answerWrap = null;
let answerInput = null;
let answerBtn = null;

function ensureAnswerUI() {
  if (answerWrap) return;

  answerWrap = document.createElement("div");
  answerWrap.style.cssText =
    "margin-top:12px; display:flex; gap:8px; justify-content:center;";

  answerInput = document.createElement("input");
  answerInput.placeholder = "Skriv jeres svar her…";
  answerInput.style.cssText =
    "font-size:1.1rem; padding:8px; width:260px;";

  answerBtn = document.createElement("button");
  answerBtn.textContent = "Send svar";
  answerBtn.style.cssText =
    "font-size:1.1rem; padding:8px 12px; font-weight:700; cursor:pointer;";

  answerBtn.onclick = () => {
    const text = (answerInput.value || "").trim();
    if (!text) return;
    socket.emit("submitCard", text);
    answerInput.value = "";
    api.showStatus("✅ Svar sendt til læreren.");
  };

  answerWrap.append(answerInput, answerBtn);
  challengeText.parentElement.appendChild(answerWrap);
}

function enableAnswerUI(enabled) {
  ensureAnswerUI();
  answerWrap.style.display = enabled ? "flex" : "none";
  answerInput.disabled = !enabled;
  answerBtn.disabled = !enabled;
}

function disableAnswerUI() {
  if (!answerWrap) return;
  answerWrap.style.display = "none";
  answerInput.disabled = true;
  answerBtn.disabled = true;
}

// -------------------
// JOIN step 1
// -------------------
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

// -------------------
// JOIN step 2
// -------------------
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

// -------------------
// BUZZ
// -------------------
buzzBtn?.addEventListener("click", async () => {
  if (!joined) return;

  // If autoplay was blocked, buzz click is allowed to start audio
  if (window.__grandprixAudio && window.__grandprixAudio.paused) {
    try { await window.__grandprixAudio.play(); }
    catch {}
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
  if (gpPopup) gpPopup.style.display = "none";
});

// -------------------
// LEADERBOARD
// -------------------
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

// -------------------
// Grandprix popup countdown
// -------------------
let gpPopupTimer = null;

function showGrandprixPopup(startAtMs, seconds) {
  if (!gpPopup || !gpPopupCountdown) return;
  if (gpPopupTimer) clearInterval(gpPopupTimer);

  gpPopup.style.display = "flex";

  const tick = () => {
    const elapsed = Math.floor((Date.now() - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    gpPopupCountdown.textContent = left;

    if (left <= 0) {
      clearInterval(gpPopupTimer);
      setTimeout(() => (gpPopup.style.display = "none"), 400);
    }
  };

  tick();
  gpPopupTimer = setInterval(tick, 100);
}

// -------------------
// Challenge render
// -------------------
function renderChallenge(ch) {
  api.setBuzzEnabled(false);
  disableAnswerUI();

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

  // NisseGåden → allow typing answer
  if (ch.type === "NisseGåden") {
    enableAnswerUI(true);
    return;
  }

  stopGrandprix();
  api.clearMiniGame();
}

// -------------------
// Receive state
// -------------------
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

  if (iAmBuzzedFirst && ch.countdownStartAt) {
    showGrandprixPopup(ch.countdownStartAt, ch.countdownSeconds || 5);
  } else {
    if (gpPopup) gpPopup.style.display = "none";
  }
});
