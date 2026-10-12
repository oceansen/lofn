// Encryption at rest for user-supplied API keys (AES-256-GCM).
// Key: SECRETS_KEY (any string; recommended), otherwise a random key generated once and kept in a file
// next to the media storage, i.e. outside the database, so a database dump alone doesn't reveal keys.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

let key: Buffer | null = null;

function loadKey(): Buffer {
  if (key) return key;
  if (process.env.SECRETS_KEY) return (key = crypto.createHash("sha256").update(process.env.SECRETS_KEY).digest());
  const file = process.env.SECRETS_KEY_FILE || path.join(path.dirname(path.resolve(config.storage.localDir)), ".lofn-secrets.key");
  try {
    return (key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64"));
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, fresh.toString("base64"), { flag: "wx", mode: 0o600 });
    return (key = fresh);
  } catch {
    // Another process (app vs worker) created it first.
    return (key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64"));
  }
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

/** Returns null if the value can't be decrypted (e.g. the secrets key changed). */
export function decryptSecret(stored: string): string | null {
  try {
    const [v, iv, tag, ct] = stored.split(":");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(s: string) {
  return s.length <= 8 ? "••••" : `${s.slice(0, s.startsWith("sk-") || s.startsWith("hf_") ? 3 : 2)}…${s.slice(-4)}`;
}
