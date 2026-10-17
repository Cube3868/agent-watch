// Demo mode (?demo): a made-up crew of agents so anyone can see Agent Watch without logs,
// and so screenshots and the launch film never show real work. Timing uses setTimeout and
// Date.now only, so a test clock can drive it frame by frame.
(() => {
  const live = document.getElementById("live"), txt = document.getElementById("liveText");
  live.classList.remove("off");
  txt.textContent = "demo";

  let lineId = 1;
  const T0 = Date.now();
  const crew = new Map();
  const make = (id, kind, name, sub, extra = {}) => {
    const a = { id, kind, name, sub, state: "working", last: Date.now(), doing: "", lines: [], images: [], ...extra };
    crew.set(id, a);
    return a;
  };
  const emit = (a) => update(JSON.parse(JSON.stringify(a)));
  const line = (a, k, t) => { a.lines.push({ id: lineId++, k, t }); if (a.lines.length > 30) a.lines.shift(); a.last = Date.now(); };
  const act = (id, fn) => () => { const a = crew.get(id); fn(a); a.last = Date.now(); emit(a); };

  // ---- generated "AI images": quiet landscapes in the Aurora colors ----
  function art(seed, w = 384) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const c = document.createElement("canvas"); c.width = c.height = w;
    const g = c.getContext("2d");
    const skies = [["#0b1440", "#3b3fa8", "#8a7cf0"], ["#06202e", "#0f6f7c", "#7de3d8"], ["#1a0f3d", "#6b3fa0", "#f0a6ca"], ["#081a33", "#1f5fa8", "#9ad1ff"], ["#121026", "#3a2d7a", "#c4b5fd"]];
    const [a, b, d] = skies[seed % skies.length];
    const sky = g.createLinearGradient(0, 0, 0, w); sky.addColorStop(0, a); sky.addColorStop(.62, b); sky.addColorStop(1, d);
    g.fillStyle = sky; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * .8})`; g.fillRect(rnd() * w, rnd() * w * .55, 1.4, 1.4); }
    const mx = w * (.25 + rnd() * .5), my = w * (.2 + rnd() * .15), mr = w * (.06 + rnd() * .05);
    const glow = g.createRadialGradient(mx, my, mr * .5, mx, my, mr * 4); glow.addColorStop(0, "rgba(255,255,255,.35)"); glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow; g.fillRect(0, 0, w, w);
    g.fillStyle = "#f4f1ff"; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
    for (let layer = 0; layer < 4; layer++) {
      const base = w * (.55 + layer * .11), amp = w * (.12 - layer * .02);
      g.fillStyle = `rgba(${10 + layer * 6},${12 + layer * 8},${40 + layer * 10},${.55 + layer * .15})`;
      g.beginPath(); g.moveTo(0, w);
      for (let x = 0; x <= w; x += w / 24) g.lineTo(x, base - Math.abs(Math.sin(x / w * (3 + layer) + seed + layer)) * amp - rnd() * amp * .25);
      g.lineTo(w, w); g.fill();
    }
    return c.toDataURL("image/jpeg", .9);
  }

  // ---- the crew ----
  make("plan", "session", "Planner", "Claude · Opus");
  make("front", "session", "Frontend", "Claude · Sonnet");
  make("api", "session", "Backend API", "Claude · Opus");
  make("art", "codex", "Concept art", "Codex · image run");
  make("film", "session", "Trailer render", "Claude · Sonnet");
  make("h1", "helper", "Find unused exports", "Helper · explorer", { parent: "plan" });
  make("h2", "helper", "Check the API docs", "Helper · reviewer", { parent: "plan" });
  make("inbox", "session", "Support inbox", "Claude · Haiku", { state: "idle" });
  make("notes", "session", "Release notes", "Claude · Sonnet", { state: "idle" });
  make("icons", "codex", "App icons", "Codex · image run", { state: "done" });
  make("palette", "codex", "Palette study", "Codex · image run", { state: "done" });
  make("lint", "helper", "Lint pass", "Helper · general", { parent: "plan", state: "done" });

  const seedLines = {
    plan: [["in", "you: get v1.2 ready to ship tonight"], ["cmd", "git log --oneline -5"], ["out", "a41c2e9 settings: dark mode toggle"], ["say", "Three pieces: API limits, the settings screen, and docs. Sending two helpers."]],
    front: [["file", "✎ src/components/Settings.tsx"], ["del", "-   <Toggle label=\"Dark\" />"], ["add", "+   <Toggle label=\"Dark mode\" checked={theme === \"dark\"} onChange={setTheme} />"]],
    api: [["cmd", "pnpm db:migrate"], ["out", "✓ 0012_rate_limits applied"], ["say", "Rate limits are in. Writing tests next."]],
    art: [["in", "asked: four moody landscape covers for the launch post"]],
    film: [["cmd", "ffmpeg -i edit.mov -c:v libx264 -crf 18 trailer.mp4"]],
    h1: [["cmd", "search \"export function\" in src"], ["say", "Found 7 exports nothing uses."]],
    h2: [["cmd", "read docs/api.md"], ["say", "Two endpoints are missing from the docs."]],
    inbox: [["say", "Drafted a reply to the refund question. Want me to send it?"]],
    notes: [["say", "Release notes are ready for your read."]],
    icons: [["say", "✓ Made 4 icon options."]],
    palette: [["say", "✓ Palette study done."]],
    lint: [["say", "✓ No lint errors."]],
  };
  const doing = { plan: "Splitting the release into tasks", front: "Editing Settings.tsx", api: "Running database migrations", art: "Making an image",
    film: "Rendering trailer.mp4", h1: "Looking for unused code", h2: "Reading the API docs", inbox: "Waiting for you", notes: "Waiting for you", icons: "Finished", palette: "Finished", lint: "Finished" };
  for (const [id, a] of crew) { a.doing = doing[id]; for (const [k, t] of seedLines[id] ?? []) line(a, k, t); }
  crew.get("icons").images = [0, 1, 2, 3].map((i) => ({ key: "icon" + i, name: "icon.jpg", t: T0, src: art(10 + i, 160) }));
  crew.get("palette").images = [0, 1, 2].map((i) => ({ key: "pal" + i, name: "palette.jpg", t: T0, src: art(20 + i, 160) }));
  crew.get("film").render = { label: "trailer.mp4", pct: 0, detail: "frame 0 / 1,440", t: T0, done: false };
  for (const id of ["inbox", "notes", "icons", "palette", "lint"]) crew.get(id).last = T0 - (id === "inbox" ? 4 : 12) * 60_000;
  ["plan", "front", "api", "art", "film", "h1", "h2", "inbox", "notes", "icons", "palette", "lint"].forEach((id) => emit(crew.get(id)));

  // ---- the script: [ms after start, what happens] ----
  const script = [
    [900, act("front", (a) => { line(a, "cmd", "pnpm vitest run settings"); a.doing = "Running the settings tests"; })],
    [1800, act("api", (a) => { a.doing = "Writing tests for rate limits"; line(a, "file", "✎ tests/limits.test.ts"); line(a, "add", "+ it(\"blocks the 101st call in a minute\", …)"); })],
    [2600, act("art", (a) => { line(a, "cmd", "image_gen \"misty mountains, moon, deep blue\""); })],
    [3400, act("front", (a) => { line(a, "out", "✓ settings.test.tsx (12 tests) 640ms"); line(a, "say", "Dark mode toggle works and remembers your choice."); })],
    [4300, act("h1", (a) => { a.doing = "Checking each unused export"; line(a, "cmd", "search \"formatLegacyDate\""); })],
    [5200, act("art", (a) => { a.images.push({ key: "a0", name: "cover-1.jpg", t: Date.now(), src: art(1) }); line(a, "file", "🖼 new image cover-1.jpg"); })],
    [6200, act("plan", (a) => { a.doing = "Reviewing the helpers' findings"; line(a, "say", "Helpers found 7 unused exports and 2 missing doc pages."); })],
    [7000, act("api", (a) => { line(a, "cmd", "pnpm test api"); a.doing = "Running the API tests"; })],
    [7900, act("art", (a) => { a.images.push({ key: "a1", name: "cover-2.jpg", t: Date.now(), src: art(2) }); line(a, "file", "🖼 new image cover-2.jpg"); })],
    [8800, act("h2", (a) => { a.doing = "Writing the missing docs"; line(a, "file", "✎ docs/api.md"); line(a, "add", "+ ## GET /v1/limits"); })],
    [9600, act("api", (a) => { line(a, "out", "✓ 48 passed, 0 failed"); line(a, "say", "All API tests pass."); })],
    [10600, act("art", (a) => { a.images.push({ key: "a2", name: "cover-3.jpg", t: Date.now(), src: art(3) }); line(a, "file", "🖼 new image cover-3.jpg"); })],
    [11600, act("front", (a) => { a.doing = "Polishing the settings screen"; line(a, "file", "✎ src/styles/settings.css"); line(a, "add", "+   border-radius: 14px;"); })],
    [12600, act("h1", (a) => { a.state = "done"; a.doing = "Finished"; line(a, "say", "✓ Removed 7 unused exports."); })],
    [13400, act("art", (a) => { a.images.push({ key: "a3", name: "cover-4.jpg", t: Date.now(), src: art(4) }); line(a, "file", "🖼 new image cover-4.jpg"); line(a, "say", "Four covers ready. Number 2 matches the brand best."); })],
    [14500, act("plan", (a) => { line(a, "cmd", "gh pr create --title \"v1.2\""); line(a, "out", "https://github.com/you/app/pull/128"); a.doing = "Opening the release pull request"; })],
    [15600, act("api", (a) => { a.doing = "Updating the changelog"; line(a, "file", "✎ CHANGELOG.md"); line(a, "add", "+ - Rate limits on every endpoint"); })],
    [17000, act("h2", (a) => { a.state = "done"; a.doing = "Finished"; line(a, "say", "✓ Docs updated."); })],
    [18500, act("front", (a) => { line(a, "cmd", "pnpm build"); line(a, "out", "✓ built in 4.1s"); })],
  ];
  for (const [ms, fn] of script) setTimeout(fn, ms);

  // the render ticks steadily from 0 to 100%
  const TOTAL = 1440, RENDER_MS = 20_000;
  const tickRender = () => {
    const a = crew.get("film");
    const p = Math.min(1, (Date.now() - T0 - 1200) / RENDER_MS);
    if (p < 0) return setTimeout(tickRender, 200);
    const f = Math.round(p * TOTAL);
    a.render = { label: "trailer.mp4", pct: p * 100, detail: p >= 1 ? "finished" : `frame ${f.toLocaleString()} / ${TOTAL.toLocaleString()}`, t: Date.now(), done: p >= 1 };
    a.doing = p >= 1 ? "Trailer rendered" : "Rendering trailer.mp4";
    if (p >= 1) line(a, "say", "✓ trailer.mp4 is done: 48 seconds, 1080p.");
    a.last = Date.now(); emit(a);
    if (p < 1) setTimeout(tickRender, 250);
  };
  tickRender();

  // keep the page alive for people trying it: replay the day every 40 seconds
  if (!new URLSearchParams(location.search).has("film")) setTimeout(() => location.reload(), 40_000);
})();
