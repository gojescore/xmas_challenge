// public/team.js
// Connect to the same server that serves this page
import { renderGrandprix } from "./minigames/grandprix.js";

const socket = io();

// --------------------------
// DOM ELEMENTS
// --------------------------
const codeInput = document.getElementById("codeInput");
const codeBtn = document.getElementById("codeBtn");

const nameRow = document.getElementById("nameRow");
const nameInput = document.getElementById("nameInput");
const nameBtn = document.getElementById("nameBtn");

const joinMsg = document.getElementById("joinMsg");

const codeDisplay = document.getElementById("codeDisplay");
const teamListEl = document.getElementById("teamList");

const challengeTitle = document.getElementById("challengeTitle");
const challengeText = document.getElementById("challengeText");

const buzzBtn = document.getElementById("buzzBtn");
const statusEl = document.getElementById("status");

const teamNameLabel = document.getElementById("teamNameLabel");

// --------------------------
// STATE
// --------------------------
let joined = false;
let joinedCode = null;
let myTeamName = null;

// --------------------------
// API given to mini-games
// --------------------------
const api = {
  setBuzzEnabled(enabled) {
    buzzBtn.disabled = !enabled;
  },

  showStatus(text) {
    statusEl.textContent = text;
  },

  clearMiniGame() {
    statusEl.textContent = "";
    buzzBtn.disabled = true;
  }
};

// --------------------------
// JOIN STEP 1: ENTER CODE
// --------------------------
codeBtn.addEventListener("click", tryCode);
codeInput.addEventListener("keydown", (e) => {
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

// --------------------------
// JOIN STEP 2: ENTER TEAM NAME
// --------------------------
nameBtn.addEventListener("click", tryJoinTeam);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoinTeam();
});

function tryJoinTeam() {
  if (!joinedCode) {
    joinMsg.textContent = "Indtast kode først.";
    return;
  }

  const teamName = nameInput.value.trim();
  if (!teamName) {
    joinMsg.textContent = "Skriv et teamnavn.";
    return;
  }

  socket.emit("joinGame", { code: joinedCode, teamName }, (res) => {
    if (!res?.ok) {
      joinMsg.textContent = res?.message || "Kunne ikke joine.";
      return;
    }

    joined = true;
    myTeamName = res.team.name;

    joinMsg.textContent = `✅ I er nu med som: ${myTeamName}`;

    // ⭐ This is all you need to set the header name
    if (teamNameLabel) {
      teamNameLabel.textContent = myTeamName;
    }

    document.getElementById("joinSection").style.display = "none";

    // Mini-games will decide when buzzing starts
    api.clearMiniGame();
  });
}

// --------------------------
// RECEIVE GLOBAL STATE
// --------------------------
socket.on("state", (serverState) => {
  if (!serverState) return;

  if (serverState.gameCode) {
    codeDisplay.textContent = serverState.gameCode;
  }

  renderLeaderboard(serverState.teams || []);
  renderChallenge(serverState.currentChallenge);
});

// --------------------------
// BUZZ HANDLING
// --------------------------
buzzBtn.addEventListener("click", () => {
  if (!joined) return;
  socket.emit("buzz");
});

socket.on("buzzed", (teamName) => {
  statusEl.textContent = `${teamName} buzzede først!`;
});

// --------------------------
// RENDERING HELPERS
// --------------------------
function renderLeaderboard(teams) {
  const sorted = [...teams].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) {
      return (b.points ?? 0) - (a.points ?? 0);
    }
    return (a.name || "").localeCompare(b.name || "");
  });

  teamListEl.innerHTML = "";

  sorted.forEach((t, i) => {
    const li = document.createElement("li");
    li.className = "team-item";

    const left = document.createElement("span");
    left.textContent = `${i + 1}. ${t.name}`;

    const right = document.createElement("span");
    right.className = "pts";
    right.textContent = t.points ?? 0;

    li.appendChild(left);
    li.appendChild(right);

    teamListEl.appendChild(li);
  });
}

function renderChallenge(challenge) {
  // Default: buzzing disabled
  buzzBtn.disabled = true;

  if (!challenge) {
    challengeTitle.textContent = "Ingen udfordring endnu";
    challengeText.textContent = "Vent på læreren…";
    api.clearMiniGame();
    return;
  }

  // Normal title fallback
  challengeTitle.textContent = challenge.type || "Udfordring";
  challengeText.textContent = challenge.text || "";

  // Decide which minigame to load
  if (typeof challenge === "object") {
    if (challenge.type === "Nisse Grandprix") {
      renderGrandprix(challenge, api);
      return;
    }
  }

  // If no specific minigame:
  api.clearMiniGame();
}
