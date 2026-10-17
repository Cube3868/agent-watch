// Records launch/film.html frame by frame into an MP4.
//   bun server.ts --demo --port=3871      (in another terminal)
//   bun launch/record.ts                   → launch/out/agent-watch-launch.mp4
// The page clock is frozen and stepped one frame at a time, so the film is identical every run
// and never drops frames, however slow the screenshots are.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FPS = 30;
const BASE = process.env.FILM_URL ?? "http://127.0.0.1:3871";
const OUT = join(import.meta.dir, "out");
const CHROME = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
const AUDIO = join(OUT, "bed.wav");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.clock.install({ time: new Date("2026-10-18T12:00:00Z") });
await context.clock.pauseAt(new Date("2026-10-18T12:00:01Z"));
const page = await context.newPage();
await page.goto(`${BASE}/film`, { waitUntil: "networkidle" });
await page.frameLocator("#app").locator(".card").first().waitFor();
await page.evaluate(() => document.fonts.ready);
await page.frameLocator("#app").locator("body").evaluate(() => document.fonts.ready);
const duration: number = await page.evaluate(() => (window as any).DURATION);
const frames = Math.round(duration * FPS);

const out = join(OUT, "agent-watch-launch.mp4");
const ffArgs = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"];
if (existsSync(AUDIO)) ffArgs.push("-i", AUDIO, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest");
ffArgs.push("-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });

for (let f = 0; f < frames; f++) {
  if (f > 0) await context.clock.runFor(1000 / FPS);
  await page.evaluate((t) => (window as any).render(t), f / FPS);
  const png = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 30 === 0) console.log(`frame ${f}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`wrote ${out} (${frames} frames)`);
