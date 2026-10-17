// Reads a render percentage out of whatever a render prints.
// Understands: ffmpeg's own stats (Duration + time=), ffmpeg -progress (out_time + total from -t),
// "frame 123/5760" style counters, and tqdm-like "42%|####" bars.

export type Progress = { pct: number; detail: string };

const hms = (s: string) => {
  const [h, m, sec] = s.split(":").map(Number);
  return h * 3600 + m * 60 + sec;
};

export function parseProgress(text: string, cmd = ""): Progress | null {
  const t = text.slice(-6000);

  // "frame 123 / 5760", "frames: 123/5760", "[123/5760]"
  const counters = [...t.matchAll(/(?:frame|frames|fr|step)?\s*[:#\[]?\s*(\d{1,7})\s*\/\s*(\d{2,7})\b/gi)];
  const lastCounter = counters.at(-1);

  // tqdm / generic percent
  const pcts = [...t.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)];
  const lastPct = pcts.at(-1);

  // ffmpeg stats
  const dur = t.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/) ?? text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
  const times = [...t.matchAll(/(?:^|\s)time=\s*(\d+:\d+:\d+(?:\.\d+)?)/g)];
  const outTimes = [...t.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  const durFlag = cmd.match(/\s-t\s+(\d+(?:\.\d+)?)/);
  const frameStat = [...t.matchAll(/frame=\s*(\d+)/g)].at(-1);

  const candidates: { at: number; p: Progress }[] = [];
  if (lastCounter) {
    const [n, d] = [Number(lastCounter[1]), Number(lastCounter[2])];
    if (d > 0 && n <= d) candidates.push({ at: lastCounter.index!, p: { pct: (n / d) * 100, detail: `frame ${n.toLocaleString()} / ${d.toLocaleString()}` } });
  }
  if (lastPct) {
    const v = Number(lastPct[1]);
    if (v <= 100) candidates.push({ at: lastPct.index!, p: { pct: v, detail: `${v}%` } });
  }
  const total = dur ? hms(dur[1]) : durFlag ? Number(durFlag[1]) : 0;
  if (total > 0 && times.length) {
    const cur = hms(times.at(-1)![1]);
    const fr = frameStat ? `frame ${Number(frameStat[1]).toLocaleString()} · ` : "";
    candidates.push({ at: times.at(-1)!.index!, p: { pct: Math.min(100, (cur / total) * 100), detail: `${fr}${cur.toFixed(1)}s of ${total.toFixed(1)}s` } });
  }
  if (total > 0 && outTimes.length) {
    const cur = Number(outTimes.at(-1)![1]) / 1e6;
    candidates.push({ at: outTimes.at(-1)!.index!, p: { pct: Math.min(100, (cur / total) * 100), detail: `${cur.toFixed(1)}s of ${total.toFixed(1)}s` } });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.at - a.at);
  const p = candidates[0].p;
  return { pct: Math.max(0, Math.min(100, p.pct)), detail: p.detail };
}

// Only commands that actually produce a video: an ffmpeg encode to a video file, the clip-music-edit
// compositor, a render script, Remotion, or a Blender animation render. Mentions in grep/cat don't count.
const RENDER_CMD = [
  /\bffmpeg(\.exe)?\b(?=[^|;&\n]*\s-i\s)[^|;&\n]*\.(mp4|mov|webm|mkv|gif)\b/i,
  /\b(python|py|uv run)\b[^|;&\n]*\b(make\.py\s+render|render\.py)\b/i,
  /\bremotion\s+render\b/i,
  /\bblender\b[^|;&\n]*\s-b\b[^|;&\n]*\s-a\b/i,
];
const NOT_RENDER = /^\s*(grep|rg|cat|type|head|tail|sed|ls|dir|echo|git|Get-Content|Select-String)\b/i;

export function looksLikeRender(cmd: string): boolean {
  return RENDER_CMD.some((re) => re.test(cmd)) && !NOT_RENDER.test(cmd);
}

export function renderLabel(cmd: string): string {
  const out = cmd.match(/([^\s"'\\\/]+\.(mp4|mov|webm|mkv|gif))/gi);
  return out ? out.at(-1)! : "render";
}
