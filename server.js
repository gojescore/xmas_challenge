const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// Create uploads folder if missing
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// -------------------------
// GLOBAL GAME SESSION STATE
// -------------------------
let gameCode = null;         // e.g. "4712"
let gameActive = false;      // true after startGame

let state = {
  teams: [],                 // [{ id, name, points }]
  leaderboard: [],           // not used yet, but kept for compatibility
  currentChallenge: null,    // string or object
};

// For stable IDs
let nextTeamId = 1;

// Helper: generate a 4-digit code
function generateGameCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Helper: normalize names for uniqueness comparison
function normalizeName(name) {
  return name.trim().toLowerCase();
}

// Multer for image uploads
const upload = multer({
  dest: "./uploads/",
});

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ filename: req.file.filename });
});

// SOCKET.IO
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Send current state + code to anyone who connects
  socket.emit("state", { ...state, gameCode, gameActive });

  // -------------------------
  // ADMIN: START GLOBAL GAME
  // -------------------------
  // Admin calls socket.emit("startGame", cb)
  socket.on("startGame", (cb) => {
    gameCode = generateGameCode();
    gameActive = true;

    // Reset game state for a fresh session
    state = {
      teams: [],
      leaderboard: [],
      currentChallenge: null,
    };
    nextTeamId = 1;

    console.log("Game started. Code:", gameCode);

    // Broadcast fresh state to everyone
    io.emit("state", { ...state, gameCode, gameActive });

    if (typeof cb === "function") {
      cb({ ok: true, gameCode });
    }
  });

  // -------------------------
  // TEAMS: JOIN WITH CODE + UNIQUE NAME
  // -------------------------
  // Team calls socket.emit("joinGame", { code, teamName }, cb)
  socket.on("joinGame", (payload, cb) => {
    const code = payload?.code?.toString().trim();
    const teamName = payload?.teamName?.toString().trim();

    if (!gameActive || !gameCode) {
      if (typeof cb === "function") {
        cb({ ok: false, message: "No active game right now." });
      }
      return;
    }

    if (!code || code !== gameCode) {
      if (typeof cb === "function") {
        cb({ ok: false, message: "Wrong game code." });
      }
      return;
    }

    if (!teamName) {
      if (typeof cb === "function") {
        cb({ ok: false, message: "Team name is required." });
      }
      return;
    }

    const normalized = normalizeName(teamName);
    const nameTaken = state.teams.some(
      (t) => normalizeName(t.name) === normalized
    );

    if (nameTaken) {
      if (typeof cb === "function") {
        cb({ ok: false, message: "Name already taken. Choose another." });
      }
      return;
    }

    // Add team to global game
    const newTeam = {
      id: nextTeamId++,
      name: teamName,
      points: 0,
    };
    state.teams.push(newTeam);

    // Store on socket for later events (buzz, submitCard, etc.)
    socket.teamId = newTeam.id;
    socket.teamName = newTeam.name;

    console.log("Team joined:", newTeam.name);

    // Broadcast updated state to everyone
    io.emit("state", { ...state, gameCode, gameActive });

    if (typeof cb === "function") {
      cb({ ok: true, team: newTeam });
    }
  });

  // -------------------------
  // BACKWARD COMPAT: old joinTeam
  // (optional - keeps old clients from breaking)
  // -------------------------
  socket.on("joinTeam", (teamName) => {
    socket.teamName = teamName;
  });

  // -------------------------
  // BUZZ
  // -------------------------
  socket.on("buzz", () => {
    if (!socket.teamName) return;
    io.emit("buzzed", socket.teamName);
  });

  // -------------------------
  // SUBMISSIONS / VOTES (kept)
  // -------------------------
  socket.on("submitCard", (text) => {
    if (!socket.teamName) return;
    io.emit("newCard", { team: socket.teamName, text });
  });

  socket.on("submitPhoto", (file) => {
    if (!socket.teamName) return;
    io.emit("newPhoto", { team: socket.teamName, file });
  });

  socket.on("vote", (index) => {
    if (!socket.teamName) return;
    io.emit("voteUpdate", { voter: socket.teamName, index });
  });

  // -------------------------
  // ADMIN: UPDATE GLOBAL STATE
  // -------------------------
  socket.on("updateState", (newState) => {
    // Only allow updates if a game is active
    if (!gameActive) return;

    // Merge carefully so we don't lose teams list
    state = {
      ...state,
      ...newState,
      teams: state.teams, // teams are server-owned now
    };

    io.emit("state", { ...state, gameCode, gameActive });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("Xmas Challenge Server Running");
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});



