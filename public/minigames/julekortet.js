// public/minigames/julekortet.js
// Team-side JuleKortet: 2 min writing, red text, Xmas card popup, anonymous voting

let writingTimer = null;
let popupEl = null;

function ensurePopup() {
  if (popupEl) return popupEl;

  popupEl = document.createElement("div");
  popupEl.id = "julekortPopup";
  popupEl.innerHTML = `
    <div class="jk-card">
      <h2 class="jk-title">🎄 JuleKortet</h2>
      <p class="jk-subtitle">Skriv et kort på 2 minutter</p>

      <div class="jk-countdown">
        Tid tilbage: <span id="jkTimeLeft">120</span>s
      </div>

      <textarea id="jkTextarea" class="jk-textarea" placeholder="Skriv jeres julekort her..."></textarea>

      <button id="jkSendBtn" class="jk-send">Send kort</button>
      <p id="jkStatus" class="jk-status"></p>
    </div>
  `;

  document.body.appendChild(popupEl);
  return popupEl;
}

export function stopJuleKortet(api) {
  if (writingTimer) clearInterval(writingTimer);
  writingTimer = null;
  if (popupEl) popupEl.remove();
  popupEl = null;
  api?.showStatus?.("");
}

export function renderJuleKortet(ch, api) {
  api.setBuzzEnabled(false);

  const popup = ensurePopup();
  popup.style.display = "flex";

  const timeLeftEl = popup.querySelector("#jkTimeLeft");
  const textarea = popup.querySelector("#jkTextarea");
  const sendBtn = popup.querySelector("#jkSendBtn");
  const statusEl = popup.querySelector("#jkStatus");

  // voting UI container (after writing)
  const existingVote = document.getElementById("jkVoteWrap");
  if (existingVote) existingVote.remove();

  // --- phase handling ---
  if (ch.phase === "writing") {
    textarea.disabled = false;
    sendBtn.disabled = false;

    const startAt = ch.writingStartAt;
    const total = ch.writingSeconds || 120;

    function tick() {
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const left = Math.max(0, total - elapsed);
      timeLeftEl.textContent = left;

      if (left <= 0) {
        clearInterval(writingTimer);
        writingTimer = null;
        autoSubmit();
      }
    }

    if (writingTimer) clearInterval(writingTimer);
    writingTimer = setInterval(tick, 250);
    tick();

    sendBtn.onclick = () => manualSubmit();

    function manualSubmit() {
      const text = (textarea.value || "").trim();
      if (!text) {
        statusEl.textContent = "Skriv noget først 🙂";
        return;
      }
      api.showStatus("✅ Kort sendt!");
      statusEl.textContent = "Kort sendt!";
      textarea.disabled = true;
      sendBtn.disabled = true;
      socket.emit("submitCard", text);
    }

    function autoSubmit() {
      const text = (textarea.value || "").trim();
      if (text) {
        socket.emit("submitCard", text);
        statusEl.textContent = "⏳ Tiden er gået — dit kort er sendt!";
      } else {
        statusEl.textContent = "⏳ Tiden er gået — ingen tekst sendt.";
      }
      textarea.disabled = true;
      sendBtn.disabled = true;
    }
  }

  if (ch.phase === "voting") {
    // hide writing box, show anonymous cards to vote on
    textarea.disabled = true;
    sendBtn.disabled = true;
    timeLeftEl.textContent = "0";
    statusEl.textContent = "Afstemning i gang! Vælg jeres favoritkort.";

    const cards = ch.cards || [];

    const voteWrap = document.createElement("div");
    voteWrap.id = "jkVoteWrap";
    voteWrap.className = "jk-vote-wrap";

    cards.forEach((c, i) => {
      const cardBox = document.createElement("button");
      cardBox.className = "jk-vote-card";
      cardBox.innerHTML = `
        <div class="jk-vote-title">Kort #${i + 1}</div>
        <div class="jk-vote-text">${c.text}</div>
      `;
      cardBox.onclick = () => {
        socket.emit("vote", i);
        api.showStatus("✅ Din stemme er afgivet!");
      };
      voteWrap.appendChild(cardBox);
    });

    popup.querySelector(".jk-card").appendChild(voteWrap);
  }

  if (ch.phase === "ended") {
    statusEl.textContent = "Runden er slut 🎉";
    textarea.disabled = true;
    sendBtn.disabled = true;
  }
}
