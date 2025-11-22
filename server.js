const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const multer = require("multer");
const fs = require("fs");

// -----------------------------
// STATIC / UPLOADS
// -----------------------------
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const upload = multer({ dest: "./uploads/" });

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ filename: req.file.filename });
});

// -----------------------------
// HELPERS
// -----------------------------
function makeGameCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function emitState() {
  io.emit("state", state);
}

function findTeamById(id) {
  return state.teams.find(t => t.id === id);
}

function findTeamByName(name) {
  return state.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
}

function findDeckItemById(id) {
  return state.challengeDeck.find(c => c.id === id);
}

function markDeckUsed(id) {
  const item = findDeckItemById(id);
  if (item) item.used = true;
}

function startGrandprixFromDeck(item) {
  const delay = 2000;
  const now = Date.now();

  state.currentChallenge = {
    id: item.id,
    type: "Nisse Grandprix",
    phase: "listening",
    audioUrl: item.audioUrl,
    startAt: now + delay,
    resumeAt: null,
    audioPosition: 0,
    firstBuzz: null,
    lockedOut: [],
    countdownStartAt: null,
    countdownSeconds: 5,
  };

  state.currentChallengeId = item.id;
}

// -----------------------------
// GAME STATE
// -----------------------------
let state = {
  gameCode: null,
  teams: [],
  leaderboard: [],
  challengeDeck: [],
  currentChallenge: null,
  currentChallengeId: null,
};

let nextTeamId = 1;

// Track admin sockets for WebRTC signaling
const adminSockets = new Set();

