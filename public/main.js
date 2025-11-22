// public/main.js (Admin)

let socket = io();

// Register as admin for mic signaling
socket.on("connect", () => {
  socket.emit("registerAdmin");
});

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

const gpCountdownEl = document.getElementById("grandprixCountdown");
const gpRemoteAudio = document.getElementById("grandprixRemoteAudio");

// Local mirror
let teams = [];
let nextTeamId = 1;
let selectedTeamId = null;
let currentChallenge = null;
let challengeDeck = [];

const STORAGE_KEY = "xmasChallengeState_v7";
let isPointsCooldown = false;

// INITIAL DECK (edit here)
function makeInitialDeck() {
  return [
    {
      id: 1,
      type: "Nisse Grandprix",
      title: "Grandprix 1",
      audioUrl: "PASTE_SUPABASE_URL_1",
      used: false,
    },
    {
      id: 2,
      type: "Nisse Grandprix",
      title: "Grandprix 2",
      audioUrl: "PASTE_SUPABASE_URL_2",
      used: false,
    },
    { id: 3, type: "FiNisse", title: "FiNisse – Juletrøje", used: false },
    { id: 4, type: "NisseGåden", title: "Gåde 1", text: "Hvad er det der er rødt og står i skoven?", used: false },
    { id: 5, type: "JuleKortet", title: "Julekort 1", text: "Skriv den mest kreative julehilsen.", used: false },
  ];
}

// localStorage
function saveStateToLocal() {
  const localState = { teams, nextTeamId, currentChallenge, challengeDeck };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(localState));
}

function loadStateFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (Array.isArray(s.teams)) teams = s.teams;
    if (typeof s.nextTeamId === "number") nextTeamId = s.nextTeamId;
    currentChallenge = s.currentChallenge ?? null;
    if (Array.isArray(s.challengeDeck)) challengeDeck = s.challengeDeck;
  } catch {}
}

// helpers
function updateCurrentChallengeTextOnly() {
  if (!currentChallenge) {
    currentChallengeText.textContent = "Ingen udfordring valgt endnu.";
    return;
  }
  if (typeof currentChallenge === "string") {
    currentChallengeText.textContent = `Aktuel udfordring: ${currentChallenge}`;
  } else {
    currentChallengeText.textContent = `Aktuel udfordring: ${currentChallenge.type}`;
  }
}

function syncToServer() {
  socket.emit("updateState", {
    teams,
    leaderboard: [],
    currentChallenge,
    challengeDeck,
  });
}

// ✅ Stop GP audio on ALL teams immediately
function stopGrandprixAudioNow() {
  socket.emit("gp-stop-audio-now");
}

// Render leaderboard
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

    const nameSpan = document.createElement("span");
    nameSpan.className = "team-name";
    nameSpan.textContent = team.name;

    const pointsDiv = document.createElement("div");
    pointsDiv.className = "team-points";

    const pointsValue = document.createElement("span");
    pointsValue.textContent = team.points;

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.onclick = (e) => {
      e.stopPropagation();
      changePoints(team.id, 1);
    };

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "−";
    minusBtn.onclick = (e) => {
      e.stopPropagation();
      changePoints(team.id, -1);
    };

    pointsDiv.appendChild(minusBtn);
    pointsDiv.appendChild(pointsValue);
    pointsDiv.appendChild(plusBtn);

    li.appendChild(nameSpan);
    li.appendChild(pointsDiv);

    li.onclick = () => {
      selectedTeamId = team.id;
      renderTeams();
    };

    teamListEl.appendChild(li);
  });
}

// Render deck
function renderDeck() {
  challengeGridEl.innerHTML = "";

  challengeDeck.forEach((card) => {
    const btn = document.createElement("button");
    btn.className = "challenge-card";
    btn.dataset.id = card.id;
    btn.textContent = card.title || card.type;

    if (card.used) {
      btn.disabled = true;
      btn.style.opacity = "0.4";
      btn.style.textDecoration = "line-through";
      btn.style.cursor = "not-allowed";
    }

    btn.onclick = () => {
      if (card.used) return;
      socket.emit("startChallenge", card.id);
    };

    challengeGridEl.appendChild(btn);
  });
}

