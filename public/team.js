// public/team.js
import { renderGrandprix, stopGrandprix } from "./minigames/grandprix.js";

const socket = io();

function el(id) {
  const node = document.getElementById(id);
  if (!node) console.warn(`Missing element with id="${id}" in team.html`);
  return node;
}

// DOM
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

// Grandprix answer popup
const gpPopup = el("grandprixPopup");
const gpPopupCountdown = el("grandprixPopupCountdown");

// STATE
let joined = false;
let joinedCode = null;
let myTeamName = null;

// Mini-game API
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
  }
};

// ---- Join step 1: code ----
codeBtn?.addEventListener("click", tryCode);
codeInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryCode();
});

function tryCode() {
  const code = (codeInput?.value || "").trim();
  if (!code) {
    if (joinMsg) joinMsg.textContent = "Skriv en kode først.";
    return;
  }

  joinedCode = code;
  if (codeDisplay) codeDisplay.textContent = code;
  if (joinMsg) joinMsg.textContent = "Kode accepteret. Skriv jeres teamnavn.";

  if (nameRow) nameRow.style.display = "flex";
  nameInput?.focus();
}

// ---- Join step 2: team name ----
nameBtn?.addEventListener("click", tryJoinTeam);
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoinTeam();
});

function tryJoinTeam() {
  if (!joinedCode) {
    if (joinMsg) joinMsg.textContent = "Indtast kode først.";
    return;
  }

  const teamName = (nameInput?.value || "").trim();
  if (!teamName) {
    if (joinMsg) joinMsg.textContent = "Skriv et teamnavn.";
    return;
  }

  socket.emit("joinGame", { code: joinedCode, teamName }, (res) => {
    if (!res?.ok) {
      if (joinMsg) joinMsg.textContent = res?.message || "Kunne ikke joine.";
      return;
    }

    joined = true;
    myTeamName = res.team.name;

    if (joinMsg) joinMsg.textContent = `✅ I er nu med som: ${myTeamName}`;
    if (teamNameLabel) teamNameLabel.textContent = myTeamName;

    if (joinSection) joinSection.style.display = "none";

    api.clearMiniGame();
  });
}

// ---- Buzz ----
buzzBtn?.addEventListener("click", () => {
  if (!joined) return;

  let audioPosition = null;
  if (window.__grandprixAudio) {
    audioPosition = window.__grandprixAudio.currentTime;
  }

  socket.emit("buzz", { audioPosition });
});

socket.on("buzzed", (teamName) => {
  if (statusEl) statusEl.textContent = `${teamName} buzzede først!`;
});

// Admin forced stop
socket.on("gp-stop-audio-now", () => {
  stopGrandprix();
  api.clearMiniGame();
  if (gpPopup) gpPopup.style.display = "none";
});

// ---- Leaderboard ----
function renderLeaderboard(teams) {
  if (!teamListEl) return;

  const sorted = [...teams].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
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

// ---- Challenge render ----
function renderChallenge(challenge) {
  buzzBtn && (buzzBtn.disabled = true);

  if (!challenge) {
    stopGrandprix();
    if (challengeTitle) challengeTitle.textContent = "Ingen udfordring endnu";
    if (challengeText) challengeText.textContent = "Vent på læreren…";
    api.clearMiniGame();
    return;
  }

  if (challengeTitle) challengeTitle.textContent = challenge.type || "Udfordring";
  if (challengeText) challengeText.textContent = challenge.text || "";

  if (challenge.type === "Nisse Grandprix") {
    renderGrandprix(challenge, api);
    return;
  }

  stopGrandprix();
  api.clearMiniGame();
}

// ---- 5-sec Grandprix answer popup ----
let gpPopupTimer = null;

function showGrandprixPopup(startAtMs, seconds) {
  if (!gpPopup || !gpPopupCountdown) return;
  if (gpPopupTimer) clearInterval(gpPopupTimer);

  gpPopup.style.display = "flex";

  function tick() {
    const now = Date.now();
    const elapsed = Math.floor((now - startAtMs) / 1000);
    const left = Math.max(0, seconds - elapsed);
    gpPopupCountdown.textContent = left;

    if (left <= 0) {
      clearInterval(gpPopupTimer);
      setTimeout(() => (gpPopup.style.display = "none"), 400);
    }
  }

  tick();
  gpPopupTimer = setInterval(tick, 100);
}

// ---- Mic (team -> admin) ----
let gpTeamPC = null;
let gpMicStream = null;

async function startMicToAdmin() {
  try {
    gpMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    gpTeamPC = new RTCPeerConnection();
    gpMicStream.getTracks().forEach(track =>
      gpTeamPC.addTrack(track, gpMicStream)
    );

    gpTeamPC.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit("gp-webrtc-ice", { candidate: ev.candidate });
    };

    const offer = await gpTeamPC.createOffer();
    await gpTeamPC.setLocalDescription(offer);

    socket.emit("gp-webrtc-offer", { offer });
  } catch {
    api.showStatus("⚠️ Mikrofon kræver tilladelse.");
  }
}

function stopMicNow() {
  if (gpMicStream) {
    gpMicStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
    gpMicStream = null;
  }
  if (gpTeamPC) {
    try { gpTeamPC.close(); } catch {}
    gpTeamPC = null;
  }
}

socket.on("gp-stop-mic", stopMicNow);

socket.on("gp-webrtc-answer", async ({ answer }) => {
  try {
    if (gpTeamPC && answer) await gpTeamPC.setRemoteDescription(answer);
  } catch {}
});

socket.on("gp-webrtc-ice", async ({ candidate }) => {
  try {
    if (gpTeamPC && candidate) await gpTeamPC.addIceCandidate(candidate);
  } catch {}
});

// ---- State from server ----
socket.on("state", (s) => {
  if (!s) return;

  if (s.gameCode && codeDisplay) codeDisplay.textContent = s.gameCode;

  renderLeaderboard(s.teams || []);
  renderChallenge(s.currentChallenge);

  const ch = s.currentChallenge;

  const isLockedGrandprix =
    ch &&
    ch.type === "Nisse Grandprix" &&
    ch.phase === "locked";

  if (!isLockedGrandprix) {
    stopMicNow();
    if (gpPopup) gpPopup.style.display = "none";
  }

  if (
    joined &&
    isLockedGrandprix &&
    ch.firstBuzz &&
    ch.firstBuzz.teamName === myTeamName &&
    ch.countdownStartAt
  ) {
    showGrandprixPopup(ch.countdownStartAt, ch.countdownSeconds || 5);
    startMicToAdmin();
  }
});
