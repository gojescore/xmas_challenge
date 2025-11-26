// public/main.js v34+facit+tasktext
// Aligned with team.js v31+ and grandprix/julekortet/nissegaaden working versions.
// Adds KreaNissen deck + admin flow WITHOUT touching existing minigame logic.
// Also shows NisseGåden "facit" AND task description (text) for all challenges.

// =====================================================
// SOCKET
// =====================================================
const socket = io();

// =====================================================
// DOM
// =====================================================
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

// =====================================================
// STATE
// =====================================================
let teams = [];
let selectedTeamId = null;

let deck = [];
let currentChallenge = null;
let gameCode = null;

const STORAGE_KEY = "xmasChallenge_admin_v34";

// =====================================================
// Persistence
// =====================================================
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

// =====================================================
// Sync
// =====================================================
function syncToServer() {
  socket.emit("updateState", {
    teams,
    deck,
    currentChallenge,
    gameCode
  });
}

// =====================================================
// Utilities
// =====================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =====================================================
// Deck load
// =====================================================
async function loadDeckSafely() {
  let gp = [];
  let ng = [];
  let jk = [];
  let kn = [];

  try {
    const m = await import("./data/deck/grandprix.js?v=" + Date.now());
    gp = m.DECK || m.grandprixDeck || m.deck || [];
  } catch {}

  try {
    const m = await import("./data/deck/nissegaaden.js?v=" + Date.now());
    ng = m.DECK || m.nisseGaaden || m.nisseGaadenDeck || m.deck || [];
  } catch {}

  try {
    const m = await import("./data/deck/julekortet.js?v=" + Date.now());
    jk = m.DECK || m.juleKortetDeck || m.deck || [];
  } catch {}

  // ✅ KreaNissen deck (public/data/deck/kreanissen.js exporting DECK)
  try {
    const m = await import("./data/deck/kreanissen.js?v=" + Date.now());
    kn = m.DECK || m.kreaNissenDeck || m.deck || [];
  } catch {}

  deck = [...gp, ...ng, ...jk, ...kn].map(c => ({ ...c, used: !!c.used }));

  renderDeck();
  renderTeams();
  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
}

// =====================================================
// Render deck
// =====================================================
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
          startAt: Date.now() + 3000,
          firstBuzz: null,
          countdownSeconds: 20,
          countdownStartAt: null,
          typedAnswer: null,
          answeredTeams: {}
        };
      }
      else if (card.type === "JuleKortet") {
        currentChallenge = {
          ...card,
          phase: "writing",
          writingSeconds: 120,
          writingStartAt: Date.now(),
          cards: [],        // [{ teamName, text }]
          votingCards: [],
          votes: {},        // { voterTeamName: index }
          winners: []
        };
        startAdminWritingTimer();
      }
      else if (card.type === "KreaNissen") {
        currentChallenge = {
          ...card,
          phase: "creating",
          creatingSeconds: 180,
          creatingStartAt: Date.now(),
          photos: [],        // [{ teamName, filename }]
          votingPhotos: [],  // [{ filename, ownerTeamName }]
          votes: {},         // { voterTeamName: index }
          winners: []
        };
        startAdminCreatingTimer();
      }
      else if (card.type === "NisseGåden") {
        // answer (if present on card) is kept as is
        currentChallenge = { ...card, answers: [] };
      }
      else {
        currentChallenge = { ...card };
      }

      selectedTeamId = null;
      endGameResultEl.textContent = "";

      renderDeck();
      renderTeams();
      renderCurrentChallenge();
      renderMiniGameArea();
      saveLocal();
      syncToServer();
    };

    challengeGridEl.appendChild(btn);
  });
}

// =====================================================
// Leaderboard
// =====================================================
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

// =====================================================
// Current challenge text
// =====================================================
function renderCurrentChallenge() {
  currentChallengeText.textContent = currentChallenge
    ? `Aktuel udfordring: ${currentChallenge.title || currentChallenge.type}`
    : "Ingen udfordring valgt endnu.";
}

// =====================================================
// Admin minigame area
// =====================================================
let jkAdminTimer = null;
let gpAdminTimer = null;
let knAdminTimer = null;

