const socket = io();

let state = {};

socket.on("state", s => {
  state = s;
  renderLeaderboard(state.leaderboard);
});

document.getElementById("startChallenge").onclick = () => {
  state.currentChallenge = "Test Challenge";
  socket.emit("updateState", state);
};

document.getElementById("endGame").onclick = () => {
  alert("Game ended!");
};
