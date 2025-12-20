// server.js
// Xmas Challenge – server authoritative timers + phases (Option 1)
// Fixes:
// - Normalize card.type strings so JuleKortet/KreaNissen/etc always start correctly
// - Grandprix: typing window is 30 seconds (NOT 20)
// - Grandprix: when typed answer is received, stop the auto-release and wait for admin YES/NO
// - Grandprix listening uses startAt synced to phaseStartAt (small delay) for more consistent playback
// - Admin YES can award MULTIPLE winners for non-voting challenges (NOT Grandprix)
// - NEW PATCH: On admin YES for non-voting challenges, keep currentChallenge alive ~3s so teams can show the correct answer
// Keeps existing uploads + legacy events + serverNow in state emissions

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// -----------------------------------------------------
// STATIC FILES
// -----------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads"); // KreaNissen photos
const AUDIO_DIR = path.join(__dirname, "uploads-audio"); // voice messages

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/uploads-audio", express.static(AUDIO_DIR));

// -----------------------------------------------------
// FILE UPLOAD (KreaNissen photos)
// -----------------------------------------------------
const uploadPhoto = multer({ dest: UPLOAD_DIR });

app.post("/upload", uploadPhoto.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "Ingen fil modtaget." });
  res.json({ ok: true, filename: req.file.filename });
});

// -----------------------------------------------------
// FILE UPLOAD (Voice messages)
// -----------------------------------------------------
const uploadAudio = multer({ dest: AUDIO_DIR });

app.post("/upload-audio", uploadAudio.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "Ingen lydfil modtaget." });
  res.json({ ok: true, filename: req.file.filename });
});

// -----------------------------------------------------
// GAME STATE
// -----------------------------------------------------
let state = {
  teams: [],
  deck: [],
  currentChallenge: null,
  gameCode: null,
  startedAt: null,
};

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------
function nowMs() {
  return Date.now();
}

function emitState() {
  io.emit("state", { ...state, serverNow: nowMs() });
}

function emitStateTo(socket) {
  socket.emit("state", { ...state, serverNow: nowMs() });
}

function normalizeKey(t) {
  return (t?.id || t?.name || "").toLowerCase();
}

function indexTeamsByKey(teams) {
  const map = new Map();
  for (const t of teams || []) {
    const key = normalizeKey(t);
    if (key) map.set(key, t);
  }
  return map;
}

function safeId() {
  return "t" + Date.now() + Math.random();
}

function shuffle(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tallyVotes(votesObj, itemsLen) {
  const counts = Array(itemsLen).fill(0);
  for (const idx of Object.values(votesObj || {})) {
    if (typeof idx === "number" && idx >= 0 && idx < itemsLen) counts[idx]++;
  }
  return counts;
}

function awardPoint(teamName, delta = 1) {
  const team = state.teams.find((t) => (t.name || "") === teamName);
  if (!team) return;

  const before = team.points ?? 0;
  team.points = Math.max(0, before + delta);
  const actualDelta = (team.points ?? 0) - before;

  if (actualDelta !== 0) {
    io.emit("points-toast", { teamName: team.name, delta: actualDelta });
  }
}

// Normalize card.type to avoid "Julekortet" vs "JuleKortet" bugs
function normalizeChallengeType(type) {
  const raw = String(type || "").trim().toLowerCase();

  // remove spaces and punctuation for matching
  const compact = raw.replace(/[\s\-_]/g, "");

  if (compact === "nissegrandprix") return "Nisse Grandprix";
  if (compact === "nissegåden" || compact === "nissegaaden") return "NisseGåden";
  if (compact === "julekortet") return "JuleKortet";
  if (compact === "kreanissen") return "KreaNissen";
  if (compact === "billedequiz") return "BilledeQuiz";

  // fallback: return original
  return type;
}

function isNonVotingChallengeType(t) {
  // These are your “non-voting minigames” you want multi-winner and answer visibility for
  return t === "NisseGåden" || t === "BilledeQuiz";
}

// -----------------------------------------------------
// Server-authoritative timers
// -----------------------------------------------------
let phaseTimer = null;

function clearPhaseTimer() {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }
}

function schedulePhaseEnd(msFromNow, fn) {
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    try {
      fn();
    } catch (err) {
      console.error("phaseTimer error:", err);
    }
  }, Math.max(0, msFromNow | 0));
}

// -----------------------------------------------------
// Challenge transitions
// -----------------------------------------------------
function setChallenge(ch) {
  state.currentChallenge = ch || null;
  clearPhaseTimer();
  emitState();
}

