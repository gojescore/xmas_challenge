// public/main.js v40-option1 (fixed voting button “stutter”)
// Fix:
// - The voting “Luk afstemning og giv point” button was being recreated every 250ms because
//   renderMiniGameArea() was re-rendering on an interval even during voting.
// - Now we ONLY run the 250ms tick when a countdown is actually shown (Grandprix locked,
//   JuleKortet writing, KreaNissen creating). During voting/ended there is NO tick,
//   so clicks are reliable.
//
// Keeps: facit line, reload deck, score toast, winner overlay, all minigame admin UI, VOICE panel.

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
const facitLine = document.getElementById("facitLine");
const yesBtn = document.getElementById("yesBtn");
const noBtn = document.getElementById("noBtn");
const incompleteBtn = document.getElementById("incompleteBtn");
const endGameBtn = document.getElementById("endGameBtn");
const endGameResultEl = document.getElementById("endGameResult");

const challengeGridEl = document.querySelector(".challenge-grid");
const miniGameArea = document.getElementById("miniGameArea");

const reloadDeckBtn = document.getElementById("reloadDeckBtn");
const openVoiceBtn = document.getElementById("openVoiceBtn");

// =====================================================
// STATE (local mirrors server state; server is authoritative)
// =====================================================
let teams = [];
let selectedTeamId = null;

let deck = [];
let currentChallenge = null;
let gameCode = null;

let serverOffsetMs = 0; // serverNow - Date.now()

const STORAGE_KEY = "xmasChallenge_admin_v40_option1";

// =====================================================
// Time helpers (for consistent countdown UI only)
// =====================================================
function updateServerOffset(serverNow) {
  if (typeof serverNow === "number") {
    serverOffsetMs = serverNow - Date.now();
  }
}
function nowMs() {
  return Date.now() + serverOffsetMs;
}
function secondsLeftFromPhase(ch) {
  if (!ch) return null;
  const start = ch.phaseStartAt;
  const dur = ch.phaseDurationSec;
  if (typeof start !== "number" || typeof dur !== "number") return null;
  const elapsed = Math.floor((nowMs() - start) / 1000);
  return Math.max(0, dur - elapsed);
}

// =====================================================
// SCORE TOAST
// =====================================================
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
  const msg =
    delta > 0
      ? `${teamName} har fået ${abs} point!`
      : `${teamName} har mistet ${abs} point!`;

  scoreToastEl.className = "score-toast";
  if (delta > 0) scoreToastEl.classList.add("score-toast--gain");
  else scoreToastEl.classList.add("score-toast--loss");

  scoreToastEl.textContent = msg;

  // restart animation
  void scoreToastEl.offsetWidth;
  scoreToastEl.classList.add("score-toast--show");

  if (scoreToastTimeout) clearTimeout(scoreToastTimeout);
  scoreToastTimeout = setTimeout(() => {
    scoreToastEl.classList.remove("score-toast--show");
  }, 4000);
}

// =====================================================
// Winner overlay
// =====================================================
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
            font-size:2.3rem;
            margin:0 0 0.8rem;
            letter-spacing:0.06em;
            text-transform:uppercase;
            text-shadow:0 3px 10px rgba(0,0,0,0.7);
          ">
            Vinder af Xmas Challenge
          </h1>

          <p id="winnerOverlayMessage" style="
            font-size:1.35rem;
            margin:0 0 0.6rem;
          "></p>

          <p id="winnerOverlayNames" style="
            font-size:2rem;
            font-weight:900;
            margin:0 0 0.3rem;
          "></p>

          <p style="font-size:1.1rem; margin:0 0 0.8rem;">
            Score: <span id="winnerOverlayScore"></span> point
          </p>

          <p style="font-size:0.95rem; opacity:0.85; margin-top:0.8rem;">
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

// =====================================================
// VOICE PANEL (admin)
// =====================================================
let __voicePanelEl = null;

