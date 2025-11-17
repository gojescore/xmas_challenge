function renderLeaderboard(list) {
  const el = document.getElementById("leaderboard");
  if (!el) return;

  el.innerHTML = "<h2>Leaderboard</h2>";

  list.forEach(t => {
    const row = document.createElement("div");
    row.textContent = `${t.name}: ${t.points}`;
    el.appendChild(row);
  });
}