function renderMiniGameArea() {
  if (!miniGameArea) return;
  miniGameArea.innerHTML = "";
  if (!currentChallenge) return;

  // ---------- GRANDPRIX ----------
  if (currentChallenge.type === "Nisse Grandprix") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    wrap.innerHTML = `
      <h3>Nisse Grandprix</h3>
      <p><strong>Fase:</strong> ${currentChallenge.phase}</p>
      <p><strong>Buzzed først:</strong> ${currentChallenge.firstBuzz?.teamName || "—"}</p>
      <p><strong>Svar fra:</strong> ${currentChallenge.typedAnswer?.teamName || "—"}</p>
      <p><strong>Tekst:</strong> ${currentChallenge.typedAnswer?.text || "—"}</p>
      <p><strong>Nedtælling:</strong> <span id="gpAdminCountdown">—</span></p>
    `;

    // 👉 Teacher-only task description (if the card has text)
    if (currentChallenge.text) {
      const desc = document.createElement("p");
      desc.style.cssText =
        "margin-top:8px; font-weight:700; color:#333;";
      desc.textContent = `Opgave-tekst: ${currentChallenge.text}`;
      wrap.appendChild(desc);
    }

    miniGameArea.appendChild(wrap);
    startAdminGpCountdownIfLocked();
    return;
  }

  // ---------- NISSEGÅDEN ----------
  if (currentChallenge.type === "NisseGåden") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    wrap.innerHTML = `<h3>NisseGåden – svar</h3>`;
    const answers = currentChallenge.answers || [];

    if (!answers.length) {
      const p = document.createElement("p");
      p.textContent = "Ingen svar endnu…";
      wrap.appendChild(p);
    } else {
      answers.forEach(a => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:8px; border:1px solid #ddd; border-radius:8px; margin-bottom:6px; background:#fff;";
        box.innerHTML = `
          <div><strong>${a.teamName || a.team || "Ukendt hold"}</strong>:</div>
          <div>${a.text}</div>
        `;
        wrap.appendChild(box);
      });
    }

    // 👉 Task description (riddle text), teacher view
    if (currentChallenge.text) {
      const desc = document.createElement("p");
      desc.style.cssText =
        "margin-top:8px; font-weight:700; color:#333;";
      desc.textContent = `Opgave-tekst: ${currentChallenge.text}`;
      wrap.appendChild(desc);
    }

    // ✅ Teacher-only solution text (if deck card has `answer`)
    if (currentChallenge.answer) {
      const sol = document.createElement("p");
      sol.style.cssText =
        "margin-top:4px; font-weight:800; color:#b11111;";
      sol.textContent = `Facit (kun til dig): ${currentChallenge.answer}`;
      wrap.appendChild(sol);
    }

    miniGameArea.appendChild(wrap);
    return;
  }

  // ---------- JULEKORTET ----------
  if (currentChallenge.type === "JuleKortet") {
    const ch = currentChallenge;

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    wrap.innerHTML = `<h3>JuleKortet – fase: ${ch.phase}</h3>`;

    // 👉 Task description from deck (text)
    if (ch.text) {
      const desc = document.createElement("p");
      desc.style.cssText =
        "margin:4px 0 10px; font-weight:700; color:#333;";
      desc.textContent = `Opgave-tekst: ${ch.text}`;
      wrap.appendChild(desc);
    }

    if (ch.phase === "writing") {
      const p = document.createElement("p");
      p.id = "jkAdminCountdown";
      p.style.fontWeight = "900";
      wrap.appendChild(p);

      const sent = ch.cards?.length || 0;
      const total = teams.length;
      const stat = document.createElement("p");
      stat.textContent = `Modtaget: ${sent}/${total} julekort`;
      stat.style.fontWeight = "800";
      wrap.appendChild(stat);

      const forceBtn = document.createElement("button");
      forceBtn.textContent = "Afslut og stem nu";
      forceBtn.className = "challenge-card";
      forceBtn.onclick = startVotingPhase;
      wrap.appendChild(forceBtn);
    }

    if (ch.phase === "voting") {
      const cards = ch.votingCards || [];
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
      finishBtn.textContent = "Luk afstemning og giv point";
      finishBtn.className = "challenge-card";
      finishBtn.onclick = finishVotingAndAward;
      wrap.appendChild(finishBtn);
    }

    if (ch.phase === "ended") {
      const winners = ch.winners || [];
      const p = document.createElement("p");
      p.style.fontWeight = "900";
      p.textContent = winners.length
        ? `Vindere: ${winners.join(", ")}`
        : "Ingen vinder fundet.";
      wrap.appendChild(p);
    }

    miniGameArea.appendChild(wrap);
    return;
  }

  // ---------- KREANISSEN ----------
  if (currentChallenge.type === "KreaNissen") {
    const ch = currentChallenge;

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #0b6; border-radius:10px;";

    wrap.innerHTML = `<h3>KreaNissen – fase: ${ch.phase}</h3>`;

    // 👉 Task description (what to build / create)
    if (ch.text) {
      const desc = document.createElement("p");
      desc.style.cssText =
        "margin:4px 0 10px; font-weight:700; color:#064420;";
      desc.textContent = `Opgave-tekst: ${ch.text}`;
      wrap.appendChild(desc);
    }

    if (ch.phase === "creating") {
      const p = document.createElement("p");
      p.id = "knAdminCountdown";
      p.style.fontWeight = "900";
      wrap.appendChild(p);

      const sent = ch.photos?.length || 0;
      const total = teams.length;
      const stat = document.createElement("p");
      stat.textContent = `Modtaget: ${sent}/${total} billeder`;
      stat.style.fontWeight = "800";
      wrap.appendChild(stat);

      const forceBtn = document.createElement("button");
      forceBtn.textContent = "Afslut og stem nu";
      forceBtn.className = "challenge-card";
      forceBtn.onclick = startKreaVotingPhase;
      wrap.appendChild(forceBtn);
    }

    if (ch.phase === "voting") {
      const photos = ch.votingPhotos || [];
      const votes = tallyVotes(ch.votes || {}, photos.length);

      photos.forEach((p, i) => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px; margin-bottom:6px;";
        box.innerHTML = `
          <div style="font-weight:800;">Billede #${i + 1}</div>
          <img src="/uploads/${p.filename}" style="max-width:100%; border-radius:8px; margin:6px 0;" />
          <div style="font-weight:900;">Stemmer: ${votes[i] || 0}</div>
        `;
        wrap.appendChild(box);
      });

      const finishBtn = document.createElement("button");
      finishBtn.textContent = "Luk afstemning og giv point";
      finishBtn.className = "challenge-card";
      finishBtn.onclick = finishKreaVotingAndAward;
      wrap.appendChild(finishBtn);
    }

    if (ch.phase === "ended") {
      const winners = ch.winners || [];
      const p = document.createElement("p");
      p.style.fontWeight = "900";
      p.textContent = winners.length
        ? `Vindere: ${winners.join(", ")}`
        : "Ingen vinder fundet.";
      wrap.appendChild(p);
    }

    miniGameArea.appendChild(wrap);
    return;
  }
}

