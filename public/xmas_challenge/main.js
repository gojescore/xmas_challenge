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

// --- State ---
let teams = [];
let nextTeamId = 1;
let selectedTeamId = null;
let currentChallengeType = null;

// localStorage key
const STORAGE_KEY = "xmasChallengeState_v1";

// Cooldown so you don't double-click while leaderboard is moving
let isPointsCooldown = false;

// --- Persistence helpers ---
function saveState() {
  const state = {
    teams,
    nextTeamId,
    currentChallengeType,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Could not save state", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (state && Array.isArray(state.teams)) {
      teams = state.teams;
      // Recover nextTeamId safely
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
    console.error("Could not load state", e);
  }
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
  saveState();
  renderTeams();
  // focus input again so you can quickly add next team
  teamNameInput.focus();
}

function changePoints(teamId, delta) {
  // Prevent rapid double clicks while leaderboard is moving
  if (isPointsCooldown) return;

  const team = teams.find((t) => t.id === teamId);
  if (!team) return;

  team.points += delta;
  saveState();
  renderTeams();

  isPointsCooldown = true;
  setTimeout(() => {
    isPointsCooldown = false;
  }, 500); // 0.5 seconds cooldown
}

function setCurrentChallenge(type) {
  currentChallengeType = type;
  currentChallengeText.textContent = type
    ? `Aktuel udfordring: ${type}`
    : "Ingen udfordring valgt endnu.";
  saveState();
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

// --- Initial load ---
loadState();
renderTeams();
setCurrentChallenge(currentChallengeType);
teamNameInput.focus();
