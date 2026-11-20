/**
 * Automated Demo Recording Template
 *
 * Adapt this template for each project. Replace the section actions
 * with interactions specific to the app being demoed.
 *
 * Usage:
 *   1. npm i -D @playwright/test tsx
 *   2. npx playwright install chromium
 *   3. Start the dev server
 *   4. npx tsx scripts/record-demo.ts
 *
 * After recording, merge with narration audio:
 *   ffmpeg -i recordings/<video>.webm -i recordings/<audio>.mp3 \
 *     -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k \
 *     -shortest -y recordings/demo.mp4
 *
 * See references/demo-recording-guide.md for the full workflow.
 */

import { chromium, type Page } from "@playwright/test";

// ── Configuration ──────────────────────────────────────────────
const BASE_URL = "http://localhost:5173"; // adjust to your dev server
const VIEWPORT = { width: 1920, height: 1080 };

// ── Audio section timestamps (seconds) ─────────────────────────
// Run silence detection on the narration audio to find these:
//   ffmpeg -i narration.mp3 -af silencedetect=noise=-30dB:d=0.5 -f null - 2>&1
// Update these values to match your audio's section boundaries.
const AUDIO_SECTIONS = {
  section1: 0,    // e.g. visual overview
  section2: 15,   // e.g. onboarding / setup
  section3: 39,   // e.g. feature walkthrough
  section4: 57,   // e.g. panels / selection
  section5: 76,   // e.g. toolbar / controls
  closing: 91,    // e.g. wrap-up
  end: 102,       // video ends (a few seconds past audio end)
};

// ── Helpers ────────────────────────────────────────────────────
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: "recordings/", size: VIEWPORT },
  });
  const page = await context.newPage();

  // Start fresh
  await page.addInitScript(() => localStorage.clear());
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Wall-clock timer for syncing video to audio sections
  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  const waitUntil = async (sec: number) => {
    const remaining = sec - elapsed();
    if (remaining > 0) await wait(remaining * 1000);
  };

  // ── Section 1 ──────────────────────────────────────────────
  // Audio describes the visual design. Show the UI, no actions.
  // (The app is already visible from page load.)

  // ── Section 2 ──────────────────────────────────────────────
  await waitUntil(AUDIO_SECTIONS.section2);
  // TODO: Add section 2 actions (e.g. fill forms, navigate setup)

  // ── Section 3 ──────────────────────────────────────────────
  await waitUntil(AUDIO_SECTIONS.section3);
  // TODO: Add section 3 actions (e.g. guided tour, feature demo)

  // ── Section 4 ──────────────────────────────────────────────
  await waitUntil(AUDIO_SECTIONS.section4);
  // TODO: Add section 4 actions (e.g. panel interactions, selection)

  // ── Section 5 ──────────────────────────────────────────────
  await waitUntil(AUDIO_SECTIONS.section5);
  // TODO: Add section 5 actions (e.g. toolbar controls)

  // ── Closing ────────────────────────────────────────────────
  await waitUntil(AUDIO_SECTIONS.end);

  await context.close();
  await browser.close();

  console.log("\nDemo recording saved to recordings/ directory.");
}

main().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
