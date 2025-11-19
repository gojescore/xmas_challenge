// Try to connect to Socket.IO server (same origin).
// If not available, fall back to a dummy socket so the UI still works.
let socket = null;

if (typeof io !== "undefined") {
  socket = io();
  console.log("Socket.IO: trying to connect from admin page.");
} else {
  console.warn("Socket.IO not found. Running in local-only mode.");
  socket = {
    emit: () => {},
    on: () => {},
    disconnected: true,
  };
}

const teamNameInput = document.getElementById("teamNameInput");
const addTeamBtn = document.getElementById("addTeamBtn");
const teamListEl = document.getElementById("teamList");

const challengeCards = document.querySelectorAll(".challenge-card");
const currentChallengeText = document.getElementById("currentChallengeText");

const yesBtn = document.getElementById("yesBtn");
const noBtn = document.getElementById("noBtn");
const incompleteBtn = document.getElementById("incompleteBtn");

const endGameBtn = document.getElementById("endGameBtn");
const endGameResultEl = document.getElementById("endGameResult");

const resetBtn = document.getElementById("resetBtn"); // 🔁 Nulstil-knappen

// --- Local state (mirrors server state) ---
let teams = [];
let nextTeamId = 1;
let selectedTeamId = null;
let currentChallengeType = null;

// localStorage key (backup + prep)
const STORAGE_KEY = "xmasChallengeState_v1";

// Cooldown so you don't double-click while leaderboard is moving
let isPointsCooldown = false;

// --- Persistence helpers (localStorage only) ---
function saveStateToLocal() {
  const state = {
    teams,
    nextTeamId,
    currentChallengeType,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Could not save state locally", e);
  }
}

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (state && Array.isArray(state.teams)) {
      teams = state.teams;
      if (typeof state.nextTeamId === "number") {
        nextTeamId = state.nextTeamId;
      } else {
        const maxId = teams.reduce(
          (max, t) => Math.max(max, t.id || 0),
          0
        );
        nextTeamId = maxId + 1;
      }
      currentChallengeType =
        state.currentChallengeType === undefined
          ? null
          : state.currentChallengeType;
    }
  } catch (e) {
    console.error("Could not load state locally", e);
  }
}

// --- Helper: update current challenge text only (no sync) ---
function updateCurrentChallengeTextOnly() {
  currentChallengeText.textContent = currentChallengeType
    ? `Aktuel udfordring: ${currentChallengeType}`
    : "Ingen udfordring valgt endnu.";
}

// --- Sync to server (real-time) ---
function syncToServer() {
  if (!socket || typeof socket.emit !== "function" || socket.disconnected) {
    // Just skip syncing if no real socket
    return;
  }

  const serverState = {
    teams,
    leaderboard: [], // can be used later if needed
    currentChallenge: currentChallengeType,
  };

  socket.emit("updateState", serverState);
}

// --- Rendering ---
function renderTeams() {
  // Sort by points (desc), then by name
  const sorted = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name);
  });

  teamListEl.innerHTML = "";

  sorted.forEach((team) => {
    const li = document.createElement("li");
    li.className =
      "team-item" + (team.id === selectedTeamId ? " selected" : "");
    li.dataset.id = team.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "team-name";
    nameSpan.textContent = team.name;

    const pointsDiv = document.createElement("div");
    pointsDiv.className = "team-points";

    const pointsValue = document.createElement("span");
    pointsValue.textContent = team.points;

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      changePoints(team.id, 1);
    });

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "−";
    minusBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      changePoints(team.id, -1);
    });

    pointsDiv.appendChild(minusBtn);
    pointsDiv.appendChild(pointsValue);
    pointsDiv.appendChild(plusBtn);

    li.appendChild(nameSpan);
    li.appendChild(pointsDiv);

    li.addEventListener("click", () => {
      selectedTeamId = team.id;
      renderTeams();
    });

    teamListEl.appendChild(li);
  });
}

// --- Team management ---
function addTeam(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  teams.push({
    id: nextTeamId++,
    name: trimmed,
    points: 0,
  });

  selectedTeamId = null;
  teamNameInput.value = "";
  saveStateToLocal();
  renderTeams();
  syncToServer();
  // focus input again so you can quickly add next team
  teamNameInput.focus();
}