function clearCurrentChallenge() {
  setChallenge(null);
}

// NEW: End + hold the challenge in state briefly (to show correct answer / winners)
function endChallengeWithHold(ms = 3000, extra = {}) {
  const ch = state.currentChallenge;
  if (!ch) return;

  // Do not interfere with Grandprix lifecycle
  if (ch.type === "Nisse Grandprix") {
    clearCurrentChallenge();
    return;
  }

  // Mark ended but keep object alive
  ch.phase = "ended";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = null;

  // Optional: winners etc. for the team popup layer
  Object.assign(ch, extra);

  emitState();

  // After hold time, clear
  schedulePhaseEnd(ms, () => {
    clearCurrentChallenge();
  });
}

// ---------- GRANDPRIX ----------
function startGrandprix(card) {
  // Give a small propagation delay so teams receive state before play triggers
  const startAt = nowMs() + 300;

  const ch = {
    ...card,
    type: "Nisse Grandprix",
    used: true,
    phase: "listening",
    phaseStartAt: startAt,
    phaseDurationSec: null, // not timed
    startAt,               // audio start timestamp used by client minigame
    firstBuzz: null,
    typedAnswer: null,
    answeredTeams: {},
  };

  setChallenge(ch);
}

function lockGrandprix(teamName) {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "Nisse Grandprix") return;
  if (ch.phase !== "listening") return;

  // ignore if already tried
  const answered = ch.answeredTeams || {};
  if (answered[teamName]) return;

  ch.phase = "locked"; // typing window
  ch.phaseStartAt = nowMs();

  // IMPORTANT: 30 seconds typing window (must stay 30)
  ch.phaseDurationSec = 30;

  ch.firstBuzz = { teamName };
  ch.typedAnswer = null;

  emitState();

  // After 30s: if NO typed answer, mark as tried + return to listening.
  schedulePhaseEnd(30 * 1000, () => {
    const c = state.currentChallenge;
    if (!c || c.type !== "Nisse Grandprix") return;

    // If we already got a typed answer, we do NOT auto-release.
    if (c.phase !== "locked") return;
    if (c.typedAnswer && c.typedAnswer.text) return;

    const buzzingTeam = c.firstBuzz?.teamName;
    c.answeredTeams = c.answeredTeams || {};
    if (buzzingTeam) c.answeredTeams[buzzingTeam] = true;

    const startAt = nowMs() + 300;

    c.phase = "listening";
    c.phaseStartAt = startAt;
    c.phaseDurationSec = null;
    c.startAt = startAt;
    c.firstBuzz = null;
    c.typedAnswer = null;

    emitState();
  });
}

function setGrandprixAwaitingDecision() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "Nisse Grandprix") return;
  if (ch.phase !== "locked") return;

  // Stop the auto-release timer; wait for admin YES/NO
  clearPhaseTimer();

  ch.phase = "awaiting";       // new phase: waiting for admin decision
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = null;  // no countdown

  emitState();
}

function resumeGrandprixListeningAfterNo() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "Nisse Grandprix") return;

  const buzzingTeam = ch.firstBuzz?.teamName;
  if (buzzingTeam) {
    ch.answeredTeams = ch.answeredTeams || {};
    ch.answeredTeams[buzzingTeam] = true;
  }

  const startAt = nowMs() + 300;

  ch.phase = "listening";
  ch.phaseStartAt = startAt;
  ch.phaseDurationSec = null;
  ch.startAt = startAt;
  ch.firstBuzz = null;
  ch.typedAnswer = null;

  clearPhaseTimer();
  emitState();
}

function endGrandprixRound() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "Nisse Grandprix") return;

  ch.phase = "ended";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = null;
  ch.firstBuzz = null;
  ch.typedAnswer = null;

  emitState();

  io.emit("gp-stop-audio-now");
}

// ---------- JULEKORTET ----------
function startJuleKortet(card) {
  const ch = {
    ...card,
    type: "JuleKortet",
    used: true,
    phase: "writing",
    phaseStartAt: nowMs(),
    phaseDurationSec: 120,
    cards: [],
    votingCards: [],
    votes: {},
    winners: [],
  };

  setChallenge(ch);

  schedulePhaseEnd(120 * 1000, () => {
    const c = state.currentChallenge;
    if (!c || c.type !== "JuleKortet") return;
    if (c.phase !== "writing") return;
    startJuleKortetVoting();
  });
}

