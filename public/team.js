// public/team.js v39
// Stable base (Grandprix/NisseGåden/JuleKortet/KreaNissen)

// Mini-games
import { renderGrandprix, stopGrandprix } from "./minigames/grandprix.js?v=3";
import { renderNisseGaaden, stopNisseGaaden } from "./minigames/nissegaaden.js";
import { renderJuleKortet, stopJuleKortet } from "./minigames/julekortet.js";
import { renderKreaNissen, stopKreaNissen } from "./minigames/kreanissen.js?v=2";

const socket = io();
const el = (id) => document.getElementById(id);

// ---------- DOM ----------
const codeInput = el("codeInput");
const codeBtn = el("codeBtn");
const nameRow = el("nameRow");
const nameInput = el("nameInput");
const nameBtn = el("nameBtn");
const joinMsg = el("joinMsg");
const joinSection = el("joinSection");

const codeDisplay = el("codeDisplay");
const teamListEl = el("teamList");

const challengeTitle = el("challengeTitle");
const challengeText = el("challengeText");

const buzzBtn = el("buzzBtn");
const statusEl = el("status");
const teamNameLabel = el("teamNameLabel");

const gpPopup = el("grandprixPopup");
const gpPopupCountdown = el("grandprixPopupCountdown");

// ---------- STATE ----------
let joined = false;
let joinedCode = null;
let myTeamName = null;

// Local Grandprix "I buzzed!" fallback
let lastBuzzRoundId = null;
let lastBuzzAt = 0;

// Grandprix typed answer lock
let gpAnsweredRoundId = null;
let gpSentThisRound = false;

// NisseGåden: remember if we already answered this riddle round
let ngAnsweredRoundId = null;

// ---------- SCORE TOAST (all teams see point changes) ----------
let scoreToastEl = null;
let scoreToastTimeout = null;

function showScoreToast(teamName, delta) {
  if (!scoreToastEl) {
    scoreToastEl = document.createElement("div");
    scoreToastEl.id = "scoreToast";
    scoreToastEl.className = "score-toast";
    document.body.appendChild(scoreToastEl);
  }

  const abs = Math.abs(delta);
  const pointWord = abs === 1 ? "point" : "point";
  const msg =
    delta > 0
      ? `${teamName} har fået ${abs} ${pointWord}!`
      : `${teamName} har mistet ${abs} ${pointWord}!`;

  scoreToastEl.className = "score-toast";
  if (delta > 0) {
    scoreToastEl.classList.add("score-toast--gain");
  } else {
    scoreToastEl.classList.add("score-toast--loss");
  }

  scoreToastEl.textContent = msg;

  // restart animation
  void scoreToastEl.offsetWidth;

  scoreToastEl.classList.add("score-toast--show");

  if (scoreToastTimeout) clearTimeout(scoreToastTimeout);

  scoreToastTimeout = setTimeout(() => {
    scoreToastEl.classList.remove("score-toast--show");
  }, 4000);
}

// ---------- Mini-game API ----------
const api = {
  setBuzzEnabled(enabled) {
    if (buzzBtn) buzzBtn.disabled = !enabled;
  },
  showStatus(text) {
    if (statusEl) statusEl.textContent = text;
  },
  clearMiniGame() {
    if (statusEl) statusEl.textContent = "";
    if (buzzBtn) buzzBtn.disabled = true;
    hideGrandprixPopup();
    hideNisseGaadenAnswer();
  }
};

// ===========================
// JOIN step 1 (enter code)
// ===========================
codeBtn?.addEventListener("click", tryCode);
codeInput?.addEventListener("keydown", (e) => {
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

// ===========================
// JOIN step 2 (enter team name)
// ===========================
nameBtn?.addEventListener("click", tryJoin);
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoin();
});

function tryJoin() {
  const name = nameInput.value.trim();
  if (!name) {
    joinMsg.textContent = "Skriv et teamnavn.";
    return;
  }

  socket.emit("joinGame", { code: joinedCode, teamName: name }, (res) => {
    if (!res?.ok) {
      joinMsg.textContent = res?.message || "Kunne ikke joine.";
      return;
    }

    joined = true;
    myTeamName = res.team.name;

    if (teamNameLabel) teamNameLabel.textContent = myTeamName;
    joinSection.style.display = "none";

    api.clearMiniGame();
  });
}

// ===========================
// BUZZ (Grandprix)
// ===========================
buzzBtn?.addEventListener("click", async () => {
  if (!joined) return;

  if (window.__grandprixAudio && window.__grandprixAudio.paused) {
    try {
      await window.__grandprixAudio.play();
    } catch {}
  }

  lastBuzzAt = Date.now();
  lastBuzzRoundId = window.__currentRoundId || null;

  socket.emit("buzz");
});

