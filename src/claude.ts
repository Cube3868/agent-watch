import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { Tail } from "./tail";
import { Agent, getAgent, push, addImage, setState, touch } from "./store";
import { clip, tail, isSensitiveCommand, isSensitivePath } from "./redact";
import { parseProgress, looksLikeRender, renderLabel } from "./progress";

const PROJECTS = join(homedir(), ".claude", "projects");
// Where Claude Code keeps live output of background commands. Seen on Windows as %TEMP%\claude;
// other systems may differ, so a few likely spots are tried and CLAUDE_TEMP_DIR overrides them.
const uid = typeof process.getuid === "function" ? process.getuid() : "";
const TEMPS = [process.env.CLAUDE_TEMP_DIR, join(tmpdir(), "claude"), `/tmp/claude-${uid}`, "/tmp/claude"].filter((d): d is string => !!d && existsSync(d));
const WINDOW = 4 * 3600_000; // only files touched in the last 4 hours are followed
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const IMG_PATH = /(?:[A-Za-z]:[\\\/]|\/[a-z]\/)[^\s"'<>|*?`]+?\.(?:png|jpe?g|webp|gif)\b/gi;

type Pending = { name: string; cmd: string; hidden: boolean; render: boolean };
type Session = {
  agent: Agent;
  tail: Tail;
  pending: Map<string, Pending>;
  turnOpen: boolean;
  lastWrite: number;
  title?: string;
  agentName?: string;
  firstPrompt?: string;
  bgCmds: Map<string, string>; // background task id -> command
};

const sessions = new Map<string, Session>();
const bgTails = new Map<string, { tail: Tail; sessionId: string; buf: string; id: string }>();

const modelName = (m?: string) => {
  if (!m) return "";
  const x = m.match(/claude-(\w+)-(\d+)-(\d+)/);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
};

function toWinPath(p: string) {
  const m = p.match(/^\/([a-z])\/(.*)$/i);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : p;
}

function maybeImage(a: Agent, raw: string, viewing = false) {
  const p = toWinPath(raw.replace(/[),.;:]+$/, ""));
  if (!IMG.test(p)) return;
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > 40_000_000) return;
    if (!viewing && Date.now() - st.mtimeMs > WINDOW) return;
    addImage(a, p, st.mtimeMs);
  } catch {}
}

function scanImages(a: Agent, text: string) {
  for (const m of text.matchAll(IMG_PATH)) maybeImage(a, m[0]);
}

