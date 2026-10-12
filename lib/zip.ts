// Streaming ZIP read/write on disk (fflate), so large media never has to sit in memory.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { ApiError } from "./http";

export type ZipEntry = { name: string; data?: Buffer | string; stream?: () => Promise<NodeJS.ReadableStream>; compress?: boolean };

const drain = (w: fs.WriteStream) => (w.writableNeedDrain ? new Promise<void>((r) => w.once("drain", () => r())) : Promise.resolve());

/** Write entries to a zip file at dest. */
export async function writeZip(dest: string, entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>) {
  const out = fs.createWriteStream(dest);
  let error: Error | null = null;
  out.on("error", (e) => (error = e));
  const done = new Promise<void>((resolve, reject) => {
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  const zip = new Zip((err, chunk, final) => {
    if (err) error = err;
    else out.write(Buffer.from(chunk));
    if (final) out.end();
  });
  for await (const e of entries as AsyncIterable<ZipEntry>) {
    if (error) throw error;
    const f = e.compress === false ? new ZipPassThrough(e.name) : new ZipDeflate(e.name, { level: 6 });
    zip.add(f);
    if (e.stream) {
      const s = await e.stream();
      for await (const c of s as AsyncIterable<Buffer>) {
        f.push(new Uint8Array(c));
        await drain(out);
      }
      f.push(new Uint8Array(0), true);
    } else {
      f.push(new Uint8Array(typeof e.data === "string" ? Buffer.from(e.data) : (e.data ?? Buffer.alloc(0))), true);
    }
    await drain(out);
  }
  zip.end();
  await done;
  if (error) throw error;
}

/** Stream a request body to a temp file, bounded by maxBytes. Returns the path (caller deletes). */
export async function requestToTempFile(req: Request, maxBytes: number) {
  if (!req.body) throw new ApiError(400, "No file was sent.");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new ApiError(413, `The file is too large (limit ${Math.round(maxBytes / 1048576)} MB).`);
  const tmp = path.join(os.tmpdir(), `lofn-in-${crypto.randomUUID()}`);
  const out = fs.createWriteStream(tmp);
  let size = 0;
  try {
    for await (const chunk of Readable.fromWeb(req.body as any)) {
      size += chunk.length;
      if (size > maxBytes) throw new ApiError(413, `The file is too large (limit ${Math.round(maxBytes / 1048576)} MB).`);
      if (!out.write(chunk)) await drain(out);
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
  } catch (e) {
    out.destroy();
    await fsp.unlink(tmp).catch(() => {});
    throw e;
  }
  return { path: tmp, size };
}

export async function isZip(file: string) {
  const fh = await fsp.open(file, "r");
  try {
    const b = Buffer.alloc(4);
    await fh.read(b, 0, 4, 0);
    return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
  } finally {
    await fh.close();
  }
}

/**
 * Extract the entries `want(name)` accepts into dir, under generated names (entry names are never used as paths).
 * Guards against zip bombs with a total uncompressed limit and an entry count limit.
 */
export async function extractZip(src: string, dir: string, want: (name: string) => boolean, limits: { totalBytes: number; entries: number }) {
  const files = new Map<string, { path: string; size: number }>();
  const writers = new Set<fs.WriteStream>();
  let total = 0, count = 0;
  let failure: Error | null = null;
  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (file) => {
    if (failure) return;
    if (++count > limits.entries) return void (failure = new ApiError(413, "The archive has too many files."));
    if (file.name.endsWith("/") || !want(file.name)) return;
    const dest = path.join(dir, `e${count}`);
    const w = fs.createWriteStream(dest);
    writers.add(w);
    const rec = { path: dest, size: 0 };
    files.set(file.name, rec);
    file.ondata = (err, chunk, final) => {
      if (err) failure = new ApiError(400, `The archive is damaged (${file.name}).`);
      if (failure) return;
      rec.size += chunk.length;
      total += chunk.length;
      if (total > limits.totalBytes) return void (failure = new ApiError(413, "The archive is too large when unpacked."));
      w.write(Buffer.from(chunk));
      if (final) w.end();
    };
    file.start();
  };
  for await (const chunk of fs.createReadStream(src, { highWaterMark: 1 << 20 })) {
    try {
      uz.push(new Uint8Array(chunk as Buffer));
    } catch {
      failure = failure || new ApiError(400, "That file isn't a valid zip archive.");
    }
    if (failure) break;
    await Promise.all([...writers].map(drain));
  }
  if (!failure) {
    try {
      uz.push(new Uint8Array(0), true);
    } catch {
      failure = new ApiError(400, "That file isn't a valid zip archive.");
    }
  }
  await Promise.all(
    [...writers].map((w) => (w.writableFinished ? null : new Promise<void>((r) => (w.writableEnded ? w.once("finish", () => r()) : (w.end(), w.once("finish", () => r())))))),
  );
  if (failure) throw failure;
  return files;
}

/** Stream a temp file as a download and delete it afterwards. */
export async function tempFileResponse(file: string, filename: string, type = "application/zip") {
  const stat = await fsp.stat(file);
  const rs = fs.createReadStream(file);
  const cleanup = () => fsp.unlink(file).catch(() => {});
  rs.on("close", cleanup);
  rs.on("error", cleanup);
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "lofn";
  return new Response(Readable.toWeb(rs) as any, {
    headers: {
      "content-type": type,
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="${safe}"`,
      "cache-control": "no-store",
    },
  });
}
