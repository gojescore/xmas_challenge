// ===============================
//  Xmas Challenge – MAIN ADMIN JS
// ===============================

const socket = io();

// -------------------------------
// Persistent admin-side state
// -------------------------------
let state = null;

// Local deck (full list of all challenges)
let deck = [];

// -------------------------------
// FALLBACK deck
// -------------------------------
const FALLBACK_DECK = [
  {
    id: "gp1",
    type: "Nisse Grandprix",
    title: "Grandprix 1",
    audioUrl: "",
    used: false
  },
  {
    id: "ng1",
    type: "NisseGåden",
    title: "NisseGåden 1",
    text: "Fallback gåde...",
    used: false
  }
];

// -------------------------------
// DOM GETTER
// -------------------------------
function el(id) {
  const node = document.getElementById(id);
  if (!node) console.warn(`Missing #${id}`);
  return node;
}

// -------------------------------
// DOM references
// -------------------------------
const startBtn = el("startGameBtn");
const resetBtn = el("resetBtn");
const gameCodeValueEl = el("gameCodeValue");

const teamNameInput = el("teamNameInput");
const addTeamBtn = el("addTeamBtn");

const teamListEl = el("teamList");
const currentChallengeText = el("currentChallengeText");

const yesBtn = el("yesBtn");
const noBtn = el("noBtn");
const incompleteBtn = el("incompleteBtn");
const endGameBtn = el("endGameBtn");
const endGameResult = el("endGameResult");

const challengeGrid = document.querySelector(".challenge-grid");

// -------------------------------
// Save & sync
// -------------------------------
function saveLocal() {
  localStorage.setItem("adminState", JSON.stringify({ deck }));
}

function syncToServer() {
  socket.emit("updateState", {
    ...state,
    deck
  });
}

// -------------------------------
// LOAD DECK FROM FILES
// -------------------------------
async function loadDeckSafely() {
  let grandprixDeck = [];
  let nisseGaaden = [];

  try {
    const gp = await import("./data/deck/grandprix.js?v=" + Date.now());
    grandprixDeck =
      gp.grandprixDeck || gp.deck || gp.default || [];
  } catch (err) {
    console.warn("⚠️ Could not load grandprix deck:", err);
  }

  try {
    const ng = await import("./data/deck/nissegaaden.js?v=" + Date.now());
    nisseGaaden =
      ng.nisseGaaden || ng.deck || ng.default || [];
  } catch (err) {
    console.warn("⚠️ Could not load nissegaaden deck:", err);
  }

  deck = [...grandprixDeck, ...nisseGaaden]
    .filter(Boolean)
    .map(c => ({ ...c, used: !!c.used }));

  if (deck.length === 0) {
    console.error("❌ Deck empty -> using fallback");
    deck = FALLBACK_DECK.map(c => ({ ...c }));
  }

  renderDeck();

  // IMPORTANT: push to server so it is never empty again
  saveLocal();
  syncToServer();
}

// -------------------------------
// RENDER DECK INTO CHALLENGE GRID
// -------------------------------
function renderDeck() {
  if (!challengeGrid) return;

  challengeGrid.innerHTML = "";

  if (!deck || deck.length === 0) {
    const w = document.createElement("p");
    w.style.color = "red";
    w.style.fontWeight = "bold";
    w.textContent = "⚠️ Ingen udfordringer fundet (deck tom)";
    challengeGrid.appendChild(w);
    return;
  }

  deck.forEach(ch => {
    const btn = document.createElement("button");
    btn.className = "challenge-card";

    if (ch.used) btn.classList.add("used");

    btn.textContent = ch.title || ch.type;

    btn.addEventListener("click", () => {
      ch.used = true;
      startChallenge(ch);
      saveLocal();
      syncToServer();
      renderDeck();
    });

    challengeGrid.appendChild(btn);
  });
}

// -------------------------------
// START A CHALLENGE
// -------------------------------
function startChallenge(challenge) {
  state.currentChallenge = {
    ...challenge,
    phase: "listening",
    startAt: Date.now()
  };

  socket.emit("updateState", state);
}

// -------------------------------
// TEAM MANAGEMENT
// -------------------------------
addTeamBtn.addEventListener("click", () => {
  const name = teamNameInput.value.trim();
  if (!name) return;

  state.teams.push({ name, points: 0 });
  teamNameInput.value = "";

  syncToServer();
});

// -------------------------------
// DECISION BUTTONS
// -------------------------------
function endGrandprixEarly() {
  socket.emit("gp-stop-audio-now");
}

yesBtn.addEventListener("click", () => {
  endGrandprixEarly();
  state.currentChallenge = null;
  syncToServer();
});

noBtn.addEventListener("click", () => {
  endGrandprixEarly();
  state.currentChallenge = null;
  syncToServer();
});

incompleteBtn.addEventListener("click", () => {
  endGrandprixEarly();
  state.currentChallenge = null;
  syncToServer();
});

// -------------------------------
// RESET GAME
// -------------------------------
resetBtn.addEventListener("click", () => {
  state.currentChallenge = null;
  state.teams = [];
  deck.forEach(c => (c.used = false));

  syncToServer();
  renderDeck();
});

// -------------------------------
// END GAME
// -------------------------------
endGameBtn.addEventListener("click", () => {
  if (!state || !state.teams.length) return;

  const sorted = [...state.teams].sort((a, b) => b.points - a.points);
  const winner = sorted[0];

  endGameResult.textContent = `Vinderen er: ${winner.name}! 🎉`;

  endGrandprixEarly();
  state.currentChallenge = null;
  syncToServer();
});

// -------------------------------
// START GAME (generate code)
// -------------------------------
startBtn.addEventListener("click", () => {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  state.gameCode = code;
  gameCodeValueEl.textContent = code;

  syncToServer();
});

// -------------------------------
// RECEIVE STATE FROM SERVER
// -------------------------------
socket.on("state", (s) => {
  if (!s) return;

  state = s;

  if (state.gameCode) {
    gameCodeValueEl.textContent = state.gameCode;
  }

  // IMPORTANT: don't let server overwrite with empty deck
  if (Array.isArray(s.deck)) {
    if (s.deck.length === 0 && deck.length > 0) {
      console.warn("Ignored empty deck from server");
    } else {
      deck = s.deck;
    }
  }

  renderDeck();
});

// -------------------------------
// INIT
// -------------------------------
state = {
  teams: [],
  currentChallenge: null,
  gameCode: null,
  deck: []
};

loadDeckSafely();
