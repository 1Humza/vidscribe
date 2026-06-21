# Start Speech Distiller at macOS login

Speech Distiller v1 installs a macOS login service that keeps the local FastAPI application available for OBS and Raycast without opening a browser window. Browser UI opens only when Session Intake or Final Review requires attention; the Python application core remains independent of the login-service wrapper.
