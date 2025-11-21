// Admin / Main computer (ES5-style, no modules)

// Socket setup
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

const resetBtn = document.getElementById("resetBtn");

// optional: if you later add a Start Game button in HTML
const startGameBtn = document.getElementById("startGameBtn");

// --- Local mirror of server state ---
let teams = [];
let nextTeamId = 1;
let selectedTeamId = null;

// currentChallenge can be string OR object (Grandprix)
let currentChallenge = null;

// localStorage key
const STORAGE_KEY = "xmasChallengeState_v2";

// Cooldown so you don't double-click while leaderboard is moving
let isPointsCooldown = false;

// -----------------------------
// Persistence
// -----------------------------
function saveStateToLocal() {
  const localState = {
    teams,
    nextTeamId,
    currentChallenge,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localState));
  } catch (e) {
    console.error("Could not save state locally", e);
  }
}

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const localState = JSON.parse(raw);
    if (localState && Array.isArray(localState.teams)) {
      teams = localState.teams;

      if (typeof localState.nextTeamId === "number") {
        nextTeamId = localState.nextTeamId;
      } else {
        const maxId = teams.reduce(
          (max, t) => Math.max(max, t.id || 0),
          0
        );
        nextTeamId = maxId + 1;
      }

      currentChallenge =
        localState.currentChallenge === undefined
          ? null
          : localState.currentChallenge;
    }
  } catch (e) {
    console.error("Could not load state locally", e);
  }
}

// -----------------------------
// UI Helpers
// -----------------------------
function updateCurrentChallengeTextOnly() {
  if (!currentChallenge) {
    currentChallengeText.textContent = "Ingen udfordring valgt endnu.";
    return;
  }

  if (typeof currentChallenge === "string") {
    currentChallengeText.textContent = `Aktuel udfordring: ${currentChallenge}`;
  } else {
    currentChallengeText.textContent =
      `Aktuel udfordring: ${currentChallenge.type} (${currentChallenge.phase})`;
  }
}

// -----------------------------
// Sync to server
// -----------------------------
function syncToServer() {
  if (!socket || typeof socket.emit !== "function" || socket.disconnected) {
    return;
  }

  const serverState = {
    gameCode: undefined, // server keeps the real code
    teams,
    leaderboard: [],
    currentChallenge,
  };

  socket.emit("updateState", serverState);
}

// -----------------------------
// Rendering
// -----------------------------
function renderTeams() {
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

// -----------------------------
// Team management
// -----------------------------
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
  teamNameInput.focus();
}

function changePoints(teamId, delta) {
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
  }, 500);
}

// -----------------------------
// Challenge selection
// -----------------------------
function setCurrentChallenge(type) {
  // Special case: Grandprix starts via server event (audio sync)
  if (type === "Nisse Grandprix") {
    const audioUrl = prompt(
      "Indsæt lydfilens URL (fx /audio/grandprix/track1.mp3)"
    );

    if (!audioUrl) {
      alert("Ingen lyd valgt. Grandprix blev ikke startet.");
      return;
    }

    socket.emit("startGrandprix", {
      audioUrl,
      startDelayMs: 2000,
    });

    return; // server will broadcast state
  }

  // Normal challenges = just string
  currentChallenge = type;
  updateCurrentChallengeTextOnly();
  saveStateToLocal();
  syncToServer();
}

// -----------------------------
// YES / NO / INCOMPLETE buttons
// -----------------------------
function handleYes() {
  if (!currentChallenge) {
    alert("Vælg en udfordring først.");
    return;
  }

  // If Grandprix and locked with firstBuzz => use server YES
  if (
    typeof currentChallenge === "object" &&
    currentChallenge.type === "Nisse Grandprix" &&
    currentChallenge.phase === "locked" &&
    currentChallenge.firstBuzz
  ) {
    socket.emit("grandprixYes");
    return;
  }

  // Otherwise manual award like before
  if (!selectedTeamId) {
    alert("Klik på et hold i leaderboardet for at vælge vinder.");
    return;
  }

  changePoints(selectedTeamId, 1);
  alert("✔ Point givet.");
}

function handleNo() {
  if (!currentChallenge) {
    alert("Vælg en udfordring først.");
    return;
  }

  // Grandprix NO => resume listening and lock out that team
  if (
    typeof currentChallenge === "object" &&
    currentChallenge.type === "Nisse Grandprix" &&
    currentChallenge.phase === "locked" &&
    currentChallenge.firstBuzz
  ) {
    // admin can optionally send audioPosition later
    socket.emit("grandprixNo", {});
    return;
  }

  alert("✖ Ikke godkendt.");
}

function handleIncomplete() {
  if (!currentChallenge) {
    alert("Vælg en udfordring først.");
    return;
  }

  // Grandprix incomplete => end without points
  if (
    typeof currentChallenge === "object" &&
    currentChallenge.type === "Nisse Grandprix"
  ) {
    socket.emit("grandprixIncomplete");
    return;
  }

  alert("❔ Markerede som ikke fuldført.");
}

// -----------------------------
// Reset / Start / End game
// -----------------------------
function handleReset() {
  const sure = confirm(
    "Er du sikker på, at du vil nulstille alle hold og point?\nDette kan ikke fortrydes."
  );
  if (!sure) return;

  teams = [];
  nextTeamId = 1;
  selectedTeamId = null;
  currentChallenge = null;
  endGameResultEl.textContent = "";

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Could not clear local storage", e);
  }

  renderTeams();
  updateCurrentChallengeTextOnly();
  syncToServer();
  teamNameInput.focus();
}

// Start game = ask server to generate new code + clear state
function handleStartGame() {
  socket.emit("startGame");
}

// End game logic (same as before)
function handleEndGame() {
  if (teams.length === 0) {
    alert("Ingen hold endnu.");
    return;
  }
  const sorted = [...teams].sort((a, b) => b.points - a.points);
  const topScore = sorted[0].points;
  const winners = sorted.filter((t) => t.points === topScore);

  if (winners.length === 1) {
    endGameResultEl.textContent =
      `Vinderen er: ${winners[0].name} med ${topScore} point! 🎉`;
  } else {
    const names = winners.map((t) => t.name).join(", ");
    endGameResultEl.textContent =
      `Der er uafgjort mellem: ${names} med ${topScore} point.`;
  }
}

// -----------------------------
// Event listeners
// -----------------------------
addTeamBtn.addEventListener("click", () => addTeam(teamNameInput.value));
teamNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTeam(teamNameInput.value);
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

// If you add a Start Game button later, it will work
startGameBtn?.addEventListener("click", handleStartGame);

// -----------------------------
// Socket receive state
// -----------------------------
socket.on("connect", () => {
  console.log("Connected to server as admin:", socket.id);
});

socket.on("state", (serverState) => {
  console.log("Received state from server:", serverState);
  if (!serverState) return;

  if (Array.isArray(serverState.teams)) {
    teams = serverState.teams;
  } else {
    teams = [];
  }

  currentChallenge =
    serverState.currentChallenge === undefined
      ? null
      : serverState.currentChallenge;

  const maxId = teams.reduce(
    (max, t) => Math.max(max, t.id || 0),
    0
  );
  nextTeamId = maxId + 1;

  saveStateToLocal();
  renderTeams();
  updateCurrentChallengeTextOnly();
});

// -----------------------------
// Initial load
// -----------------------------
loadStateFromLocal();
renderTeams();
updateCurrentChallengeTextOnly();
teamNameInput.focus();
