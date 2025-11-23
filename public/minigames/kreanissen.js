// public/minigames/kreanissen.js
// Team UI for KreaNissen: 3 min create + photo upload + anonymous voting

let timer = null;
let popup = null;
let hasSubmitted = false;
let hasVoted = false;
let selectedFile = null;
let previewUrl = null;

function ensurePopup() {
  if (popup) return popup;

  popup = document.createElement("div");
  popup.id = "kreanissenPopup";
  popup.style.cssText = `
    position:fixed; inset:0; display:flex; justify-content:center; align-items:center;
    background:rgba(0,0,0,0.65); z-index:9999; padding:16px;
  `;

  popup.innerHTML = `
    <div style="
      width:min(760px, 96vw);
      background:#fff7ef;
      border:8px solid #0b6;
      border-radius:18px;
      padding:18px;
      box-shadow:0 8px 30px rgba(0,0,0,0.3);
      text-align:center;
    ">
      <h2 style="margin:0 0 8px; font-size:2.1rem;">🎨 KreaNissen</h2>
      <p id="knPrompt" style="font-size:1.3rem; font-weight:800; margin:0 0 10px;"></p>

      <div style="font-weight:900; font-size:1.3rem; margin-bottom:10px;">
        Tid tilbage: <span id="knTimeLeft">180</span>s
      </div>

      <div id="knCaptureWrap" style="display:flex; flex-direction:column; gap:10px; align-items:center;">
        <input id="knFileInput" type="file" accept="image/*" capture="environment"
          style="font-size:1.1rem;" />

        <img id="knPreview" style="
          display:none; max-width:95%; max-height:320px;
          border-radius:12px; border:2px solid #ccc;
        " />

        <button id="knSendBtn" style="
          font-size:1.4rem; font-weight:900;
          padding:10px 14px; border-radius:12px; border:none;
          background:#1a7f37; color:#fff; cursor:pointer;
        ">Send billede</button>

        <p id="knStatus" style="margin:0; font-weight:800;"></p>
      </div>

      <div id="knVoteWrap" style="margin-top:14px;"></div>
    </div>
  `;

  document.body.appendChild(popup);
  return popup;
}

export function stopKreaNissen(api) {
  if (timer) clearInterval(timer);
  timer = null;

  if (popup) popup.remove();
  popup = null;

  hasSubmitted = false;
  hasVoted = false;
  selectedFile = null;

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  api?.showStatus?.("");
}

