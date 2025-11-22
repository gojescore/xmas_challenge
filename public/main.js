// public/main.js v26
// Stable admin controller for Xmas Challenge.
// Works with:
// - server.js (joinGame, submitCard, vote, gp-typed-answer, gp-stop-audio-now)
// - team.js v28 router
// - minigames: grandprix.js, nissegaaden.js, julekortet.js
// - decks: data/deck/*.js

const socket = io();

// ---------------- DOM ----------------
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
const miniGameArea = document.getElementById("miniGameArea");

// ---------------- STATE ----------------
let teams = [];
let selectedTeamId = null;

let deck = [];
let currentChallenge = null;
let gameCode = null;

const STORAGE_KEY = "xmasChallenge_admin_v26";

// ---------------- Persistence ----------------
function saveLocal() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ teams, deck, currentChallenge, gameCode })
    );
  } catch {}
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

// ---------------- Sync ----------------
function syncToServer() {
  socket.emit("updateState", {
    teams,
    deck,
    currentChallenge,
    gameCode
  });
}

// ---------------- Deck load ----------------
async function loadDeckSafely() {
  let gp = [];
  let ng = [];
  let jk = [];

  try {
    const m = await import("./data/deck/grandprix.js?v=" + Date.now());
    gp = m.grandprixDeck || m.deck || [];
  } catch {}

  try {
    const m = await import("./data/deck/nissegaaden.js?v=" + Date.now());
    ng = m.nisseGaaden || m.nisseGaadenDeck || m.deck || [];
  } catch {}

  try {
    const m = await import("./data/deck/julekortet.js?v=" + Date.now());
    jk = m.juleKortetDeck || m.deck || [];
  } catch {}

  deck = [...gp, ...ng, ...jk].map(c => ({ ...c, used: !!c.used }));

  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
}

// ---------------- Render deck ----------------
function renderDeck() {
  if (!challengeGridEl) return;
  challengeGridEl.innerHTML = "";

  if (!deck.length) {
    const p = document.createElement("p");
    p.textContent = "⚠️ Ingen udfordringer fundet (deck tom).";
    p.style.fontWeight = "900";
    p.style.color = "crimson";
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
      if (card.used) return alert("Denne udfordring er allerede brugt.");
      card.used = true;

      if (card.type === "Nisse Grandprix") {
        currentChallenge = {
          ...card,
          phase: "listening",
          startAt: Date.now() + 3000, // 3s sync buffer
          firstBuzz: null,
          countdownSeconds: 20,
          countdownStartAt: null,
          typedAnswer: null
        };
      } 
      else if (card.type === "JuleKortet") {
        currentChallenge = {
          ...card,
          phase: "writing",
          writingSeconds: 120,
          writingStartAt: Date.now(),
          cards: [],
          votes: {}
        };
        startAdminWritingTimer();
      } 
      else if (card.type === "NisseGåden") {
        currentChallenge = {
          ...card,
          answers: [] // admin-only list
        };
      } 
      else {
        currentChallenge = { ...card };
      }

      selectedTeamId = null;
      endGameResultEl.textContent = "";

      renderDeck();
      renderCurrentChallenge();
      renderMiniGameArea();
      saveLocal();
      syncToServer();
    };

    challengeGridEl.appendChild(btn);
  });
}

