// Everything shown on the page passes through here first. Fails toward hiding.

const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key hidden]"],
  [/\b(sk|rk|pk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_\-]{16,}/g, "[secret hidden]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "[secret hidden]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[secret hidden]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[secret hidden]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[secret hidden]"],
  [/\bAIza[0-9A-Za-z_\-]{30,}/g, "[secret hidden]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[secret hidden]"],
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+\/=-]{12,}/gi, "$1 [secret hidden]"],
  // NAME=value / "name": "value" where the name smells like a credential
  [/\b([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH(?!OR)|COOKIE)[A-Z0-9_]*)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/gi, "$1=[secret hidden]"],
  [/("(?:[a-z_]*?)(?:key|token|secret|password|auth|cookie)[a-z_]*"\s*:\s*)"[^"]{6,}"/gi, '$1"[secret hidden]"'],
  [/(\/\/[^\/\s:@]+:)[^@\s\/]+@/g, "$1[secret hidden]@"],
  // long opaque blobs (hex or base64-ish), likely keys or hashes of keys
  [/\b[A-Fa-f0-9]{40,}\b/g, "[long hex hidden]"],
];

// Mixed-case-plus-digit runs of 32+ look like keys; kebab-case names and paths do not.
const BLOB = /[A-Za-z0-9+\/_=-]{32,}/g;
function looksOpaque(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s) && (s.match(/[-\/]/g)?.length ?? 0) < 4;
}

export function redact(text: string): string {
  let t = text;
  for (const [re, rep] of PATTERNS) t = t.replace(re, rep);
  return t.replace(BLOB, (m) => (looksOpaque(m) ? "[long blob hidden]" : m));
}

const SENSITIVE_FILE = /(^|[\\\/])(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|\.pypirc|credentials(\.json)?|auth\.json|id_(rsa|ed25519|ecdsa)[^\\\/]*|[^\\\/]*\.(pem|key|p12|pfx))$/i;

export function isSensitivePath(p: string): boolean {
  return SENSITIVE_FILE.test(p.trim());
}

// A command that prints a sensitive file or the environment: hide its output.
export function isSensitiveCommand(cmd: string): boolean {
  if (/\b(printenv|env|set)\s*($|\|)/.test(cmd)) return true;
  if (/Get-ChildItem\s+env:|\$env:\w*(KEY|TOKEN|SECRET)/i.test(cmd)) return true;
  if (/(cat|type|Get-Content|head|tail|less|more)\b[^|]*(\.env\b|\.npmrc|\.netrc|credentials|auth\.json|id_rsa|\.pem|\.key\b|\.sandbox-secrets|\\secrets\\|\/secrets\/)/i.test(cmd)) return true;
  return false;
}

/** Keep only the last few lines, each clipped, then redact. */
export function tail(text: string, lines = 4, width = 220): string[] {
  const all = redact(String(text ?? "")).replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  return all.slice(-lines).map((l) => (l.length > width ? l.slice(0, width - 1) + "…" : l));
}

export function clip(text: string, width = 220): string {
  const one = redact(String(text ?? "")).replace(/\s+/g, " ").trim();
  return one.length > width ? one.slice(0, width - 1) + "…" : one;
}
