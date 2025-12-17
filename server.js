// server.js
// Xmas Challenge – main + team + minigames + point toasts + winner + voice messages

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
    return res
      .status(400)
      .json({ ok: false, message: "Ingen lydfil modtaget." });
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
};

// Helper to compare old/new team points
function indexTeamsByKey(teams) {
  const map = new Map();
  for (const t of teams || []) {
    const key = (t.id || t.name || "").toLowerCase();
    if (key) map.set(key, t);
  }
  return map;
}

// -----------------------------------------------------
// STATE EMIT HELPERS (adds server time to prevent clock-skew bugs)
// -----------------------------------------------------
function snapshotState() {
  // Important: do NOT mutate state; just add a derived field
  return { ...state, serverNow: Date.now() };
}

function emitStateToAll() {
  io.emit("state", snapshotState());
}

function emitStateToSocket(socket) {
  socket.emit("state", snapshotState());
}

// -----------------------------------------------------
// SOCKET.IO
// -----------------------------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state to new client (main or team) + serverNow
  emitStateToSocket(socket);

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
        team = {
          id: "t" + Date.now() + Math.random(),
          name: trimmedName,
          points: 0,
        };
        state.teams.push(team);

        // Broadcast updated state + serverNow
        emitStateToAll();
      }

      socket.data.teamName = team.name;
      cb && cb({ ok: true, team });
    } catch (err) {
      console.error("joinGame error:", err);
      cb && cb({ ok: false, message: "Server-fejl ved join." });
    }
  });

  // ---------------------------------------------
  // MAIN: updateState (admin sends full game state)
  // ---------------------------------------------
  socket.on("updateState", (newState) => {
    if (!newState) return;

    // 1) Compute point changes for toasts
    const oldIndex = indexTeamsByKey(state.teams);
    const newTeams = Array.isArray(newState.teams) ? newState.teams : state.teams;

    for (const t of newTeams) {
      const key = (t.id || t.name || "").toLowerCase();
      if (!key) continue;

      const old = oldIndex.get(key);
      const oldPts = old?.points ?? 0;
      const newPts = t.points ?? 0;
      const delta = newPts - oldPts;

      if (delta !== 0) {
        io.emit("points-toast", { teamName: t.name, delta });
      }
    }

    // 2) Replace state with new one
    state = {
      ...state,
      ...newState,
      teams: newTeams,
    };

    // 3) Broadcast new full state + serverNow
    emitStateToAll();
  });

  // ---------------------------------------------
  // Winner screen (admin -> all clients)
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
  // GRANDPRIX: buzz (team -> main)
  // ---------------------------------------------
  socket.on("buzz", () => {
    const teamName = socket.data.teamName;
    if (!teamName) return;
    io.emit("buzzed", teamName);
  });

  // ---------------------------------------------
  // GRANDPRIX: typed answer (team -> main)
  // ---------------------------------------------
  socket.on("gp-typed-answer", (payload) => {
    io.emit("gp-typed-answer", payload);
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

    io.emit("newCard", { teamName, text });
  });

  // ---------------------------------------------
  // KREANISSEN: new uploaded photo
  // ---------------------------------------------
  socket.on("submitPhoto", ({ teamName, filename }) => {
    if (!filename) return;
    const realTeamName = teamName || socket.data.teamName || "Ukendt hold";
    io.emit("newPhoto", { teamName: realTeamName, filename });
  });

  // Backwards compatibility
  socket.on("newPhoto", (payload) => io.emit("newPhoto", payload));

  // ---------------------------------------------
  // Voting
  // ---------------------------------------------
  socket.on("vote", (index) => {
    const voter = socket.data.teamName || "Ukendt hold";
    io.emit("voteUpdate", { voter, index });
  });

  // Backwards compatibility
  socket.on("voteUpdate", (payload) => io.emit("voteUpdate", payload));

  // ---------------------------------------------
  // Grandprix: stop audio everywhere
  // ---------------------------------------------
  socket.on("gp-stop-audio-now", () => {
    io.emit("gp-stop-audio-now");
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
