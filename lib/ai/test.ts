// Quick live checks so an administrator can confirm a provider/model works before a session.
import { config } from "../config";
import { makeChat, parseJsonLoose } from "./provider";
import { hasKey, type Task } from "./settings";

/** 1 second of a 440 Hz tone as 16 kHz mono WAV (no speech: we only check the endpoint answers). */
function toneWav(): Buffer {
  const rate = 16000, n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

async function redSquare(): Promise<string> {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 30, b: 30 } } }).png().toBuffer();
  return png.toString("base64");
}

export async function testModel(task: Task, provider: string, model: string) {
  const t0 = Date.now();
  if (provider === "none") return { ok: true, latencyMs: 0, sample: "Development fallback: no AI calls are made." };
  if (!hasKey(provider)) return { ok: false, latencyMs: 0, error: `No API key for ${provider} is configured on the server.` };
  try {
    if (task === "transcription") {
      const r = await transcribeWith(provider, model);
      return { ok: true, latencyMs: Date.now() - t0, sample: r || "(the endpoint answered; the test tone contains no speech)" };
    }
    const ai = makeChat(provider, model);
    if (!ai) return { ok: false, latencyMs: 0, error: "This provider isn't available on the server." };
    if (task === "vision") {
      const out = await ai.complete({
        system: "Answer in one short sentence.",
        parts: [{ type: "text", text: "What colour is this square?" }, { type: "image", mime: "image/png", base64: await redSquare() }],
        maxTokens: 400,
      });
      return { ok: true, latencyMs: Date.now() - t0, sample: out.slice(0, 200) };
    }
    const out = await ai.complete({
      system: 'Return ONLY a JSON object of the form {"answer": string, "refs": number[]}.',
      parts: [{ type: "text", text: "Contribution [C1]: Safer crossings near the school. Summarise it in one sentence and cite it." }],
      json: true,
      maxTokens: 800,
      temperature: 0.2,
    });
    const j = parseJsonLoose(out);
    if (typeof j.answer !== "string") throw new Error("The model didn't return the expected JSON.");
    return { ok: true, latencyMs: Date.now() - t0, sample: j.answer.slice(0, 200) };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message.slice(0, 400) };
  }
}

// Transcription test that doesn't touch persisted settings.
async function transcribeWith(provider: string, model: string) {
  const audio = toneWav();
  if (provider === "huggingface") {
    const res = await fetch(`${config.ai.hfInferenceUrl}/${model.split(":")[0]}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.ai.hfToken}`, "content-type": "audio/wav" },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${text.slice(0, 300)}`);
    return String(JSON.parse(text).text ?? "").trim();
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "test.wav");
  form.append("model", model);
  const res = await fetch(`${config.ai.openaiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.ai.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${text.slice(0, 300)}`);
  return String(JSON.parse(text).text ?? "").trim();
}

