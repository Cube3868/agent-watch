import { openSync, readSync, closeSync, statSync } from "node:fs";

// Follows a growing file read-only. The first read starts near the end, so a 20 MB transcript
// costs one small read, not a full parse.
export class Tail {
  offset = -1;
  partial = "";
  mtime = 0;
  constructor(public path: string, public startBytes = 400_000) {}

  /** Returns complete new lines since the last call (or [] if unchanged). */
  read(): string[] {
    let st;
    try {
      st = statSync(this.path);
    } catch {
      return [];
    }
    if (st.mtimeMs === this.mtime && st.size === this.offset) return [];
    this.mtime = st.mtimeMs;
    let skipFirst = false;
    if (this.offset < 0) {
      this.offset = Math.max(0, st.size - this.startBytes);
      skipFirst = this.offset > 0;
    }
    if (st.size < this.offset) {
      this.offset = 0; // truncated or replaced
      this.partial = "";
    }
    if (st.size === this.offset) return [];
    const len = Math.min(st.size - this.offset, 8_000_000);
    const buf = Buffer.alloc(len);
    let fd;
    try {
      fd = openSync(this.path, "r");
      readSync(fd, buf, 0, len, this.offset);
    } catch {
      return [];
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    this.offset += len;
    const text = this.partial + buf.toString("utf8");
    const parts = text.split("\n");
    this.partial = parts.pop() ?? "";
    if (skipFirst) parts.shift();
    return parts;
  }

  /** For plain-text logs: the raw new bytes, unfinished last line included (progress bars use \r). */
  readChunk(): string {
    const lines = this.read();
    const text = lines.join("\n") + (lines.length ? "\n" : "") + this.partial;
    this.partial = "";
    return text;
  }
}