function startJuleKortetVoting() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "JuleKortet") return;
  if (ch.phase !== "writing") return;

  const votingCards = shuffle(
    (ch.cards || []).map((c) => ({
      text: c.text,
      ownerTeamName: c.teamName || c.team,
    }))
  );

  ch.phase = "voting";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = null;
  ch.votingCards = votingCards;
  ch.votes = {};
  ch.winners = [];

  clearPhaseTimer();
  emitState();
}

function finishJuleKortetAndAward() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "JuleKortet") return;
  if (ch.phase !== "voting") return;

  const cards = ch.votingCards || [];
  if (!cards.length) {
    ch.phase = "ended";
    ch.winners = [];
    emitState();
    return;
  }

  const counts = tallyVotes(ch.votes || {}, cards.length);
  const max = Math.max(...counts);

  const winners = counts
    .map((c, i) => ({ i, c }))
    .filter((x) => x.c === max)
    .map((x) => cards[x.i]?.ownerTeamName)
    .filter(Boolean);

  for (const name of winners) awardPoint(name, 1);

  ch.phase = "ended";
  ch.phaseStartAt = nowMs();
  ch.winners = winners;

  emitState();
}

// ---------- KREANISSEN ----------
function startKreaNissen(card) {
  const ch = {
    ...card,
    type: "KreaNissen",
    used: true,
    phase: "creating",
    phaseStartAt: nowMs(),
    phaseDurationSec: 180,
    photos: [],
    votingPhotos: [],
    votes: {},
    winners: [],
  };

  setChallenge(ch);

  schedulePhaseEnd(180 * 1000, () => {
    const c = state.currentChallenge;
    if (!c || c.type !== "KreaNissen") return;
    if (c.phase !== "creating") return;
    startKreaVoting();
  });
}

function startKreaVoting() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "KreaNissen") return;
  if (ch.phase !== "creating") return;

  const votingPhotos = shuffle(
    (ch.photos || []).map((p) => ({
      filename: p.filename,
      ownerTeamName: p.teamName || p.team,
    }))
  );

  ch.phase = "voting";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = null;
  ch.votingPhotos = votingPhotos;
  ch.votes = {};
  ch.winners = [];

  clearPhaseTimer();
  emitState();
}

function finishKreaAndAward() {
  const ch = state.currentChallenge;
  if (!ch || ch.type !== "KreaNissen") return;
  if (ch.phase !== "voting") return;

  const photos = ch.votingPhotos || [];
  if (!photos.length) {
    ch.phase = "ended";
    ch.winners = [];
    emitState();
    return;
  }

  const counts = tallyVotes(ch.votes || {}, photos.length);
  const max = Math.max(...counts);

  const winners = counts
    .map((c, i) => ({ i, c }))
    .filter((x) => x.c === max)
    .map((x) => photos[x.i]?.ownerTeamName)
    .filter(Boolean);

  for (const name of winners) awardPoint(name, 1);

  ch.phase = "ended";
  ch.phaseStartAt = nowMs();
  ch.winners = winners;

  emitState();
}

// ---------- NISSEGÅDEN / BILLEDEQUIZ ----------
function startNisseGaaden(card) {
  const ch = {
    ...card,
    type: "NisseGåden",
    used: true,
    phase: "answering",
    phaseStartAt: nowMs(),
    phaseDurationSec: null,
    answers: [],
  };
  setChallenge(ch);
}

function startBilledeQuiz(card) {
  const ch = {
    ...card,
    type: "BilledeQuiz",
    used: true,
    phase: "showing",
    phaseStartAt: nowMs(),
    phaseDurationSec: null,
  };
  setChallenge(ch);
}

// -----------------------------------------------------
// Game start/reset/end
// -----------------------------------------------------
function startGame() {
  state.gameCode = String(Math.floor(1000 + Math.random() * 9000));
  state.teams = [];
  state.currentChallenge = null;
  state.startedAt = nowMs();
  clearPhaseTimer();
  emitState();
}

function resetGame() {
  state.teams = [];
  state.currentChallenge = null;

  if (Array.isArray(state.deck)) {
    state.deck.forEach((c) => (c.used = false));
  }

  clearPhaseTimer();
  io.emit("gp-stop-audio-now");
  emitState();
}

function endGameAndAnnounceWinner() {
  if (!state.teams.length) return;

  const sorted = [...state.teams].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const topScore = sorted[0]?.points ?? 0;
  const winners = sorted.filter((t) => (t.points ?? 0) === topScore);

  const message =
    winners.length === 1
      ? `Vinderen er: ${winners[0].name} med ${topScore} point! 🎉`
      : `Uafgjort: ${winners.map((x) => x.name).join(", ")} – ${topScore} point.`;

  io.emit("show-winner", {
    winners: winners.map((w) => w.name),
    topScore,
    message,
  });

  emitState();
}

