// Agent Watch: a live view of what your AI agents are doing. Reads logs read-only, serves on 127.0.0.1 only.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { scanClaude } from "./src/claude";
import { scanCodex } from "./src/codex";
import { snapshot, subscribe, flush, imagePaths } from "./src/store";

const args = process.argv.slice(2);
const DEMO = args.includes("--demo");
const portArg = args.find((a) => a.startsWith("--port="));
const PORT = Number(portArg?.split("=")[1] ?? process.env.AGENT_WATCH_PORT ?? 3870);
const PUBLIC = join(import.meta.dir, "public");
const FILM = join(import.meta.dir, "launch", "film.html");
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function tick() {
  if (DEMO) return; // demo mode reads nothing; the page makes up its own agents
  try {
    scanClaude();
  } catch (e) {
    console.error("claude scan:", e);
  }
  try {
    scanCodex();
  } catch (e) {
    console.error("codex scan:", e);
  }
  flush();
}
tick();
setInterval(tick, 700);

const enc = new TextEncoder();

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/events") {
      let unsub = () => {};
      let ping: ReturnType<typeof setInterval>;
      const stream = new ReadableStream({
        start(ctl) {
          const send = (m: unknown) => {
            try {
              ctl.enqueue(enc.encode(`data: ${JSON.stringify(m)}\n\n`));
            } catch {}
          };
          send({ type: "snapshot", agents: snapshot(), now: Date.now() });
          unsub = subscribe(send) as () => void;
          ping = setInterval(() => send({ type: "ping", now: Date.now() }), 15_000);
        },
        cancel() {
          unsub();
          clearInterval(ping);
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
    }
    if (url.pathname.startsWith("/img/")) {
      const path = imagePaths.get(url.pathname.slice(5)); // only images an agent touched are served
      if (!path) return new Response("not found", { status: 404 });
      const ext = path.split(".").pop()!.toLowerCase();
      return new Response(Bun.file(path), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "max-age=3600" } });
    }
    if ((url.pathname === "/" || url.pathname === "/index.html") && DEMO && !url.searchParams.has("demo")) return new Response(null, { status: 302, headers: { Location: "/?demo" } });
    if (url.pathname === "/" || url.pathname === "/index.html") return new Response(Bun.file(join(PUBLIC, "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/demo.js") return new Response(Bun.file(join(PUBLIC, "demo.js")), { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    if (url.pathname === "/film" && existsSync(FILM)) return new Response(Bun.file(FILM), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("not found", { status: 404 });
  },
});

console.log(`Agent Watch${DEMO ? " (demo)" : ""} → http://127.0.0.1:${PORT}`);
