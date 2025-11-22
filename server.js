const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// uploads for FiNisse later
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// PUBLIC state (sent to all clients)
let state = {
  teams: [],
  deck: [],
  currentChallenge: null,
  gameCode: null,
};

// PRIVATE store (never sent)
const privateStore = {
  julekortet: new Map(), // challengeId -> [{ teamName, text }]
};

const upload = multer({ dest: "./uploads/" });
app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ filename: req.file.filename });
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.emit("state", state);

  socket.on("joinTeam", (teamName) => {
    socket.team = teamName;
  });

  // Teams join by code + name (callback)
  socket.on("joinGame", ({ code, teamName }, cb) => {
    if (!state.gameCode || code !== state.gameCode) {
      cb?.({ ok: false, message: "Forkert kode" });
      return;
    }

    if (!teamName?.trim()) {
      cb?.({ ok: false, message: "Ugyldigt navn" });
      return;
    }

    const exists = state.teams.some(
      (t) => t.name.toLowerCase() === teamName.toLowerCase()
    );
    if (exists) {
      cb?.({ ok: false, message: "Navnet findes allerede" });
      return;
    }

    const team = {
      id: "t" + Date.now() + Math.random(),
      name: teamName.trim(),
      points: 0,
    };

    state.teams.push(team);
    io.emit("state", state);

    console.log("Team joined:", teamName);
    cb?.({ ok: true, team });
  });

  // BUZZ (Grandprix)
  socket.on("buzz", (payload) => {
    io.emit("buzzed", socket.team, payload);
  });

  // TEXT SUBMISSION (JuleKortet + NisseGåden)
  socket.on("submitCard", (text) => {
    const ch = state.currentChallenge;

    if (ch?.type === "JuleKortet" && ch.phase === "writing") {
      // public cards (anonymous)
      ch.cards = ch.cards || [];
      ch.cards.push({ text });

      // private cards (with team)
      const key = ch.id;
      if (!privateStore.julekortet.has(key)) privateStore.julekortet.set(key, []);
      privateStore.julekortet.get(key).push({ teamName: socket.team, text });

      io.emit("state", state);
      return;
    }

    // default (NisseGåden etc)
    io.emit("newCard", { team: socket.team, text });
  });

  // VOTE (JuleKortet voting)
  socket.on("vote", (index) => {
    const ch = state.currentChallenge;
    if (ch?.type !== "JuleKortet" || ch.phase !== "voting") return;

    ch.votes = ch.votes || {}; // voterTeam -> index

    // only one vote per team; overwrite allowed
    ch.votes[socket.team] = index;

    io.emit("state", state);
    io.emit("voteUpdate", { voter: socket.team, index });
  });

  // Admin updates state
  socket.on("updateState", (newState) => {
    state = newState;
    io.emit("state", state);
  });

  // Admin asks: who wrote winning card?
  socket.on("jk-request-winner-team", ({ challengeId, cardIndex }, cb) => {
    const priv = privateStore.julekortet.get(challengeId) || [];
    const winner = priv[cardIndex];
    cb?.(winner ? { ok: true, teamName: winner.teamName } : { ok: false });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("Xmas Challenge Server Running");
});

http.listen(process.env.PORT || 3000, () => {
  console.log("Server listening");
});
