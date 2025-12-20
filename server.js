// server.js
// Xmas Challenge – server authoritative timers + phases (Option 1)
// Enhancement:
// - When points are awarded, optionally include "reason" and/or "answer" in points-toast,
//   so team screens can show the correct answer after awarding.
// - Keeps all existing logic intact.

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

/**
 * Award points with optional metadata so team screens can show:
 * - reason (e.g. "Vandt afstemningen")
 * - answer (facit)
 * - challengeType/title (for context)
 */
function awardPoint(teamName, delta = 1, meta = {}) {
  const team = state.teams.find((t) => (t.name || "") === teamName);
  if (!team) return;

  const before = team.points ?? 0;
  team.points = Math.max(0, before + delta);
  const actualDelta = (team.points ?? 0) - before;

  if (actualDelta !== 0) {
    io.emit("points-toast", {
      teamName: team.name,
      delta: actualDelta,

      // Optional extra info:
      reason: meta?.reason || "",
      answer: meta?.answer || "",
      challengeType: meta?.challengeType || "",
      challengeTitle: meta?.challengeTitle || "",
    });
  }
}

// Normalize card.type to avoid "Julekortet" vs "JuleKortet" bugs
function normalizeChallengeType(type) {
  const raw = String(type || "").trim().toLowerCase();
  const compact = raw.replace(/[\s\-_]/g, "");

  if (compact === "nissegrandprix") return "Nisse Grandprix";
  if (compact === "nissegåden" || compact === "nissegaaden") return "NisseGåden";
  if (compact === "julekortet") return "JuleKortet";
  if (compact === "kreanissen") return "KreaNissen";
  if (compact === "billedequiz") return "BilledeQuiz";

  return type;
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

// ---------- GRANDPRIX ----------
function startGrandprix(card) {
  const startAt = nowMs() + 300;

  const ch = {
    ...card,
    type: "Nisse Grandprix",
    used: true,
    phase: "listening",
    phaseStartAt: startAt,
    phaseDurationSec: null,
    startAt,
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

  const answered = ch.answeredTeams || {};
  if (answered[teamName]) return;

  ch.phase = "locked";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = 30; // NOTE: change to 30 here if you want 30 seconds
  ch.firstBuzz = { teamName };
  ch.typedAnswer = null;

  emitState();

  schedulePhaseEnd(30 * 1000, () => { // NOTE: change to 30 * 1000 if you want 30 seconds
    const c = state.currentChallenge;
    if (!c || c.type !== "Nisse Grandprix") return;

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

  clearPhaseTimer();

  ch.phase = "awaiting";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = null;

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

  // Provide context toast (no "answer" here, but a reason)
  for (const name of winners) {
    awardPoint(name, 1, {
      reason: "Vandt afstemningen (JuleKortet)",
      challengeType: ch.type,
      challengeTitle: ch.title || "",
    });
  }

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

  for (const name of winners) {
    awardPoint(name, 1, {
      reason: "Vandt afstemningen (KreaNissen)",
      challengeType: ch.type,
      challengeTitle: ch.title || "",
    });
  }

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

    if (fixedCard.id && Array.isArray(state.deck)) {
      const found = state.deck.find((c) => c.id === fixedCard.id);
      if (found) found.used = true;
    }

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

  socket.on("admin:decision", ({ decision, selectedTeamId } = {}) => {
    const ch = state.currentChallenge;
    if (!ch) return;

    const pickTeamById = () => state.teams.find((t) => t.id === selectedTeamId) || null;

    io.emit("gp-stop-audio-now");

    if (decision === "yes") {
      const t = pickTeamById();
      if (t) {
        // Try to provide a facit/answer for team screens
        const answer =
          (typeof ch.answer === "string" && ch.answer.trim())
            ? ch.answer.trim()
            : "";

        awardPoint(t.name, 1, {
          reason: "Korrekt!",
          answer,
          challengeType: ch.type || "",
          challengeTitle: ch.title || "",
        });
      }
      clearCurrentChallenge();
      return;
    }

    if (decision === "no") {
      if (ch.type === "Nisse Grandprix" && (ch.phase === "locked" || ch.phase === "awaiting")) {
        resumeGrandprixListeningAfterNo();
        return;
      }
      clearCurrentChallenge();
      return;
    }

    if (decision === "incomplete") {
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

  socket.on("show-winner", (payload) => io.emit("show-winner", payload));

  socket.on("send-voice", (payload) => {
    if (!payload || !payload.filename) return;
    io.emit("send-voice", payload);
  });

  // GRANDPRIX: buzz
  socket.on("buzz", () => {
    const teamName = socket.data.teamName;
    if (!teamName) return;

    io.emit("buzzed", teamName);
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

