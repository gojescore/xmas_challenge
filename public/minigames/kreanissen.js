// public/minigames/kreanissen.js v2
// Team UI for KreaNissen: 3 min create + webcam photo + anonymous voting
// Webcam flow: Tag foto -> Prøv igen -> Accepter (upload + submit)

// ---------------- Local state ----------------
let timer = null;
let popup = null;
let hasSubmitted = false;
let hasVoted = false;

let stream = null;          // MediaStream
let videoEl = null;
let canvasEl = null;
let imgEl = null;

let capturedBlob = null;    // Blob after "Tag foto"
let previewUrl = null;

// ---------------- Popup builder ----------------
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
      font-family: system-ui, sans-serif;
    ">
      <h2 style="margin:0 0 8px; font-size:2.1rem;">🎨 KreaNissen</h2>
      <p id="knPrompt" style="font-size:1.3rem; font-weight:800; margin:0 0 10px;"></p>

      <div style="font-weight:900; font-size:1.3rem; margin-bottom:10px;">
        Tid tilbage: <span id="knTimeLeft">180</span>s
      </div>

      <!-- CAMERA AREA -->
      <div id="knCameraWrap" style="
        display:flex; flex-direction:column; gap:10px; align-items:center;
      ">
        <div style="
          width:min(520px, 92vw);
          background:#000;
          border-radius:12px;
          overflow:hidden;
          border:2px solid #ccc;
        ">
          <video id="knVideo" autoplay playsinline style="width:100%; display:block;"></video>
          <img id="knSnapshot" style="width:100%; display:none;" />
          <canvas id="knCanvas" style="display:none;"></canvas>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
          <button id="knTakeBtn" style="
            font-size:1.3rem; font-weight:900;
            padding:10px 14px; border-radius:12px; border:none;
            background:#0b6; color:#fff; cursor:pointer;
          ">📸 Tag foto</button>

          <button id="knRetryBtn" disabled style="
            font-size:1.3rem; font-weight:900;
            padding:10px 14px; border-radius:12px; border:none;
            background:#555; color:#fff; cursor:pointer;
            opacity:0.6;
          ">🔁 Prøv igen</button>

          <button id="knAcceptBtn" disabled style="
            font-size:1.3rem; font-weight:900;
            padding:10px 14px; border-radius:12px; border:none;
            background:#1a7f37; color:#fff; cursor:pointer;
            opacity:0.6;
          ">✅ Accepter</button>
        </div>

        <!-- FALLBACK FILE INPUT (hidden unless webcam fails) -->
        <div id="knFallbackWrap" style="display:none; margin-top:6px;">
          <input id="knFileInput" type="file" accept="image/*" capture="environment"
            style="font-size:1.1rem;" />
          <button id="knSendFallbackBtn" style="
            margin-left:6px; font-size:1.2rem; font-weight:900;
            padding:8px 12px; border-radius:10px; border:none;
            background:#1a7f37; color:#fff; cursor:pointer;
          ">Send billede</button>
        </div>

        <p id="knStatus" style="margin:0; font-weight:800;"></p>
      </div>

      <div id="knVoteWrap" style="margin-top:14px;"></div>
    </div>
  `;

  document.body.appendChild(popup);
  return popup;
}

// ---------------- Cleanup ----------------
export function stopKreaNissen(api) {
  if (timer) clearInterval(timer);
  timer = null;

  stopCamera();

  if (popup) popup.remove();
  popup = null;

  hasSubmitted = false;
  hasVoted = false;
  capturedBlob = null;

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  api?.showStatus?.("");
}

// ---------------- Camera helpers ----------------
async function startCamera(statusEl, fallbackWrap) {
  stopCamera();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    if (videoEl) {
      videoEl.srcObject = stream;
      await videoEl.play();
    }
  } catch (err) {
    console.warn("Camera failed, fallback to file input.", err);
    if (statusEl) statusEl.textContent = "⚠️ Kamera ikke tilgængeligt. Brug fil-upload.";
    if (fallbackWrap) fallbackWrap.style.display = "block";
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => {
      try { t.stop(); } catch {}
    });
    stream = null;
  }
  if (videoEl) {
    try { videoEl.pause(); } catch {}
    videoEl.srcObject = null;
  }
}

function setButtonEnabled(btn, enabled) {
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? "1" : "0.6";
}

// Capture current frame into blob
function takeSnapshot(statusEl, retryBtn, acceptBtn) {
  if (!videoEl || !canvasEl || !imgEl) return;

  const w = videoEl.videoWidth || 640;
  const h = videoEl.videoHeight || 480;

  canvasEl.width = w;
  canvasEl.height = h;

  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);

  canvasEl.toBlob((blob) => {
    if (!blob) {
      if (statusEl) statusEl.textContent = "⚠️ Kunne ikke tage foto. Prøv igen.";
      return;
    }

    capturedBlob = blob;

    // show snapshot
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);

    imgEl.src = previewUrl;
    imgEl.style.display = "block";
    videoEl.style.display = "none";

    setButtonEnabled(retryBtn, true);
    setButtonEnabled(acceptBtn, true);

    if (statusEl) statusEl.textContent = "✅ Foto taget. Tryk ‘Accepter’ for at sende.";
  }, "image/jpeg", 0.9);
}

function retrySnapshot(statusEl, retryBtn, acceptBtn) {
  capturedBlob = null;

  if (imgEl) imgEl.style.display = "none";
  if (videoEl) videoEl.style.display = "block";

  setButtonEnabled(retryBtn, false);
  setButtonEnabled(acceptBtn, false);

  if (statusEl) statusEl.textContent = "";
}

// Upload blob via /upload
async function uploadBlob(blob) {
  const fd = new FormData();
  const file = new File([blob], "kreanissen.jpg", { type: blob.type || "image/jpeg" });
  fd.append("file", file);

  const res = await fetch("/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("upload failed");
  const json = await res.json();
  return json.filename;
}

// ---------------- Render ----------------
export function renderKreaNissen(ch, api, socket, myTeamName) {
  api.setBuzzEnabled(false);

  const pop = ensurePopup();
  pop.style.display = "flex";

  const promptEl = pop.querySelector("#knPrompt");
  const timeLeftEl = pop.querySelector("#knTimeLeft");

  videoEl = pop.querySelector("#knVideo");
  imgEl = pop.querySelector("#knSnapshot");
  canvasEl = pop.querySelector("#knCanvas");

  const takeBtn = pop.querySelector("#knTakeBtn");
  const retryBtn = pop.querySelector("#knRetryBtn");
  const acceptBtn = pop.querySelector("#knAcceptBtn");

  const fallbackWrap = pop.querySelector("#knFallbackWrap");
  const fileInput = pop.querySelector("#knFileInput");
  const sendFallbackBtn = pop.querySelector("#knSendFallbackBtn");

  const statusEl = pop.querySelector("#knStatus");
  const voteWrap = pop.querySelector("#knVoteWrap");

  promptEl.textContent = ch.text || "Lav noget kreativt og tag et billede!";
  voteWrap.innerHTML = "";

  // ---------------- CREATING PHASE ----------------
  if (ch.phase === "creating") {
    hasVoted = false;

    // Reset UI for new round
    capturedBlob = null;
    if (imgEl) imgEl.style.display = "none";
    if (videoEl) videoEl.style.display = "block";
    if (statusEl) statusEl.textContent = "";

    setButtonEnabled(retryBtn, false);
    setButtonEnabled(acceptBtn, false);

    // Start camera (or fallback)
    if (fallbackWrap) fallbackWrap.style.display = "none";
    startCamera(statusEl, fallbackWrap);

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

    // Buttons
    takeBtn.onclick = () => {
      if (hasSubmitted) return;
      takeSnapshot(statusEl, retryBtn, acceptBtn);
    };

    retryBtn.onclick = () => {
      if (hasSubmitted) return;
      retrySnapshot(statusEl, retryBtn, acceptBtn);
    };

    acceptBtn.onclick = async () => {
      if (hasSubmitted) return;
      if (!capturedBlob) return;

      hasSubmitted = true;
      setButtonEnabled(takeBtn, false);
      setButtonEnabled(retryBtn, false);
      setButtonEnabled(acceptBtn, false);
      if (statusEl) statusEl.textContent = "⏳ Sender billede…";

      try {
        const filename = await uploadBlob(capturedBlob);
        socket.emit("submitPhoto", { teamName: myTeamName, filename });
        if (statusEl) statusEl.textContent = "✅ Billede sendt!";
        stopCamera();
        setTimeout(() => (pop.style.display = "none"), 600);
      } catch {
        hasSubmitted = false;
        setButtonEnabled(takeBtn, true);
        setButtonEnabled(retryBtn, !!capturedBlob);
        setButtonEnabled(acceptBtn, !!capturedBlob);
        if (statusEl) statusEl.textContent = "⚠️ Upload fejlede. Prøv igen.";
      }
    };

    // Fallback upload (if camera fails)
    if (sendFallbackBtn && fileInput) {
      fileInput.onchange = () => {
        const f = fileInput.files?.[0] || null;
        if (!f) return;
        capturedBlob = f; // treat as blob/file
      };

      sendFallbackBtn.onclick = async () => {
        if (hasSubmitted) return;
        const f = fileInput.files?.[0];
        if (!f) {
          statusEl.textContent = "Vælg et billede først 🙂";
          return;
        }

        hasSubmitted = true;
        sendFallbackBtn.disabled = true;
        fileInput.disabled = true;
        statusEl.textContent = "⏳ Sender billede…";

        try {
          const filename = await uploadBlob(f);
          socket.emit("submitPhoto", { teamName: myTeamName, filename });
          statusEl.textContent = "✅ Billede sendt!";
          setTimeout(() => (pop.style.display = "none"), 600);
        } catch {
          hasSubmitted = false;
          sendFallbackBtn.disabled = false;
          fileInput.disabled = false;
          statusEl.textContent = "⚠️ Upload fejlede. Prøv igen.";
        }
      };
    }

    async function autoSubmit() {
      if (hasSubmitted) return;

      // If they haven't accepted a photo, send nothing
      if (!capturedBlob) {
        hasSubmitted = true;
        statusEl.textContent = "⏰ Tiden er gået – intet billede sendt.";
        stopCamera();
        setTimeout(() => (pop.style.display = "none"), 800);
        return;
      }

      hasSubmitted = true;
      setButtonEnabled(takeBtn, false);
      setButtonEnabled(retryBtn, false);
      setButtonEnabled(acceptBtn, false);
      statusEl.textContent = "⏳ Sender billede…";

      try {
        const filename = await uploadBlob(capturedBlob);
        socket.emit("submitPhoto", { teamName: myTeamName, filename });
        statusEl.textContent = "✅ Billede sendt!";
        stopCamera();
        setTimeout(() => (pop.style.display = "none"), 600);
      } catch {
        statusEl.textContent = "⚠️ Upload fejlede ved timeout.";
        stopCamera();
        setTimeout(() => (pop.style.display = "none"), 800);
      }
    }

    return;
  }

  // ---------------- VOTING PHASE ----------------
  if (ch.phase === "voting") {
    stopCamera();

    // hide camera UI
    if (videoEl) videoEl.style.display = "none";
    if (imgEl) imgEl.style.display = "none";

    setButtonEnabled(takeBtn, false);
    setButtonEnabled(retryBtn, false);
    setButtonEnabled(acceptBtn, false);
    if (fallbackWrap) fallbackWrap.style.display = "none";
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
    stopCamera();

    if (videoEl) videoEl.style.display = "none";
    if (imgEl) imgEl.style.display = "none";

    setButtonEnabled(takeBtn, false);
    setButtonEnabled(retryBtn, false);
    setButtonEnabled(acceptBtn, false);
    if (fallbackWrap) fallbackWrap.style.display = "none";
    timeLeftEl.parentElement.style.display = "none";

    const winners = ch.winners || [];
    statusEl.textContent = winners.length
      ? `🎉 Vindere: ${winners.join(", ")}`
      : "🎉 Runden er slut!";

    setTimeout(() => (pop.style.display = "none"), 6000);
  }
}