function initVoicePanel() {
  if (__voicePanelEl) return;

  const panel = document.createElement("div");
  panel.id = "voicePanel";
  panel.style.cssText = `
    position:fixed; right:14px; bottom:14px; z-index:9999;
    width:min(380px, 92vw);
    background:rgba(255,255,255,0.92);
    border:2px solid rgba(0,0,0,0.15);
    border-radius:14px;
    padding:12px;
    box-shadow:0 8px 26px rgba(0,0,0,0.25);
    font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    display:none;
  `;

  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <div style="font-weight:900;">🎙️ Voice besked</div>
      <button id="vpClose" style="border:none; background:transparent; font-size:18px; cursor:pointer;">✕</button>
    </div>

    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
      <button id="vpRecord" class="challenge-card" style="padding:8px 10px;">Optag</button>
      <button id="vpStop" class="challenge-card" style="padding:8px 10px;" disabled>Stop</button>
      <button id="vpSend" class="challenge-card" style="padding:8px 10px;" disabled>Send til alle</button>
    </div>

    <div id="vpStatus" style="margin-top:8px; font-weight:800; font-size:0.95rem;"></div>
    <audio id="vpPreview" controls style="margin-top:10px; width:100%; display:none;"></audio>
  `;

  document.body.appendChild(panel);
  __voicePanelEl = panel;

  const closeBtn = panel.querySelector("#vpClose");
  const recordBtn = panel.querySelector("#vpRecord");
  const stopBtn = panel.querySelector("#vpStop");
  const sendBtn = panel.querySelector("#vpSend");
  const statusEl = panel.querySelector("#vpStatus");
  const previewEl = panel.querySelector("#vpPreview");

  function setStatus(t) {
    if (statusEl) statusEl.textContent = t || "";
  }

  closeBtn.onclick = () => (panel.style.display = "none");

  window.__showVoicePanel = () => {
    panel.style.display = "block";
  };

  let mediaRecorder = null;
  let audioStream = null;
  let chunks = [];
  let recordedBlob = null;
  let recordedMime = "";

  function stopStream() {
    if (audioStream) {
      audioStream.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      audioStream = null;
    }
  }

  recordBtn.onclick = async () => {
    recordedBlob = null;
    chunks = [];
    previewEl.style.display = "none";
    previewEl.src = "";
    sendBtn.disabled = true;

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};

      if (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      } else if (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm")) {
        options.mimeType = "audio/webm";
      }

      mediaRecorder = new MediaRecorder(audioStream, options);
      recordedMime = mediaRecorder.mimeType || options.mimeType || "";

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(chunks, { type: recordedMime || "audio/webm" });
        const url = URL.createObjectURL(recordedBlob);
        previewEl.src = url;
        previewEl.style.display = "block";
        sendBtn.disabled = false;
        setStatus("✅ Optagelse klar. Tryk Send til alle.");
        stopStream();
      };

      mediaRecorder.start();
      recordBtn.disabled = true;
      stopBtn.disabled = false;
      setStatus("⏺️ Optager… tryk Stop når du er færdig.");
    } catch (err) {
      console.error(err);
      setStatus("⚠️ Kunne ikke starte mikrofon (tilladelse?).");
      recordBtn.disabled = false;
      stopBtn.disabled = true;
      stopStream();
    }
  };

  stopBtn.onclick = () => {
    if (!mediaRecorder) return;
    try { mediaRecorder.stop(); } catch {}
    stopBtn.disabled = true;
    recordBtn.disabled = false;
    setStatus("⏳ Stopper optagelse…");
  };

  sendBtn.onclick = async () => {
    if (!recordedBlob) return;

    sendBtn.disabled = true;
    recordBtn.disabled = true;
    stopBtn.disabled = true;
    setStatus("⏳ Sender lyd til server…");

    try {
      const fd = new FormData();
      fd.append("file", recordedBlob, "voice.webm");

      const res = await fetch("/upload-audio", { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");

      const json = await res.json();
      if (!json?.filename) throw new Error("no filename");

      socket.emit("send-voice", {
        filename: json.filename,
        from: "Lærer",
        createdAt: Date.now(),
        mimeType: recordedMime || "audio/webm"
      });

      setStatus("✅ Voice besked sendt til alle skærme.");
    } catch (err) {
      console.error(err);
      setStatus("⚠️ Upload fejlede. Prøv igen.");
      sendBtn.disabled = false;
    } finally {
      recordBtn.disabled = false;
      stopBtn.disabled = true;
    }
  };
}

// =====================================================
// Persistence (UI convenience only; server is truth)
// =====================================================
function saveLocal() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ deck })
    );
  } catch {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.deck)) deck = s.deck;
  } catch {}
}

// =====================================================
// Deck load (client loads deck for UI; server stores copy for sharing)
// =====================================================
async function loadDeckSafely() {
  let gp = [];
  let ng = [];
  let jk = [];
  let kn = [];
  let bq = [];

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

  try {
    const m = await import("./data/deck/kreanissen.js?v=" + Date.now());
    kn = m.DECK || m.kreaNissenDeck || m.deck || [];
  } catch {}

  try {
    const m = await import("./data/deck/billedequiz.js?v=" + Date.now());
    bq = m.DECK || m.billedeQuizDeck || m.deck || [];
  } catch {}

  deck = [...gp, ...ng, ...jk, ...kn, ...bq].map((c) => ({ ...c, used: !!c.used }));

  renderDeck();
  saveLocal();

  // IMPORTANT: sync deck to server (legacy updateState used ONLY for deck storage)
  socket.emit("updateState", { deck });
}

async function reloadDeck() {
  await loadDeckSafely();
}

reloadDeckBtn?.addEventListener("click", reloadDeck);

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

  deck.forEach((card) => {
    const btn = document.createElement("button");
    btn.className = "challenge-card";
    btn.textContent = card.title || card.type;

    if (card.used) {
      btn.style.opacity = "0.45";
      btn.style.textDecoration = "line-through";
    }

    btn.onclick = () => {
      if (card.used) return alert("Denne udfordring er allerede brugt.");

      socket.emit("admin:selectChallenge", card);

      card.used = true;
      selectedTeamId = null;
      if (endGameResultEl) endGameResultEl.textContent = "";

      renderDeck();
      saveLocal();
    };

    challengeGridEl.appendChild(btn);
  });
}

// =====================================================
// Leaderboard
// =====================================================
function renderTeams() {
  if (!teamListEl) return;

  const sorted = [...teams].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  teamListEl.innerHTML = "";

  sorted.forEach((team) => {
    const li = document.createElement("li");
    li.className = "team-item" + (team.id === selectedTeamId ? " selected" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "team-name";
    nameSpan.textContent = team.name;

    const pointsDiv = document.createElement("div");
    pointsDiv.className = "team-points";

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.onclick = (e) => {
      e.stopPropagation();

      const newTeams = teams.map((t) => {
        if (t.id !== team.id) return t;
        const before = t.points ?? 0;
        return { ...t, points: Math.max(0, before - 1) };
      });
      socket.emit("updateState", { teams: newTeams });
    };

    const val = document.createElement("span");
    val.textContent = team.points ?? 0;

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.onclick = (e) => {
      e.stopPropagation();

      const newTeams = teams.map((t) => {
        if (t.id !== team.id) return t;
        const before = t.points ?? 0;
        return { ...t, points: before + 1 };
      });
      socket.emit("updateState", { teams: newTeams });
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
// Current challenge text + FACIT
// =====================================================
function renderCurrentChallenge() {
  if (!currentChallengeText) return;

  if (!currentChallenge) {
    currentChallengeText.textContent = "Ingen udfordring valgt endnu.";
    if (facitLine) facitLine.textContent = "";
    return;
  }

  const title = currentChallenge.title || currentChallenge.type;
  currentChallengeText.textContent = title;

  let facitText = currentChallenge.answer || "";
  if (!facitText) {
    if (currentChallenge.type === "Nisse Grandprix") {
      facitText = "Eleverne lytter til sangen og buzzer, når de kender svaret.";
    } else if (currentChallenge.type === "NisseGåden") {
      facitText = "Eleverne skal gætte gåden og skrive deres svar.";
    } else if (currentChallenge.type === "JuleKortet") {
      facitText = "Eleverne skriver et julekort, som senere indgår i en anonym afstemning.";
    } else if (currentChallenge.type === "KreaNissen") {
      facitText = "Eleverne laver noget kreativt og sender et billede.";
    } else if (currentChallenge.type === "BilledeQuiz") {
      facitText = "Se på billedet og løs opgaven.";
    }
  }

  if (facitLine) facitLine.textContent = facitText ? `Facit: ${facitText}` : "";
}

// =====================================================
// Admin minigame area (server-authoritative)
// FIX: Only tick when a countdown is shown (prevents voting button stutter).
// =====================================================
let miniUiTimer = null;
let closeVotingLocked = false;

function stopMiniUiTick() {
  if (miniUiTimer) clearInterval(miniUiTimer);
  miniUiTimer = null;
}

function startMiniUiTick() {
  if (miniUiTimer) clearInterval(miniUiTimer);
  miniUiTimer = setInterval(() => {
    renderMiniGameArea(); // visual countdown refresh only
  }, 250);
}

function renderMiniGameArea() {
  if (!miniGameArea) return;
  miniGameArea.innerHTML = "";
  if (!currentChallenge) {
    stopMiniUiTick();
    return;
  }

  const ch = currentChallenge;

  // Default: do NOT tick. We enable it only in phases with a visible countdown.
  stopMiniUiTick();

  // ---------- GRANDPRIX ----------
  if (ch.type === "Nisse Grandprix") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";

    const left = secondsLeftFromPhase(ch);
    const countdownText =
      ch.phase === "locked"
        ? (left === null ? "—" : String(left))
        : "—";

    wrap.innerHTML = `
      <h3>Nisse Grandprix</h3>
      <p><strong>Fase:</strong> ${ch.phase}</p>
      <p><strong>Buzzed først:</strong> ${ch.firstBuzz?.teamName || "—"}</p>
      <p><strong>Svar fra:</strong> ${ch.typedAnswer?.teamName || "—"}</p>
      <p><strong>Tekst:</strong> ${ch.typedAnswer?.text || "—"}</p>
      <p><strong>Nedtælling:</strong> <span id="gpAdminCountdown">${countdownText}</span></p>
    `;

    miniGameArea.appendChild(wrap);

    // Tick ONLY while locked countdown is visible
    if (ch.phase === "locked") startMiniUiTick();

    return;
  }

  // ---------- NISSEGÅDEN ----------
  if (ch.type === "NisseGåden") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";
    wrap.innerHTML = `<h3>NisseGåden – svar</h3>`;

    const answers = ch.answers || [];
    if (!answers.length) {
      const p = document.createElement("p");
      p.textContent = "Ingen svar endnu…";
      wrap.appendChild(p);
    } else {
      answers.forEach((a) => {
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

    miniGameArea.appendChild(wrap);
    return;
  }

  // ---------- JULEKORTET ----------
  if (ch.type === "JuleKortet") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #ccc; border-radius:10px;";
    wrap.innerHTML = `<h3>JuleKortet – fase: ${ch.phase}</h3>`;

    if (ch.phase === "writing") {
      const left = secondsLeftFromPhase(ch);
      const p = document.createElement("p");
      p.style.fontWeight = "900";
      p.textContent = `Tid tilbage til skrivning: ${left === null ? "—" : left + "s"}`;
      wrap.appendChild(p);

      const sent = ch.cards?.length || 0;
      const total = teams.length;
      const stat = document.createElement("p");
      stat.textContent = `Modtaget: ${sent}/${total} julekort`;
      stat.style.fontWeight = "800";
      wrap.appendChild(stat);

      // Tick ONLY while writing countdown is visible
      startMiniUiTick();
    }

    if (ch.phase === "voting") {
      const cards = ch.votingCards || [];
      const votesObj = ch.votes || {};
      const counts = Array(cards.length).fill(0);
      Object.values(votesObj).forEach((idx) => {
        if (typeof idx === "number" && idx >= 0 && idx < cards.length) counts[idx]++;
      });

      cards.forEach((c, i) => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px; margin-bottom:6px;";
        box.innerHTML = `
          <div style="font-weight:800;">Kort #${i + 1}</div>
          <div style="white-space:pre-wrap; margin:6px 0;">${c.text}</div>
          <div style="font-weight:900;">Stemmer: ${counts[i] || 0}</div>
        `;
        wrap.appendChild(box);
      });

      const finishBtn = document.createElement("button");
      finishBtn.textContent = "Luk afstemning og giv point";
      finishBtn.className = "challenge-card";

      finishBtn.onclick = () => {
        // Small lock to avoid double-send + makes clicks feel “acknowledged”
        if (closeVotingLocked) return;
        closeVotingLocked = true;
        finishBtn.disabled = true;

        socket.emit("admin:closeVoting");

        setTimeout(() => {
          closeVotingLocked = false;
          // It’s okay if server already changed phase; button will disappear on next state.
          finishBtn.disabled = false;
        }, 800);
      };

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
  if (ch.type === "KreaNissen") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #0b6; border-radius:10px;";
    wrap.innerHTML = `<h3>KreaNissen – fase: ${ch.phase}</h3>`;

    if (ch.phase === "creating") {
      const left = secondsLeftFromPhase(ch);
      const p = document.createElement("p");
      p.style.fontWeight = "900";
      p.textContent = `Tid tilbage til krea: ${left === null ? "—" : left + "s"}`;
      wrap.appendChild(p);

      const sent = ch.photos?.length || 0;
      const total = teams.length;
      const stat = document.createElement("p");
      stat.textContent = `Modtaget: ${sent}/${total} billeder`;
      stat.style.fontWeight = "800";
      wrap.appendChild(stat);

      // Tick ONLY while creating countdown is visible
      startMiniUiTick();
    }

    if (ch.phase === "voting") {
      const photos = ch.votingPhotos || [];
      const votesObj = ch.votes || {};
      const counts = Array(photos.length).fill(0);
      Object.values(votesObj).forEach((idx) => {
        if (typeof idx === "number" && idx >= 0 && idx < photos.length) counts[idx]++;
      });

      photos.forEach((p, i) => {
        const box = document.createElement("div");
        box.style.cssText =
          "padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px; margin-bottom:6px;";
        box.innerHTML = `
          <div style="font-weight:800;">Billede #${i + 1}</div>
          <img src="/uploads/${p.filename}" style="max-width:100%; border-radius:8px; margin:6px 0;" />
          <div style="font-weight:900;">Stemmer: ${counts[i] || 0}</div>
        `;
        wrap.appendChild(box);
      });

      const finishBtn = document.createElement("button");
      finishBtn.textContent = "Luk afstemning og giv point";
      finishBtn.className = "challenge-card";

      finishBtn.onclick = () => {
        if (closeVotingLocked) return;
        closeVotingLocked = true;
        finishBtn.disabled = true;

        socket.emit("admin:closeVoting");

        setTimeout(() => {
          closeVotingLocked = false;
          finishBtn.disabled = false;
        }, 800);
      };

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

  // ---------- BILLEDEQUIZ ----------
  if (ch.type === "BilledeQuiz") {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px; padding:10px; border:1px dashed #336; border-radius:10px;";
    wrap.innerHTML = `
      <h3>Billedquiz</h3>
      <p>Holdene ser billedet på deres egne skærme.</p>
    `;
    miniGameArea.appendChild(wrap);
    return;
  }
}

// =====================================================
// Decision buttons (server-authoritative)
// =====================================================
yesBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  if (!selectedTeamId) return alert("Vælg vinderholdet.");

  socket.emit("admin:decision", { decision: "yes", selectedTeamId });
};

noBtn.onclick = () => {
  if (!currentChallenge) return alert("Vælg en udfordring først.");
  socket.emit("admin:decision", { decision: "no", selectedTeamId });
};

incompleteBtn.onclick = () => {
  if (!currentChallenge) return;
  socket.emit("admin:decision", { decision: "incomplete" });
};

// =====================================================
// Reset / End game (server-authoritative)
// =====================================================
resetBtn.onclick = () => {
  if (!confirm("Nulstil hele spillet?")) return;
  socket.emit("admin:resetGame");
  if (endGameResultEl) endGameResultEl.textContent = "";
};

endGameBtn.onclick = () => {
  socket.emit("admin:endGame");
};

// =====================================================
// Start game (server-authoritative)
// =====================================================
startGameBtn.onclick = () => {
  socket.emit("admin:startGame");
  if (endGameResultEl) endGameResultEl.textContent = "";
};

// =====================================================
// Add team manually (optional; legacy updateState)
// =====================================================
addTeamBtn.onclick = () => {
  const name = (teamNameInput?.value || "").trim();
  if (!name) return;

  if (teams.some((t) => (t.name || "").toLowerCase() === name.toLowerCase())) {
    alert("Navnet findes allerede.");
    return;
  }

  const newTeam = { id: "t" + Date.now() + Math.random(), name, points: 0 };
  const newTeams = [...teams, newTeam];

  teamNameInput.value = "";
  socket.emit("updateState", { teams: newTeams });
};

// =====================================================
// SOCKET LISTENERS
// =====================================================
socket.on("show-winner", (payload) => {
  showWinnerOverlay(payload || {});
});

socket.on("points-toast", ({ teamName, delta }) => {
  showScoreToast(teamName, delta);
});

socket.on("state", (s) => {
  if (!s) return;

  updateServerOffset(s.serverNow);

  if (Array.isArray(s.teams)) teams = s.teams;
  if (s.currentChallenge !== undefined) currentChallenge = s.currentChallenge;
  if (s.gameCode !== undefined) gameCode = s.gameCode;

  if (Array.isArray(s.deck) && s.deck.length) {
    deck = s.deck;
  }

  if (gameCodeValueEl) gameCodeValueEl.textContent = gameCode || "—";

  renderTeams();
  renderDeck();
  renderCurrentChallenge();
  renderMiniGameArea();

  if (selectedTeamId && !teams.some((t) => t.id === selectedTeamId)) {
    selectedTeamId = null;
  }

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

initVoicePanel();

if (openVoiceBtn) {
  openVoiceBtn.onclick = () => {
    initVoicePanel();
    window.__showVoicePanel?.();
    const p = document.getElementById("voicePanel");
    if (p) p.style.display = "block";
  };
}

await loadDeckSafely();
if (gameCodeValueEl) gameCodeValueEl.textContent = gameCode || "—";