export function renderKreaNissen(ch, api, socket, myTeamName) {
  api.setBuzzEnabled(false);

  const pop = ensurePopup();
  pop.style.display = "flex";

  const promptEl = pop.querySelector("#knPrompt");
  const timeLeftEl = pop.querySelector("#knTimeLeft");
  const fileInput = pop.querySelector("#knFileInput");
  const preview = pop.querySelector("#knPreview");
  const sendBtn = pop.querySelector("#knSendBtn");
  const statusEl = pop.querySelector("#knStatus");
  const voteWrap = pop.querySelector("#knVoteWrap");

  promptEl.textContent = ch.text || "Lav noget kreativt og tag et billede!";
  voteWrap.innerHTML = "";

  // ---------------- WRITING/CREATION PHASE ----------------
  if (ch.phase === "creating") {
    hasVoted = false;

    fileInput.style.display = "block";
    sendBtn.style.display = "inline-block";
    timeLeftEl.parentElement.style.display = "block";

    fileInput.disabled = hasSubmitted;
    sendBtn.disabled = hasSubmitted;

    statusEl.textContent = hasSubmitted
      ? "✅ Billede sendt. Vent på afstemning…"
      : "";

    // preview when file selected
    fileInput.onchange = () => {
      selectedFile = fileInput.files?.[0] || null;
      if (!selectedFile) return;

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(selectedFile);

      preview.src = previewUrl;
      preview.style.display = "block";
    };

    const startAt = ch.creatingStartAt;
    const total = ch.creatingSeconds || 180;

    function tick() {
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const left = Math.max(0, total - elapsed);
      timeLeftEl.textContent = left;

      if (left <= 0) {
        clearInterval(timer);
        timer = null;
        autoSubmit();
      }
    }

    if (timer) clearInterval(timer);
    if (!hasSubmitted) timer = setInterval(tick, 250);
    tick();

    sendBtn.onclick = manualSubmit;

    async function uploadFile(file) {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");
      const json = await res.json();
      return json.filename;
    }

    async function manualSubmit() {
      if (hasSubmitted) return;

      if (!selectedFile) {
        statusEl.textContent = "Vælg / tag et billede først 🙂";
        return;
      }

      hasSubmitted = true;
      fileInput.disabled = true;
      sendBtn.disabled = true;
      statusEl.textContent = "⏳ Sender billede…";

      try {
        const filename = await uploadFile(selectedFile);
        socket.emit("submitPhoto", { teamName: myTeamName, filename });
        statusEl.textContent = "✅ Billede sendt!";
        setTimeout(() => (pop.style.display = "none"), 600);
      } catch {
        hasSubmitted = false;
        fileInput.disabled = false;
        sendBtn.disabled = false;
        statusEl.textContent = "⚠️ Upload fejlede. Prøv igen.";
      }
    }

    async function autoSubmit() {
      if (hasSubmitted) return;
      if (!selectedFile) {
        hasSubmitted = true;
        statusEl.textContent = "⏰ Tiden er gået – intet billede sendt.";
        setTimeout(() => (pop.style.display = "none"), 800);
        return;
      }

      hasSubmitted = true;
      fileInput.disabled = true;
      sendBtn.disabled = true;
      statusEl.textContent = "⏳ Sender billede…";

      try {
        const filename = await uploadFile(selectedFile);
        socket.emit("submitPhoto", { teamName: myTeamName, filename });
        statusEl.textContent = "✅ Billede sendt!";
        setTimeout(() => (pop.style.display = "none"), 600);
      } catch {
        statusEl.textContent = "⚠️ Upload fejlede ved timeout.";
        setTimeout(() => (pop.style.display = "none"), 800);
      }
    }

    return;
  }

  // ---------------- VOTING PHASE ----------------
  if (ch.phase === "voting") {
    fileInput.style.display = "none";
    sendBtn.style.display = "none";
    timeLeftEl.parentElement.style.display = "none";

    statusEl.textContent = hasVoted
      ? "✅ Din stemme er afgivet!"
      : "Afstemning i gang! Stem på det bedste billede.";

    const photos = ch.votingPhotos || [];

    const grid = document.createElement("div");
    grid.style.cssText = `
      display:grid; gap:10px;
      grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
    `;

    photos.forEach((p, i) => {
      const owner = p.ownerTeamName;
      const isMine = owner === myTeamName;

      const btn = document.createElement("button");
      btn.style.cssText = `
        text-align:left; padding:8px; border-radius:12px;
        border:2px solid #0b6; background:#fff; cursor:pointer;
        font-size:1.1rem;
        opacity:${isMine ? 0.45 : 1};
      `;
      btn.disabled = isMine || hasVoted;

      btn.innerHTML = `
        <div style="font-weight:900;">Billede #${i + 1}</div>
        <img src="/uploads/${p.filename}" style="
          width:100%; border-radius:10px; margin-top:6px;
          border:1px solid #ccc;
        "/>
        ${isMine ? '<div style="margin-top:6px; font-weight:800;">(Dit billede)</div>' : ""}
      `;

      btn.onclick = () => {
        if (hasVoted || isMine) return;
        hasVoted = true;

        socket.emit("vote", i);

        api.showStatus("✅ Din stemme er afgivet!");
        statusEl.textContent = "✅ Tak for din stemme!";

        [...grid.querySelectorAll("button")].forEach(b => (b.disabled = true));
      };

      grid.appendChild(btn);
    });

    voteWrap.appendChild(grid);
    return;
  }

  // ---------------- ENDED PHASE ----------------
  if (ch.phase === "ended") {
    fileInput.style.display = "none";
    sendBtn.style.display = "none";
    timeLeftEl.parentElement.style.display = "none";

    const winners = ch.winners || [];
    statusEl.textContent = winners.length
      ? `🎉 Vindere: ${winners.join(", ")}`
      : "🎉 Runden er slut!";

    setTimeout(() => (pop.style.display = "none"), 6000);
  }
}
