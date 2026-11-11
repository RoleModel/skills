# Automated Demo Recording

Generate narrated screen recordings of web projects using Playwright and ffmpeg. Useful as a client deliverable alongside the audit report — shows the redesigned experience in action with synchronized voiceover.

## Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| **Playwright** | `npm i -D @playwright/test` then `npx playwright install chromium` | Browser automation + video capture |
| **tsx** | `npm i -D tsx` (or use `npx tsx`) | Run TypeScript scripts directly |
| **ffmpeg** | `brew install ffmpeg` | Merge video + audio, re-encode |

## Workflow

```
1. Write the recording script    → scripts/record-demo.ts
2. Write the narration text      → scripts/demo-narration.md
3. Run the recording             → npm run record-demo
4. Generate audio from narration → Hedra, ElevenLabs, or any TTS
5. Merge video + audio           → ffmpeg
```

## Step 1: Recording Script

Create `scripts/record-demo.ts`. The script launches a Chromium browser, navigates through the app, and Playwright captures everything as a `.webm` video.

### Key patterns

**Timer-based section sync** — Use a wall-clock timer so each section of the demo starts at the exact second its narration begins, regardless of how long individual actions take:

```typescript
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;
const waitUntil = async (sec: number) => {
  const remaining = sec - elapsed();
  if (remaining > 0) await wait(remaining * 1000);
};

// Section 1 narration starts at 0s — just show the UI
await waitUntil(15); // Section 2 narration starts at 15s
// ... wizard actions ...
await waitUntil(39); // Section 3 narration starts at 39s
// ... tour actions ...
```

**Query real element positions** — Don't hardcode coordinates. Query the DOM for element positions and derive click targets:

```typescript
const rect = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="building-rect"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
```

**Robust selectors** — When duplicate elements exist (e.g. mobile vs desktop), scope selectors to the visible container:

```typescript
const centerBarBtn = (page: Page, label: string) =>
  page.locator(".hidden.md\\:block").locator(`button[aria-label="${label}"]`);
```

**Force-click for overlays** — Tooltips, tours, and modals may render outside the viewport. Use `force: true`:

```typescript
await tooltip.locator("button", { hasText: "Next" }).click({ force: true });
```

### Viewport and recording setup

```typescript
const VIEWPORT = { width: 1920, height: 1080 };

const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: "recordings/", size: VIEWPORT },
});
```

Use 1920x1080 for a standard HD recording. Smaller viewports may cut off content, especially for apps with large canvas areas.

### Fresh state

Clear localStorage/sessionStorage before each run so the app starts from its initial state:

```typescript
await page.addInitScript(() => localStorage.clear());
```

## Step 2: Narration Script

Write the narration as plain text with `/pause` markers between sections (for TTS tools like Hedra that respect them). Target the audience — for client demos, focus on what changed rather than explaining the product:

```
The first thing you'll notice is the completely new visual design... /pause
When users first open the app, a guided setup wizard... /pause
```

## Step 3: Run the Recording

Add a script to `package.json`:

```json
{
  "scripts": {
    "record-demo": "npx tsx scripts/record-demo.ts"
  }
}
```

Make sure the dev server is running first, then:

```bash
npm run record-demo
```

Output lands in `recordings/` as a `.webm` file.

## Step 4: Generate Audio

Paste the narration text into your TTS tool of choice. Drop the resulting `.mp3` or `.wav` into the `recordings/` directory.

## Step 5: Detect Audio Section Timing

Use ffmpeg's silence detection to find where each narration section starts and ends. This tells you the exact timestamps to use in `waitUntil()` calls:

```bash
ffmpeg -i recordings/narration.mp3 \
  -af silencedetect=noise=-30dB:d=0.5 \
  -f null - 2>&1 | grep -E "silence_start|silence_end"
```

Look for silences longer than 1.5 seconds — these mark the `/pause` boundaries between sections. Map them to your script's `waitUntil()` targets.

## Step 6: Merge Video + Audio

Playwright outputs VP8/WebM. Re-encode to H.264 for universal playback:

```bash
ffmpeg \
  -i recordings/screen-recording.webm \
  -i recordings/narration.mp3 \
  -c:v libx264 -preset fast -crf 20 \
  -c:a aac -b:a 128k \
  -shortest \
  -y recordings/final-demo.mp4
```

The `-shortest` flag trims whichever track is longer. Make sure the video is at least a few seconds longer than the audio so nothing gets cut off — add extra wait time at the end of the script.

## Tips

- **Add `data-testid` attributes** to key elements in the app so the recording script can find them reliably.
- **Add `recordings/` to `.gitignore`** — generated videos shouldn't be committed.
- **Clean old recordings** before each run — Playwright generates random filenames.
- **Account for action overhead** — each Playwright click/fill adds ~50-200ms. The `waitUntil()` pattern absorbs this automatically.
- **Test without audio first** — get the video looking right, then worry about sync.
- **Iterate on timing** — run silence detection on the final audio, update `waitUntil()` targets, re-record, and re-merge. Usually takes 2-3 passes to nail the sync.