socket.on("gp-stop-audio-now", () => {
  stopGrandprix();
  api.clearMiniGame();
});

// ===========================
// LEADERBOARD
// ===========================
function renderLeaderboard(teams) {
  if (!teamListEl) return;

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
    li.innerHTML = `
      <span>${i + 1}. ${t.name}</span>
      <span class="pts">${t.points ?? 0}</span>
    `;
    teamListEl.appendChild(li);
  });
}

// ===========================
// NISSEGÅDEN answer input
// ===========================
let ngWrap = null;
let ngInput = null;
let ngBtn = null;

function ensureNisseGaadenAnswer() {
  if (ngWrap) return;

  ngWrap = document.createElement("div");
  ngWrap.style.cssText =
    "margin-top:12px; display:flex; gap:8px; justify-content:center;";

  ngInput = document.createElement("input");
  ngInput.placeholder = "Skriv jeres svar her…";
  ngInput.style.cssText =
    "font-size:1.2rem; padding:10px; width:320px;";

  ngBtn = document.createElement("button");
  ngBtn.textContent = "Send svar";
  ngBtn.style.cssText =
    "font-size:1.2rem; padding:10px 14px; font-weight:800; cursor:pointer;";

  ngBtn.onclick = () => {
    const text = (ngInput.value || "").trim();
    if (!text) return;

    socket.emit("submitCard", { teamName: myTeamName, text });

    // mark this round as answered
    ngAnsweredRoundId = window.__currentRoundId || null;

    // clear + lock UI
    ngInput.value = "";
    api.showStatus("✅ Svar sendt til læreren.");
    hideNisseGaadenAnswer();
  };

  ngWrap.append(ngInput, ngBtn);
  challengeText.parentElement.appendChild(ngWrap);
}

function showNisseGaadenAnswer() {
  ensureNisseGaadenAnswer();
  ngWrap.style.display = "flex";
  ngInput.disabled = false;
  ngBtn.disabled = false;
  setTimeout(() => ngInput.focus(), 50);
}

function hideNisseGaadenAnswer() {
  if (!ngWrap) return;
  ngWrap.style.display = "none";
  ngInput.disabled = true;
  ngBtn.disabled = true;
}

// ===========================
// GRANDPRIX POPUP + INPUT
// ===========================
let gpPopupTimer = null;
let gpAnswerInput = null;
let gpAnswerBtn = null;
let gpAnswerWrap = null;
let gpNoteEl = null;

function ensureGpAnswerUI() {
  if (!gpPopup) return;

  if (!gpAnswerWrap) {
    gpAnswerWrap = document.createElement("div");
    gpAnswerWrap.style.cssText = `
      margin-top:18px; display:flex; flex-direction:column; gap:10px;
      width:min(520px, 92vw);
    `;

    gpNoteEl = document.createElement("div");
    gpNoteEl.style.cssText =
      "font-size:1.1rem; font-weight:700; text-align:center;";

    gpAnswerInput = document.createElement("input");
    gpAnswerInput.placeholder = "Skriv jeres svar …";
    gpAnswerInput.style.cssText = `
      font-size:1.6rem; padding:14px; border-radius:10px; border:2px solid #222;
      width:100%;
    `;

    gpAnswerBtn = document.createElement("button");
    gpAnswerBtn.textContent = "Send svar";
    gpAnswerBtn.style.cssText = `
      font-size:1.5rem; font-weight:900; padding:12px; border-radius:10px; border:none;
      background:#1a7f37; color:white; cursor:pointer;
    `;

    gpAnswerBtn.onclick = () => {
      if (gpSentThisRound) return;

      const text = (gpAnswerInput.value || "").trim();
      if (!text) return;

      gpSentThisRound = true;
      gpAnswerInput.disabled = true;
      gpAnswerBtn.disabled = true;

      socket.emit("gp-typed-answer", { teamName: myTeamName, text });
      api.showStatus("✅ Svar sendt til læreren.");
    };

    gpAnswerWrap.append(gpNoteEl, gpAnswerInput, gpAnswerBtn);
    gpPopup.appendChild(gpAnswerWrap);
  }
}

