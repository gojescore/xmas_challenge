// public/main.js (v24) — event-safe admin
// - Deck boxes (used/crossed-out)
// - Grandprix phase: listening -> locked -> ended
// - 20 second answer window for buzzing team
// - Stop audio on Ja/Nej/Ikke/Nulstil/Afslut
// - Auto-select buzzing team on admin
// - Receive typed answers (GP + NisseGåden)

const socket = io();

// DOM
const startGameBtn = document.getElementById("startGameBtn");
const resetBtn = document.getElementById("resetBtn");
const gameCodeValueEl = document.getElementById("gameCodeValue");

const teamNameInput = document.getElementById("teamNameInput");
const addTeamBtn = document.getElementById("addTeamBtn");
const teamListEl = document.getElementById("teamList");

const currentChallengeText = document.getElementById("currentChallengeText");
const yesBtn = document.getElementById("yesBtn");
const noBtn = document.getElementById("noBtn");
const incompleteBtn = document.getElementById("incompleteBtn");
const endGameBtn = document.getElementById("endGameBtn");
const endGameResultEl = document.getElementById("endGameResult");

const challengeGridEl = document.querySelector(".challenge-grid");

// STATE
let teams = [];
let selectedTeamId = null;
let currentChallenge = null;
let deck = [];
let gameCode = null;

const STORAGE_KEY = "xmasChallenge_admin_event_v24";

// ---------------------------
// Load deck from files safely
// ---------------------------
async function loadDeckSafely() {
  let gpDeck = [];
  let ngDeck = [];

  try {
    const gp = await import("./data/deck/grandprix.js?v=" + Date.now());
    gpDeck = gp.grandprixDeck || gp.deck || gp.default || [];
  } catch (e) {
    console.warn("Could not load grandprix deck:", e);
  }

  try {
    const ng = await import("./data/deck/nissegaaden.js?v=" + Date.now());
    ngDeck = ng.nisseGaaden || ng.deck || ng.default || [];
  } catch (e) {
    console.warn("Could not load nissegaaden deck:", e);
  }

  deck = [...gpDeck, ...ngDeck].map(c => ({ ...c, used: !!c.used }));

  renderDeck();
  saveLocal();
  syncToServer(); // publish deck so it never goes empty on server
}

// ---------------------------
// Local persistence
// ---------------------------
function saveLocal() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ teams, deck, currentChallenge, gameCode })
  );
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.teams)) teams = s.teams;
    if (Array.isArray(s.deck)) deck = s.deck;
    currentChallenge = s.currentChallenge || null;
    gameCode = s.gameCode || null;
  } catch {}
}

// ---------------------------
// Sync to server
// ---------------------------
function syncToServer() {
  socket.emit("updateState", { teams, deck, currentChallenge, gameCode });
}

// ---------------------------
// Render deck boxes
// ---------------------------
function renderDeck() {
  if (!challengeGridEl) return;
  challengeGridEl.innerHTML = "";

  if (!deck.length) {
    const p = document.createElement("p");
    p.textContent = "⚠️ Ingen udfordringer fundet (deck tom)";
    p.style.color = "crimson";
    p.style.fontWeight = "800";
    challengeGridEl.appendChild(p);
    return;
  }

  deck.forEach(card => {
    const btn = document.createElement("button");
    btn.className = "challenge-card";
    btn.textContent = card.title || card.type;

    if (card.used) {
      btn.style.opacity = "0.45";
      btn.style.textDecoration = "line-through";
    }

    btn.onclick = () => {
      if (card.used) {
        alert("Denne udfordring er allerede brugt.");
        return;
      }

      // mark used
      card.used = true;

      // build challenge object
      if (card.type === "Nisse Grandprix") {
        currentChallenge = {
          ...card,
          phase: "listening",
          startAt: Date.now() + 3000, // 3 sec pre-countdown so audio syncs
          firstBuzz: null,
          countdownSeconds: 20 // ✅ 20 seconds to type answer
        };
      } else {
        currentChallenge = { ...card };
      }

      renderDeck();
      renderCurrentChallenge();
      saveLocal();
      syncToServer();
    };

    challengeGridEl.appendChild(btn);
  });
}