// -----------------------------------------------------
// SOCKET.IO
// -----------------------------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  emitStateTo(socket);

  // TEAMS: joinGame
  socket.on("joinGame", ({ code, teamName }, cb) => {
    try {
      const trimmedName = (teamName || "").trim();
      if (!trimmedName) return cb && cb({ ok: false, message: "Tomt teamnavn." });

      if (!state.gameCode || String(code) !== String(state.gameCode)) {
        return cb && cb({ ok: false, message: "Forkert kode." });
      }

      let team = state.teams.find((t) => (t.name || "").toLowerCase() === trimmedName.toLowerCase());

      if (!team) {
        team = { id: safeId(), name: trimmedName, points: 0 };
        state.teams.push(team);
        emitState();
      }

      socket.data.teamName = team.name;
      cb && cb({ ok: true, team });
    } catch (err) {
      console.error("joinGame error:", err);
      cb && cb({ ok: false, message: "Server-fejl ved join." });
    }
  });

  // ADMIN: intents
  socket.on("admin:startGame", startGame);
  socket.on("admin:resetGame", resetGame);

  socket.on("admin:selectChallenge", (card) => {
    if (!card || !card.type) return;

    const normalizedType = normalizeChallengeType(card.type);
    const fixedCard = { ...card, type: normalizedType };

    // mark used in server deck if possible
    if (fixedCard.id && Array.isArray(state.deck)) {
      const found = state.deck.find((c) => c.id === fixedCard.id);
      if (found) found.used = true;
    }

    // stop GP audio when switching challenges
    io.emit("gp-stop-audio-now");

    if (normalizedType === "Nisse Grandprix") return startGrandprix(fixedCard);
    if (normalizedType === "JuleKortet") return startJuleKortet(fixedCard);
    if (normalizedType === "KreaNissen") return startKreaNissen(fixedCard);
    if (normalizedType === "NisseGåden") return startNisseGaaden(fixedCard);
    if (normalizedType === "BilledeQuiz") return startBilledeQuiz(fixedCard);

    setChallenge({
      ...fixedCard,
      used: true,
      phase: "active",
      phaseStartAt: nowMs(),
      phaseDurationSec: null,
    });
  });

  // ADMIN: decision (YES can be multi-select for non-voting, but Grandprix is single-select)
  socket.on("admin:decision", ({ decision, selectedTeamId, selectedTeamIds } = {}) => {
    const ch = state.currentChallenge;
    if (!ch) return;

    const pickTeamById = (id) => state.teams.find((t) => t.id === id) || null;

    // Always stop GP audio on decisions (safe, consistent)
    io.emit("gp-stop-audio-now");

    if (decision === "yes") {
      // Grandprix must remain SINGLE winner selection
      if (ch.type === "Nisse Grandprix") {
        const t = pickTeamById(selectedTeamId);
        if (t) awardPoint(t.name, 1);
        clearCurrentChallenge();
        return;
      }

      // Non-voting challenges: allow MULTIPLE winners
      const ids = Array.isArray(selectedTeamIds)
        ? selectedTeamIds
        : (selectedTeamId ? [selectedTeamId] : []);

      const winnerNames = [];
      for (const id of ids) {
        const t = pickTeamById(id);
        if (t) {
          awardPoint(t.name, 1);
          winnerNames.push(t.name);
        }
      }

      // PATCH: keep the challenge alive briefly so teams can show the correct answer
      // Only applies to your non-voting types (NisseGåden / BilledeQuiz). Others keep existing behavior.
      if (isNonVotingChallengeType(ch.type)) {
        endChallengeWithHold(3000, { winners: winnerNames });
        return;
      }

      // For anything else non-GP (if you add future types), default to clear immediately
      clearCurrentChallenge();
      return;
    }

    if (decision === "no") {
      // Grandprix: if we are judging a buzz (locked/awaiting), resume listening and mark that team tried
      if (ch.type === "Nisse Grandprix" && (ch.phase === "locked" || ch.phase === "awaiting")) {
        resumeGrandprixListeningAfterNo();
        return;
      }
      clearCurrentChallenge();
      return;
    }

    if (decision === "incomplete") {
      // Optional: you can hold here too, but keeping your existing behavior (immediate clear).
      clearCurrentChallenge();
    }
  });

  socket.on("admin:closeVoting", () => {
    const ch = state.currentChallenge;
    if (!ch) return;
    if (ch.type === "JuleKortet") return finishJuleKortetAndAward();
    if (ch.type === "KreaNissen") return finishKreaAndAward();
  });

  socket.on("admin:endGame", endGameAndAnnounceWinner);

  // LEGACY: updateState (kept)
  socket.on("updateState", (newState) => {
    if (!newState) return;

    const oldIndex = indexTeamsByKey(state.teams);
    const newTeams = Array.isArray(newState.teams) ? newState.teams : state.teams;

    for (const t of newTeams) {
      const key = normalizeKey(t);
      if (!key) continue;

      const old = oldIndex.get(key);
      const oldPts = old?.points ?? 0;
      const newPts = t.points ?? 0;
      const delta = newPts - oldPts;

      if (delta !== 0) io.emit("points-toast", { teamName: t.name, delta });
    }

    state = { ...state, ...newState, teams: newTeams };
    emitState();
  });

  // Legacy winner event
  socket.on("show-winner", (payload) => io.emit("show-winner", payload));

  // Voice message
  socket.on("send-voice", (payload) => {
    if (!payload || !payload.filename) return;
    io.emit("send-voice", payload);
  });

  // GRANDPRIX: buzz (authoritative)
  socket.on("buzz", () => {
    const teamName = socket.data.teamName;
    if (!teamName) return;

    io.emit("buzzed", teamName); // legacy visibility
    lockGrandprix(teamName);
  });

  // GRANDPRIX: typed answer
  socket.on("gp-typed-answer", (payload) => {
    io.emit("gp-typed-answer", payload);

    const ch = state.currentChallenge;
    if (!ch || ch.type !== "Nisse Grandprix") return;
    if (ch.phase !== "locked") return;

    const teamName = payload?.teamName;
    const text = payload?.text;
    if (!teamName || !text) return;

    ch.typedAnswer = { teamName, text };

    // IMPORTANT FIX: stop the lock timeout and wait for admin YES/NO
    setGrandprixAwaitingDecision();
  });

  // submitCard (NisseGåden / JuleKortet)
  socket.on("submitCard", (payload) => {
    let teamName = null;
    let text = "";

    if (typeof payload === "string") {
      text = payload;
      teamName = socket.data.teamName || null;
    } else if (payload && typeof payload === "object") {
      text = payload.text ?? "";
      teamName = payload.teamName || socket.data.teamName || null;
    }

    io.emit("newCard", { teamName, text });

    const ch = state.currentChallenge;
    if (!ch) return;

    if (ch.type === "NisseGåden") {
      ch.answers = ch.answers || [];
      ch.answers.push({ teamName, text });
      emitState();
      return;
    }

    if (ch.type === "JuleKortet" && ch.phase === "writing") {
      ch.cards = ch.cards || [];
      const already = ch.cards.some((c) => (c.teamName || c.team) === teamName);
      if (!already) ch.cards.push({ teamName, text });

      emitState();

      if (state.teams.length > 0 && ch.cards.length >= state.teams.length) {
        startJuleKortetVoting();
      }
    }
  });

  // submitPhoto (KreaNissen)
  socket.on("submitPhoto", ({ teamName, filename }) => {
    if (!filename) return;
    const realTeamName = teamName || socket.data.teamName || "Ukendt hold";

    io.emit("newPhoto", { teamName: realTeamName, filename });

    const ch = state.currentChallenge;
    if (!ch) return;

    if (ch.type === "KreaNissen" && ch.phase === "creating") {
      ch.photos = ch.photos || [];
      const already = ch.photos.some((p) => (p.teamName || p.team) === realTeamName);
      if (!already) ch.photos.push({ teamName: realTeamName, filename });

      emitState();

      if (state.teams.length > 0 && ch.photos.length >= state.teams.length) {
        startKreaVoting();
      }
    }
  });

  socket.on("newPhoto", (payload) => io.emit("newPhoto", payload));

  // Voting
  socket.on("vote", (index) => {
    const voter = socket.data.teamName || "Ukendt hold";
    io.emit("voteUpdate", { voter, index });

    const ch = state.currentChallenge;
    if (!ch) return;

    if ((ch.type === "JuleKortet" || ch.type === "KreaNissen") && ch.phase === "voting") {
      ch.votes = ch.votes || {};
      ch.votes[voter] = index;
      emitState();
    }
  });

  socket.on("voteUpdate", (payload) => io.emit("voteUpdate", payload));

  // Stop audio everywhere (manual)
  socket.on("gp-stop-audio-now", () => {
    io.emit("gp-stop-audio-now");
    endGrandprixRound();
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// -----------------------------------------------------
// START SERVER
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Xmas Challenge server listening on port", PORT);
});
