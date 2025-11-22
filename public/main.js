// ======================================================================
//  Xmas Challenge – MAIN CONTROLLER (Admin PC)
// ======================================================================
//  Version: v32 (Grandprix NO fix + stable deck + stable mini-games)
// ======================================================================

import { renderGrandprixAdmin, stopGrandprixEverywhere } from "./minigames/grandprix.js";
import { renderNissegaadenAdmin } from "./minigames/nissegaaden.js";
import { renderJulekortAdmin } from "./minigames/julekortet.js";

// Connect
const socket = io();

// --------------------------------------------------
// Helpers
// --------------------------------------------------
function el(id) {
  const x = document.getElementById(id);
  if (!x) console.warn("Missing:", id);
  return x;
}

// --------------------------------------------------
// DOM
// --------------------------------------------------
const startGameBtn = el("startGameBtn");
const gameCodeValueEl = el("gameCodeValue");

const challengeGrid = el("challengeGrid");
const currentChallengeText = el("currentChallengeText");

const yesBtn = el("yesBtn");
const noBtn = el("noBtn");
const incompleteBtn = el("incompleteBtn");

const teamListEl = el("teamList");
const endGameBtn = el("endGameBtn");
const endGameResultEl = el("endGameResult");
const resetBtn = el("resetBtn");

const miniGameArea = el("miniGameArea");

// --------------------------------------------------
// STATE
// --------------------------------------------------
let gameCode = null;
let teams = [];
let currentChallenge = null;
let deck = []; // challenge deck

// --------------------------------------------------
// Load challenge deck (Grandprix, NisseGåden, Julekortet etc.)
// --------------------------------------------------
async function loadDeck() {
  const modules = await Promise.all([
    import("./data/deck/grandprix.js?v=32"),   // gp01…gpXX
    import("./data/deck/nissegaaden.js?v=32"), // ng01…ngXX
    import("./data/deck/julekortet.js?v=32"),  // jk01…jkXX
  ]);

  deck = [
    ...modules[0].DECK,
    ...modules[1].DECK,
    ...modules[2].DECK,
  ];

  if (!deck.length) console.warn("⚠️ No challenges in deck!");
}

// --------------------------------------------------
// Save + Load local admin state
// --------------------------------------------------
function saveLocal() {
  const data = {
    gameCode,
    teams,
    currentChallenge
  };
  localStorage.setItem("xmasAdminState", JSON.stringify(data));
}

function loadLocal() {
  const raw = localStorage.getItem("xmasAdminState");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    gameCode = data.gameCode ?? null;
    teams = Array.isArray(data.teams) ? data.teams : [];
    currentChallenge = data.currentChallenge ?? null;
  } catch {}
}

// --------------------------------------------------
// Sync state to server
// --------------------------------------------------
function sync() {
  socket.emit("updateState", {
    gameCode,
    teams,
    currentChallenge,
  });
}

// --------------------------------------------------
// Rendering
// --------------------------------------------------
function renderChallengeArea() {
  if (!currentChallenge) {
    currentChallengeText.textContent = "Ingen udfordring valgt.";
    miniGameArea.innerHTML = "";
    return;
  }

  currentChallengeText.textContent =
    `${currentChallenge.type} – ${currentChallenge.id}`;

  miniGameArea.innerHTML = "";

  if (currentChallenge.type === "Nisse Grandprix") {
    renderGrandprixAdmin(miniGameArea, currentChallenge, socket);
    return;
  }

  if (currentChallenge.type === "NisseGåden") {
    renderNissegaadenAdmin(miniGameArea, currentChallenge, socket);
    return;
  }

  if (currentChallenge.type === "JuleKortet") {
    renderJulekortAdmin(miniGameArea, currentChallenge, socket);
    return;
  }
}

function renderTeams() {
  const sorted = [...teams].sort((a, b) => b.points - a.points);
  teamListEl.innerHTML = "";

  sorted.forEach((t) => {
    const li = document.createElement("li");
    li.className = "team-item";
    li.innerHTML = `
      <span class="team-name">${t.name}</span>
      <span class="team-points">${t.points}</span>
    `;
    li.onclick = () => {
      sorted.forEach(x => x.selected = false);
      t.selected = true;
      renderTeams();
    };
    if (t.selected) li.classList.add("selected");
    teamListEl.appendChild(li);
  });
}

// --------------------------------------------------
// Select next challenge (uses deck)
// --------------------------------------------------
function pickNextChallenge() {
  if (!deck.length) {
    alert("Ingen udfordringer tilbage!");
    return;
  }

  const challenge = deck.shift();
  currentChallenge = JSON.parse(JSON.stringify(challenge));

  // Reset states per challenge
  if (currentChallenge.type === "Nisse Grandprix") {
    currentChallenge.phase = "listening";
    currentChallenge.firstBuzz = null;
    currentChallenge.answeredTeams = {};
  }

  if (currentChallenge.type === "NisseGåden") {
    currentChallenge.answers = [];
  }

  if (currentChallenge.type === "JuleKortet") {
    currentChallenge.cards = {};
    currentChallenge.phase = "writing";
    currentChallenge.writingEndsAt = Date.now() + 120000; // 2 min
  }

  renderChallengeArea();
  saveLocal();
  sync();
}