// ---------------- Leaderboard ----------------
function renderTeams() {
  const sorted = [...teams].sort((a,b) => {
    if ((b.points ?? 0) !== (a.points ?? 0))
      return (b.points ?? 0) - (a.points ?? 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  teamListEl.innerHTML = "";

  sorted.forEach(team => {
    const li = document.createElement("li");
    li.className =
      "team-item" + (team.id === selectedTeamId ? " selected" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "team-name";
    nameSpan.textContent = team.name;

    const pointsDiv = document.createElement("div");
    pointsDiv.className = "team-points";

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.onclick = (e) => {
      e.stopPropagation();
      team.points = Math.max(0, (team.points ?? 0) - 1);
      saveLocal(); renderTeams(); syncToServer();
    };

    const val = document.createElement("span");
    val.textContent = team.points ?? 0;

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.onclick = (e) => {
      e.stopPropagation();
      team.points = (team.points ?? 0) + 1;
      saveLocal(); renderTeams(); syncToServer();
    };

    pointsDiv.append(minus, val, plus);
    li.append(nameSpan, pointsDiv);

    li.onclick = () => {
      selectedTeamId = team.id;
      renderTeams();
    };

    teamListEl.appendChild(li);
  });
}

// ---------------- Current challenge text ----------------
function renderCurrentChallenge() {
  currentChallengeText.textContent = currentChallenge
    ? `Aktuel udfordring: ${currentChallenge.title || currentChallenge.type}`
    : "Ingen udfordring valgt endnu.";
}

// ---------------- Admin minigame area ----------------
let jkAdminTimer = null;

function renderMiniGameArea() {
  if (!miniGameArea) return;
  miniGameArea.innerHTML = "";

  if (!currentChallenge) return;

  // ---------- GRANDPRIX ADMIN VIEW ----------
  if (currentChallenge.type === "Nisse Grandprix") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    wrap.innerHTML = `
      <h3>Nisse Grandprix</h3>
      <p><strong>Fase:</strong> ${currentChallenge.phase}</p>
      <p><strong>Buzzed først:</strong> ${currentChallenge.firstBuzz?.teamName || "—"}</p>
      <p><strong>Typed svar:</strong> ${currentChallenge.typedAnswer || "—"}</p>
      <p><strong>Nedtælling:</strong> <span id="gpAdminCountdown">—</span></p>
    `;

    miniGameArea.appendChild(wrap);

    startAdminGpCountdownIfLocked();
    return;
  }

  // ---------- NISSEGÅDEN ADMIN VIEW ----------
  if (currentChallenge.type === "NisseGåden") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    const answers = currentChallenge.answers || [];

    wrap.innerHTML = `<h3>NisseGåden – svar</h3>`;

    if (!answers.length) {
      const p = document.createElement("p");
      p.textContent = "Ingen svar endnu…";
      wrap.appendChild(p);
    } else {
      answers.forEach((a, i) => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:8px; border:1px solid #ddd; border-radius:8px; margin-bottom:6px; background:#fff;";
        box.innerHTML = `
          <div><strong>${a.team}</strong>:</div>
          <div>${a.text}</div>
        `;
        wrap.appendChild(box);
      });
    }

    miniGameArea.appendChild(wrap);
    return;
  }

  // ---------- JULEKORTET ADMIN VIEW ----------
  if (currentChallenge.type === "JuleKortet") {
    const ch = currentChallenge;

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    const h = document.createElement("h3");
    h.textContent = `JuleKortet – fase: ${ch.phase}`;
    wrap.appendChild(h);

    if (ch.phase === "writing") {
      const p = document.createElement("p");
      p.id = "jkAdminCountdown";
      p.style.fontWeight = "900";
      wrap.appendChild(p);

      const forceBtn = document.createElement("button");
      forceBtn.textContent = "Stop skrivning → start afstemning";
      forceBtn.className = "challenge-card";
      forceBtn.onclick = () => startVotingPhase();
      wrap.appendChild(forceBtn);
    }

    if (ch.phase === "voting") {
      const cards = ch.cards || [];
      const votes = tallyVotes(ch.votes || {}, cards.length);

      cards.forEach((c, i) => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px; margin-bottom:6px;";
        box.innerHTML = `
          <div style="font-weight:800;">Kort #${i + 1}</div>
          <div style="white-space:pre-wrap; margin:6px 0;">${c.text}</div>
          <div style="font-weight:900;">Stemmer: ${votes[i] || 0}</div>
        `;
        wrap.appendChild(box);
      });

      const finishBtn = document.createElement("button");
      finishBtn.textContent = "Afslut afstemning og find vinder";
      finishBtn.className = "challenge-card";
      finishBtn.onclick = () => finishVotingAndAward();
      wrap.appendChild(finishBtn);
    }

    miniGameArea.appendChild(wrap);
  }
}

// ---------------- Julekortet helpers ----------------
function startAdminWritingTimer() {
  clearInterval(jkAdminTimer);
  jkAdminTimer = setInterval(() => {
    if (!currentChallenge || currentChallenge.type !== "JuleKortet") {
      clearInterval(jkAdminTimer);
      return;
    }
    const left = getWritingLeftSeconds(currentChallenge);
    const elc = document.getElementById("jkAdminCountdown");
    if (elc) elc.textContent = `Tid tilbage til skrivning: ${left}s`;
    if (left <= 0) {
      clearInterval(jkAdminTimer);
      startVotingPhase();
    }
  }, 300);
}

function getWritingLeftSeconds(ch) {
  const elapsed = Math.floor((Date.now() - ch.writingStartAt) / 1000);
  return Math.max(0, (ch.writingSeconds || 120) - elapsed);
}

function startVotingPhase() {
  if (!currentChallenge || currentChallenge.type !== "JuleKortet") return;
  currentChallenge.phase = "voting";
  renderMiniGameArea();
  saveLocal();
  syncToServer();
}

function tallyVotes(votesObj, cardsLen) {
  const counts = Array(cardsLen).fill(0);
  Object.values(votesObj).forEach(idx => {
    if (typeof idx === "number" && idx >= 0 && idx < cardsLen) counts[idx]++;
  });
  return counts;
}

function finishVotingAndAward() {
  const ch = currentChallenge;
  const cards = ch.cards || [];
  if (!cards.length) return alert("Ingen kort modtaget.");

  const counts = tallyVotes(ch.votes || {}, cards.length);
  const max = Math.max(...counts);
  const winners = counts
    .map((c, i) => ({ i, c }))
    .filter(x => x.c === max)
    .map(x => x.i);

  if (winners.length !== 1) {
    alert("Der er uafgjort. Vælg vinder manuelt og tryk Ja.");
    return;
  }

  const winningIndex = winners[0];

  socket.emit(
    "jk-request-winner-team",
    { challengeId: ch.id, cardIndex: winningIndex },
    (res) => {
      if (!res?.ok) {
        alert("Kunne ikke finde vinderhold. Vælg manuelt.");
        return;
      }

      const winnerTeam = teams.find(t => t.name === res.teamName);
      if (winnerTeam) {
        winnerTeam.points = (winnerTeam.points ?? 0) + 1;
        alert(`Vinder: ${winnerTeam.name}! (+1 point)`);
      }

      ch.phase = "ended";
      renderTeams();
      renderMiniGameArea();
      renderCurrentChallenge();
      saveLocal();
      syncToServer();
    }
  );
}