function short(p: string) {
  const parts = String(p).split(/[\\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

function describe(name: string, input: any): { cmd: string; doing: string; lines: [any, string][]; hidden: boolean } {
  const n = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  switch (name) {
    case "Bash":
    case "PowerShell": {
      const c = String(input.command ?? "");
      const prog = c.replace(/^\s*(cd\s+\S+\s*(&&|;)\s*)+/, "").trim().split(/\s+/)[0]?.split(/[\\\/]/).pop() ?? "";
      return { cmd: c, doing: input.description || (prog ? `Running ${prog}` : "Running a command"), lines: [["cmd", clip(c, 300)]], hidden: isSensitiveCommand(c) };
    }
    case "Edit":
    case "MultiEdit": {
      const edits = name === "MultiEdit" ? input.edits ?? [] : [input];
      const lines: [any, string][] = [["file", `✎ ${short(input.file_path)}`]];
      const hidden = isSensitivePath(String(input.file_path));
      if (!hidden)
        for (const e of edits.slice(0, 2)) {
          for (const l of tail(e.old_string ?? "", 3, 160)) lines.push(["del", "- " + l]);
          for (const l of tail(e.new_string ?? "", 4, 160)) lines.push(["add", "+ " + l]);
        }
      return { cmd: "", doing: `Editing ${short(input.file_path)}`, lines, hidden };
    }
    case "Write": {
      const hidden = isSensitivePath(String(input.file_path));
      const body = String(input.content ?? "");
      const lines: [any, string][] = [["file", `✎ new ${short(input.file_path)} (${body.split("\n").length} lines)`]];
      if (!hidden) for (const l of tail(body.split("\n").slice(0, 3).join("\n"), 3, 160)) lines.push(["add", "+ " + l]);
      return { cmd: "", doing: `Writing ${short(input.file_path)}`, lines, hidden };
    }
    case "Read":
      return { cmd: "", doing: `Reading ${short(input.file_path)}`, lines: [["cmd", `read ${short(input.file_path)}`]], hidden: true };
    case "Grep":
      return { cmd: "", doing: `Searching for “${clip(input.pattern, 40)}”`, lines: [["cmd", `search ${clip(input.pattern, 120)}${input.path ? " in " + short(input.path) : ""}`]], hidden: false };
    case "Glob":
      return { cmd: "", doing: "Looking for files", lines: [["cmd", `find ${clip(input.pattern, 120)}`]], hidden: false };
    case "Agent":
    case "Task":
      return { cmd: "", doing: `Sent a helper: ${clip(input.description, 60)}`, lines: [["cmd", `helper → ${clip(input.description, 120)}`]], hidden: true };
    case "WebFetch":
    case "WebSearch":
      return { cmd: "", doing: "Looking something up online", lines: [["cmd", `${n} ${clip(input.url ?? input.query ?? "", 120)}`]], hidden: true };
    case "AskUserQuestion":
      return { cmd: "", doing: "Waiting for you", lines: [["say", "❓ " + clip(input.questions?.[0]?.question ?? "asked you something", 160)]], hidden: true };
    case "SendMessage":
      return { cmd: "", doing: "Messaging another agent", lines: [["cmd", `message → ${clip(input.summary ?? input.to ?? "", 100)}`]], hidden: true };
  }
  if (n === "wrap_up") return { cmd: "", doing: "Wrapping up", lines: [["say", "✓ " + clip(input.recap ?? "", 200)]], hidden: true };
  if (n === "update_plan") {
    const cur = (input.items ?? []).find((i: any) => i.status === "in_progress");
    return { cmd: "", doing: cur ? cur.content : "", lines: cur ? [["say", "▸ " + clip(cur.content, 120)]] : [], hidden: true };
  }
  if (/^(computer|browser_batch|navigate|screenshot)$/.test(n)) return { cmd: "", doing: "Using the browser", lines: [["cmd", `${n}`]], hidden: true };
  if (name === "Skill") return { cmd: "", doing: `Opening the ${clip(input.skill ?? "", 40)} playbook`, lines: [["cmd", `skill ${clip(input.skill ?? "", 60)}`]], hidden: true };
  if (name === "ToolSearch") return { cmd: "", doing: "Getting a tool ready", lines: [], hidden: true };
  const plain = n.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return { cmd: "", doing: plain.charAt(0).toUpperCase() + plain.slice(1), lines: [["cmd", n]], hidden: true };
}

function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  return "";
}

function nameSession(s: Session) {
  const a = s.agent;
  const n = s.title || s.agentName || (s.firstPrompt ? clip(s.firstPrompt, 40) : "") || "Claude session";
  if (a.name !== n) {
    a.name = n;
    touch(a);
  }
}

function handle(s: Session, rec: any) {
  const a = s.agent;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : 0;
  if (ts && ts > a.last) a.last = ts;
  switch (rec.type) {
    case "custom-title":
      s.title = rec.customTitle;
      nameSession(s);
      return;
    case "agent-name":
      s.agentName = rec.agentName;
      nameSession(s);
      return;
    case "system":
      if (rec.subtype === "stop_hook_summary" || rec.subtype === "turn_duration") s.turnOpen = false;
      return;
    case "assistant": {
      const m = rec.message ?? {};
      if (m.model && a.kind === "session") a.sub = `Claude · ${modelName(m.model)}`;
      let usedTool = false;
      for (const b of m.content ?? []) {
        if (b.type === "tool_use") {
          usedTool = true;
          const d = describe(b.name, b.input ?? {});
          const render = (b.name === "Bash" || b.name === "PowerShell") && looksLikeRender(d.cmd);
          s.pending.set(b.id, { name: b.name, cmd: d.cmd, hidden: d.hidden, render });
          for (const [k, t] of d.lines) push(a, k, t);
          if (d.doing) a.doing = clip(d.doing, 90);
          if (render) a.render = { label: renderLabel(d.cmd), pct: null, detail: "rendering…", t: ts || Date.now(), done: false };
          if (b.name === "Read" && b.input?.file_path) maybeImage(a, String(b.input.file_path), true);
          if ((b.name === "Write" || b.name === "Edit") && b.input?.file_path) maybeImage(a, String(b.input.file_path));
          if (d.cmd) scanImages(a, d.cmd);
        } else if (b.type === "text" && b.text?.trim()) {
          push(a, "say", clip(b.text, 220));
        }
      }
      s.turnOpen = usedTool || m.stop_reason !== "end_turn";
      touch(a);
      return;
    }
    case "user": {
      const c = rec.message?.content;
      if (typeof c === "string" || (Array.isArray(c) && c.some((x: any) => x.type === "text"))) {
        if (rec.isMeta) return;
        const t = textOf(c).trim();
        if (!t || t.startsWith("<")) return;
        if (!s.firstPrompt) {
          s.firstPrompt = t;
          nameSession(s);
        }
        s.turnOpen = true;
        push(a, "in", "you: " + clip(t, 160));
        a.doing = "Thinking…";
        return;
      }
      if (!Array.isArray(c)) return;
      for (const r of c) {
        if (r.type !== "tool_result") continue;
        const p = s.pending.get(r.tool_use_id);
        s.pending.delete(r.tool_use_id);
        const out = textOf(r.content);
        const bg = out.match(/running in background with ID:\s*(\w+)/i);
        if (bg && p) s.bgCmds.set(bg[1], p.cmd);
        if (p?.render) {
          const pr = parseProgress(out, p.cmd);
          a.render = { label: renderLabel(p.cmd), pct: r.is_error ? (pr?.pct ?? null) : bg ? null : 100, detail: r.is_error ? "render failed" : bg ? "rendering in background…" : "finished", t: Date.now(), done: !bg };
        }
        if (!p || !p.hidden) {
          for (const l of tail(out, p ? 3 : 2)) push(a, r.is_error ? "err" : "out", l);
          scanImages(a, out);
        } else if (r.is_error) push(a, "err", "✗ " + clip(out, 140));
      }
      touch(a);
      return;
    }
  }
}

function followSession(file: string, id: string, project: string) {
  if (sessions.has(id)) return sessions.get(id)!;
  const agent = getAgent(id, () => ({ id, kind: "session", name: "Claude session", sub: "Claude" }));
  const s: Session = { agent, tail: new Tail(file), pending: new Map(), turnOpen: false, lastWrite: 0, bgCmds: new Map() };
  const tf = join(PROJECTS, project, id, "custom-title.json");
  try {
    if (existsSync(tf)) s.title = JSON.parse(readFileSync(tf, "utf8")).customTitle;
  } catch {}
  sessions.set(id, s);
  nameSession(s);
  return s;
}

function followHelper(file: string, helperId: string, parentId: string) {
  const id = `${parentId}/${helperId}`;
  if (sessions.has(id)) return sessions.get(id)!;
  let meta: any = {};
  try {
    meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8"));
  } catch {}
  const agent = getAgent(id, () => ({
    id,
    kind: "helper",
    parent: parentId,
    name: meta.description || "Helper",
    sub: ["Helper", meta.agentType, meta.model].filter(Boolean).join(" · "),
  }));
  const s: Session = { agent, tail: new Tail(file, 200_000), pending: new Map(), turnOpen: true, lastWrite: 0, bgCmds: new Map() };
  sessions.set(id, s);
  return s;
}

function pump(s: Session, mtime: number) {
  const lines = s.tail.read();
  if (lines.length) s.lastWrite = Math.max(s.lastWrite, mtime);
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      handle(s, JSON.parse(l));
    } catch {}
  }
}

