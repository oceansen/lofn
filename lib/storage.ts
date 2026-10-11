import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "./config";

export interface StorageDriver {
  name: "local" | "s3";
  putFile(key: string, filePath: string, mime: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  /** Writes the object to a local file (for ffmpeg etc). */
  download(key: string, destPath: string): Promise<void>;
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
  signedUrl?(key: string, mime: string): Promise<string>;
}

class LocalStorage implements StorageDriver {
  name = "local" as const;
  root = path.resolve(config.storage.localDir);
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async putFile(key: string, filePath: string) {
    const dest = this.p(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(filePath, dest);
    } catch {
      await fsp.copyFile(filePath, dest);
      await fsp.unlink(filePath).catch(() => {});
    }
  }
  getBuffer(key: string) {
    return fsp.readFile(this.p(key));
  }
  async download(key: string, destPath: string) {
    await fsp.copyFile(this.p(key), destPath);
  }
  async stream(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.p(key), range);
  }
  async delete(key: string) {
    await fsp.unlink(this.p(key)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}

class S3Storage implements StorageDriver {
  name = "s3" as const;
  private clientP = (async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: config.storage.s3Region,
      endpoint: config.storage.s3Endpoint,
      forcePathStyle: config.storage.s3ForcePathStyle,
    });
  })();
  private bucket = config.storage.s3Bucket;

  async putFile(key: string, filePath: string, mime: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { size } = await fsp.stat(filePath);
    const client = await this.clientP;
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: size,
        ContentType: mime,
        ServerSideEncryption: process.env.S3_SSE === "none" ? undefined : "AES256",
      }),
    );
    await fsp.unlink(filePath).catch(() => {});
  }
  async getBuffer(key: string) {
    const s = await this.stream(key);
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }
  async download(key: string, destPath: string) {
    const s = await this.stream(key);
    await new Promise<void>((resolve, reject) => {
      const w = fs.createWriteStream(destPath);
      s.pipe(w);
      w.on("finish", () => resolve());
      w.on("error", reject);
      s.on("error", reject);
    });
  }
  async stream(key: string, range?: { start: number; end: number }) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientP;
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    );
    return res.Body as Readable;
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientP;
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async signedUrl(key: string, mime: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.clientP;
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: mime }), {
      expiresIn: config.storage.signedUrlSeconds,
    });
  }
}

const g = globalThis as unknown as { __lofnStorage?: StorageDriver };
export function storage(): StorageDriver {
  if (!g.__lofnStorage) g.__lofnStorage = config.storage.driver === "s3" ? new S3Storage() : new LocalStorage();
  return g.__lofnStorage;
}

// ---------- validation ----------

export type MediaCategory = "image" | "audio" | "video";

export const ALLOWED_MIME: Record<MediaCategory, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  // Browsers record audio into webm/ogg/mp4 containers, which sniff as video/* sometimes.
  audio: [
    "audio/webm", "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wav",
    "audio/x-wav", "audio/vnd.wave", "audio/flac", "audio/x-flac", "video/webm", "video/mp4", "video/x-matroska", "video/ogg",
  ],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/ogg", "video/3gpp"],
};

export function maxBytes(cat: MediaCategory) {
  return cat === "image" ? config.limits.imageBytes : cat === "audio" ? config.limits.audioBytes : config.limits.videoBytes;
}

export function extFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "video/ogg": "ogg", "audio/opus": "opus",
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "aac",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/vnd.wave": "wav", "audio/flac": "flac", "audio/x-flac": "flac",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/3gpp": "3gp",
  };
  return map[mime] || "bin";
}