// =====================================================
// JuleKortet helpers
// =====================================================
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

    if (currentChallenge.cards.length >= teams.length && teams.length > 0) {
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
  if (currentChallenge.phase !== "writing") return;

  const votingCards = shuffle(
    currentChallenge.cards.map(c => ({
      text: c.text,
      ownerTeamName: c.teamName || c.team
    }))
  );

  currentChallenge.phase = "voting";
  currentChallenge.votingCards = votingCards;
  currentChallenge.votes = {};
  currentChallenge.winners = [];

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
  const cards = ch.votingCards || [];
  if (!cards.length) return alert("Ingen kort til afstemning.");

  const counts = tallyVotes(ch.votes || {}, cards.length);
  const max = Math.max(...counts);

  const winningIndexes = counts
    .map((c, i) => ({ i, c }))
    .filter(x => x.c === max)
    .map(x => x.i);

  const winners = winningIndexes
    .map(i => cards[i].ownerTeamName)
    .filter(Boolean);

  winners.forEach(name => {
    const t = teams.find(x => x.name === name);
    if (t) t.points = (t.points ?? 0) + 1;
  });

  ch.phase = "ended";
  ch.winners = winners;

  renderTeams();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
}

// =====================================================
// KreaNissen helpers
// =====================================================
function startAdminCreatingTimer() {
  clearInterval(knAdminTimer);
  knAdminTimer = setInterval(() => {
    if (!currentChallenge || currentChallenge.type !== "KreaNissen") {
      clearInterval(knAdminTimer);
      return;
    }

    const left = getCreatingLeftSeconds(currentChallenge);
    const elc = document.getElementById("knAdminCountdown");
    if (elc) elc.textContent = `Tid tilbage til krea: ${left}s`;

    if (left <= 0) {
      clearInterval(knAdminTimer);
      startKreaVotingPhase();
    }

    if (currentChallenge.photos.length >= teams.length && teams.length > 0) {
      clearInterval(knAdminTimer);
      startKreaVotingPhase();
    }
  }, 300);
}

