// public/minigames/julekortet.js v6
// Changes:
// - After pressing Send (or auto-submit), replace input UI with confirmation ("Dit svar er sendt").
// - When round ends, close popup and restore default team screen ("Vent på læreren...") via api.clearMiniGame().
// - Uses server-authoritative timing: phaseStartAt + phaseDurationSec (Option 1).

let writingTimer = null;
let popupEl = null;
let hasSubmitted = false;
let hasVoted = false;

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

      <div id="jkTimerRow" style="font-weight:900; font-size:1.3rem; margin-bottom:10px;">
        Tid tilbage: <span id="jkTimeLeft">120</span>s
      </div>

      <div id="jkWriteWrap">
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
      </div>

      <div id="jkSentWrap" style="display:none; margin-top:12px;">
        <div style="
          padding:14px;
          border-radius:14px;
          background:linear-gradient(135deg, #e7ffe9, #ffffff);
          border:2px solid rgba(26,127,55,0.35);
          font-size:1.35rem;
          font-weight:900;
          text-align:center;
        ">
          ✅ Dit svar er sendt
        </div>
        <div style="margin-top:10px; font-size:1.1rem; font-weight:800; text-align:center; opacity:0.85;">
          Vent på læreren…
        </div>
      </div>

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

function showSentView(popup) {
  const writeWrap = popup.querySelector("#jkWriteWrap");
  const sentWrap = popup.querySelector("#jkSentWrap");
  const voteWrap = popup.querySelector("#jkVoteWrap");
  const timerRow = popup.querySelector("#jkTimerRow");

  if (writeWrap) writeWrap.style.display = "none";
  if (voteWrap) voteWrap.innerHTML = "";
  if (timerRow) timerRow.style.display = "none";
  if (sentWrap) sentWrap.style.display = "block";
}

export function stopJuleKortet(api) {
  clearWritingTimer();
  if (popupEl) popupEl.remove();
  popupEl = null;
  hasSubmitted = false;
  hasVoted = false;
  api?.showStatus?.("");
}

export function renderJuleKortet(ch, api, socket, myTeamName) {
  api?.setBuzzEnabled?.(false);

  const popup = ensurePopup();
  popup.style.display = "flex";

  const promptEl = popup.querySelector("#jkPrompt");
  const timeLeftEl = popup.querySelector("#jkTimeLeft");
  const timerRow = popup.querySelector("#jkTimerRow");

  const textarea = popup.querySelector("#jkTextarea");
  const sendBtn = popup.querySelector("#jkSendBtn");
  const statusEl = popup.querySelector("#jkStatus");
  const voteWrap = popup.querySelector("#jkVoteWrap");

  const writeWrap = popup.querySelector("#jkWriteWrap");
  const sentWrap = popup.querySelector("#jkSentWrap");

  // Prompt text from deck
  if (promptEl) {
    promptEl.textContent = ch.text || "Skriv et kort på 2 minutter";
  }

  // Reset visible sections each render
  if (voteWrap) voteWrap.innerHTML = "";
  if (sentWrap) sentWrap.style.display = "none";
  if (writeWrap) writeWrap.style.display = "block";
  if (timerRow) timerRow.style.display = "block";

  // --- WRITING PHASE ---
  if (ch.phase === "writing") {
    hasVoted = false;

    // If already submitted, show confirmation view (prevents confusion + extra typing)
    if (hasSubmitted) {
      clearWritingTimer();
      showSentView(popup);
      return;
    }

    // Ensure input UI is enabled
    if (textarea) {
      textarea.style.display = "block";
      textarea.readOnly = false;
    }
    if (sendBtn) {
      sendBtn.style.display = "inline-block";
      sendBtn.disabled = false;
    }
    if (statusEl) statusEl.textContent = "";

    // Server-authoritative timer: phaseStartAt + phaseDurationSec
    const startAt = typeof ch.phaseStartAt === "number" ? ch.phaseStartAt : Date.now();
    const total = typeof ch.phaseDurationSec === "number" ? ch.phaseDurationSec : 120;

    function tick() {
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const left = Math.max(0, total - elapsed);
      if (timeLeftEl) timeLeftEl.textContent = left;

      if (left <= 0) {
        clearWritingTimer();
        autoSubmit();
      }
    }

    clearWritingTimer();
    writingTimer = setInterval(tick, 250);
    tick();

    setTimeout(() => textarea?.focus?.(), 80);

    function finalizeSubmit(sentSomething) {
      hasSubmitted = true;

      // Lock UI and show confirmation screen immediately
      if (textarea) {
        textarea.readOnly = true;
        textarea.blur?.();
      }
      if (sendBtn) sendBtn.disabled = true;

      // Replace typing UI with confirmation
      showSentView(popup);

      // Keep popup visible for reassurance (do not close instantly)
      // You can tweak this delay if you want it to close automatically later.
      // setTimeout(() => (popup.style.display = "none"), 3000);
    }

    function manualSubmit() {
      const text = (textarea?.value || "").trim();
      if (!text) {
        if (statusEl) statusEl.textContent = "Skriv noget først 🙂";
        return;
      }

      socket.emit("submitCard", { teamName: myTeamName, text });
      clearWritingTimer();
      finalizeSubmit(true);
    }

    function autoSubmit() {
      if (hasSubmitted) return;

      const text = (textarea?.value || "").trim();
      if (text) socket.emit("submitCard", { teamName: myTeamName, text });

      finalizeSubmit(!!text);
    }

    if (sendBtn) sendBtn.onclick = manualSubmit;
    return;
  }

  // --- VOTING PHASE ---
  if (ch.phase === "voting") {
    clearWritingTimer();

    // Hide writing UI
    if (writeWrap) writeWrap.style.display = "none";
    if (sentWrap) sentWrap.style.display = "none";
    if (timerRow) timerRow.style.display = "none";

    if (statusEl) {
      statusEl.textContent = hasVoted
        ? "✅ Din stemme er afgivet!"
        : "Afstemning i gang! Vælg jeres favoritkort.";
    }

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
        if (statusEl) statusEl.textContent = "✅ Tak for din stemme!";
        [...grid.querySelectorAll("button")].forEach((b) => (b.disabled = true));
      };

      grid.appendChild(btn);
    });

    if (voteWrap) voteWrap.appendChild(grid);
    return;
  }

  // --- ENDED ---
  if (ch.phase === "ended") {
    clearWritingTimer();

    // Optional: show winners briefly, then restore default "Vent på læreren..."
    if (writeWrap) writeWrap.style.display = "none";
    if (timerRow) timerRow.style.display = "none";
    if (sentWrap) sentWrap.style.display = "none";

    const winners = ch.winners || [];
    if (statusEl) {
      statusEl.textContent = winners.length
        ? `🎉 Vindere: ${winners.join(", ")}`
        : "🎉 Runden er slut!";
    }

    // Close popup and restore default team screen text, like other minigames
    setTimeout(() => {
      if (popupEl) popupEl.style.display = "none";
      // This is the key: returns to your normal "Vent på læreren…" state.
      api?.clearMiniGame?.();
    }, 1800);

    return;
  }

  // Fallback: if unknown phase, close and restore
  clearWritingTimer();
  if (popupEl) popupEl.style.display = "none";
  api?.clearMiniGame?.();
}
