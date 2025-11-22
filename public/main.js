// public/main.js (v25)
// Adds JuleKortet admin flow safely.

const socket = io();

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

let teams = [];
let selectedTeamId = null;
let currentChallenge = null;
let deck = [];
let gameCode = null;

const STORAGE_KEY = "xmasChallenge_admin_v25";

// ---------- deck load ----------
async function loadDeckSafely() {
  let gpDeck = [];
  let ngDeck = [];
  let jkDeck = [];

  try {
    const gp = await import("./data/deck/grandprix.js?v=" + Date.now());
    gpDeck = gp.grandprixDeck || gp.deck || [];
  } catch {}

  try {
    const ng = await import("./data/deck/nissegaaden.js?v=" + Date.now());
    ngDeck = ng.nisseGaaden || ng.deck || [];
  } catch {}

  try {
    const jk = await import("./data/deck/julekortet.js?v=" + Date.now());
    jkDeck = jk.juleKortetDeck || jk.deck || [];
  } catch {}

  deck = [...gpDeck, ...ngDeck, ...jkDeck].map(c => ({ ...c, used: !!c.used }));
  renderDeck();
  saveLocal();
  syncToServer();
}

// ---------- persistence ----------
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

// ---------- sync ----------
function syncToServer() {
  socket.emit("updateState", { teams, deck, currentChallenge, gameCode });
}

// ---------- render deck ----------
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
      if (card.used) return alert("Denne udfordring er allerede brugt.");
      card.used = true;

      if (card.type === "Nisse Grandprix") {
        currentChallenge = {
          ...card,
          phase: "listening",
          startAt: Date.now() + 3000,
          firstBuzz: null,
          countdownSeconds: 20,
        };
      } else if (card.type === "JuleKortet") {
        currentChallenge = {
          ...card,
          phase: "writing",
          writingSeconds: 120, // ✅ 2 minutes
          writingStartAt: Date.now(),
          cards: [],
          votes: {},
        };
      } else {
        currentChallenge = { ...card };
      }

      renderDeck();
      renderCurrentChallenge();
      renderMiniGameArea();
      saveLocal();
      syncToServer();

      if (currentChallenge.type === "JuleKortet") {
        startAdminWritingTimer();
      }
    };

    challengeGridEl.appendChild(btn);
  });
}

// ---------- leaderboard ----------
function renderTeams() {
  const sorted = [...teams].sort((a,b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
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
    li.onclick = () => { selectedTeamId = team.id; renderTeams(); };

    teamListEl.appendChild(li);
  });
}

// ---------- current challenge text ----------
function renderCurrentChallenge() {
  currentChallengeText.textContent = currentChallenge
    ? `Aktuel udfordring: ${currentChallenge.title || currentChallenge.type}`
    : "Ingen udfordring valgt endnu.";
}

// ---------- add team manually (optional) ----------
addTeamBtn.onclick = () => {
  const name = teamNameInput.value.trim();
  if (!name) return;
  if (teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert("Navnet findes allerede."); return;
  }
  teams.push({ id: "t"+Date.now()+Math.random(), name, points:0 });
  teamNameInput.value = "";
  renderTeams(); saveLocal(); syncToServer();
};

// ---------- stop gp helper ----------
function stopGpNow() {
  socket.emit("gp-stop-audio-now");
  if (currentChallenge?.type === "Nisse Grandprix") {
    currentChallenge = { ...currentChallenge, phase: "ended" };
  } else {
    currentChallenge = null;
  }
}

// ---------- decision buttons ----------
yesBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  if (!selectedTeamId) return alert("Vælg vinderholdet.");

  stopGpNow();

  const t = teams.find(x => x.id === selectedTeamId);
  if (t) t.points = (t.points ?? 0) + 1;

  selectedTeamId = null;
  renderTeams(); renderCurrentChallenge(); renderMiniGameArea();
  saveLocal(); syncToServer();
};
noBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  stopGpNow();
  renderCurrentChallenge(); renderMiniGameArea();
  saveLocal(); syncToServer();
};
incompleteBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  stopGpNow();
  renderCurrentChallenge(); renderMiniGameArea();
  saveLocal(); syncToServer();
};

