// public/main.js (MODULE Version A)

import { grandprixDeck } from "./data/deck/grandprix.js";
import { nisseGaaden } from "./data/deck/nissegaaden.js";

const socket = (typeof io !== "undefined") ? io() : {
  emit() {},
  on() {},
  disconnected: true
};

// DOM
const teamNameInput = document.getElementById("teamNameInput");
const addTeamBtn = document.getElementById("addTeamBtn");
const teamListEl = document.getElementById("teamList");

const challengeGridEl = document.querySelector(".challenge-grid");
const currentChallengeText = document.getElementById("currentChallengeText");

const yesBtn = document.getElementById("yesBtn");
const noBtn = document.getElementById("noBtn");
const incompleteBtn = document.getElementById("incompleteBtn");

const endGameBtn = document.getElementById("endGameBtn");
const endGameResultEl = document.getElementById("endGameResult");

const resetBtn = document.getElementById("resetBtn");
const startGameBtn = document.getElementById("startGameBtn");
const gameCodeValueEl = document.getElementById("gameCodeValue");

// Countdown element on main (to right of "ikke fuldført")
let mainCountdownEl = null;
function ensureMainCountdownEl() {
  if (mainCountdownEl) return mainCountdownEl;
  mainCountdownEl = document.createElement("span");
  mainCountdownEl.id = "mainCountdown";
  mainCountdownEl.style.cssText = `
    font-weight:900; font-size:1.6rem; margin-left:10px;
    padding:6px 10px; border-radius:8px; background:#111; color:#fff;
    display:none; min-width:40px; text-align:center;
  `;
  incompleteBtn?.insertAdjacentElement("afterend", mainCountdownEl);
  return mainCountdownEl;
}

// STATE
let teams = [];
let selectedTeamId = null;
let currentChallenge = null;
let deck = makeInitialDeck();
let gameCode = null;

let isPointsCooldown = false;
const STORAGE_KEY = "xmasChallengeState_v4";

// Build initial deck from imported sets
function makeInitialDeck() {
  return [
    ...grandprixDeck,
    ...nisseGaaden,
  ].map(c => ({ ...c, used: !!c.used }));
}

// Local persistence
function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      teams, deck, currentChallenge, gameCode
    }));
  } catch {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.teams)) teams = s.teams;
    if (Array.isArray(s.deck)) deck = s.deck;
    if (s.currentChallenge) currentChallenge = s.currentChallenge;
    if (s.gameCode) gameCode = s.gameCode;
  } catch {}
}

// Sync to server
function syncToServer() {
  if (!socket || socket.disconnected) return;
  socket.emit("updateState", { gameCode, teams, deck, currentChallenge });
}

