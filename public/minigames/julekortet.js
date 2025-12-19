// public/minigames/julekortet.js v6
// Option 1 compatible:
// - Uses server fields: ch.phaseStartAt + ch.phaseDurationSec
// - Countdown uses api.nowMs() (server-synced) when available
// - Resets hasSubmitted/hasVoted when a new round arrives (ch.id changes)
// - Shows ch.text as prompt as you already wanted

let writingTimer = null;
let popupEl = null;

let hasSubmitted = false;
let hasVoted = false;

// Track round so we can reset local flags between rounds
let lastRoundId = null;

function ensurePopup() {
  if (popupEl) return popupEl;

  popupEl = document.createElement("div");
  popupEl.id = "julekortPopup";
  popupEl.style.cssText = `
    position:fixed; inset:0; display:flex; justify-content:center; align-items:center;
    background:rgba(0,0,0,0.6); z-index:9999; padding:16px;
  `;

  popupEl.innerHTML = `
    <div class="jk-card" style="
      width:min(720px, 96vw);
      background:#fff7ef;
      border:8px solid #d11;
      border-radius:18px;
      padding:18px;
      box-shadow:0 8px 30px rgba(0,0,0,0.3);
    ">
      <h2 style="margin:0 0 6px; font-size:2rem;">🎄 JuleKortet</h2>
      <p id="jkPrompt" style="margin:0 0 10px; font-weight:700;"></p>

      <div id="jkTimeRow" style="font-weight:900; font-size:1.3rem; margin-bottom:10px;">
        Tid tilbage: <span id="jkTimeLeft">120</span>s
      </div>

      <textarea id="jkTextarea" placeholder="Skriv jeres julekort her..."
        style="
          width:100%; min-height:220px;
          font-size:1.6rem; line-height:1.35;
          padding:12px; border-radius:12px; border:2px solid #a33;
          color:crimson; background:#fff;
        "></textarea>

      <button id="jkSendBtn" style="
        margin-top:10px; font-size:1.4rem; font-weight:900;
        padding:10px 14px; border-radius:12px; border:none;
        background:#1a7f37; color:#fff; cursor:pointer;
      ">Send kort</button>

      <p id="jkStatus" style="margin-top:8px; font-weight:800;"></p>
      <div id="jkVoteWrap" style="margin-top:12px;"></div>
    </div>
  `;

  document.body.appendChild(popupEl);
  return popupEl;
}

function clearWritingTimer() {
  if (writingTimer) clearInterval(writingTimer);
  writingTimer = null;
}

export function stopJuleKortet(api) {
  clearWritingTimer();
  if (popupEl) popupEl.remove();
  popupEl = null;

  hasSubmitted = false;
  hasVoted = false;
  lastRoundId = null;

  api?.showStatus?.("");
}

