const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// ------------------------------
// Static hosting
// ------------------------------
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Xmas Challenge Server Running");
});

// ------------------------------
// In-memory state (single active game)
// ------------------------------
let state = {
  gameCode: null,
  teams: [],
  deck: [],
  currentChallenge: null,
};

// ------------------------------
// Helpers
// ------------------------------
function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

function findTeamByName(teamName) {
  const n = normalizeName(teamName);
  return state.teams.find(t => normalizeName(t.name) === n);
}

function broadcastState() {
  io.emit("state", state);
}

// ------------------------------
// SOCKET.IO
// ------------------------------
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Send current state to anyone who connects
  socket.emit("state", state);

  // --------------------------
  // Admin: Start game (stable code)
  // --------------------------
  socket.on("startGame", (cb) => {
    if (!state.gameCode) {
      state.gameCode = generateCode();
      state.currentChallenge = null;
      console.log("Game started. Code:", state.gameCode);
      broadcastState();
    }
    cb?.({ ok: true, gameCode: state.gameCode, state });
  });

  // --------------------------
  // Team: Join game by code + team name
  // --------------------------
  socket.on("joinGame", ({ code, teamName }, cb) => {
    const cleanCode = String(code || "").trim();
    const cleanName = String(teamName || "").trim();

    if (!cleanCode) {
      cb?.({ ok: false, message: "Game code mangler." });
      return;
    }

    if (!state.gameCode || cleanCode !== state.gameCode) {
      cb?.({ ok: false, message: "Forkert game code." });
      return;
    }

    if (!cleanName) {
      cb?.({ ok: false, message: "Teamnavn mangler." });
      return;
    }

    if (findTeamByName(cleanName)) {
      cb?.({ ok: false, message: "Teamnavnet er allerede taget." });
      return;
    }

    const team = {
      id: "t" + Date.now() + Math.floor(Math.random() * 9999),
      name: cleanName,
      points: 0,
    };

    state.teams.push(team);

    socket.teamName = team.name;
    socket.teamId = team.id;

    console.log("Team joined:", team.name);
    broadcastState();

    cb?.({ ok: true, team });
  });

  // --------------------------
  // Team buzz (Grandprix)
  // --------------------------
  socket.on("buzz", ({ audioPosition } = {}) => {
    const teamName = socket.teamName;
    if (!teamName) return;

    io.emit("buzzed", teamName);

    const ch = state.currentChallenge;

    if (
      ch &&
      typeof ch === "object" &&
      ch.type === "Nisse Grandprix" &&
      ch.phase === "listening" &&
      !ch.firstBuzz
    ) {
      const now = Date.now();
      const countdownSeconds = ch.countdownSeconds || 5;

      state.currentChallenge = {
        ...ch,
        phase: "locked",
        firstBuzz: {
          teamName,
          audioPosition: Number(audioPosition || 0),
        },
        countdownStartAt: now,
        countdownSeconds,
      };

      broadcastState();
    }
  });

  // --------------------------
  // WebRTC relay for Grandprix mic
  // Team sends offer/ice → admin
  // Admin sends answer/ice → team
  // --------------------------
  socket.on("gp-webrtc-offer", ({ offer }) => {
    socket.broadcast.emit("gp-webrtc-offer", {
      teamName: socket.teamName,
      offer,
    });
  });

  socket.on("gp-webrtc-answer", ({ teamName, answer }) => {
    for (const s of io.sockets.sockets.values()) {
      if (s.teamName === teamName) {
        s.emit("gp-webrtc-answer", { answer });
      }
    }
  });

  socket.on("gp-webrtc-ice", ({ teamName, candidate }) => {
    if (!teamName) {
      socket.broadcast.emit("gp-webrtc-ice", {
        teamName: socket.teamName,
        candidate,
      });
      return;
    }

    for (const s of io.sockets.sockets.values()) {
      if (s.teamName === teamName) {
        s.emit("gp-webrtc-ice", { candidate });
      }
    }
  });

  // --------------------------
  // Admin updates full state
  // --------------------------
  socket.on("updateState", (newState) => {
    const prevChallenge = state.currentChallenge;
    state = newState || state;

    const prevWasGP =
      prevChallenge &&
      prevChallenge.type === "Nisse Grandprix" &&
      prevChallenge.phase !== "ended";

    const nextIsGP =
      state.currentChallenge &&
      state.currentChallenge.type === "Nisse Grandprix" &&
      state.currentChallenge.phase !== "ended";

    if (prevWasGP && !nextIsGP) {
      io.emit("gp-stop-audio-now");
      io.emit("gp-stop-mic");
    }

    broadcastState();
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ------------------------------
// Listen (Render uses PORT)
// ------------------------------
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