// Render teams
function renderTeams() {
  const sorted = [...teams].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  teamListEl.innerHTML = "";

  sorted.forEach(team => {
    const li = document.createElement("li");
    li.className = "team-item" + (team.id === selectedTeamId ? " selected" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "team-name";
    nameSpan.textContent = team.name;

    const pointsDiv = document.createElement("div");
    pointsDiv.className = "team-points";

    const pointsValue = document.createElement("span");
    pointsValue.textContent = team.points ?? 0;

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.onclick = (e) => { e.stopPropagation(); changePoints(team.id, 1); };

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "−";
    minusBtn.onclick = (e) => { e.stopPropagation(); changePoints(team.id, -1); };

    pointsDiv.append(minusBtn, pointsValue, plusBtn);
    li.append(nameSpan, pointsDiv);

    li.onclick = () => { selectedTeamId = team.id; renderTeams(); };

    teamListEl.appendChild(li);
  });
}

// Render deck boxes
function renderDeck() {
  if (!challengeGridEl) return;
  challengeGridEl.innerHTML = "";

  deck.forEach(card => {
    const btn = document.createElement("button");
    btn.className = "challenge-card";
    btn.textContent = card.title || card.type;

    if (card.used) {
      btn.style.opacity = "0.45";
      btn.style.textDecoration = "line-through";
    }

    btn.onclick = () => {
      if (card.used) return alert("Denne udfordring er allerede brugt.");
      setCurrentChallenge(card);
    };

    challengeGridEl.appendChild(btn);
  });
}

// Render current challenge text + countdown on main
let mainCountdownTimer = null;
function renderCurrentChallenge() {
  if (!currentChallenge) {
    currentChallengeText.textContent = "Ingen udfordring valgt endnu.";
    hideMainCountdown();
    return;
  }

  currentChallengeText.textContent =
    `Aktuel udfordring: ${currentChallenge.title || currentChallenge.type}`;

  if (
    currentChallenge.type === "Nisse Grandprix" &&
    currentChallenge.phase === "locked" &&
    currentChallenge.countdownStartAt
  ) {
    showMainCountdown(currentChallenge.countdownStartAt, currentChallenge.countdownSeconds || 5);
  } else hideMainCountdown();
}

function showMainCountdown(startAtMs, seconds) {
  ensureMainCountdownEl();
  mainCountdownEl.style.display = "inline-block";
  if (mainCountdownTimer) clearInterval(mainCountdownTimer);

  const tick = () => {
    const now = Date.now();
    const elapsed = Math.floor((now - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    mainCountdownEl.textContent = left;

    if (left <= 0) {
      clearInterval(mainCountdownTimer);
      mainCountdownTimer = null;
      setTimeout(hideMainCountdown, 400);
    }
  };

  tick();
  mainCountdownTimer = setInterval(tick, 100);
}

function hideMainCountdown() {
  if (mainCountdownTimer) clearInterval(mainCountdownTimer);
  mainCountdownTimer = null;
  if (mainCountdownEl) mainCountdownEl.style.display = "none";
}

// Team management
function addTeam(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  if (teams.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) {
    return alert("Holdnavnet findes allerede.");
  }

  teams.push({
    id: "t" + (crypto?.randomUUID?.() || Date.now()),
    name: trimmed,
    points: 0,
  });

  selectedTeamId = null;
  teamNameInput.value = "";
  saveLocal();
  renderTeams();
  syncToServer();
  teamNameInput.focus();
}

function changePoints(teamId, delta) {
  if (isPointsCooldown) return;
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  team.points = (team.points ?? 0) + delta;

  saveLocal();
  renderTeams();
  syncToServer();

  isPointsCooldown = true;
  setTimeout(() => isPointsCooldown = false, 400);
}

// Selecting a challenge
function setCurrentChallenge(card) {
  if (card.type === "Nisse Grandprix") {
    const startDelayMs = 3000;
    currentChallenge = {
      ...card,
      phase: "listening",
      startAt: Date.now() + startDelayMs,
      firstBuzz: null,
      countdownSeconds: 5
    };
  } else {
    currentChallenge = { ...card };
  }

  renderCurrentChallenge();
  saveLocal();
  syncToServer();
}

// Mark current card used
function markCurrentUsed() {
  if (!currentChallenge) return;
  const idx = deck.findIndex(c => c.id === currentChallenge.id);
  if (idx >= 0) deck[idx].used = true;
}

// End current challenge safely
function endCurrentChallenge() {
  if (!currentChallenge) return;
  if (currentChallenge.type === "Nisse Grandprix") {
    currentChallenge.phase = "ended";
  } else {
    currentChallenge = null;
  }
}

// Decision buttons
function handleYes() {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  if (!selectedTeamId) return alert("Vælg vinderholdet.");

  changePoints(selectedTeamId, 1);
  markCurrentUsed();
  endCurrentChallenge();

  renderDeck();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
}

function handleNo() {
  if (!currentChallenge) return alert("Vælg en udfordring først.");

  markCurrentUsed();
  endCurrentChallenge();

  renderDeck();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
}

function handleIncomplete() {
  if (!currentChallenge) return alert("Vælg en udfordring først.");

  markCurrentUsed();
  endCurrentChallenge();

  renderDeck();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
}

// Reset everything
function handleReset() {
  const sure = confirm("Nulstil hele spillet? (hold, point og udfordringer)");
  if (!sure) return;

  teams = [];
  selectedTeamId = null;
  currentChallenge = null;
  deck = makeInitialDeck();
  endGameResultEl.textContent = "";
  gameCode = null;

  localStorage.removeItem(STORAGE_KEY);

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  syncToServer();
  teamNameInput.focus();
}

// End game (does NOT wipe; just shows winner)
function handleEndGame() {
  if (!teams.length) return alert("Ingen hold endnu.");

  const sorted = [...teams].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const topScore = sorted[0].points ?? 0;
  const winners = sorted.filter(t => (t.points ?? 0) === topScore);

  endGameResultEl.textContent =
    winners.length === 1
      ? `Vinderen er: ${winners[0].name} med ${topScore} point! 🎉`
      : `Uafgjort mellem: ${winners.map(t => t.name).join(", ")} (${topScore} point)`;

  if (currentChallenge?.type === "Nisse Grandprix") {
    currentChallenge.phase = "ended";
    syncToServer();
  }
}

// Start game (server is truth — no local fallback)
function handleStartGame() {
  startGameBtn.disabled = true;

  socket.emit("startGame", (res) => {
    if (!res?.ok) {
      alert(res?.message || "Kunne ikke starte spillet. Prøv igen.");
      startGameBtn.disabled = false;
      return;
    }

    gameCode = res.gameCode;
    if (gameCodeValueEl) gameCodeValueEl.textContent = gameCode;

    // keep local deck unless server sent one
    if (res.state?.deck && Array.isArray(res.state.deck)) deck = res.state.deck;

    currentChallenge = null;

    renderTeams();
    renderDeck();
    renderCurrentChallenge();
    saveLocal();
    syncToServer();
  });
}

// Listeners
addTeamBtn?.addEventListener("click", () => addTeam(teamNameInput.value));
teamNameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTeam(teamNameInput.value);
});

yesBtn?.addEventListener("click", handleYes);
noBtn?.addEventListener("click", handleNo);
incompleteBtn?.addEventListener("click", handleIncomplete);

resetBtn?.addEventListener("click", handleReset);
endGameBtn?.addEventListener("click", handleEndGame);
startGameBtn?.addEventListener("click", handleStartGame);

// Server state
socket.on("state", (s) => {
  if (!s) return;

  if (s.gameCode) {
    gameCode = s.gameCode;
    if (gameCodeValueEl) gameCodeValueEl.textContent = gameCode;
  }

  if (Array.isArray(s.teams)) teams = s.teams;
  if (Array.isArray(s.deck)) deck = s.deck;
  currentChallenge = s.currentChallenge || null;

  saveLocal();
  renderTeams();
  renderDeck();
  renderCurrentChallenge();
});

socket.on("buzzed", (teamName) => {
  const t = teams.find(x => x.name === teamName);
  if (t) {
    selectedTeamId = t.id;
    renderTeams();
  }
});

// Init
loadLocal();
renderTeams();
renderDeck();
renderCurrentChallenge();
teamNameInput?.focus();
if (gameCodeValueEl && gameCode) gameCodeValueEl.textContent = gameCode;