// ---------------------------
// Render leaderboard
// ---------------------------
function renderTeams() {
  const sorted = [...teams].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) {
      return (b.points ?? 0) - (a.points ?? 0);
    }
    return (a.name || "").localeCompare(b.name || "");
  });

  teamListEl.innerHTML = "";

  sorted.forEach(team => {
    const li = document.createElement("li");
    li.className = "team-item" + (team.id === selectedTeamId ? " selected" : "");

    li.innerHTML = `
      <span class="team-name">${team.name}</span>
      <div class="team-points">
        <button class="minus">−</button>
        <span>${team.points ?? 0}</span>
        <button class="plus">+</button>
      </div>
    `;

    li.querySelector(".plus").onclick = (e) => {
      e.stopPropagation();
      team.points = (team.points ?? 0) + 1;
      saveLocal(); renderTeams(); syncToServer();
    };

    li.querySelector(".minus").onclick = (e) => {
      e.stopPropagation();
      team.points = Math.max(0, (team.points ?? 0) - 1);
      saveLocal(); renderTeams(); syncToServer();
    };

    li.onclick = () => {
      selectedTeamId = team.id;
      renderTeams();
    };

    teamListEl.appendChild(li);
  });
}

// ---------------------------
// Current challenge text
// ---------------------------
function renderCurrentChallenge() {
  currentChallengeText.textContent = currentChallenge
    ? `Aktuel udfordring: ${currentChallenge.title || currentChallenge.type}`
    : "Ingen udfordring valgt endnu.";
}

// ---------------------------
// Add team manually (optional)
// ---------------------------
addTeamBtn.onclick = () => {
  const name = teamNameInput.value.trim();
  if (!name) return;

  if (teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert("Navnet findes allerede.");
    return;
  }

  teams.push({
    id: "t" + Date.now() + Math.random(),
    name,
    points: 0
  });

  teamNameInput.value = "";
  renderTeams();
  saveLocal();
  syncToServer();
};

// ---------------------------
// Stop Grandprix helper
// ---------------------------
function stopGpNow() {
  socket.emit("gp-stop-audio-now");

  if (currentChallenge?.type === "Nisse Grandprix") {
    currentChallenge = { ...currentChallenge, phase: "ended" };
  } else {
    currentChallenge = null;
  }
}

// ---------------------------
// Decision buttons
// ---------------------------
yesBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  if (!selectedTeamId) return alert("Vælg vinderholdet.");

  stopGpNow();

  const t = teams.find(x => x.id === selectedTeamId);
  if (t) t.points = (t.points ?? 0) + 1;

  selectedTeamId = null;

  renderTeams();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
};

noBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  stopGpNow();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
};

incompleteBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  stopGpNow();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
};

// ---------------------------
// Reset game
// ---------------------------
resetBtn.onclick = () => {
  if (!confirm("Nulstil hele spillet?")) return;

  stopGpNow();

  teams = [];
  selectedTeamId = null;
  currentChallenge = null;
  deck.forEach(c => (c.used = false));
  endGameResultEl.textContent = "";

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  saveLocal();
  syncToServer();
};

// ---------------------------
// End game
// ---------------------------
endGameBtn.onclick = () => {
  if (!teams.length) return alert("Ingen hold endnu.");

  stopGpNow();

  const sorted = [...teams].sort((a,b) => (b.points ?? 0) - (a.points ?? 0));
  const top = sorted[0];

  endGameResultEl.textContent =
    `Vinderen er: ${top.name} med ${top.points ?? 0} point! 🎉`;

  renderCurrentChallenge();
  saveLocal();
  syncToServer();
};

// ---------------------------
// Start game → generate code
// ---------------------------
startGameBtn.onclick = () => {
  gameCode = String(Math.floor(1000 + Math.random() * 9000));
  gameCodeValueEl.textContent = gameCode;

  saveLocal();
  syncToServer();
};

// ---------------------------
// Auto-select buzzing team
// ---------------------------
socket.on("buzzed", (teamName) => {
  const t = teams.find(x => x.name === teamName);
  if (t) {
    selectedTeamId = t.id;
    renderTeams();
  }
});

// ---------------------------
// Receive typed answers
// ---------------------------
socket.on("newCard", ({ team, text }) => {
  alert(`Svar fra ${team}:\n\n${text}`);
});

socket.on("gp-typed-answer", ({ teamName, text }) => {
  alert(`Svar fra ${teamName}:\n\n${text}`);
});

// ---------------------------
// Receive state from server
// ---------------------------
socket.on("state", (s) => {
  if (!s) return;

  if (Array.isArray(s.teams)) teams = s.teams;

  if (Array.isArray(s.deck)) {
    // keep local deck if server sends empty
    if (!(s.deck.length === 0 && deck.length > 0)) {
      deck = s.deck;
    }
  }

  currentChallenge = s.currentChallenge || null;
  gameCode = s.gameCode || gameCode;

  if (gameCodeValueEl && gameCode) {
    gameCodeValueEl.textContent = gameCode;
  }

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  saveLocal();
});

// ---------------------------
// INIT
// ---------------------------
loadLocal();
renderTeams();
renderDeck();
renderCurrentChallenge();
loadDeckSafely();

if (gameCodeValueEl && gameCode) {
  gameCodeValueEl.textContent = gameCode;
}