function pumpBackground(project: string, sessionId: string) {
  const dir = TEMPS.map((t) => join(t, project, sessionId, "tasks")).find((d) => existsSync(d));
  if (!dir) return;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const s = sessions.get(sessionId);
  if (!s) return;
  for (const n of names) {
    if (!n.endsWith(".output") || /^a[0-9a-f]{16}\.output$/.test(n)) continue; // a… files are helper transcripts
    const f = join(dir, n);
    let st;
    try {
      st = statSync(f);
    } catch {
      continue;
    }
    if (Date.now() - st.mtimeMs > 30 * 60_000) continue;
    const id = n.replace(/\.output$/, "");
    let b = bgTails.get(f);
    if (!b) bgTails.set(f, (b = { tail: new Tail(f, 20_000), sessionId, buf: "", id }));
    const chunk = b.tail.readChunk();
    if (!chunk) continue;
    b.buf = (b.buf + chunk).slice(-12_000);
    const cmd = s.bgCmds.get(id) ?? "";
    if (isSensitiveCommand(cmd)) continue;
    const a = s.agent;
    a.last = Math.max(a.last, st.mtimeMs);
    // progress bars redraw with a bare \r: keep only what is left visible on each line
    const visibleText = chunk.replace(/\r\n/g, "\n").split("\n").map((l) => l.split("\r").pop() ?? "").join("\n");
    const lastLines = tail(visibleText.replace(/^\s*\[exited with code 0\]\s*$/gm, ""), 2);
    for (const l of lastLines) push(a, "bg", l);
    const pr = parseProgress(b.buf, cmd);
    if (pr && (looksLikeRender(cmd) || /frame=|Duration:|out_time/.test(b.buf))) {
      a.render = { label: cmd ? renderLabel(cmd) : "render", pct: pr.pct, detail: pr.detail, t: Date.now(), done: pr.pct >= 100 };
      touch(a);
    }
    scanImages(a, chunk);
  }
}

