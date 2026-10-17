import { createHash } from "node:crypto";

export type LineKind = "cmd" | "out" | "err" | "say" | "in" | "file" | "add" | "del" | "bg";
export type Line = { id: number; k: LineKind; t: string };
export type Img = { key: string; name: string; t: number };
export type Render = { label: string; pct: number | null; detail: string; t: number; done: boolean };
export type State = "working" | "idle" | "done";

export type Agent = {
  id: string;
  kind: "session" | "helper" | "codex";
  name: string;
  sub: string;
  parent?: string;
  state: State;
  last: number; // ms epoch of last activity
  doing: string;
  lines: Line[];
  images: Img[];
  render?: Render;
};

const MAX_LINES = 40;
const MAX_IMAGES = 8;
let lineSeq = 1;

export const agents = new Map<string, Agent>();
export const imagePaths = new Map<string, string>(); // key -> absolute path (the only files /img will serve)
const dirty = new Set<string>();
const listeners = new Set<(msg: unknown) => void>();

export function getAgent(id: string, init: () => Omit<Agent, "lines" | "images" | "state" | "last" | "doing">): Agent {
  let a = agents.get(id);
  if (!a) {
    a = { ...init(), state: "idle", last: 0, doing: "", lines: [], images: [] };
    agents.set(id, a);
  }
  return a;
}

export function push(a: Agent, k: LineKind, t: string) {
  if (!t) return;
  a.lines.push({ id: lineSeq++, k, t });
  if (a.lines.length > MAX_LINES) a.lines.splice(0, a.lines.length - MAX_LINES);
  touch(a);
}

export function addImage(a: Agent, path: string, t: number) {
  const key = createHash("sha1").update(path.toLowerCase()).digest("hex").slice(0, 16);
  if (a.images.some((i) => i.key === key)) return;
  imagePaths.set(key, path);
  a.images.push({ key, name: path.split(/[\\/]/).pop() ?? "image", t });
  if (a.images.length > MAX_IMAGES) a.images.splice(0, a.images.length - MAX_IMAGES);
  touch(a);
}

export function touch(a: Agent) {
  dirty.add(a.id);
}

export function subscribe(fn: (msg: unknown) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function visible(a: Agent, now = Date.now()): boolean {
  if (!a.lines.length && !a.images.length) return false;
  const age = now - a.last;
  if (a.state === "working") return true;
  if (a.kind === "helper") return age < 30 * 60_000;
  if (a.kind === "codex") return age < (a.state === "done" ? 45 * 60_000 : 2 * 3600_000);
  return age < 4 * 3600_000;
}

export function snapshot() {
  const now = Date.now();
  return [...agents.values()].filter((a) => visible(a, now));
}

let shown = new Set<string>();
export function flush() {
  const now = Date.now();
  for (const id of dirty) {
    const a = agents.get(id);
    if (!a) continue;
    if (visible(a, now)) {
      shown.add(id);
      for (const fn of listeners) fn({ type: "agent", agent: a });
    }
  }
  dirty.clear();
  for (const id of shown) {
    const a = agents.get(id);
    if (!a || !visible(a, now)) {
      shown.delete(id);
      for (const fn of listeners) fn({ type: "gone", id });
    }
  }
}

export function setState(a: Agent, s: State) {
  if (a.state !== s) {
    a.state = s;
    touch(a);
  }
}
