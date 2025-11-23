// server.js v36
// Backward compatible: joinGame + joinTeam both work.
// Safe gameCode guard so admin sync can’t wipe it.

const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const multer = require("multer");
const fs = require("fs");

// --------------------
// Static + uploads
// --------------------
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const upload = multer({ dest: "./uploads/" });
app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ filename: req.file.filename });
});

// --------------------
// Global state
// --------------------
let state = {
  gameCode: null,
  teams: [],
  deck: [],
  currentChallenge: null,
};

const normalize = (s) => (s || "").trim().toLowerCase();
const makeCode = () => String(Math.floor(1000 + Math.random() * 9000));

// --------------------
// Socket.io
// --------------------
io.on("connection", (socket) => {
  console.log("New client:", socket.id);
  socket.emit("state", state);

  // ADMIN updates whole state
  socket.on("updateState", (incoming) => {
    if (!incoming || typeof incoming !== "object") return;

    // ✅ Never wipe gameCode unless a real one is sent
    if (
      incoming.gameCode !== undefined &&
      incoming.gameCode !== null &&
      String(incoming.gameCode).trim() !== ""
    ) {
      state.gameCode = String(incoming.gameCode).trim();
    }

    if (Array.isArray(incoming.teams)) state.teams = incoming.teams;
    if (Array.isArray(incoming.deck) && incoming.deck.length > 0) state.deck = incoming.deck;
    if (incoming.currentChallenge !== undefined) state.currentChallenge = incoming.currentChallenge;

    io.emit("state", state);
  });

  // ADMIN starts new game
  socket.on("startGame", (ack) => {
    state.gameCode = makeCode();
    state.teams = [];
    state.currentChallenge = null;

    console.log("Game started. Code:", state.gameCode);
    io.emit("state", state);

    if (typeof ack === "function") ack({ ok: true, gameCode: state.gameCode });
  });

  // --------------------
  // JOIN HANDLERS (both)
  // --------------------
  function handleJoin({ code, teamName }, ack) {
    const c = String(code || "").trim();
    const n = String(teamName || "").trim();

    console.log("Join attempt:", { code: c, teamName: n, serverCode: state.gameCode });

    if (!state.gameCode || c !== state.gameCode) {
      if (typeof ack === "function") ack({ ok: false, message: "Forkert kode" });
      return;
    }

    if (!n) {
      if (typeof ack === "function") ack({ ok: false, message: "Skriv et teamnavn" });
      return;
    }

    if (state.teams.some(t => normalize(t.name) === normalize(n))) {
      if (typeof ack === "function") ack({ ok: false, message: "Navnet er allerede taget" });
      return;
    }

    const team = { id: "t" + Date.now(), name: n, points: 0 };
    state.teams.push(team);

    socket.teamName = n;

    io.emit("state", state);
    if (typeof ack === "function") ack({ ok: true, team });
  }

  // New event name
  socket.on("joinGame", handleJoin);

  // Old event name (fallback)
  socket.on("joinTeam", (teamName, ack) => {
    handleJoin({ code: state.gameCode, teamName }, ack);
  });

  // --------------------
  // Gameplay events
  // --------------------
  socket.on("buzz", () => {
    const who = socket.teamName || "Ukendt hold";
    io.emit("buzzed", who);
  });

  socket.on("gp-typed-answer", (payload) => {
    io.emit("gp-typed-answer", payload);
  });

  socket.on("submitCard", (payload) => {
    let teamName, text;

    if (typeof payload === "string") {
      teamName = socket.teamName;
      text = payload;
    } else {
      teamName = payload?.teamName || socket.teamName;
      text = payload?.text;
    }
    if (!teamName || !text) return;

    io.emit("newCard", { teamName, text });
  });

  socket.on("submitPhoto", (payload) => {
    let teamName, filename;

    if (typeof payload === "string") {
      teamName = socket.teamName;
      filename = payload;
    } else {
      teamName = payload?.teamName || socket.teamName;
      filename = payload?.filename || payload?.file;
    }
    if (!teamName || !filename) return;

    io.emit("newPhoto", { teamName, filename });
  });

  socket.on("vote", (index) => {
    const voter = socket.teamName || "Ukendt hold";
    io.emit("voteUpdate", { voter, index });
  });

  socket.on("gp-stop-audio-now", () => {
    io.emit("gp-stop-audio-now");
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

app.get("/", (req, res) => res.send("Xmas Challenge Server Running"));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server listening on port", PORT));
