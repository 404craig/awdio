/**
 * Development mock of docs/API.md, mounted as Vite middleware by `npm run dev:mock`.
 * In-memory state; resets when the dev server restarts.
 *
 * Env knobs: MOCK_PIN=1234 (enable the access PIN), MOCK_COLD=8 (Kokoro "loads" for
 * 8 s, so audio returns 503 engine_not_ready), MOCK_LATENCY=300 (first-synthesis delay, ms).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { Document, DocumentSummary, PrepareStatus, Progress, Settings } from "../src/api/types";
import {
  SECONDS_PER_WORD,
  SUPPORTED,
  blocksFromText,
  buildDocument,
  defaultSettings,
  engines,
  fallbackBlocks,
  initialDocuments,
} from "./data";
import { silentWav } from "./wav";

type Req = IncomingMessage;
type Res = ServerResponse;

interface PrepareJob {
  engine: string;
  voiceId: string;
  startedAt: number;
  total: number;
  cancelled: boolean;
}

const HEADING_PAD = 0.5;
const BLOCK_PAD = 0.15;
const PREPARE_BLOCKS_PER_SEC = 4;

function createState() {
  const docs = new Map<string, Document>(initialDocuments().map((d) => [d.id, d]));
  const progress = new Map<string, { blockIndex: number; wordIndex: number; updatedAt: string }>();
  const seed = (id: string, fraction: number) => {
    const doc = docs.get(id);
    if (!doc) return;
    const target = Math.floor(doc.wordCount * fraction);
    const block = doc.pages.flatMap((p) => p.blocks).find((b) => b.wordStart + b.wordCount > target);
    if (block) progress.set(id, { blockIndex: block.index, wordIndex: 0, updatedAt: new Date().toISOString() });
  };
  seed("alice", 0.12);
  seed("pride", 0.34);
  return {
    docs,
    progress,
    settings: defaultSettings(),
    elevenKey: "",
    prepare: new Map<string, PrepareJob>(),
    synthesized: new Set<string>(),
    startedAt: Date.now(),
    unlocked: new Set<string>(),
    wrongPins: 0,
    lockedUntil: 0,
  };
}

const env = {
  pin: process.env.MOCK_PIN ?? "",
  coldSec: Number(process.env.MOCK_COLD ?? 0),
  latency: Number(process.env.MOCK_LATENCY ?? 300),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(res: Res, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sendWav(res: Res, wav: Buffer) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", String(wav.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(wav);
}

const fail = (res: Res, status: number, code: string, message: string) => send(res, status, { error: { code, message } });

async function readBody(req: Req): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function readJson(req: Req): Promise<Record<string, unknown>> {
  const raw = (await readBody(req)).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function parseMultipartFile(req: Req, body: Buffer): { filename: string; content: Buffer } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers["content-type"] ?? "");
  if (!boundary) return null;
  const marker = `--${boundary[1] ?? boundary[2]}`;
  const head = body.indexOf("filename=");
  if (head < 0) return null;
  const nameMatch = /filename="([^"]*)"/.exec(body.subarray(head, head + 1024).toString("utf8"));
  const start = body.indexOf("\r\n\r\n", head) + 4;
  const end = body.indexOf(`\r\n${marker}`, start);
  return { filename: nameMatch?.[1] ?? "upload.txt", content: body.subarray(start, end < 0 ? undefined : end) };
}

export function mockApi(): Plugin {
  const s = createState();

  const kokoroReady = () => Date.now() - s.startedAt > env.coldSec * 1000;

  const blocksOf = (doc: Document) => doc.pages.flatMap((p) => p.blocks);

  const prepareStatus = (doc: Document, engine: string, voiceId: string): PrepareStatus => {
    if (doc.prepare.status === "done" && doc.prepare.engine === engine && doc.prepare.voiceId === voiceId) return doc.prepare;
    const job = s.prepare.get(doc.id);
    if (!job || job.engine !== engine || job.voiceId !== voiceId) return { status: "idle", done: 0, total: doc.blockCount };
    const done = Math.min(job.total, Math.floor(((Date.now() - job.startedAt) / 1000) * PREPARE_BLOCKS_PER_SEC));
    if (job.cancelled) return { status: "idle", done, total: job.total, engine, voiceId };
    if (done >= job.total) {
      doc.prepare = { status: "done", done, total: job.total, engine, voiceId };
      s.prepare.delete(doc.id);
      return doc.prepare;
    }
    return { status: "running", done, total: job.total, engine, voiceId };
  };

  const progressOf = (doc: Document): Progress | null => {
    const p = s.progress.get(doc.id);
    if (!p) return null;
    const block = blocksOf(doc)[p.blockIndex];
    const wordOrdinal = block.wordStart + p.wordIndex;
    return { ...p, wordOrdinal, percent: Math.round((wordOrdinal / Math.max(1, doc.wordCount)) * 1000) / 10 };
  };

  const summary = (doc: Document): DocumentSummary => {
    const { pages: _pages, ...rest } = doc;
    return { ...rest, progress: progressOf(doc), prepare: prepareStatus(doc, s.settings.engine, s.settings.voiceId) };
  };

  const blockDuration = (doc: Document, index: number) => {
    const block = blocksOf(doc)[index];
    const pad = block.kind === "heading" || block.kind === "title" ? HEADING_PAD : BLOCK_PAD;
    return { block, speech: block.wordCount * SECONDS_PER_WORD, total: block.wordCount * SECONDS_PER_WORD + pad };
  };

  const voiceKnown = (engine: string, voice: string) =>
    engines(true, s.settings.elevenLabsConfigured).some((e) => e.id === engine && e.voices.some((v) => v.id === voice));

  const sessionOf = (req: Req) => /awdio_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";

  async function route(req: Req, res: Res, path: string, query: URLSearchParams): Promise<boolean> {
    const method = req.method ?? "GET";
    const seg = path.split("/").filter(Boolean); // ["api", ...]
    const [, a, b, c, d, e] = seg;

    if (a === "config" && method === "GET") {
      send(res, 200, { accessPinRequired: !!env.pin, unlocked: !env.pin || s.unlocked.has(sessionOf(req)), version: "0.1.0-mock" });
      return true;
    }
    if (a === "unlock" && method === "POST") {
      const body = await readJson(req);
      await sleep(250);
      if (Date.now() < s.lockedUntil) return fail(res, 429, "too_many_attempts", "Too many attempts"), true;
      if (body.pin !== env.pin) {
        s.wrongPins += 1;
        if (s.wrongPins >= 5) {
          s.wrongPins = 0;
          s.lockedUntil = Date.now() + 60_000;
        }
        return fail(res, 401, "wrong_pin", "That PIN didn’t work"), true;
      }
      s.wrongPins = 0;
      const token = Math.random().toString(36).slice(2);
      s.unlocked.add(token);
      send(res, 204, undefined, { "Set-Cookie": `awdio_session=${token}; HttpOnly; Path=/; Max-Age=15552000; SameSite=Lax` });
      return true;
    }
    if (env.pin && !s.unlocked.has(sessionOf(req))) return fail(res, 401, "locked", "Enter the access PIN"), true;

    if (a === "health") {
      send(res, 200, { status: "ok", engines: [{ id: "kokoro", ready: kokoroReady() }, { id: "elevenlabs", ready: s.settings.elevenLabsConfigured }] });
      return true;
    }

    if (a === "settings") {
      if (method === "PUT") {
        const body = (await readJson(req)) as Partial<Settings> & { elevenLabsApiKey?: string };
        if (typeof body.elevenLabsApiKey === "string") {
          if (body.elevenLabsApiKey && !body.elevenLabsApiKey.startsWith("sk_")) {
            return fail(res, 400, "invalid_api_key", "ElevenLabs rejected that API key"), true;
          }
          s.elevenKey = body.elevenLabsApiKey;
          s.settings.elevenLabsConfigured = !!s.elevenKey;
        }
        const { elevenLabsApiKey: _k, elevenLabsConfigured: _c, ...writable } = body;
        s.settings = { ...s.settings, ...writable };
      }
      send(res, 200, s.settings);
      return true;
    }

    if (a === "voices") {
      if (!b) return send(res, 200, { engines: engines(kokoroReady(), s.settings.elevenLabsConfigured) }), true;
      if (d === "preview") {
        await sleep(200);
        sendWav(res, silentWav(2.5));
        return true;
      }
    }

    if (a === "audio" && b) {
      const key = b.replace(/\.wav$/, "");
      const [docId, blockStr] = key.split("~");
      const doc = s.docs.get(docId);
      if (!doc) return fail(res, 404, "not_found", "No such audio"), true;
      sendWav(res, silentWav(blockDuration(doc, Number(blockStr)).total));
      return true;
    }

    if (a !== "documents") return false;

    if (!b) {
      if (method === "GET") {
        const list = [...s.docs.values()].sort(
          (x, y) => (y.lastOpenedAt ?? "").localeCompare(x.lastOpenedAt ?? "") || y.createdAt.localeCompare(x.createdAt),
        );
        send(res, 200, list.map(summary));
        return true;
      }
      if (method === "POST") {
        const body = await readBody(req);
        const file = parseMultipartFile(req, body);
        if (!file) return fail(res, 400, "bad_request", "Expected a multipart field named file"), true;
        if (body.length > 50 * 1024 * 1024) return fail(res, 413, "file_too_large", "Files must be 50 MB or smaller"), true;
        const ext = file.filename.split(".").pop()?.toLowerCase() ?? "";
        const sourceType = SUPPORTED[ext];
        if (!sourceType) return fail(res, 415, "unsupported_type", "awdio reads PDF, EPUB, DOCX, TXT and Markdown"), true;
        await sleep(1200);
        const title = file.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        const text = file.content.toString("utf8");
        if ((sourceType === "txt" || sourceType === "md") && !text.trim()) {
          return fail(res, 422, "no_text", "No readable text was found in that file"), true;
        }
        const raw = sourceType === "txt" || sourceType === "md" ? blocksFromText(text, title) : fallbackBlocks(title);
        const id = `up${Date.now().toString(36)}`;
        const doc = buildDocument({ id, title, sourceType, createdAt: new Date().toISOString(), lastOpenedAt: null }, raw, "synthetic");
        s.docs.set(id, doc);
        send(res, 201, summary(doc));
        return true;
      }
    }

    const doc = s.docs.get(b);
    if (!doc) return fail(res, 404, "not_found", "Document not found"), true;

    if (!c) {
      if (method === "GET") {
        doc.lastOpenedAt = new Date().toISOString();
        send(res, 200, { ...doc, ...summary(doc) });
        return true;
      }
      if (method === "PATCH") {
        const body = await readJson(req);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) return fail(res, 400, "bad_request", "Title can’t be empty"), true;
        doc.title = title;
        send(res, 200, summary(doc));
        return true;
      }
      if (method === "DELETE") {
        s.docs.delete(doc.id);
        s.progress.delete(doc.id);
        send(res, 204);
        return true;
      }
    }

    if (c === "progress") {
      if (method === "PUT") {
        const body = await readJson(req);
        const blocks = blocksOf(doc);
        const blockIndex = Math.min(Math.max(Number(body.blockIndex) || 0, 0), blocks.length - 1);
        const wordIndex = Math.min(Math.max(Number(body.wordIndex) || 0, 0), blocks[blockIndex].wordCount - 1);
        s.progress.set(doc.id, { blockIndex, wordIndex, updatedAt: new Date().toISOString() });
      }
      send(res, 200, progressOf(doc));
      return true;
    }

    if (c === "blocks" && e === "audio") {
      const engine = query.get("engine") ?? "kokoro";
      const voiceId = query.get("voice") ?? "af_heart";
      if (engine !== "kokoro" && engine !== "elevenlabs") return fail(res, 400, "unknown_engine", "Unknown engine"), true;
      if (engine === "elevenlabs" && !s.settings.elevenLabsConfigured) {
        return fail(res, 400, "engine_not_configured", "Add an ElevenLabs API key first"), true;
      }
      if (!voiceKnown(engine, voiceId)) return fail(res, 400, "unknown_voice", "Unknown voice"), true;
      if (engine === "kokoro" && !kokoroReady()) return fail(res, 503, "engine_not_ready", "The voice model is still loading"), true;
      const index = Number(d);
      if (!Number.isInteger(index) || index < 0 || index >= doc.blockCount) return fail(res, 404, "block_not_found", "No such block"), true;
      // `prefetch=true` only lowers priority on the real server; the mock treats it the same.
      const cacheKey = `${doc.id}~${index}~${engine}~${voiceId}`;
      const prepared = prepareStatus(doc, engine, voiceId);
      if (!s.synthesized.has(cacheKey) && prepared.status !== "done") await sleep(env.latency);
      s.synthesized.add(cacheKey);
      const { block, speech, total } = blockDuration(doc, index);
      const step = speech / block.wordCount;
      send(res, 200, {
        blockIndex: index,
        engine,
        voiceId,
        url: `/api/audio/${encodeURIComponent(cacheKey)}.wav`,
        durationSec: total,
        timings: Array.from({ length: block.wordCount }, (_, i) => [+(i * step).toFixed(3), +((i + 1) * step - 0.04).toFixed(3)]),
        format: "wav",
      });
      return true;
    }

    if (c === "prepare") {
      const engine = query.get("engine") ?? s.settings.engine;
      const voiceId = query.get("voice") ?? s.settings.voiceId;
      if (method === "DELETE") {
        const job = s.prepare.get(doc.id);
        if (job) job.cancelled = true;
        s.prepare.delete(doc.id);
        send(res, 204);
        return true;
      }
      if (method === "POST") {
        const current = prepareStatus(doc, engine, voiceId);
        if (current.status !== "running" && current.status !== "done") {
          s.prepare.set(doc.id, { engine, voiceId, startedAt: Date.now(), total: doc.blockCount, cancelled: false });
        }
        send(res, 202, prepareStatus(doc, engine, voiceId));
        return true;
      }
      send(res, 200, prepareStatus(doc, engine, voiceId));
      return true;
    }
    return false;
  }

  return {
    name: "awdio-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://mock");
        if (!url.pathname.startsWith("/api/")) return next();
        route(req, res, decodeURIComponent(url.pathname), url.searchParams)
          .then((handled) => {
            if (!handled) fail(res, 404, "not_found", `No mock for ${req.method} ${url.pathname}`);
          })
          .catch((err: unknown) => fail(res, 500, "mock_error", String(err)));
      });
    },
  };
}
