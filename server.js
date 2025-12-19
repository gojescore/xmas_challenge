// server.js
// Xmas Challenge – server authoritative timers + phases (Option 1)
// Keeps existing uploads + legacy events, but adds admin intent events.
// Also injects serverNow into every "state" emit so clients can render consistent countdowns.

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

// Ensure upload folders exist
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
  if (!req.file) {
    return res.status(400).json({ ok: false, message: "Ingen fil modtaget." });
  }
  res.json({ ok: true, filename: req.file.filename });
});

// -----------------------------------------------------
// FILE UPLOAD (Voice messages)
// -----------------------------------------------------
const uploadAudio = multer({ dest: AUDIO_DIR });

app.post("/upload-audio", uploadAudio.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: "Ingen lydfil modtaget." });
  }
  res.json({ ok: true, filename: req.file.filename });
});

// -----------------------------------------------------
// GAME STATE (kept in memory on the server)
// -----------------------------------------------------
let state = {
  teams: [],
  deck: [],
  currentChallenge: null,
  gameCode: null,

  // Optional: track if "game is started"
  startedAt: null,
};

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------
function nowMs() {
  return Date.now();
}

function emitState() {
  // Do NOT store serverNow in state; attach to emitted payload only.
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

// -----------------------------------------------------
// Server-authoritative timers (one at a time is enough)
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
// Challenge transitions (authoritative)
// -----------------------------------------------------
function setChallenge(ch) {
  state.currentChallenge = ch || null;
  clearPhaseTimer();
  emitState();
}

function startGrandprix(card) {
  // listening phase (not timed by default, but we keep a stable phaseStartAt)
  const ch = {
    ...card,
    used: true,
    phase: "listening",
    phaseStartAt: nowMs(),
    phaseDurationSec: null, // not timed unless you want
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

  // If team already tried this round, ignore buzz
  const answered = ch.answeredTeams || {};
  if (answered[teamName]) return;

  ch.phase = "locked";
  ch.phaseStartAt = nowMs();
  ch.phaseDurationSec = 20;
  ch.firstBuzz = { teamName };
  ch.typedAnswer = null;

  emitState();

  // After 20 sec: treat as "timeout = wrong attempt" and return to listening
  schedulePhaseEnd(20 * 1000, () => {
    const c = state.currentChallenge;
    if (!c || c.type !== "Nisse Grandprix") return;
    if (c.phase !== "locked") return;

    const buzzingTeam = c.firstBuzz?.teamName;
    c.answeredTeams = c.answeredTeams || {};
    if (buzzingTeam) c.answeredTeams[buzzingTeam] = true;

    c.phase = "listening";
    c.phaseStartAt = nowMs();
    c.phaseDurationSec = null;
    c.firstBuzz = null;
    c.typedAnswer = null;

    emitState();
  });
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

  // Stop audio everywhere when round ends
  io.emit("gp-stop-audio-now");
}

function startJuleKortet(card) {
  const ch = {
    ...card,
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
    // If still writing, move to voting
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
  ch.phaseDurationSec = null; // keep voting manual close (stable)
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

  const winningIndexes = counts
    .map((c, i) => ({ i, c }))
    .filter((x) => x.c === max)
    .map((x) => x.i);

  const winners = winningIndexes
    .map((i) => cards[i]?.ownerTeamName)
    .filter(Boolean);

  // Award +1 per winner
  for (const name of winners) awardPoint(name, 1);

  ch.phase = "ended";
  ch.phaseStartAt = nowMs();
  ch.winners = winners;

  emitState();
}

function startKreaNissen(card) {
  const ch = {
    ...card,
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
  ch.phaseDurationSec = null; // manual close
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

  const winningIndexes = counts
    .map((c, i) => ({ i, c }))
    .filter((x) => x.c === max)
    .map((x) => x.i);

  const winners = winningIndexes
    .map((i) => photos[i]?.ownerTeamName)
    .filter(Boolean);

  for (const name of winners) awardPoint(name, 1);

  ch.phase = "ended";
  ch.phaseStartAt = nowMs();
  ch.winners = winners;

  emitState();
}

function startNisseGaaden(card) {
  const ch = {
    ...card,
    used: true,
    // Untimed by default
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
    used: true,
    phase: "showing",
    phaseStartAt: nowMs(),
    phaseDurationSec: null,
  };
  setChallenge(ch);
}

function clearCurrentChallenge() {
  setChallenge(null);
}

// -----------------------------------------------------
// Game start/reset/end (authoritative)
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
  // Keep gameCode as-is? Your old UX regenerates on start. Here we keep it unless you want otherwise.
  // If you want reset to also clear code: state.gameCode = null;
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

  const payload = {
    winners: winners.map((w) => w.name),
    topScore,
    message,
  };

  io.emit("show-winner", payload);
  emitState();
}

// -----------------------------------------------------
// SOCKET.IO
// -----------------------------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state to new client (main or team)
  emitStateTo(socket);

  // ---------------------------------------------
  // TEAMS: joinGame (code + team name)
  // ---------------------------------------------
  socket.on("joinGame", ({ code, teamName }, cb) => {
    try {
      const trimmedName = (teamName || "").trim();
      if (!trimmedName) {
        cb && cb({ ok: false, message: "Tomt teamnavn." });
        return;
      }

      if (!state.gameCode || String(code) !== String(state.gameCode)) {
        cb && cb({ ok: false, message: "Forkert kode." });
        return;
      }

      let team = state.teams.find(
        (t) => (t.name || "").toLowerCase() === trimmedName.toLowerCase()
      );

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

  // ---------------------------------------------
  // ADMIN INTENT EVENTS (Option 1)
  // ---------------------------------------------
  socket.on("admin:startGame", () => {
    startGame();
  });

  socket.on("admin:resetGame", () => {
    resetGame();
  });

  socket.on("admin:selectChallenge", (card) => {
    // card is the selected deck item from admin UI
    if (!card || !card.type) return;

    // Mark used in server deck too if ids match
    if (card.id && Array.isArray(state.deck)) {
      const found = state.deck.find((c) => c.id === card.id);
      if (found) found.used = true;
    }

    // Stop any ongoing GP audio when switching challenges
    io.emit("gp-stop-audio-now");

    if (card.type === "Nisse Grandprix") return startGrandprix(card);
    if (card.type === "JuleKortet") return startJuleKortet(card);
    if (card.type === "KreaNissen") return startKreaNissen(card);
    if (card.type === "NisseGåden") return startNisseGaaden(card);
    if (card.type === "BilledeQuiz") return startBilledeQuiz(card);

    // Default: just set as current challenge, no timers
    setChallenge({ ...card, used: true, phase: "active", phaseStartAt: nowMs(), phaseDurationSec: null });
  });

  // Admin decisions: yes/no/incomplete
  socket.on("admin:decision", ({ decision, selectedTeamId } = {}) => {
    const ch = state.currentChallenge;
    if (!ch) return;

    const pickTeamById = () => state.teams.find((t) => t.id === selectedTeamId) || null;

    // Always stop GP audio on any decision (safe)
    io.emit("gp-stop-audio-now");

    if (decision === "yes") {
      const t = pickTeamById();
      if (t) awardPoint(t.name, 1);
      clearCurrentChallenge();
      return;
    }

    if (decision === "no") {
      // Grandprix special: mark first buzz as "already answered", return to listening
      if (ch.type === "Nisse Grandprix" && ch.phase === "locked" && ch.firstBuzz?.teamName) {
        const buzzingTeam = ch.firstBuzz.teamName;
        ch.answeredTeams = ch.answeredTeams || {};
        ch.answeredTeams[buzzingTeam] = true;

        ch.phase = "listening";
        ch.phaseStartAt = nowMs();
        ch.phaseDurationSec = null;
        ch.firstBuzz = null;
        ch.typedAnswer = null;

        clearPhaseTimer();
        emitState();
        return;
      }

      // Otherwise: cancel challenge
      clearCurrentChallenge();
      return;
    }

    if (decision === "incomplete") {
      clearCurrentChallenge();
      return;
    }
  });

  socket.on("admin:closeVoting", () => {
    const ch = state.currentChallenge;
    if (!ch) return;

    if (ch.type === "JuleKortet") return finishJuleKortetAndAward();
    if (ch.type === "KreaNissen") return finishKreaAndAward();
  });

  socket.on("admin:endGame", () => {
    endGameAndAnnounceWinner();
  });

  // ---------------------------------------------
  // LEGACY: updateState (kept for backward compatibility)
  // IMPORTANT: If you still call updateState from main.js, it can fight the server timers.
  // When you finish migrating main.js, you should stop using updateState.
  // ---------------------------------------------
  socket.on("updateState", (newState) => {
    if (!newState) return;

    // Keep your existing points-toast delta logic (legacy)
    const oldIndex = indexTeamsByKey(state.teams);
    const newTeams = Array.isArray(newState.teams) ? newState.teams : state.teams;

    for (const t of newTeams) {
      const key = normalizeKey(t);
      if (!key) continue;

      const old = oldIndex.get(key);
      const oldPts = old?.points ?? 0;
      const newPts = t.points ?? 0;
      const delta = newPts - oldPts;

      if (delta !== 0) {
        io.emit("points-toast", { teamName: t.name, delta });
      }
    }

    // Replace state with new one
    state = {
      ...state,
      ...newState,
      teams: newTeams,
    };

    emitState();
  });

  // ---------------------------------------------
  // Winner screen (admin -> all clients) (legacy)
  // ---------------------------------------------
  socket.on("show-winner", (payload) => {
    io.emit("show-winner", payload);
  });

  // ---------------------------------------------
  // Voice message (admin -> all clients)
  // ---------------------------------------------
  socket.on("send-voice", (payload) => {
    // payload: { filename, from, createdAt, mimeType }
    if (!payload || !payload.filename) return;
    io.emit("send-voice", payload);
  });

  // ---------------------------------------------
  // GRANDPRIX: buzz (team -> server authoritative)
  // ---------------------------------------------
  socket.on("buzz", () => {
    const teamName = socket.data.teamName;
    if (!teamName) return;

    // Still emit legacy event so admin UI can react if it listens
    io.emit("buzzed", teamName);

    // Authoritative lock
    lockGrandprix(teamName);
  });

  // ---------------------------------------------
  // GRANDPRIX: typed answer (team -> state)
  // ---------------------------------------------
  socket.on("gp-typed-answer", (payload) => {
    io.emit("gp-typed-answer", payload); // legacy visibility

    const ch = state.currentChallenge;
    if (!ch || ch.type !== "Nisse Grandprix") return;
    if (ch.phase !== "locked") return;

    const teamName = payload?.teamName;
    const text = payload?.text;

    if (!teamName || !text) return;

    ch.typedAnswer = { teamName, text };
    emitState();
  });

  // ---------------------------------------------
  // NISSEGÅDEN / JULEKORTET: submit text card
  // ---------------------------------------------
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

    io.emit("newCard", { teamName, text }); // legacy

    const ch = state.currentChallenge;
    if (!ch) return;

    // NisseGåden answers
    if (ch.type === "NisseGåden") {
      ch.answers = ch.answers || [];
      ch.answers.push({ teamName, text });
      emitState();
      return;
    }

    // JuleKortet writing submissions
    if (ch.type === "JuleKortet" && ch.phase === "writing") {
      ch.cards = ch.cards || [];
      const already = ch.cards.some((c) => (c.teamName || c.team) === teamName);
      if (!already) ch.cards.push({ teamName, text });

      emitState();

      // Early close writing if all submitted
      if (state.teams.length > 0 && ch.cards.length >= state.teams.length) {
        startJuleKortetVoting();
      }
    }
  });

  // ---------------------------------------------
  // KREANISSEN: new uploaded photo
  // ---------------------------------------------
  socket.on("submitPhoto", ({ teamName, filename }) => {
    if (!filename) return;
    const realTeamName = teamName || socket.data.teamName || "Ukendt hold";

    io.emit("newPhoto", { teamName: realTeamName, filename }); // legacy

    const ch = state.currentChallenge;
    if (!ch) return;

    if (ch.type === "KreaNissen" && ch.phase === "creating") {
      ch.photos = ch.photos || [];
      const already = ch.photos.some((p) => (p.teamName || p.team) === realTeamName);
      if (!already) ch.photos.push({ teamName: realTeamName, filename });

      emitState();

      // Early close creating if all submitted
      if (state.teams.length > 0 && ch.photos.length >= state.teams.length) {
        startKreaVoting();
      }
    }
  });

  // Backwards compatibility
  socket.on("newPhoto", (payload) => io.emit("newPhoto", payload));

  // ---------------------------------------------
  // Voting (team -> server authoritative)
  // ---------------------------------------------
  socket.on("vote", (index) => {
    const voter = socket.data.teamName || "Ukendt hold";
    io.emit("voteUpdate", { voter, index }); // legacy

    const ch = state.currentChallenge;
    if (!ch) return;

    if ((ch.type === "JuleKortet" || ch.type === "KreaNissen") && ch.phase === "voting") {
      ch.votes = ch.votes || {};
      ch.votes[voter] = index;
      emitState();
    }
  });

  // Backwards compatibility
  socket.on("voteUpdate", (payload) => io.emit("voteUpdate", payload));

  // ---------------------------------------------
  // Grandprix: stop audio everywhere
  // ---------------------------------------------
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