function showGrandprixPopup(startAtMs, seconds, iAmFirstBuzz, roundId) {
  if (!gpPopup || !gpPopupCountdown) return;

  ensureGpAnswerUI();
  gpPopup.style.display = "flex";

  // new round => reset lock
  if (roundId && roundId !== gpAnsweredRoundId) {
    gpAnsweredRoundId = roundId;
    gpSentThisRound = false;
  }

  if (iAmFirstBuzz) {
    gpNoteEl.textContent = "Svar inden tiden udløber";
    gpAnswerInput.disabled = gpSentThisRound;
    gpAnswerBtn.disabled = gpSentThisRound;
    if (!gpSentThisRound) setTimeout(() => gpAnswerInput.focus(), 80);
  } else {
    gpNoteEl.textContent = "Vent… et andet hold svarer nu";
    gpAnswerInput.disabled = true;
    gpAnswerBtn.disabled = true;
  }

  if (gpPopupTimer) clearInterval(gpPopupTimer);

  function tick() {
    const elapsed = Math.floor((Date.now() - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    gpPopupCountdown.textContent = left;

    if (left <= 0) {
      clearInterval(gpPopupTimer);
      gpPopupTimer = null;
      gpAnswerInput.disabled = true;
      gpAnswerBtn.disabled = true;
      setTimeout(hideGrandprixPopup, 600);
    }
  }

  tick();
  gpPopupTimer = setInterval(tick, 100);
}

function hideGrandprixPopup() {
  if (gpPopupTimer) clearInterval(gpPopupTimer);
  gpPopupTimer = null;
  if (gpPopup) gpPopup.style.display = "none";
}

// ===========================
// Challenge router
// ===========================
function renderChallenge(ch) {
  api.setBuzzEnabled(false);
  hideNisseGaadenAnswer();

  // Stop all mini-games before switch
  stopGrandprix();
  stopNisseGaaden(api);
  stopJuleKortet(api);
  stopKreaNissen(api);

  if (!ch) {
    challengeTitle.textContent = "Ingen udfordring endnu";
    challengeText.textContent = "Vent på læreren…";
    api.clearMiniGame();
    return;
  }

  window.__currentRoundId = ch.id || null;

  challengeTitle.textContent = ch.type || "Udfordring";
  challengeText.textContent = ch.text || "";

  if (ch.type === "Nisse Grandprix") {
    renderGrandprix(ch, api);
    return;
  }

  if (ch.type === "NisseGåden") {
    renderNisseGaaden(ch, api);

    const alreadyAnswered =
      ch.id && ngAnsweredRoundId && ch.id === ngAnsweredRoundId;

    if (!alreadyAnswered) {
      showNisseGaadenAnswer();
    } else {
      api.showStatus("✅ Svar sendt. Vent på læreren…");
    }
    return;
  }

  if (ch.type === "JuleKortet") {
    renderJuleKortet(ch, api, socket, myTeamName);
    return;
  }

  if (ch.type === "KreaNissen") {
    renderKreaNissen(ch, api, socket, myTeamName);
    return;
  }

  api.clearMiniGame();
}

// ===========================
// Receive state from server
// ===========================
socket.on("state", (s) => {
  if (!s) return;

  if (s.gameCode) codeDisplay.textContent = s.gameCode;

  renderLeaderboard(s.teams || []);
  renderChallenge(s.currentChallenge);

  const ch = s.currentChallenge;

  // ---------- NEW: Grandprix lock-out for teams that already answered wrong ----------
  if (ch && ch.type === "Nisse Grandprix") {
    const answeredTeams = ch.answeredTeams || {};
    const normalizeName = (x) => (x || "").trim().toLowerCase();
    const me = normalizeName(myTeamName);

    const alreadyAnswered = Object.keys(answeredTeams).some(
      (name) => normalizeName(name) === me
    );

    // If this team already tried this round, BUZZ must stay disabled
    if (alreadyAnswered) {
      api.setBuzzEnabled(false);
    }
  }

  const isLockedGP =
    ch && ch.type === "Nisse Grandprix" && ch.phase === "locked";

  const normalize = (x) => (x || "").trim().toLowerCase();

  let iAmFirstBuzz =
    joined &&
    isLockedGP &&
    ch.firstBuzz &&
    normalize(ch.firstBuzz.teamName) === normalize(myTeamName);

  if (!iAmFirstBuzz && isLockedGP) {
    const sameRound = ch.id && lastBuzzRoundId && ch.id === lastBuzzRoundId;
    const recent = Date.now() - lastBuzzAt < 8000;
    if (sameRound && recent) iAmFirstBuzz = true;
  }

  if (isLockedGP && ch.countdownStartAt) {
    showGrandprixPopup(
      ch.countdownStartAt,
      ch.countdownSeconds || 20,
      iAmFirstBuzz,
      ch.id
    );
  } else {
    hideGrandprixPopup();
  }
});

// When points change, show a toast on all teams
socket.on("points-toast", ({ teamName, delta }) => {
  showScoreToast(teamName, delta);
});