function getCreatingLeftSeconds(ch) {
  const elapsed = Math.floor((Date.now() - ch.creatingStartAt) / 1000);
  return Math.max(0, (ch.creatingSeconds || 180) - elapsed);
}

function startKreaVotingPhase() {
  if (!currentChallenge || currentChallenge.type !== "KreaNissen") return;
  if (currentChallenge.phase !== "creating") return;

  const votingPhotos = shuffle(
    currentChallenge.photos.map(p => ({
      filename: p.filename,
      ownerTeamName: p.teamName || p.team
    }))
  );

  currentChallenge.phase = "voting";
  currentChallenge.votingPhotos = votingPhotos;
  currentChallenge.votes = {};
  currentChallenge.winners = [];

  renderMiniGameArea();
  saveLocal();
  syncToServer();
}

function finishKreaVotingAndAward() {
  const ch = currentChallenge;
  const photos = ch.votingPhotos || [];
  if (!photos.length) return alert("Ingen billeder til afstemning.");

  const counts = tallyVotes(ch.votes || {}, photos.length);
  const max = Math.max(...counts);

  const winningIndexes = counts
    .map((c, i) => ({ i, c }))
    .filter(x => x.c === max)
    .map(x => x.i);

  const winners = winningIndexes
    .map(i => photos[i].ownerTeamName)
    .filter(Boolean);

  winners.forEach(name => {
    const t = teams.find(x => x.name === name);
    if (t) t.points = (t.points ?? 0) + 1;
  });

  ch.phase = "ended";
  ch.winners = winners;

  renderTeams();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
}

// =====================================================
// Grandprix countdown on admin
// =====================================================
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

// =====================================================
// Stop GP audio everywhere
// =====================================================
function stopGpAudioEverywhere() {
  socket.emit("gp-stop-audio-now");
  if (currentChallenge?.type === "Nisse Grandprix") {
    currentChallenge.phase = "ended";
  }
}

// =====================================================
// Decision buttons
// =====================================================
yesBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  if (!selectedTeamId) return alert("Vælg vinderholdet.");

  stopGpAudioEverywhere();

  const t = teams.find(x => x.id === selectedTeamId);
  if (t) t.points = (t.points ?? 0) + 1;

  currentChallenge = null;
  selectedTeamId = null;

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
};

noBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");

  // Grandprix NO resumes listening for everyone
  if (currentChallenge.type === "Nisse Grandprix") {
    if (currentChallenge.phase === "locked" && currentChallenge.firstBuzz) {
      const buzzingTeam = currentChallenge.firstBuzz.teamName;

      currentChallenge.answeredTeams =
        currentChallenge.answeredTeams || {};
      currentChallenge.answeredTeams[buzzingTeam] = true;

      currentChallenge.phase = "listening";
      currentChallenge.firstBuzz = null;
      currentChallenge.countdownStartAt = null;
      currentChallenge.typedAnswer = null;

      selectedTeamId = null;

      renderTeams();
      renderCurrentChallenge();
      renderMiniGameArea();
      saveLocal();
      syncToServer();
      return;
    }
  }

  // Other challenges: just end without point
  currentChallenge = null;

  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
};

incompleteBtn.onclick = () => {
  if (!currentChallenge) return;

  stopGpAudioEverywhere();
  currentChallenge = null;
  selectedTeamId = null;

  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
};

// =====================================================
// Reset / End game
// =====================================================
resetBtn.onclick = () => {
  if (!confirm("Nulstil hele spillet?")) return;

  stopGpAudioEverywhere();

  teams = [];
  selectedTeamId = null;
  currentChallenge = null;
  deck.forEach(c => (c.used = false));
  endGameResultEl.textContent = "";

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();

  saveLocal();
  syncToServer();
};

endGameBtn.onclick = () => {
  if (!teams.length) return alert("Ingen hold endnu.");

  stopGpAudioEverywhere();

  const sorted = [...teams].sort((a,b)=>(b.points??0)-(a.points??0));
  const topScore = sorted[0].points;
  const winners = sorted.filter(t => t.points === topScore);

  endGameResultEl.textContent =
    winners.length === 1
      ? `Vinderen er: ${winners[0].name} med ${topScore} point! 🎉`
      : `Uafgjort: ${winners.map(x => x.name).join(", ")} – ${topScore} point.`;

  saveLocal();
  syncToServer();
};