// ---------------- Grandprix countdown on admin ----------------
let gpAdminTimer = null;

function startAdminGpCountdownIfLocked() {
  clearInterval(gpAdminTimer);

  if (!currentChallenge || currentChallenge.type !== "Nisse Grandprix") return;
  if (currentChallenge.phase !== "locked") return;
  if (!currentChallenge.countdownStartAt) return;

  gpAdminTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - currentChallenge.countdownStartAt) / 1000);
    const left = Math.max(0, (currentChallenge.countdownSeconds || 20) - elapsed);
    const elc = document.getElementById("gpAdminCountdown");
    if (elc) elc.textContent = left;

    if (left <= 0) clearInterval(gpAdminTimer);
  }, 200);
}

// ---------------- Stop GP audio everywhere ----------------
function stopGpAudioEverywhere() {
  socket.emit("gp-stop-audio-now");
}

// ---------------- Decision buttons ----------------
yesBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  if (!selectedTeamId) return alert("Vælg vinderholdet.");

  stopGpAudioEverywhere();

  const t = teams.find(x => x.id === selectedTeamId);
  if (t) t.points = (t.points ?? 0) + 1;

  selectedTeamId = null;

  renderTeams();
  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
};

noBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  stopGpAudioEverywhere();

  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
};

incompleteBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  stopGpAudioEverywhere();

  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
};

// ---------------- Reset ----------------
resetBtn.onclick = () => {
  if (!confirm("Nulstil hele spillet?")) return;

  stopGpAudioEverywhere();

  teams = [];
  selectedTeamId = null;
  currentChallenge = null;
  deck.forEach(c => c.used = false);
  endGameResultEl.textContent = "";

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();

  saveLocal();
  syncToServer();
};

// ---------------- End game ----------------
endGameBtn.onclick = () => {
  if (!teams.length) return alert("Ingen hold endnu.");

  stopGpAudioEverywhere();

  const sorted = [...teams].sort((a,b)=>(b.points??0)-(a.points??0));
  const top = sorted[0];

  endGameResultEl.textContent =
    `Vinderen er: ${top.name} med ${top.points ?? 0} point! 🎉`;

  saveLocal();
  syncToServer();
};

// ---------------- Start game ----------------
startGameBtn.onclick = () => {
  gameCode = String(Math.floor(1000 + Math.random() * 9000));
  gameCodeValueEl.textContent = gameCode;
  saveLocal();
  syncToServer();
};

// ---------------- Add team manually (optional) ----------------
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

// ---------------- SOCKET LISTENERS ----------------

// When team buzzes first
socket.on("buzzed", (teamName, payload) => {
  if (!currentChallenge || currentChallenge.type !== "Nisse Grandprix") return;
  if (currentChallenge.phase !== "listening") return;
  if (currentChallenge.firstBuzz) return;

  currentChallenge.phase = "locked";
  currentChallenge.firstBuzz = { teamName, audioPosition: payload?.audioPosition ?? null };
  currentChallenge.countdownStartAt = Date.now();

  // highlight winner candidate
  const t = teams.find(x => x.name === teamName);
  if (t) selectedTeamId = t.id;

  renderTeams();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// Receive NisseGåden answers (team -> admin)
socket.on("newCard", ({ team, text }) => {
  if (!currentChallenge) return;
  if (currentChallenge.type !== "NisseGåden") return;

  currentChallenge.answers = currentChallenge.answers || [];
  currentChallenge.answers.push({ team, text });

  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// Receive typed Grandprix answer (buzzed team -> admin)
socket.on("gp-typed-answer", ({ text }) => {
  if (!currentChallenge) return;
  if (currentChallenge.type !== "Nisse Grandprix") return;

  currentChallenge.typedAnswer = text;

  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// Receive full state from server (server is truth)
socket.on("state", (s) => {
  if (!s) return;

  if (Array.isArray(s.teams)) teams = s.teams;

  if (Array.isArray(s.deck)) {
    if (!(s.deck.length === 0 && deck.length > 0)) deck = s.deck;
  }

  currentChallenge = s.currentChallenge || currentChallenge;
  gameCode = s.gameCode || gameCode;

  if (gameCodeValueEl && gameCode) gameCodeValueEl.textContent = gameCode;

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();

  saveLocal();
});

// ---------------- INIT ----------------
loadLocal();
renderTeams();
renderDeck();
renderCurrentChallenge();
renderMiniGameArea();

loadDeckSafely();

if (gameCodeValueEl && gameCode) gameCodeValueEl.textContent = gameCode;
