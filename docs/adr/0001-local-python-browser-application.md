---
status: superseded by ADR-0006
---

# Use a local Python application with a browser interface

Vidscribe v1 runs as a local FastAPI service with a simple HTML, CSS, and JavaScript browser interface. Processing runs in the local application rather than the browser connection, with durable stage progress supporting recovery after reloads or restarts. This keeps FFmpeg, filesystem organization, staging, OBS/Raycast intake, and source-media movement local while supporting streamed processing and review without a native desktop shell, frontend framework, or external queue service.
