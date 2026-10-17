import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { Tail } from "./tail";
import { Agent, getAgent, push, addImage, setState, touch } from "./store";
import { clip, tail, isSensitiveCommand } from "./redact";
import { parseProgress, looksLikeRender, renderLabel } from "./progress";

const CODEX = join(homedir(), ".codex");
const WINDOW = 3 * 3600_000;
const STARTED = Date.now();

type Run = { agent: Agent; tail: Tail; open: boolean; lastWrite: number; exec: boolean; cwd: string; calls: Map<string, { cmd: string; hidden: boolean; render: boolean }> };
const runs = new Map<string, Run>();
const names = new Map<string, string>();
const indexTail = new Tail(join(CODEX, "session_index.jsonl"), 300_000);
const imgSeen = new Set<string>();

function readIndex() {
  for (const l of indexTail.read()) {
    try {
      const o = JSON.parse(l);
      if (o.id && o.thread_name) {
        names.set(o.id, o.thread_name);
        const r = runs.get(o.id);
        if (r && r.agent.name !== o.thread_name) {
          r.agent.name = o.thread_name;
          touch(r.agent);
        }
      }
    } catch {}
  }
}

function textOf(c: any): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => x.text ?? "").join("\n");
  return "";
}

// Codex runs JS that calls tools.exec_command({cmd:"..."}); pull the shell commands out of it.
function commandsIn(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:cmd|command)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g)) {
    try {
      out.push(m[1].startsWith("`") ? m[1].slice(1, -1) : JSON.parse(m[1].startsWith("'") ? '"' + m[1].slice(1, -1).replace(/"/g, '\\"') + '"' : m[1]));
    } catch {
      out.push(m[1].slice(1, -1));
    }
  }
  return out;
}

function handle(r: Run, rec: any) {
  const a = r.agent;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : 0;
  if (ts > a.last) a.last = ts;
  const p = rec.payload ?? {};
  if (rec.type === "session_meta") {
    r.cwd = p.cwd ?? "";
    r.exec = p.originator === "codex_exec" || p.source === "exec";
    a.sub = `Codex · ${r.exec ? "background run" : "chat"}${r.cwd ? " · " + basename(r.cwd) : ""}`;
    if (!names.has(a.id) && r.cwd) a.name = `Codex in ${basename(r.cwd)}`;
    touch(a);
    return;
  }
  if (rec.type === "event_msg") {
    if (p.type === "task_started") r.open = true;
    if (p.type === "task_complete") {
      r.open = false;
      if (p.last_agent_message) push(a, "say", "✓ " + clip(p.last_agent_message, 200));
      a.doing = "Finished";
    }
    if (p.type === "item_completed" && p.item?.type === "UserMessage") {
      const t = textOf(p.item.content);
      if (t) {
        push(a, "in", "asked: " + clip(t, 160));
        a.doing = "Starting";
      }
    }
    return;
  }
  if (rec.type !== "response_item") return;
  switch (p.type) {
    case "message":
      if (p.role === "assistant") {
        const t = textOf(p.content);
        if (t.trim()) push(a, "say", clip(t, 220));
      }
      return;
    case "custom_tool_call":
    case "function_call": {
      let code = "";
      let title = "";
      if (p.type === "custom_tool_call") code = String(p.input ?? "");
      else {
        try {
          const args = JSON.parse(p.arguments ?? "{}");
          code = String(args.code ?? args.cmd ?? args.command ?? args.prompt ?? "");
          title = args.title ?? "";
        } catch {
          code = String(p.arguments ?? "");
        }
      }
      const cmds = commandsIn(code);
      const shown = cmds.length ? cmds : [title || code.split("\n").find((l) => l.trim()) || p.name];
      let hidden = false;
      let render = false;
      for (const c of shown.slice(0, 3)) {
        hidden ||= isSensitiveCommand(c);
        render ||= looksLikeRender(c);
        push(a, "cmd", clip(c, 300));
      }
      if (/image_gen|generate_image|imagegen/i.test(p.name + code)) a.doing = "Making an image";
      else a.doing = clip(title || shown[0], 80);
      const cmd = shown.join(" ; ");
      if (render) a.render = { label: renderLabel(cmd), pct: null, detail: "rendering…", t: ts || Date.now(), done: false };
      r.calls.set(p.call_id, { cmd, hidden, render });
      return;
    }
    case "custom_tool_call_output":
    case "function_call_output": {
      const c = r.calls.get(p.call_id);
      const out = typeof p.output === "string" ? p.output : textOf(p.output);
      if (c?.render) {
        const pr = parseProgress(out, c.cmd);
        a.render = { label: renderLabel(c.cmd), pct: pr?.pct ?? 100, detail: pr?.detail ?? "finished", t: Date.now(), done: true };
      }
      if (!c?.hidden) for (const l of tail(out.replace(/^Script completed\s*\nWall time[^\n]*\nOutput:\s*/m, ""), 3)) push(a, "out", l);
      touch(a);
      return;
    }
  }
}

function scanImages(r: Run) {
  const dir = join(CODEX, "generated_images", r.agent.id);
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const full = join(dir, f);
    if (imgSeen.has(full) || !/\.(png|jpe?g|webp)$/i.test(f)) continue;
    try {
      const st = statSync(full);
      if (st.size < 1000) continue; // still being written
      imgSeen.add(full);
      addImage(r.agent, full, st.mtimeMs);
      if (st.mtimeMs > STARTED) push(r.agent, "file", `🖼 new image ${f}`);
    } catch {}
  }
}

function firstLine(path: string): string {
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(1_500_000);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString("utf8");
    const nl = text.indexOf("\n");
    return nl > 0 ? text.slice(0, nl) : "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function dayDirs(): string[] {
  const out: string[] = [];
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86400_000);
    const p = (n: number) => String(n).padStart(2, "0");
    out.push(join(CODEX, "sessions", String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate())));
  }
  return out;
}

export function scanCodex() {
  readIndex();
  const now = Date.now();
  for (const dir of dayDirs()) {
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.startsWith("rollout-") || !f.endsWith(".jsonl")) continue;
      const id = f.slice(-42, -6);
      const full = join(dir, f);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (now - st.mtimeMs > WINDOW && !runs.has(id)) continue;
      let r = runs.get(id);
      if (!r) {
        const agent = getAgent(id, () => ({ id, kind: "codex", name: names.get(id) ?? "Codex", sub: "Codex" }));
        runs.set(id, (r = { agent, tail: new Tail(full, 600_000), open: false, lastWrite: 0, exec: false, cwd: "", calls: new Map() }));
        const meta = firstLine(full); // session_meta (cwd, exec or chat) sits on line one, before the tail window
        if (meta) {
          try {
            handle(r, JSON.parse(meta));
          } catch {}
        }
      }
      const lines = r.tail.read();
      if (lines.length) r.lastWrite = st.mtimeMs;
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          handle(r, JSON.parse(l));
        } catch {}
      }
      scanImages(r);
    }
  }
  for (const r of runs.values()) {
    const quiet = now - Math.max(r.lastWrite, r.agent.last);
    const working = (r.open && quiet < 180_000) || quiet < 6_000;
    setState(r.agent, working ? "working" : r.exec ? "done" : "idle");
  }
}
