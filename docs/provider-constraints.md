# Provider Constraints

Checked against official provider documentation on July 22, 2026. Provider limits can change and should be represented as configuration rather than scattered constants.

## Groq transcription

Default model: `whisper-large-v3-turbo`.

| Constraint | v1 behavior |
|---|---|
| Accepted source for API request | Generated `.24k.ogg` Analysis Audio |
| Direct upload ceiling | Conservatively preflight at 25 MB unless an explicitly configured account limit is known |
| Oversized audio | Stop as Needs Attention; do not chunk automatically |
| Required response | `verbose_json` with word and segment timestamp granularities |
| Deterministic rendering | Derive speaker-turn timestamps and 15-second Silence Markers from Whisper timing rather than free-form Gemini text |
| Coverage validation | Compare the final recognized speech with the final active audio region so long pauses or premature truncation do not silently end the Transcript |
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

| UI label | Model ID | Status on July 22, 2026 |
|---|---|---|
| Gemini 3 Flash | `gemini-3-flash-preview` | Preview; default |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Stable |

| Model | Offered effort levels | Vidscribe default |
|---|---|---|
| Gemini 3 Flash | `minimal`, `low`, `medium`, `high` | `medium` |
| Gemini 2.5 Flash | `low`, `medium`, `high` | Preserve the current supported level; otherwise `low` |

Switching from Gemini 3 Flash to Gemini 2.5 Flash while `minimal` is selected changes the effort to `low` rather than silently sending an unsupported value.

| Constraint | v1 behavior |
|---|---|
| Audio duration | Preflight against the documented 9.5-hour combined-audio limit |
| Application inline threshold | Send Analysis Audio inline only at or below 15 MB and only while the complete request remains within the documented 100 MB payload limit |
| Larger supported files | Upload through the resumable Files API, wait with a bounded poll until the file becomes active, and use its file URI |
| Files API lifetime | Treat uploaded files as temporary provider resources with a 48-hour lifetime |
| Files API cleanup | Request deletion in a guaranteed cleanup path after success, failure, or cancellation |
| PDFs | Reject above 50 MB or 1,000 pages |
| Structured response | Require schema validation before presenting the formatted Analysis Result |
| Artifact ownership | Vidscribe renders the Session Record envelope, normalized timestamps, Silence Markers, section order, and Snapshot references from structured data rather than accepting provider-formatted Markdown as authoritative |
| Context isolation | Place Attached Context in its own explicitly delimited request part rather than blending it into output instructions |
| Transcript integrity | Allow Extra Instructions to guide uncertain names and terminology, but never to authorize omitted or invented speech |
| Stream handling | Buffer incomplete SSE events, join multi-line data blocks, and emit only new text when the provider repeats cumulative content |
| Interrupted stream | Preserve the assembled partial Raw Analysis Stream and provider request identifiers when generation fails |
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