// Teams
function addTeam(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  teams.push({ id: nextTeamId++, name: trimmed, points: 0 });
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
  setTimeout(() => (isPointsCooldown = false), 500);
}

function markLocalDeckUsed(id) {
  const item = challengeDeck.find(c => c.id === id);
  if (item) item.used = true;
  saveStateToLocal();
  renderDeck();
  syncToServer();
}

// ---- Grandprix mic cleanup on admin ----
let gpAdminPC = null;
let gpBuzzingTeamId = null;

function stopGrandprixMic() {
  if (gpBuzzingTeamId) {
    socket.emit("gp-stop-mic", { toTeamId: gpBuzzingTeamId });
  }

  gpBuzzingTeamId = null;

  if (gpAdminPC) {
    try { gpAdminPC.close(); } catch {}
    gpAdminPC = null;
  }
  if (gpRemoteAudio) {
    gpRemoteAudio.srcObject = null;
  }
}

// Decision buttons
function handleYes() {
  stopGrandprixAudioNow();  // ✅ instant audio stop

  if (!currentChallenge) return alert("Vælg en udfordring først.");

  if (
    typeof currentChallenge === "object" &&
    currentChallenge.type === "Nisse Grandprix"
  ) {
    stopGrandprixMic();
    socket.emit("grandprixYes");
    return;
  }

  if (!selectedTeamId) return alert("Vælg vinder i leaderboard først.");
  changePoints(selectedTeamId, 1);

  if (typeof currentChallenge === "object" && currentChallenge.id) {
    markLocalDeckUsed(currentChallenge.id);
  }
}

function handleNo() {
  stopGrandprixAudioNow();  // ✅ stop immediately, then resume if NO

  if (
    typeof currentChallenge === "object" &&
    currentChallenge.type === "Nisse Grandprix"
  ) {
    stopGrandprixMic();
    socket.emit("grandprixNo");
    return;
  }

  alert("✖ Ikke godkendt.");
}

function handleIncomplete() {
  stopGrandprixAudioNow();  // ✅ instant stop

  if (!currentChallenge) return;

  if (
    typeof currentChallenge === "object" &&
    currentChallenge.type === "Nisse Grandprix"
  ) {
    stopGrandprixMic();
    socket.emit("grandprixIncomplete");
    return;
  }

  if (typeof currentChallenge === "object" && currentChallenge.id) {
    markLocalDeckUsed(currentChallenge.id);
  }
}

// Reset / Start / End
function handleReset() {
  stopGrandprixAudioNow();  // ✅ instant stop

  if (!confirm("Nulstil alle hold + point?")) return;

  teams = [];
  nextTeamId = 1;
  selectedTeamId = null;
  currentChallenge = null;
  endGameResultEl.textContent = "";
  challengeDeck = challengeDeck.map(c => ({ ...c, used: false }));

  localStorage.removeItem(STORAGE_KEY);

  renderTeams();
  renderDeck();
  updateCurrentChallengeTextOnly();
  syncToServer();
}

function handleStartGame() {
  // Reset local deck flags
  challengeDeck = challengeDeck.map(c => ({ ...c, used: false }));
  saveStateToLocal();
  renderDeck();

  socket.emit("startGame");
  socket.emit("setDeck", challengeDeck);
}

function handleEndGame() {
  stopGrandprixAudioNow();  // ✅ instant stop

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
    endGameResultEl.textContent =
      `Uafgjort mellem: ${winners.map(w => w.name).join(", ")} (${topScore} point).`;
  }

  // FULL RESET after showing winners
  teams = [];
  nextTeamId = 1;
  selectedTeamId = null;
  currentChallenge = null;

  challengeDeck = challengeDeck.map(c => ({ ...c, used: false }));
  saveStateToLocal();
  renderTeams();
  renderDeck();
  updateCurrentChallengeTextOnly();

  socket.emit("startGame");
  socket.emit("setDeck", challengeDeck);
}

