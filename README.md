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
cp .env.example .env
```

Set `GROQ_API_KEY` and `GEMINI_API_KEY` in `.env`, then run the service and UI
in separate terminals:

```bash
.venv/bin/python -m vidscribe
npm run dev -- --host 127.0.0.1 --port 5173
```

The API listens on `127.0.0.1:8000` and rejects non-loopback hosts. Session
state defaults to `~/Library/Application Support/Vidscribe`.

Source and Destination paths enter the service only through native picker
capabilities. The browser receives an opaque `selection_id` for Session creation;
raw paths are not accepted as intake authority. Analysis Audio larger than the
Groq direct-upload ceiling is split into temporary overlapping FFmpeg windows,
fully transcribed with absolute timing and deterministic overlap deduplication,
then removed automatically.

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
