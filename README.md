# Lofn

Lofn is a collaborative feedback platform. Groups answer project questions by contributing text, voice, photos (with or without notes) and video. A worker merges each group's input into an evolving answer every 60 seconds and shows its sources.

```
Create project → Questions → Groups (access codes) → Start timed cycle → Contributions
   → AI synthesis every minute → Final synthesis at the end → Compare groups → Project synthesis → Export (PDF/MD/JSON)
```

## Architecture

| Part | What it does |
|---|---|
| **Next.js 15 app** (`app/`, `components/`) | The participant and admin UIs, plus all API routes (`app/api/**`). It does server-side authorization on every resource. |
| **Worker** (`worker/index.ts`) | A separate long-running process with these jobs:<br>• runs the server-side cycle clock<br>• runs the 60-second synthesis scheduler<br>• runs media processing (transcription, image/video interpretation)<br>• runs final and project-level synthesis<br>• applies retention |
| **PostgreSQL** (`db/migrations`) | Holds all state. It also provides:<br>• a durable job queue (`jobs`, `SELECT … FOR UPDATE SKIP LOCKED`)<br>• real-time fan-out via `LISTEN/NOTIFY` |
| **Object storage** (`lib/storage.ts`) | Local disk for development; S3 or any S3-compatible store for production. Media is only served through an authorised route. |
| **Real-time** | Server-sent events: `/api/p/events` streams to participants (filtered to their group) and `/api/admin/projects/:id/events` to admins. Clients refetch authorised data on each event, so events never carry content. |

Several design properties hold throughout:

- **Authoritative timer.** The server stores `ends_at` while a cycle runs and `remaining_ms` while it is paused. Clients render from these values, corrected for clock offset, so every device shows the same countdown. The worker ends cycles on time, and API reads also expire them lazily.
- **Incremental synthesis.** Each answer records which contributions it has already included (`answer_contributions`). Every minute only *new*, *withdrawn* or *re-processed* contributions are sent to the model, together with the current answer and short excerpts of earlier contributions for grounding.
  - Media is transcribed or described once. Byte-identical files within the same project are never re-analysed.
- **No overlapping or stale writes.** A job takes a lease on the answer row before synthesising. The new version is written only if the answer is still at the version the job started from (optimistic check), so an older AI response can never overwrite a newer answer.
- **Traceability.** Every claim cites `[C12]` reference tags.
  - Citations to contributions that don't exist are stripped and recorded as warnings.
  - "Agreements" backed by only one contribution are moved to *alternative perspectives*.
  - Every version is kept with its change list, and the UI shows a word-level diff.
- **Originals are immutable.** Transcripts and descriptions are stored separately (`derivations`). Moderation hides a contribution and removes it from the answer, but never edits it.

## Run locally

Requires Node 20.9+, PostgreSQL 14+ and `ffmpeg`. `ffmpeg` is needed for video analysis and long-audio normalisation.

```bash
npm install
cp .env.example .env              # set DATABASE_URL and an AI key (see below)
createdb lofn                     # or: docker compose up db
npm run db:migrate
npm run dev                       # terminal 1: web app on http://localhost:3000
npm run worker:dev                # terminal 2: worker (required for timers' auto-end, AI and media)
```

1. Open `http://localhost:3000/admin`. On first run you create the administrator account there. You can also run `npm run admin:create -- you@org.no "a long password" "Your name"`.
2. Create a project, add questions, then add groups. Share each group's code, join link or QR code; **Print codes** gives table cards.
3. Create a cycle and start it. Participants join at `/` with their code, without creating an account.

With Docker (Postgres, app and worker): `cp .env.example .env && docker compose up --build`.

## AI providers

All AI calls happen server-side in the worker; keys never reach the browser. Each of the three jobs (answer synthesis, image/video interpretation, transcription) can use a different provider and model. Pick them in the app under **Admin → AI models**. That page searches Hugging Face for models that Inference Providers currently serve, and has a **Test** button for each job. The environment variables below set the defaults.

| Provider | Key | Models |
|---|---|---|
| **Hugging Face** Inference Providers | `HF_TOKEN` (fine-grained, "Make calls to Inference Providers") | Any chat or vision-language model served by the router, e.g. `Qwen/Qwen3.8-27B` (default), `zai-org/GLM-5.3`, `google/gemma-4-31B-it`. Append `:provider` (e.g. `:together`) to pin a provider. Speech uses HF Inference Whisper (`openai/whisper-large-v3-turbo`). |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`) |
| OpenAI or any OpenAI-compatible endpoint | `OPENAI_API_KEY`, `OPENAI_BASE_URL` | `OPENAI_MODEL` (default `gpt-4o`), `OPENAI_TRANSCRIPTION_MODEL` (default `whisper-1`) |

Defaults are auto-detected from whichever keys are present, or forced with `AI_PROVIDER` / `TRANSCRIPTION_PROVIDER`. Reasoning models' `<think>` blocks are stripped automatically. If a hosted model rejects JSON mode, Lofn retries without it, because the prompt already demands JSON.

**Without any key**, Lofn runs in a *development fallback* mode, and it is labelled as such everywhere. Answers list the contributions verbatim under a "Development fallback — not an AI synthesis" banner, media is marked "not interpreted", and admins see a warning. Simulated output is never presented as synthesis.

Tuning options: `SYNTHESIS_INTERVAL_SECONDS` (default 60) and `FINAL_SYNTHESIS_WAIT_SECONDS`, which sets how long the final pass waits for media still being processed (default 180). You can also set guidance for the synthesis per project in **Settings**.

## Media

- **Upload rules.** Files are streamed to disk with size limits (`MAX_IMAGE_MB`, `MAX_AUDIO_MB`, `MAX_VIDEO_MB`). Their type is verified by magic bytes, not by file extension.
- **Browser-side handling.** Large photos are downscaled in the browser before upload. Voice and video can be recorded in the browser (MediaRecorder) or picked from the device, which on phones opens the camera or recorder.
- **Processing.**
  - Audio is transcribed.
  - Images are described by a vision model, with the contributor's note and the question as context.
  - Video gets its audio track transcribed and six evenly spaced keyframes interpreted.
- **Retention.** Each project can delete media N days after a cycle ends. **Settings → Delete all media now** purges immediately. Transcripts and descriptions are kept, so answers stay intact. Uploads that were never attached to a contribution are removed after a day.
- **S3.** Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION` (and `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE` for MinIO or R2), and the AWS credentials. Objects use SSE-AES256. They are served through short-lived signed URLs, issued only after authorisation.

