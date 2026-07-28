---
status: accepted
---

# Use the React frontend with the local FastAPI service

Vidscribe v1 keeps processing, durable Session state, filesystem access, and finalization in the local FastAPI application while adopting the imported React/Vite interface as its browser client. The frontend communicates with FastAPI through an HTTP and streamed-progress contract; it does not own provider orchestration or filesystem mutations. This supersedes ADR-0001's restriction against a frontend framework while preserving its local-service boundary, recovery model, and rejection of a native desktop shell or external queue; the exported Express server remains baseline scaffolding rather than the production backend.