// --------------------------------------------------
// Buttons
// --------------------------------------------------
startGameBtn.onclick = () => {
  gameCode = Math.floor(1000 + Math.random() * 9000).toString();
  gameCodeValueEl.textContent = gameCode;
  teams = [];
  currentChallenge = null;
  endGameResultEl.textContent = "";
  saveLocal();
  sync();
};

endGameBtn.onclick = () => {
  if (!teams.length) return;

  const sorted = [...teams].sort((a, b) => b.points - a.points);
  const top = sorted[0].points;
  const winners = sorted.filter(t => t.points === top);

  if (winners.length === 1) {
    endGameResultEl.textContent =
      `Vinderen er: ${winners[0].name} med ${top} point! 🎉`;
  } else {
    endGameResultEl.textContent =
      `Uafgjort: ${winners.map(x => x.name).join(", ")} – ${top} point.`;
  }
};

resetBtn.onclick = () => {
  if (!confirm("Nulstil alt?")) return;
  teams = [];
  currentChallenge = null;
  gameCode = null;
  gameCodeValueEl.textContent = "---";
  miniGameArea.innerHTML = "";
  saveLocal();
  sync();
};

// --------------------------------------------------
// YES = award 1 point to selected team
// --------------------------------------------------
yesBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg udfordring først.");

  const selected = teams.find(t => t.selected);
  if (!selected) return alert("Vælg et hold til højre.");

  selected.points++;
  currentChallenge = null;
  miniGameArea.innerHTML = "";
  saveLocal();
  sync();
  renderTeams();
  renderChallengeArea();
};

// --------------------------------------------------
// NO = special Grandprix rule
// --------------------------------------------------
noBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg udfordring først.");

  if (currentChallenge.type === "Nisse Grandprix" &&
      currentChallenge.phase === "locked" &&
      currentChallenge.firstBuzz) {

    const buzzingTeam = currentChallenge.firstBuzz.teamName;

    currentChallenge.answeredTeams =
      currentChallenge.answeredTeams || {};
    currentChallenge.answeredTeams[buzzingTeam] = true;

    // Resume listening
    currentChallenge.phase = "listening";
    currentChallenge.firstBuzz = null;
    currentChallenge.countdownStartAt = null;
    currentChallenge.typedAnswer = null;

    teams.forEach(t => (t.selected = false));

    renderTeams();
    renderChallengeArea();
    saveLocal();
    sync();
    return;
  }

  // For all other challenges: simply end
  currentChallenge = null;
  miniGameArea.innerHTML = "";
  saveLocal();
  sync();
  renderChallengeArea();
};

// --------------------------------------------------
// Incomplete (Ikke fuldført)
// --------------------------------------------------
incompleteBtn.onclick = () => {
  if (!currentChallenge) return;

  currentChallenge = null;
  miniGameArea.innerHTML = "";
  saveLocal();
  sync();
  renderChallengeArea();
};

// --------------------------------------------------
// Receive state from server
// --------------------------------------------------
socket.on("state", ({ gameCode: cg, teams: ts, currentChallenge: cc }) => {
  if (cg !== undefined) {
    gameCode = cg;
    gameCodeValueEl.textContent = gameCode ?? "---";
  }
  teams = Array.isArray(ts) ? ts : [];
  currentChallenge = cc || null;

  renderTeams();
  renderChallengeArea();
});

// --------------------------------------------------
// Team joining
// --------------------------------------------------
socket.on("teamJoined", (team) => {
  if (!teams.some(t => t.name === team.name)) {
    teams.push({ ...team, points: 0 });
    saveLocal();
    sync();
    renderTeams();
  }
});

// --------------------------------------------------
// Team answers for NisseGåden
// --------------------------------------------------
socket.on("nissegaaden-answer", ({ teamName, answer }) => {
  if (!currentChallenge ||
      currentChallenge.type !== "NisseGåden") return;

  currentChallenge.answers.push({ teamName, answer });
  renderChallengeArea();
  saveLocal();
  sync();
});

// --------------------------------------------------
// Julekortet submissions
// --------------------------------------------------
socket.on("julekort-submitted", ({ teamName, text }) => {
  if (!currentChallenge ||
      currentChallenge.type !== "JuleKortet") return;

  currentChallenge.cards[teamName] = text;
  renderChallengeArea();
  saveLocal();
  sync();
});

// --------------------------------------------------
// Vote updates
// --------------------------------------------------
socket.on("julekort-vote", ({ teamName, votedFor }) => {
  if (!currentChallenge ||
      currentChallenge.type !== "JuleKortet") return;

  const cards = currentChallenge.cards;
  if (!cards) return;

  if (!currentChallenge.votes)
    currentChallenge.votes = {};

  if (teamName === votedFor) return;

  currentChallenge.votes[teamName] = votedFor;
  renderChallengeArea();
  saveLocal();
  sync();
});

// --------------------------------------------------
// Init
// --------------------------------------------------
await loadDeck();
loadLocal();
renderTeams();
renderChallengeArea();
sync();

