// public/minigames/kreanissen.js v2.3
// KreaNissen: camera photo only (take/retake/accept) + anonymous voting
// Fixes:
// - Prevents local taken-photo preview from being reset when another team submits (no more "my photo disappeared")
// - Keeps your v2.2 UX: take/retake/accept only, no upload option
// - Uses server timing: phaseStartAt + phaseDurationSec
// - Second round reliably resets (keyed by phaseStartAt)

let timer = null;
let popup = null;
let hasSubmitted = false;
let hasVoted = false;

// webcam
let stream = null;
let videoEl = null;
let canvasEl = null;
let photoImgEl = null;
let photoBlob = null;
let previewUrl = null;

// Track current round so a second KreaNissen starts fresh
let roundKey = "";

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
      width:min(820px, 96vw);
      background:#fff7ef;
      border:8px solid #0b6;
      border-radius:18px;
      padding:18px;
      box-shadow:0 8px 30px rgba(0,0,0,0.3);
      text-align:center;
      font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">
      <h2 style="margin:0 0 8px; font-size:2.1rem;">🎨 KreaNissen</h2>
      <p id="knPrompt" style="font-size:1.3rem; font-weight:800; margin:0 0 10px;"></p>

      <div id="knTimerRow" style="font-weight:900; font-size:1.3rem; margin-bottom:10px;">
        Tid tilbage: <span id="knTimeLeft">180</span>s
      </div>

      <div id="knCameraWrap" style="display:flex; flex-direction:column; gap:10px; align-items:center;">
        <video id="knVideo" autoplay playsinline style="
          width:100%; max-width:640px; border-radius:12px; border:2px solid #ccc; background:#000;
        "></video>

        <img id="knPhotoPreview" style="
          display:none; width:100%; max-width:640px;
          border-radius:12px; border:2px solid #ccc;
        " />

        <canvas id="knCanvas" style="display:none;"></canvas>

        <div id="knButtons" style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">
          <button id="knTakeBtn" style="
            font-size:1.3rem; font-weight:900; padding:10px 14px;
            border-radius:12px; border:none; background:#0b6; color:#fff; cursor:pointer;
          ">📸 Tag foto</button>

          <button id="knRetryBtn" disabled style="
            font-size:1.3rem; font-weight:900; padding:10px 14px;
            border-radius:12px; border:none; background:#555; color:#fff; cursor:pointer;
            opacity:0.6;
          ">🔁 Prøv igen</button>

          <button id="knAcceptBtn" disabled style="
            font-size:1.3rem; font-weight:900; padding:10px 14px;
            border-radius:12px; border:none; background:#1a7f37; color:#fff; cursor:pointer;
            opacity:0.6;
          ">✅ Accepter</button>
        </div>

        <p id="knStatus" style="margin:0; font-weight:800;"></p>
      </div>

      <div id="knVoteWrap" style="margin-top:14px;"></div>
    </div>
  `;

  document.body.appendChild(popup);
  return popup;
}

async function startCameraIfNeeded() {
  // Do not restart the stream on every re-render.
  // Also: if a photo is currently previewed (video hidden), do not restart.
  if (stream) return;
  if (videoEl && videoEl.style.display === "none") return;

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
    console.error(err);
    throw new Error("camera_denied");
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => {
      try { t.stop(); } catch {}
    });
    stream = null;
  }
}

function clearPhoto() {
  photoBlob = null;

  if (previewUrl) {
    try { URL.revokeObjectURL(previewUrl); } catch {}
    previewUrl = null;
  }

  if (photoImgEl) {
    photoImgEl.src = "";
    photoImgEl.style.display = "none";
  }
  if (videoEl) videoEl.style.display = "block";
}

function takePhoto() {
  if (!videoEl || !canvasEl) return;

  const w = videoEl.videoWidth || 640;
  const h = videoEl.videoHeight || 480;

  canvasEl.width = w;
  canvasEl.height = h;

  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);

  return new Promise((resolve) => {
    canvasEl.toBlob((blob) => {
      photoBlob = blob;

      if (photoImgEl) {
        if (previewUrl) {
          try { URL.revokeObjectURL(previewUrl); } catch {}
        }
        previewUrl = URL.createObjectURL(blob);
        photoImgEl.src = previewUrl;
        photoImgEl.style.display = "block";
      }

      if (videoEl) videoEl.style.display = "none";
      resolve(blob);
    }, "image/jpeg", 0.9);
  });
}

async function uploadBlob(blob) {
  const fd = new FormData();
  fd.append("file", blob, "kreanissen.jpg");

  const res = await fetch("/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("upload failed");
  const json = await res.json();
  return json.filename;
}

function setCameraUiMode(pop, mode) {
  // mode: "camera" | "submitted" | "hidden"
  const cameraWrap = pop.querySelector("#knCameraWrap");
  if (!cameraWrap) return;

  if (mode === "hidden") {
    cameraWrap.style.display = "none";
    return;
  }

  cameraWrap.style.display = "flex";

  const takeBtn = pop.querySelector("#knTakeBtn");
  const retryBtn = pop.querySelector("#knRetryBtn");
  const acceptBtn = pop.querySelector("#knAcceptBtn");

  if (takeBtn) takeBtn.style.display = "inline-block";
  if (retryBtn) retryBtn.style.display = "inline-block";
  if (acceptBtn) acceptBtn.style.display = "inline-block";

  if (mode === "submitted") {
    if (takeBtn) { takeBtn.disabled = true; }
    if (retryBtn) { retryBtn.disabled = true; retryBtn.style.opacity = "0.6"; }
    if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.style.opacity = "0.6"; }

    // Hide live camera/preview (submitted message only)
    if (videoEl) videoEl.style.display = "none";
    if (photoImgEl) photoImgEl.style.display = "none";
  }
}

function maybeResetForNewRound(ch) {
  const key = String(ch?.phaseStartAt || "");
  if (!key) return;

  if (key !== roundKey) {
    roundKey = key;
    hasSubmitted = false;
    hasVoted = false;

    // Reset local camera/preview state for the new round
    stopCamera();
    clearPhoto();
  }
}

export function stopKreaNissen(api) {
  if (timer) clearInterval(timer);
  timer = null;

  stopCamera();

  if (popup) popup.remove();
  popup = null;

  hasSubmitted = false;
  hasVoted = false;
  roundKey = "";

  clearPhoto();
  api?.showStatus?.("");
}

export async function renderKreaNissen(ch, api, socket, myTeamName) {
  api.setBuzzEnabled(false);

  const pop = ensurePopup();
  pop.style.display = "flex";

  maybeResetForNewRound(ch);

  const promptEl = pop.querySelector("#knPrompt");
  const timeLeftEl = pop.querySelector("#knTimeLeft");
  const statusEl = pop.querySelector("#knStatus");
  const voteWrap = pop.querySelector("#knVoteWrap");
  const timerRow = pop.querySelector("#knTimerRow");

  videoEl = pop.querySelector("#knVideo");
  canvasEl = pop.querySelector("#knCanvas");
  photoImgEl = pop.querySelector("#knPhotoPreview");

  const takeBtn = pop.querySelector("#knTakeBtn");
  const retryBtn = pop.querySelector("#knRetryBtn");
  const acceptBtn = pop.querySelector("#knAcceptBtn");

  if (promptEl) promptEl.textContent = ch.text || "Lav noget kreativt og tag et billede!";

  // ---------------- CREATING PHASE ----------------
  if (ch.phase === "creating") {
    hasVoted = false;

    if (voteWrap) voteWrap.innerHTML = "";
    setCameraUiMode(pop, hasSubmitted ? "submitted" : "camera");
    if (timerRow) timerRow.style.display = "block";

    if (statusEl) {
      statusEl.textContent = hasSubmitted
        ? "✅ Dit billede er sendt. Vent på afstemning…"
        : "";
    }

    // IMPORTANT: Do NOT reset the local "photo taken" UI if photoBlob exists.
    const hasTakenPhoto = !!photoBlob;

    if (takeBtn) takeBtn.disabled = hasSubmitted;

    if (retryBtn) {
      retryBtn.disabled = hasSubmitted ? true : !hasTakenPhoto;
      retryBtn.style.opacity = retryBtn.disabled ? "0.6" : "1";
    }

    if (acceptBtn) {
      acceptBtn.disabled = hasSubmitted ? true : !hasTakenPhoto;
      acceptBtn.style.opacity = acceptBtn.disabled ? "0.6" : "1";
    }

    // Start camera only if not submitted and we are not currently previewing a photo
    if (!hasSubmitted && !hasTakenPhoto) {
      try {
        await startCameraIfNeeded();
      } catch {
        if (statusEl) statusEl.textContent = "⚠️ Kamera kræver tilladelse.";
      }
    } else {
      // If submitted or previewing, we do not need a running stream.
      if (hasSubmitted) stopCamera();
    }

    if (takeBtn) {
      takeBtn.onclick = async () => {
        if (hasSubmitted) return;
        await takePhoto();

        // Enable retry + accept (and do NOT get reset on other teams' submits)
        if (retryBtn) { retryBtn.disabled = false; retryBtn.style.opacity = "1"; }
        if (acceptBtn) { acceptBtn.disabled = false; acceptBtn.style.opacity = "1"; }
      };
    }

    if (retryBtn) {
      retryBtn.onclick = () => {
        if (hasSubmitted) return;
        clearPhoto();
        stopCamera(); // ensures a clean restart
        if (retryBtn) { retryBtn.disabled = true; retryBtn.style.opacity = "0.6"; }
        if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.style.opacity = "0.6"; }
      };
    }

    if (acceptBtn) {
      acceptBtn.onclick = async () => {
        if (hasSubmitted) return;

        if (!photoBlob) {
          if (statusEl) statusEl.textContent = "Tag et foto først 🙂";
          return;
        }

        hasSubmitted = true;

        if (takeBtn) takeBtn.disabled = true;
        if (retryBtn) retryBtn.disabled = true;
        if (acceptBtn) acceptBtn.disabled = true;

        if (statusEl) statusEl.textContent = "⏳ Sender billede…";

        try {
          const filename = await uploadBlob(photoBlob);
          socket.emit("submitPhoto", { teamName: myTeamName, filename });

          stopCamera();

          setCameraUiMode(pop, "submitted");
          if (statusEl) statusEl.textContent = "✅ Dit billede er sendt. Vent på afstemning…";
        } catch (e) {
          console.error(e);
          hasSubmitted = false;

          if (takeBtn) takeBtn.disabled = false;

          // If a photo is still present, allow accept/retry again
          const stillHasPhoto = !!photoBlob;
          if (retryBtn) { retryBtn.disabled = !stillHasPhoto; retryBtn.style.opacity = retryBtn.disabled ? "0.6" : "1"; }
          if (acceptBtn) { acceptBtn.disabled = !stillHasPhoto; acceptBtn.style.opacity = acceptBtn.disabled ? "0.6" : "1"; }

          if (statusEl) statusEl.textContent = "⚠️ Upload fejlede. Prøv igen.";
        }
      };
    }

    const startAt = ch.phaseStartAt;
    const total = ch.phaseDurationSec ?? 180;

    function tick() {
      if (typeof startAt !== "number") {
        if (timeLeftEl) timeLeftEl.textContent = String(total);
        return;
      }

      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const left = Math.max(0, total - elapsed);

      if (timeLeftEl) timeLeftEl.textContent = String(left);

      if (left <= 0) {
        clearInterval(timer);
        timer = null;

        if (!hasSubmitted && photoBlob && acceptBtn) {
          acceptBtn.click();
        } else {
          stopCamera();
          if (!hasSubmitted && statusEl) statusEl.textContent = "⏰ Tiden er gået.";
        }
      }
    }

    if (timer) clearInterval(timer);
    if (!hasSubmitted) timer = setInterval(tick, 250);
    tick();

    return;
  }

  // ---------------- VOTING PHASE ----------------
  if (ch.phase === "voting") {
    stopCamera();
    if (timer) clearInterval(timer);
    timer = null;

    if (timerRow) timerRow.style.display = "none";
    setCameraUiMode(pop, "hidden");

    if (statusEl) {
      statusEl.textContent = hasVoted
        ? "✅ Din stemme er afgivet!"
        : "Afstemning i gang! Stem på det bedste billede.";
    }

    const photos = Array.isArray(ch.votingPhotos) ? ch.votingPhotos : [];
    if (!photos.length) {
      if (voteWrap) {
        voteWrap.innerHTML = `
          <div style="font-weight:900; padding:14px;">
            ⏳ Vent… læreren forbereder afstemningen.
          </div>
        `;
      }
      return;
    }

    if (voteWrap) voteWrap.innerHTML = "";

    const grid = document.createElement("div");
    grid.style.cssText = `
      display:grid; gap:10px;
      grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
    `;

    const v = typeof ch.phaseStartAt === "number" ? ch.phaseStartAt : 1;

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
        <img src="/uploads/${p.filename}?v=${v}" style="
          width:100%; border-radius:10px; margin-top:6px;
          border:1px solid #ccc; display:block;
        "/>
        ${isMine ? '<div style="margin-top:6px; font-weight:800;">(Dit billede)</div>' : ""}
      `;

      btn.onclick = () => {
        if (hasVoted || isMine) return;
        hasVoted = true;
        socket.emit("vote", i);

        api.showStatus("✅ Din stemme er afgivet!");
        if (statusEl) statusEl.textContent = "✅ Tak for din stemme!";
        [...grid.querySelectorAll("button")].forEach(b => (b.disabled = true));
      };

      grid.appendChild(btn);
    });

    if (voteWrap) voteWrap.appendChild(grid);
    return;
  }

  // ---------------- ENDED PHASE ----------------
  if (ch.phase === "ended") {
    stopCamera();
    if (timer) clearInterval(timer);
    timer = null;

    if (timerRow) timerRow.style.display = "none";
    setCameraUiMode(pop, "hidden");

    const winners = ch.winners || [];
if (statusEl) {
  statusEl.textContent = winners.length
    ? `🎉 Vindere: ${winners.join(", ")} — afgjort ved jeres afstemning`
    : "🎉 Runden er slut! — afgjort ved jeres afstemning";
}

    api?.showStatus?.("Vent på læreren…");
    setTimeout(() => (pop.style.display = "none"), 6000);
  }
}