// ---------- reset ----------
resetBtn.onclick = () => {
  if (!confirm("Nulstil hele spillet?")) return;
  stopGpNow();

  teams = [];
  selectedTeamId = null;
  currentChallenge = null;
  deck.forEach(c => c.used = false);
  endGameResultEl.textContent = "";

  renderTeams(); renderDeck(); renderCurrentChallenge(); renderMiniGameArea();
  saveLocal(); syncToServer();
};

// ---------- end game ----------
endGameBtn.onclick = () => {
  if (!teams.length) return alert("Ingen hold endnu.");
  stopGpNow();

  const sorted = [...teams].sort((a,b)=>(b.points??0)-(a.points??0));
  const top = sorted[0];
  endGameResultEl.textContent = `Vinderen er: ${top.name} med ${top.points ?? 0} point! 🎉`;

  renderCurrentChallenge(); renderMiniGameArea();
  saveLocal(); syncToServer();
};

// ---------- start game ----------
startGameBtn.onclick = () => {
  gameCode = String(Math.floor(1000 + Math.random() * 9000));
  gameCodeValueEl.textContent = gameCode;
  saveLocal(); syncToServer();
};

// ---------- buzzer feedback ----------
socket.on("buzzed", (teamName) => {
  const t = teams.find(x => x.name === teamName);
  if (t) { selectedTeamId = t.id; renderTeams(); }
});

// ---------- admin miniGame UI ----------
let jkAdminTimer = null;

function renderMiniGameArea() {
  if (!miniGameArea) return;
  miniGameArea.innerHTML = "";

  if (!currentChallenge) return;

  if (currentChallenge.type === "JuleKortet") {
    const ch = currentChallenge;

    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    const h = document.createElement("h3");
    h.textContent = `JuleKortet – fase: ${ch.phase}`;
    wrap.appendChild(h);

    if (ch.phase === "writing") {
      const p = document.createElement("p");
      p.id = "jkAdminCountdown";
      p.style.fontWeight = "800";
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

      const list = document.createElement("div");
      list.style.display = "grid";
      list.style.gridTemplateColumns = "1fr";
      list.style.gap = "8px";

      cards.forEach((c, i) => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px;";
        box.innerHTML = `
          <div style="font-weight:700;">Kort #${i + 1}</div>
          <div style="white-space:pre-wrap; margin:6px 0;">${c.text}</div>
          <div style="font-weight:800;">Stemmer: ${votes[i] || 0}</div>
        `;
        list.appendChild(box);
      });

      wrap.appendChild(list);

      const finishBtn = document.createElement("button");
      finishBtn.textContent = "Afslut afstemning og find vinder";
      finishBtn.className = "challenge-card";
      finishBtn.onclick = () => finishVotingAndAward();
      wrap.appendChild(finishBtn);
    }

    miniGameArea.appendChild(wrap);
  }
}

function startAdminWritingTimer() {
  clearInterval(jkAdminTimer);
  jkAdminTimer = setInterval(() => {
    if (!currentChallenge || currentChallenge.type !== "JuleKortet") {
      clearInterval(jkAdminTimer); return;
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

  socket.emit("jk-request-winner-team",
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

// ---------- receive state ----------
socket.on("state", (s) => {
  if (!s) return;

  if (Array.isArray(s.teams)) teams = s.teams;

  if (Array.isArray(s.deck)) {
    if (!(s.deck.length === 0 && deck.length > 0)) deck = s.deck;
  }

  currentChallenge = s.currentChallenge || null;
  gameCode = s.gameCode || gameCode;

  if (gameCodeValueEl && gameCode) gameCodeValueEl.textContent = gameCode;

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();
  saveLocal();
});

// INIT
loadLocal();
renderTeams();
renderDeck();
renderCurrentChallenge();
renderMiniGameArea();
loadDeckSafely();

if (gameCodeValueEl && gameCode) gameCodeValueEl.textContent = gameCode;
