---
status: deprecated
---

# Start Vidscribe at macOS login

Vidscribe v1 installs a macOS login service that keeps the local FastAPI application available for OBS and Raycast without opening a browser window. Browser UI opens only when Session Intake or Final Review requires attention; the Python application core remains independent of the login-service wrapper.

This decision was deferred after manual file intake became the initial release boundary. Login startup, Session Markers, OBS intake, and Raycast shortcuts may return after the manual end-to-end workflow is reliable.