export function scanClaude() {
  const now = Date.now();
  let projects: string[] = [];
  try {
    projects = readdirSync(PROJECTS);
  } catch {
    return;
  }
  for (const p of projects) {
    const pdir = join(PROJECTS, p);
    let entries: string[] = [];
    try {
      entries = readdirSync(pdir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".jsonl")) continue;
      const f = join(pdir, e);
      let st;
      try {
        st = statSync(f);
      } catch {
        continue;
      }
      const id = e.slice(0, -6);
      if (now - st.mtimeMs > WINDOW && !sessions.has(id)) continue;
      pump(followSession(f, id, p), st.mtimeMs);
      // helpers
      const sub = join(pdir, id, "subagents");
      let subs: string[] = [];
      try {
        subs = readdirSync(sub);
      } catch {}
      for (const h of subs) {
        if (!h.endsWith(".jsonl")) continue;
        const hf = join(sub, h);
        let hs;
        try {
          hs = statSync(hf);
        } catch {
          continue;
        }
        const hid = h.slice(0, -6);
        if (now - hs.mtimeMs > 30 * 60_000 && !sessions.has(`${id}/${hid}`)) continue;
        const helper = followHelper(hf, hid, id);
        pump(helper, hs.mtimeMs);
      }
      pumpBackground(p, id);
    }
  }
  // states
  for (const s of sessions.values()) {
    const a = s.agent;
    const quiet = now - Math.max(s.lastWrite, a.last);
    const waitingOnYou = [...s.pending.values()].some((p) => p.name === "AskUserQuestion");
    const working = !waitingOnYou && ((s.turnOpen && quiet < 120_000) || quiet < 6_000);
    if (working) setState(a, "working");
    else if (a.kind === "helper") setState(a, "done");
    else {
      setState(a, "idle");
      if (waitingOnYou) a.doing = "Waiting for you";
    }
    if (!working && a.render && !a.render.done && now - a.render.t > 60_000) {
      a.render.done = true;
      touch(a);
    }
  }
}

export function sessionName(id: string) {
  return sessions.get(id)?.agent.name;
}
