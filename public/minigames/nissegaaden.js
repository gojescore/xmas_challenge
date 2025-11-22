// public/minigames/nissegaaden.js
// Owns NisseGåden UI mode (big riddle text)

function enableBigRiddleMode() {
  document.body.classList.add("nissegaaden-mode");
}

function disableBigRiddleMode() {
  document.body.classList.remove("nissegaaden-mode");
}

/**
 * Called when NisseGåden is selected.
 * team.js already sets #challengeTitle and #challengeText,
 * and shows the answer input. We just enable big text mode.
 */
export function renderNisseGaaden(challenge, api) {
  enableBigRiddleMode();

  // NisseGåden never uses buzz
  api?.setBuzzEnabled?.(false);

  // Optional: if challenge has an imageUrl, show it under the text
  // (safe, doesn't break if not present)
  const existingImg = document.getElementById("nissegaadenImg");
  if (existingImg) existingImg.remove();

  if (challenge?.imageUrl) {
    const img = document.createElement("img");
    img.id = "nissegaadenImg";
    img.src = challenge.imageUrl;
    img.alt = "NisseGåden billede";
    img.style.cssText = `
      display:block;
      max-width:90%;
      margin:14px auto 0 auto;
      border-radius:12px;
      box-shadow:0 4px 12px rgba(0,0,0,0.25);
    `;

    const textEl = document.getElementById("challengeText");
    textEl?.parentElement?.appendChild(img);
  }
}

/**
 * Called by team.js every time BEFORE rendering any challenge.
 * Ensures big text mode is removed when leaving NisseGåden.
 */
export function stopNisseGaaden(api) {
  disableBigRiddleMode();

  // Remove optional image if it exists
  const existingImg = document.getElementById("nissegaadenImg");
  if (existingImg) existingImg.remove();
}