export function renderJuleKortet(ch, api, socket, myTeamName) {
  api?.setBuzzEnabled?.(false);

  // Reset local flags on new round
  const roundId = ch?.id ?? null;
  if (roundId && roundId !== lastRoundId) {
    lastRoundId = roundId;
    hasSubmitted = false;
    hasVoted = false;
  }

  const popup = ensurePopup();
  popup.style.display = "flex";

  const promptEl = popup.querySelector("#jkPrompt");
  const timeLeftEl = popup.querySelector("#jkTimeLeft");
  const timeRow = popup.querySelector("#jkTimeRow");
  const textarea = popup.querySelector("#jkTextarea");
  const sendBtn = popup.querySelector("#jkSendBtn");
  const statusEl = popup.querySelector("#jkStatus");
  const voteWrap = popup.querySelector("#jkVoteWrap");

  // Show prompt
  if (promptEl) {
    promptEl.textContent = ch.text || "Skriv et kort på 2 minutter";
  }

  // Always clear voteWrap before rendering phase UI
  if (voteWrap) voteWrap.innerHTML = "";

  // Helper: server-synced now (falls back safely)
  const now = () => (typeof api?.nowMs === "function" ? api.nowMs() : Date.now());

  // --- WRITING PHASE ---
  if (ch.phase === "writing") {
    hasVoted = false;
    clearWritingTimer();

    textarea.style.display = "block";
    sendBtn.style.display = "inline-block";
    if (timeRow) timeRow.style.display = "block";

    textarea.readOnly = hasSubmitted;
    sendBtn.disabled = hasSubmitted;

    statusEl.textContent = hasSubmitted ? "✅ Kort sendt. Vent på afstemning…" : "";

    // ✅ Option 1 fields (from server.js)
    const startAt = typeof ch.phaseStartAt === "number" ? ch.phaseStartAt : now();
    const total = typeof ch.phaseDurationSec === "number" ? ch.phaseDurationSec : 120;

    function manualSubmit() {
      const text = (textarea.value || "").trim();
      if (!text) {
        statusEl.textContent = "Skriv noget først 🙂";
        return;
      }
      hasSubmitted = true;
      textarea.readOnly = true;
      sendBtn.disabled = true;
      statusEl.textContent = "✅ Kort sendt!";

      socket.emit("submitCard", { teamName: myTeamName, text });

      setTimeout(() => (popup.style.display = "none"), 600);
    }

    function autoSubmit() {
      if (hasSubmitted) return;
      hasSubmitted = true;

      const text = (textarea.value || "").trim();
      textarea.readOnly = true;
      sendBtn.disabled = true;

      if (text) socket.emit("submitCard", { teamName: myTeamName, text });

      setTimeout(() => (popup.style.display = "none"), 600);
    }

    function tick() {
      const elapsed = Math.floor((now() - startAt) / 1000);
      const left = Math.max(0, total - elapsed);
      if (timeLeftEl) timeLeftEl.textContent = String(left);

      if (left <= 0) {
        clearWritingTimer();
        autoSubmit();
      }
    }

    sendBtn.onclick = manualSubmit;

    // Only keep ticking if not already submitted
    if (!hasSubmitted) {
      writingTimer = setInterval(tick, 250);
      tick();
      setTimeout(() => textarea.focus(), 80);
    } else {
      // ensure UI shows correct time even if already submitted
      tick();
    }

    return;
  }

  // --- VOTING PHASE ---
  if (ch.phase === "voting") {
    clearWritingTimer();
    popup.style.display = "flex";

    textarea.style.display = "none";
    sendBtn.style.display = "none";
    if (timeRow) timeRow.style.display = "none";

    statusEl.textContent = hasVoted
      ? "✅ Din stemme er afgivet!"
      : "Afstemning i gang! Vælg jeres favoritkort.";

    const cards = ch.votingCards || [];

    const grid = document.createElement("div");
    grid.style.cssText = `
      display:grid; gap:10px;
      grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
    `;

    cards.forEach((c, i) => {
      const owner = c.ownerTeamName;
      const isMine = owner === myTeamName;

      const btn = document.createElement("button");
      btn.style.cssText = `
        text-align:left; padding:10px; border-radius:12px;
        border:2px solid #d77; background:#fff; cursor:pointer;
        font-size:1.1rem; opacity:${isMine ? 0.45 : 1};
      `;
      btn.disabled = isMine || hasVoted;

      btn.innerHTML = `
        <div style="font-weight:900;">Kort #${i + 1}</div>
        <div style="white-space:pre-wrap; margin-top:6px;">${c.text}</div>
        ${isMine ? '<div style="margin-top:6px; font-weight:800;">(Dit kort)</div>' : ""}
      `;

      btn.onclick = () => {
        if (hasVoted || isMine) return;
        hasVoted = true;

        socket.emit("vote", i);

        api?.showStatus?.("✅ Din stemme er afgivet!");
        statusEl.textContent = "✅ Tak for din stemme!";
        [...grid.querySelectorAll("button")].forEach((b) => (b.disabled = true));
      };

      grid.appendChild(btn);
    });

    voteWrap.appendChild(grid);
    return;
  }

  // --- ENDED ---
  if (ch.phase === "ended") {
    clearWritingTimer();
    popup.style.display = "flex";

    textarea.style.display = "none";
    sendBtn.style.display = "none";
    if (timeRow) timeRow.style.display = "none";

    const winners = ch.winners || [];
    statusEl.textContent = winners.length
      ? `🎉 Vindere: ${winners.join(", ")}`
      : "🎉 Runden er slut!";

    setTimeout(() => (popup.style.display = "none"), 6000);
    return;
  }

  // Fallback: if unknown phase, just hide
  clearWritingTimer();
  popup.style.display = "none";
}