// Countdown on admin
let gpAdminTimer = null;
function startAdminCountdown(startAtMs, seconds) {
  if (!gpCountdownEl) return;
  if (gpAdminTimer) clearInterval(gpAdminTimer);

  gpCountdownEl.style.display = "block";

  function tick() {
    const now = Date.now();
    const elapsed = Math.floor((now - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    gpCountdownEl.textContent = left;
    if (left <= 0) clearInterval(gpAdminTimer);
  }
  tick();
  gpAdminTimer = setInterval(tick, 100);
}

// WebRTC (admin hears mic)
socket.on("gp-webrtc-offer", async ({ fromTeamId, offer }) => {
  gpBuzzingTeamId = fromTeamId;

  if (gpAdminPC) gpAdminPC.close();
  gpAdminPC = new RTCPeerConnection();

  gpAdminPC.ontrack = (ev) => {
    if (gpRemoteAudio) gpRemoteAudio.srcObject = ev.streams[0];
  };

  gpAdminPC.onicecandidate = (ev) => {
    if (ev.candidate && gpBuzzingTeamId) {
      socket.emit("gp-webrtc-ice", {
        toTeamId: gpBuzzingTeamId,
        candidate: ev.candidate
      });
    }
  };

  await gpAdminPC.setRemoteDescription(offer);
  const answer = await gpAdminPC.createAnswer();
  await gpAdminPC.setLocalDescription(answer);

  socket.emit("gp-webrtc-answer", {
    toTeamId: gpBuzzingTeamId,
    answer
  });
});

socket.on("gp-webrtc-ice", async ({ candidate }) => {
  try {
    if (gpAdminPC && candidate) {
      await gpAdminPC.addIceCandidate(candidate);
    }
  } catch {}
});

// Buzzed feedback
socket.on("buzzed", (teamName) => {
  currentChallengeText.textContent = `⛔ ${teamName} buzzed først!`;
});

// Receive state
socket.on("state", (s) => {
  if (!s) return;

  if (s.gameCode && gameCodeValueEl) {
    gameCodeValueEl.textContent = s.gameCode;
  }

  teams = Array.isArray(s.teams) ? s.teams : [];
  currentChallenge = s.currentChallenge ?? null;

  if (Array.isArray(s.challengeDeck)) {
    challengeDeck = s.challengeDeck;
  }

  if (!challengeDeck.length) {
    challengeDeck = makeInitialDeck();
    socket.emit("setDeck", challengeDeck);
  }

  const maxId = teams.reduce((m, t) => Math.max(m, t.id || 0), 0);
  nextTeamId = maxId + 1;

  // Admin countdown display
  const ch = s.currentChallenge;
  if (
    ch &&
    typeof ch === "object" &&
    ch.type === "Nisse Grandprix" &&
    ch.phase === "locked" &&
    ch.countdownStartAt
  ) {
    startAdminCountdown(ch.countdownStartAt, ch.countdownSeconds || 5);
  } else if (gpCountdownEl) {
    gpCountdownEl.textContent = "";
    gpCountdownEl.style.display = "none";
  }

  saveStateToLocal();
  renderTeams();
  renderDeck();
  updateCurrentChallengeTextOnly();
});

// Listeners
addTeamBtn.onclick = () => addTeam(teamNameInput.value);
teamNameInput.onkeydown = (e) => {
  if (e.key === "Enter") addTeam(teamNameInput.value);
};

yesBtn.onclick = handleYes;
noBtn.onclick = handleNo;
incompleteBtn.onclick = handleIncomplete;
endGameBtn.onclick = handleEndGame;
resetBtn.onclick = handleReset;
startGameBtn.onclick = handleStartGame;

// Init
loadStateFromLocal();

if (!challengeDeck.length) {
  challengeDeck = makeInitialDeck();
  saveStateToLocal();
  socket.emit("setDeck", challengeDeck);
}

renderTeams();
renderDeck();
updateCurrentChallengeTextOnly();
teamNameInput.focus();