// -----------------------------
// SOCKET.IO
// -----------------------------
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  socket.emit("state", state);

  // Admin registers
  socket.on("registerAdmin", () => {
    adminSockets.add(socket.id);
    socket.role = "admin";
  });

  // ADMIN: start new game
  socket.on("startGame", () => {
    state.gameCode = makeGameCode();
    state.teams = [];
    nextTeamId = 1;
    state.currentChallenge = null;
    state.currentChallengeId = null;

    // reset used flags
    state.challengeDeck = state.challengeDeck.map(c => ({ ...c, used: false }));

    console.log("Game started. Code:", state.gameCode);
    emitState();
  });

  // TEAM: join game
  socket.on("joinGame", ({ code, teamName }, ack) => {
    try {
      const cleanCode = (code || "").trim();
      const cleanName = (teamName || "").trim();

      if (!state.gameCode) {
        return ack?.({ ok: false, message: "Spillet er ikke startet endnu." });
      }
      if (cleanCode !== state.gameCode) {
        return ack?.({ ok: false, message: "Forkert game code." });
      }
      if (!cleanName) {
        return ack?.({ ok: false, message: "Teamnavn mangler." });
      }
      if (findTeamByName(cleanName)) {
        return ack?.({ ok: false, message: "Teamnavnet er allerede taget." });
      }

      const newTeam = {
        id: nextTeamId++,
        name: cleanName,
        points: 0,
      };

      state.teams.push(newTeam);
      socket.teamId = newTeam.id;
      socket.teamName = newTeam.name;

      console.log("Team joined:", newTeam.name);
      emitState();

      return ack?.({ ok: true, team: newTeam });
    } catch (err) {
      console.error("joinGame error", err);
      return ack?.({ ok: false, message: "Serverfejl ved join." });
    }
  });

  // ADMIN: set full deck
  socket.on("setDeck", (deck) => {
    if (!Array.isArray(deck)) return;
    state.challengeDeck = deck;
    emitState();
  });

  // ADMIN: start a deck challenge
  socket.on("startChallenge", (challengeId) => {
    const id = Number(challengeId);
    const item = findDeckItemById(id);
    if (!item || item.used) return;

    if (item.type === "Nisse Grandprix") {
      if (!item.audioUrl) return;
      startGrandprixFromDeck(item);
      emitState();
      return;
    }

    state.currentChallenge = {
      id: item.id,
      type: item.type,
      title: item.title || item.type,
      text: item.text || "",
      imageUrl: item.imageUrl || null,
    };
    state.currentChallengeId = item.id;

    emitState();
  });

  // TEAM: buzz (only for Grandprix listening)
  socket.on("buzz", ({ audioPosition } = {}) => {
    const teamId = socket.teamId;
    const teamName = socket.teamName;
    if (!teamId || !teamName) return;

    const ch = state.currentChallenge;
    if (!ch || typeof ch !== "object") return;
    if (ch.type !== "Nisse Grandprix") return;
    if (ch.phase !== "listening") return;

    if (ch.lockedOut.includes(teamId)) return;
    if (ch.firstBuzz) return;

    if (typeof audioPosition === "number" && !Number.isNaN(audioPosition)) {
      ch.audioPosition = audioPosition;
    }

    ch.firstBuzz = { teamId, teamName, at: Date.now() };
    ch.phase = "locked";

    // ⭐ start global 5-second countdown
    ch.countdownStartAt = Date.now() + 200;
    ch.countdownSeconds = 5;

    io.emit("buzzed", teamName);
    emitState();
  });

  // ADMIN: Grandprix YES
  socket.on("grandprixYes", () => {
    const ch = state.currentChallenge;
    if (!ch || typeof ch !== "object") return;
    if (ch.type !== "Nisse Grandprix") return;

    if (ch.firstBuzz?.teamId) {
      const t = findTeamById(ch.firstBuzz.teamId);
      if (t) t.points += 1;
    }

    ch.phase = "ended";
    if (state.currentChallengeId != null) {
      markDeckUsed(state.currentChallengeId);
    }

    emitState();
  });

  // ADMIN: Grandprix NO (resume, lock out buzzing team)
  socket.on("grandprixNo", () => {
    const ch = state.currentChallenge;
    if (!ch || typeof ch !== "object") return;
    if (ch.type !== "Nisse Grandprix") return;

    if (ch.firstBuzz?.teamId) {
      ch.lockedOut.push(ch.firstBuzz.teamId);
    }

    ch.firstBuzz = null;
    ch.phase = "listening";
    ch.resumeAt = Date.now() + 1000;

    emitState();
  });

  // ADMIN: Grandprix INCOMPLETE
  socket.on("grandprixIncomplete", () => {
    const ch = state.currentChallenge;
    if (!ch || typeof ch !== "object") return;
    if (ch.type !== "Nisse Grandprix") return;

    ch.phase = "ended";
    if (state.currentChallengeId != null) {
      markDeckUsed(state.currentChallengeId);
    }

    emitState();
  });

  // ------- WebRTC signaling (mic team -> admin only) -------
  socket.on("gp-webrtc-offer", (payload) => {
    for (const id of adminSockets) {
      io.to(id).emit("gp-webrtc-offer", {
        fromTeamId: socket.teamId,
        fromTeamName: socket.teamName,
        offer: payload.offer,
      });
    }
  });

  socket.on("gp-webrtc-answer", ({ toTeamId, answer }) => {
    for (const [id, s] of io.of("/").sockets) {
      if (s.teamId === toTeamId) {
        io.to(id).emit("gp-webrtc-answer", { answer });
        break;
      }
    }
  });

  socket.on("gp-webrtc-ice", ({ toTeamId, candidate }) => {
    if (socket.role === "admin") {
      for (const [id, s] of io.of("/").sockets) {
        if (s.teamId === toTeamId) {
          io.to(id).emit("gp-webrtc-ice", { candidate });
          break;
        }
      }
    } else {
      for (const id of adminSockets) {
        io.to(id).emit("gp-webrtc-ice", {
          fromTeamId: socket.teamId,
          candidate
        });
      }
    }
  });

  socket.on("disconnect", () => {
    adminSockets.delete(socket.id);
    console.log("Client disconnected:", socket.id);
  });
});

// Root
app.get("/", (req, res) => {
  res.send("Xmas Challenge Server Running");
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