function changePoints(teamId, delta) {
  // Prevent rapid double clicks while leaderboard is moving
  if (isPointsCooldown) return;

  const team = teams.find((t) => t.id === teamId);
  if (!team) return;

  team.points += delta;
  saveStateToLocal();
  renderTeams();
  syncToServer();

  isPointsCooldown = true;
  setTimeout(() => {
    isPointsCooldown = false;
  }, 500); // 0.5 seconds cooldown
}

function setCurrentChallenge(type) {
  currentChallengeType = type;
  updateCurrentChallengeTextOnly();
  saveStateToLocal();
  syncToServer();
}

// --- Challenge decision buttons ---
function handleYes() {
  if (!currentChallengeType) {
    alert("Vælg en udfordring først.");
    return;
  }
  if (!selectedTeamId) {
    alert("Klik på et hold i leaderboardet for at vælge vinder.");
    return;
  }
  changePoints(selectedTeamId, 1);
  alert(
    `✔ Udfordring "${currentChallengeType}" er godkendt.\nHoldet fik 1 point.`
  );
}

function handleNo() {
  if (!currentChallengeType) {
    alert("Vælg en udfordring først.");
    return;
  }
  if (!selectedTeamId) {
    alert("Vælg det hold, der fik nej (valgfrit).");
    return;
  }
  alert(`✖ Udfordring "${currentChallengeType}" blev ikke godkendt.`);
}

function handleIncomplete() {
  if (!currentChallengeType) {
    alert("Vælg en udfordring først.");
    return;
  }
  alert(
    `❔ Udfordring "${currentChallengeType}" blev markeret som ikke fuldført.`
  );
}

// --- Reset all data ---
function handleReset() {
  const sure = confirm(
    "Er du sikker på, at du vil nulstille alle hold og point?\nDette kan ikke fortrydes."
  );
  if (!sure) return;

  teams = [];
  nextTeamId = 1;
  selectedTeamId = null;
  currentChallengeType = null;
  endGameResultEl.textContent = "";

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Could not clear local state", e);
  }

  renderTeams();
  updateCurrentChallengeTextOnly();
  syncToServer();
  teamNameInput.focus();
}

// --- End game logic ---
function handleEndGame() {
  if (teams.length === 0) {
    alert("Ingen hold endnu.");
    return;
  }
  const sorted = [...teams].sort((a, b) => b.points - a.points);
  const topScore = sorted[0].points;
  const winners = sorted.filter((t) => t.points === topScore);

  if (winners.length === 1) {
    endGameResultEl.textContent = `Vinderen er: ${winners[0].name} med ${topScore} point! 🎉`;
  } else {
    const names = winners.map((t) => t.name).join(", ");
    endGameResultEl.textContent = `Der er uafgjort mellem: ${names} med ${topScore} point.`;
  }
}

// --- Event listeners ---
addTeamBtn.addEventListener("click", () => {
  addTeam(teamNameInput.value);
});

teamNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addTeam(teamNameInput.value);
  }
});

challengeCards.forEach((card) => {
  card.addEventListener("click", () => {
    const type = card.dataset.type;
    setCurrentChallenge(type);
  });
});

yesBtn.addEventListener("click", handleYes);
noBtn.addEventListener("click", handleNo);
incompleteBtn.addEventListener("click", handleIncomplete);
endGameBtn.addEventListener("click", handleEndGame);
resetBtn.addEventListener("click", handleReset);

// --- Socket.IO: Receive state from server (if available) ---
if (socket && typeof socket.on === "function") {
  socket.on("connect", () => {
    console.log("Connected to server as admin:", socket.id);
  });

  socket.on("state", (serverState) => {
    console.log("Received state from server:", serverState);

    if (!serverState) return;

    // Use server's version as truth
    if (Array.isArray(serverState.teams)) {
      teams = serverState.teams;
    } else {
      teams = [];
    }

    currentChallengeType =
      serverState.currentChallenge === undefined
        ? null
        : serverState.currentChallenge;

    // Rebuild nextTeamId from existing teams
    const maxId = teams.reduce(
      (max, t) => Math.max(max, t.id || 0),
      0
    );
    nextTeamId = maxId + 1;

    // Save server state locally just for backup/preload
    saveStateToLocal();

    renderTeams();
    updateCurrentChallengeTextOnly();
  });
}

// --- Initial load (local first, then server will override if different) ---
loadStateFromLocal();
renderTeams();
updateCurrentChallengeTextOnly();
teamNameInput.focus();