## Security model

- **Admin sessions.** Admins sign in with scrypt-hashed passwords. Sessions are random tokens, stored as SHA-256 hashes, in HttpOnly SameSite=Lax cookies. Logins are rate-limited.
- **Participant sessions.**
  - Participants join with an 8-character group code from an unambiguous alphabet (~10¹² combinations). Join attempts are rate-limited per IP.
  - **New code** revokes every session in the group.
  - **Turn code off** blocks the group's access.
- **Resource ownership.** Every admin route resolves the resource to its project and checks ownership. A project you don't own returns 404 rather than 403.
- **Participant scope.** Participants can only read their own group's questions, contributions, answers, media and events.
- **Request checks.** State-changing requests reject cross-origin `Origin` headers. All input is validated with zod.

For multiple app instances, put a shared rate limiter at the proxy (the built-in limiter runs per process). Make sure the proxy doesn't buffer `text/event-stream` responses.

## Deploy

1. Provision PostgreSQL and (recommended) an S3 bucket.
2. Build the image (`docker build -t lofn .`) or run `npm ci && npm run build`.
3. Run the **app**: `npm run db:migrate && npm start`. Set `APP_URL` to the public HTTPS URL; secure cookies are enabled automatically in production over HTTPS.
4. Run **one or more workers**: `npm run worker`. Workers coordinate through Postgres, so you can scale or restart them freely; jobs left behind by a dead worker are recovered.
5. Give both processes the same environment: database, storage and AI keys.

Health check: `GET /api/health`.

### Render

`render.yaml` is a Render Blueprint. It creates two resources in Frankfurt:

- a managed PostgreSQL 16 database;
- one Docker web service with a 5 GB persistent disk for media. The service runs the app **and** the worker (`npm run start:all`), because a Render disk can attach to only one service.

To deploy it:

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and select the repo.
3. Enter `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` when prompted.
4. Open the service URL, go to `/admin` and create the administrator.

`APP_URL` defaults to Render's `RENDER_EXTERNAL_URL`.

To scale out, switch to `STORAGE_DRIVER=s3`. You can then split the worker into a separate Background Worker service (`npm run worker`).

### Hugging Face Spaces

The image also runs as a Docker Space. On a Space it listens on port 7860 and, because `DATABASE_URL` is unset, starts an embedded PostgreSQL inside the container.

- **Data location.** Data lives in `/data` when the Space has *persistent storage*. Without persistent storage it is wiped whenever the Space restarts or rebuilds.
- **Keeping data on the free tier.** Point `DATABASE_URL` at an external Postgres instead, for example Neon or Supabase. Media is still ephemeral unless you also set `STORAGE_DRIVER=s3`.
- **Embedded view.** Cookies use `SameSite=None; Secure` so the app works inside the huggingface.co iframe.

To deploy:

1. Create a Space with the Docker SDK and a blank template.
2. Add `HF_TOKEN` as a Space secret (Settings → Variables and secrets) to use Hugging Face models, or another provider's key.
3. Push this repo to the Space. `.github/workflows/hf-space.yml` does this on every push to `main` once you add the GitHub secret `HF_TOKEN` and the variable `HF_SPACE` (`user/space`).

## Tests

- `npm test` runs the unit tests: answer normalisation, citation validation, access codes and hashing.
- `npm run typecheck` runs the type checker.
- The full flow was also exercised end to end against a real Postgres, ffmpeg and an OpenAI-compatible mock. That run covered join, uploads, transcription, vision, incremental synthesis, moderation, pause/resume/extend, final synthesis, carry-forward cycles, project synthesis, all exports and the authorisation boundaries.

## Project layout

```
app/                  pages (participant: /, /g; admin: /admin/**) and API routes (app/api/**)
components/           UI: AnswerPanel (synthesis + history/diff), Composer (multimodal input), Countdown…
lib/                  server logic: cycles, jobs, synthesis, project-synthesis, media-processing, storage, export
lib/ai/provider.ts    Anthropic / OpenAI-compatible chat + transcription adapters
worker/index.ts       background worker
db/migrations/        SQL schema
```
