// public/team.js v41
// Stable base (Grandprix/NisseGåden/JuleKortet/KreaNissen/BilledeQuiz + Xmas winner overlay)

import { renderGrandprix, stopGrandprix } from "./minigames/grandprix.js?v=3";
import { renderNisseGaaden, stopNisseGaaden } from "./minigames/nissegaaden.js";
import { renderJuleKortet, stopJuleKortet } from "./minigames/julekortet.js";
import { renderKreaNissen, stopKreaNissen } from "./minigames/kreanissen.js?v=2";
import { renderBilledeQuiz, stopBilledeQuiz } from "./minigames/billedequiz.js";

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

// ---------- SCORE TOAST ----------
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

// ---------- Xmas Winner Overlay ----------
let winnerOverlayEl = null;

function showWinnerOverlay({ winners = [], topScore = 0, message = "" } = {}) {
  if (!winnerOverlayEl) {
    winnerOverlayEl = document.createElement("div");
    winnerOverlayEl.id = "winnerOverlay";
    winnerOverlayEl.style.cssText = `
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at top, #ffffff22 0, transparent 55%),
        linear-gradient(135deg, #021526 0%, #200222 50%, #05301c 100%);
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      text-align: center;
      padding: 20px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    `;

    winnerOverlayEl.innerHTML = `
      <div style="
        max-width: 720px;
        width: min(720px, 96vw);
        background: rgba(15, 15, 30, 0.8);
        border-radius: 24px;
        padding: 26px 22px 30px;
        box-shadow: 0 16px 45px rgba(0,0,0,0.7);
        border: 3px solid rgba(255,255,255,0.55);
        backdrop-filter: blur(10px);
        position: relative;
        overflow: hidden;
      ">
        <div style="
          position:absolute;
          inset:-40px;
          background-image:
            radial-gradient(circle at 10% 0%, #ffffff33 0, transparent 55%),
            radial-gradient(circle at 90% 100%, #ffd96633 0, transparent 55%),
            repeating-linear-gradient(45deg,
              rgba(255,255,255,0.15),
              rgba(255,255,255,0.15) 2px,
              transparent 2px,
              transparent 6px
            );
          opacity:0.2;
          pointer-events:none;
        "></div>

        <div style="position:relative; z-index:1;">
          <div style="font-size:3.2rem; margin-bottom:0.3rem;">🎄🎉</div>
          <h1 style="
            font-size:2.1rem;
            margin:0 0 0.8rem;
            letter-spacing:0.06em;
            text-transform:uppercase;
            text-shadow:0 3px 10px rgba(0,0,0,0.7);
          ">
            Vinder af Xmas Challenge
          </h1>

          <p id="winnerOverlayMessage" style="
            font-size:1.3rem;
            margin:0 0 0.6rem;
          "></p>

          <p id="winnerOverlayNames" style="
            font-size:1.9rem;
            font-weight:900;
            margin:0 0 0.3rem;
          "></p>

          <p style="
            font-size:1.1rem;
            margin:0 0 0.8rem;
          ">
            Score: <span id="winnerOverlayScore"></span> point
          </p>

          <p style="
            font-size:0.95rem;
            opacity:0.85;
            margin-top:0.8rem;
          ">
            Klik hvor som helst på skærmen for at lukke
          </p>
        </div>
      </div>
    `;

    winnerOverlayEl.addEventListener("click", () => {
      winnerOverlayEl.style.display = "none";
    });

    document.body.appendChild(winnerOverlayEl);
  }

  const msgEl = winnerOverlayEl.querySelector("#winnerOverlayMessage");
  const namesEl = winnerOverlayEl.querySelector("#winnerOverlayNames");
  const scoreEl = winnerOverlayEl.querySelector("#winnerOverlayScore");

  if (msgEl) msgEl.textContent = message || "";
  if (namesEl) {
    namesEl.textContent =
      winners && winners.length ? winners.join(", ") : "Ingen vinder fundet";
  }
  if (scoreEl) {
    scoreEl.textContent =
      typeof topScore === "number" && !Number.isNaN(topScore)
        ? String(topScore)
        : "0";
  }

  winnerOverlayEl.style.display = "flex";
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
    stopBilledeQuiz(api);
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

    ngAnsweredRoundId = window.__currentRoundId || null;

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

  stopGrandprix();
  stopNisseGaaden(api);
  stopJuleKortet(api);
  stopKreaNissen(api);
  stopBilledeQuiz(api);

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

  if (ch.type === "BilledeQuiz") {
    renderBilledeQuiz(ch, api);
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

  if (ch && ch.type === "Nisse Grandprix") {
    const answeredTeams = ch.answeredTeams || {};
    const normalizeName = (x) => (x || "").trim().toLowerCase();
    const me = normalizeName(myTeamName);

    const alreadyAnswered = Object.keys(answeredTeams).some(
      (name) => normalizeName(name) === me
    );

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

// Winner overlay from server
socket.on("show-winner", (payload) => {
  showWinnerOverlay(payload || {});
});

// When points change, show a toast on all teams
socket.on("points-toast", ({ teamName, delta }) => {
  showScoreToast(teamName, delta);
});
