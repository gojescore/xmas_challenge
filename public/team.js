// Team page (ES module) — SAFE version with lazy mini-game loading

// --- Socket init (defensive) ---
let socket = null;

if (typeof io !== "undefined") {
  socket = io();
  console.log("Socket.IO connected (team page).");
} else {
  console.warn("Socket.IO not loaded yet. Using dummy socket.");
  socket = {
    emit: () => {},
    on: () => {},
    disconnected: true,
  };
}

let joined = false;
let joinedCode = null;
let myTeamName = null;

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

// --- Mini-game API ---
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
  },
};

// ----------------------
// JOIN FLOW
// ----------------------
codeBtn.addEventListener("click", tryCode);
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryCode();
});

function tryCode() {
  const code = codeInput.value.trim();
  if (!code) {
    joinMsg.textContent = "Skriv en code først.";
    return;
  }

  joinedCode = code;
  codeDisplay.textContent = code;
  joinMsg.textContent = "Code accepteret. Skriv jeres teamnavn.";

  nameRow.style.display = "flex";
  nameInput.focus();
}

nameBtn.addEventListener("click", tryJoinTeam);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoinTeam();
});

function tryJoinTeam() {
  if (!joinedCode) {
    joinMsg.textContent = "Indtast code først.";
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
    document.getElementById("teamNameLabel").textContent = myTeamName;

    document.getElementById("teamNameLabel").textContent = `– ${myTeamName}`;

    document.getElementById("joinSection").style.display = "none";

    // Mini-games decide buzz (not here)
    api.clearMiniGame();
  });
}

// ----------------------
// SOCKET EVENTS
// ----------------------
socket.on("state", (serverState) => {
  if (!serverState) return;

  if (serverState.gameCode) {
    codeDisplay.textContent = serverState.gameCode;
  }

  renderLeaderboard(serverState.teams || []);
  renderChallenge(serverState.currentChallenge);
});

buzzBtn.addEventListener("click", () => {
  if (!joined) return;
  socket.emit("buzz");
});

socket.on("buzzed", (teamName) => {
  statusEl.textContent = `${teamName} buzzed først!`;
});

// ----------------------
// RENDERING
// ----------------------
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

// --- Lazy mini-game loader ---
// Map challenge type -> module path + export name
const MINI_GAMES = {
  "Nisse Grandprix": {
    path: "./minigames/grandprix.js",
    exportName: "renderGrandprix",
  },

  // Add later when files exist:
  // "FiNisse": { path: "./minigames/finisse.js", exportName: "renderFiNisse" },
  // "NisseGåden": { path: "./minigames/nissegaaden.js", exportName: "renderNisseGaaden" },
  // "JuleKortet": { path: "./minigames/julekortet.js", exportName: "renderJuleKortet" },
  // "Nisse-udfordringen": { path: "./minigames/nisse_udfordringen.js", exportName: "renderNisseUdfordringen" },
};

async function runMiniGame(type, challenge) {
  const cfg = MINI_GAMES[type];
  if (!cfg) {
    api.clearMiniGame();
    return;
  }

  try {
    const mod = await import(cfg.path);
    const fn = mod[cfg.exportName];
    if (typeof fn === "function") {
      fn(challenge, api);
    } else {
      console.warn(`Mini-game export not found: ${cfg.exportName}`);
      api.clearMiniGame();
    }
  } catch (err) {
    console.error("Mini-game failed to load:", cfg.path, err);
    // Don’t kill the UI — just show default view
    api.clearMiniGame();
  }
}

function renderChallenge(challenge) {
  api.clearMiniGame();

  if (!challenge) {
    challengeTitle.textContent = "Ingen udfordring endnu";
    challengeText.textContent = "Vent på læreren…";
    return;
  }

  let type;

  if (typeof challenge === "string") {
    type = challenge;
    challengeTitle.textContent = challenge;
    challengeText.textContent = "Se instruktioner på skærmen.";
  } else {
    type = challenge.type || "Ny udfordring!";
    challengeTitle.textContent = type;
    challengeText.textContent =
      challenge.text || "Se instruktioner på skærmen.";
  }

  runMiniGame(type, challenge);
}


