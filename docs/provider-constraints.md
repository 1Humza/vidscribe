# Provider Constraints

Checked against official provider documentation on June 18, 2026. Provider limits can change and should be represented as configuration rather than scattered constants.

## Groq transcription

Default model: `whisper-large-v3-turbo`.

| Constraint | v1 behavior |
|---|---|
| Accepted source for API request | Generated `.24k.ogg` Analysis Audio |
| Direct upload ceiling | Conservatively preflight at 25 MB unless an explicitly configured account limit is known |
| Oversized audio | Stop as Needs Attention; do not chunk automatically |
| Required response | `verbose_json` with word and segment timestamp granularities |
| Retry automatically | `429`, `500`, `502`, `503`, and transient connection failures, using bounded exponential backoff and `Retry-After` |
| Do not retry blindly | Authentication, permission, malformed request, unsupported media, and payload-too-large errors |
| Published price | $0.04 per audio hour, with a 10-second minimum billed duration |

Groq's public documentation presents inconsistent tier-specific upload and rate-limit numbers. Runtime errors and the account Limits page are authoritative; errors must preserve the provider message for the user.

Official documentation:

- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/model/whisper-large-v3-turbo
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/errors

## Gemini analysis

| UI label | Model ID | Status on June 18, 2026 |
|---|---|---|
| Gemini 3 Flash | `gemini-3-flash-preview` | Preview; default |
| Gemini 3.5 Flash | `gemini-3.5-flash` | Stable |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | Stable |

The former `gemini-3.1-flash-lite-preview` model was shut down on May 25, 2026 and must not be offered.

| Constraint | v1 behavior |
|---|---|
| Audio duration | Preflight against the documented 9.5-hour combined-audio limit |
| Inline payload | Use inline input only within the documented 100 MB request payload limit |
| Larger supported files | Upload through the Files API, up to its documented 2 GB per-file limit |
| Files API lifetime | Treat uploaded files as temporary provider resources with a 48-hour lifetime |
| PDFs | Reject above 50 MB or 1,000 pages |
| Structured response | Require schema validation before presenting the formatted Analysis Result |
| Retry automatically | `429`, `500`, and `503`, using bounded exponential backoff |
| Needs Attention | Invalid request, unsupported attachment, permission/billing failure, missing provider file, repeated context/time-limit failures |

Official documentation:

- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/audio
- https://ai.google.dev/gemini-api/docs/files
- https://ai.google.dev/gemini-api/docs/file-input-methods
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/troubleshooting
