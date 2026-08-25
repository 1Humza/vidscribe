# Vidscribe

Vidscribe is a local macOS browser application that turns recorded media into a
durable, reviewable Session Record. FastAPI owns local files, SQLite state,
FFmpeg preparation, and provider orchestration; React renders Session Intake and
Final Review.

## Run Locally

**Prerequisites:** macOS, Python 3.11+, Node.js, and FFmpeg/FFprobe.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
npm install
```

Put `GROQ_API_KEY` and `GEMINI_API_KEY` in the shared user-level credentials
file below. This location is outside the repository, so it is available from
every git worktree:

```bash
mkdir -p ~/.config/vidscribe
cp .env.example ~/.config/vidscribe/api_keys.env
$EDITOR ~/.config/vidscribe/api_keys.env
chmod 600 ~/.config/vidscribe/api_keys.env
```

The service also accepts shell environment variables and the repository-local
`.env` or `api_keys.env` files; those are useful for isolated development and
tests.

### Start the API and UI

Run both processes in separate terminals. The UI requires the API for picker,
session, review, and snapshot functionality.

```bash
# Terminal 1 — FastAPI backend
.venv/bin/python -m vidscribe

# Terminal 2 — Vite frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

The API listens on `127.0.0.1:8000` and rejects non-loopback hosts. Session
state defaults to `~/Library/Application Support/Vidscribe`.

Open <http://127.0.0.1:5173/> after both processes are running. Verify the API
with:

```bash
curl http://127.0.0.1:8000/api/health
```

Expected response: `{"status":"ok"}`.

Source and Destination paths enter the service only through native picker
capabilities. The browser receives an opaque `selection_id` for Session creation;
raw paths are not accepted as intake authority. Analysis Audio larger than the
Groq direct-upload ceiling is split into temporary overlapping FFmpeg windows,
fully transcribed with absolute timing and deterministic overlap deduplication,
then removed automatically.

Session Date is inferred from an explicit filename date or recording metadata;
when neither is reliable, the user must confirm it before processing. Attached
Context uses the same picker-capability boundary, remains in its original
location, and is supplied to analysis as bounded local context.

## Tests

```bash
.venv/bin/pytest tests/backend
npm test
npx playwright test tests/e2e/distill-recording.spec.ts
```

Routine tests use deterministic provider adapters. Paid live smoke tests are
opt-in and require `VIDSCRIBE_LIVE_AUDIO_PATH` plus provider credentials:

```bash
VIDSCRIBE_RUN_LIVE_TESTS=1 .venv/bin/pytest tests/backend/test_live_providers.py -m live
```