// =====================================================
// Start game
// =====================================================
startGameBtn.onclick = () => {
  gameCode = String(Math.floor(1000 + Math.random() * 9000));
  gameCodeValueEl.textContent = gameCode;

  teams = [];
  selectedTeamId = null;
  currentChallenge = null;

  saveLocal();
  syncToServer();
};

// =====================================================
// Add team manually (optional)
// =====================================================
addTeamBtn.onclick = () => {
  const name = teamNameInput.value.trim();
  if (!name) return;

  if (teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert("Navnet findes allerede.");
    return;
  }

  teams.push({ id: "t" + Date.now() + Math.random(), name, points: 0 });
  teamNameInput.value = "";

  renderTeams();
  saveLocal();
  syncToServer();
};

// =====================================================
// SOCKET LISTENERS
// =====================================================

// ---- Grandprix buzz ----
socket.on("buzzed", (teamName) => {
  if (!currentChallenge || currentChallenge.type !== "Nisse Grandprix") return;
  if (currentChallenge.phase !== "listening") return;
  if (currentChallenge.firstBuzz) return;

  currentChallenge.phase = "locked";
  currentChallenge.firstBuzz = { teamName };
  currentChallenge.countdownStartAt = Date.now();
  currentChallenge.typedAnswer = null;

  const t = teams.find(x => x.name === teamName);
  if (t) selectedTeamId = t.id;

  renderTeams();
  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// ---- Grandprix typed answer ----
socket.on("gp-typed-answer", ({ teamName, text }) => {
  if (!currentChallenge || currentChallenge.type !== "Nisse Grandprix") return;

  currentChallenge.answeredTeams = currentChallenge.answeredTeams || {};
  if (currentChallenge.answeredTeams[teamName]) return;

  currentChallenge.answeredTeams[teamName] = true;
  currentChallenge.typedAnswer = { teamName, text };

  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// ---- Shared "newCard" from server (NisseGåden + JuleKortet)
socket.on("newCard", ({ teamName, text }) => {
  if (!currentChallenge) return;

  if (currentChallenge.type === "NisseGåden") {
    currentChallenge.answers.push({ teamName, text });
  }

  if (currentChallenge.type === "JuleKortet" && currentChallenge.phase === "writing") {
    const already = currentChallenge.cards.some(c => (c.teamName || c.team) === teamName);
    if (!already) currentChallenge.cards.push({ teamName, text });
  }

  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// ---- KreaNissen photo submit ----
socket.on("newPhoto", ({ teamName, filename }) => {
  if (!currentChallenge || currentChallenge.type !== "KreaNissen") return;
  if (currentChallenge.phase !== "creating") return;

  const already = currentChallenge.photos.some(p => (p.teamName || p.team) === teamName);
  if (!already) currentChallenge.photos.push({ teamName, filename });

  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// ---- Votes update (used by both JuleKortet + KreaNissen)
socket.on("voteUpdate", ({ voter, index }) => {
  if (!currentChallenge) return;

  if (currentChallenge.type === "JuleKortet") {
    if (currentChallenge.phase !== "voting") return;
    currentChallenge.votes[voter] = index;
  }

  if (currentChallenge.type === "KreaNissen") {
    if (currentChallenge.phase !== "voting") return;
    currentChallenge.votes[voter] = index;
  }

  renderMiniGameArea();
  saveLocal();
  syncToServer();
});

// ---- Full state sync from server ----
socket.on("state", (s) => {
  if (!s) return;

  if (Array.isArray(s.teams)) teams = s.teams;
  if (Array.isArray(s.deck)) deck = s.deck;
  if (s.currentChallenge !== undefined) currentChallenge = s.currentChallenge;
  if (s.gameCode !== undefined) gameCode = s.gameCode;

  if (gameCodeValueEl) gameCodeValueEl.textContent = gameCode || "—";

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();

  saveLocal();
});

// =====================================================
// INIT
// =====================================================
loadLocal();
renderTeams();
renderDeck();
renderCurrentChallenge();
renderMiniGameArea();
await loadDeckSafely();
if (gameCodeValueEl) gameCodeValueEl.textContent = gameCode || "—";

