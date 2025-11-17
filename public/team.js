const socket = io();

let teamName = prompt("Enter team name:");
socket.emit("joinTeam", teamName);

document.getElementById("buzzBtn").onclick = () => {
  socket.emit("buzz");
};

socket.on("buzzed", team => {
  document.getElementById("status").innerText = `${team} buzzed first!`;
});

socket.on("state", s => {
  renderLeaderboard(s.leaderboard);
});
