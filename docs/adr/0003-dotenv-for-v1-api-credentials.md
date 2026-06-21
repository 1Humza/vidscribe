# Use a local dotenv file for v1 API credentials

Speech Distiller v1 reads Gemini and Groq API credentials from a local `.env` file. The repository includes only an example file, ignores the real credential file, and must never write secrets into logs, staging artifacts, Session Records, or completed folders; a system credential-store adapter can be introduced later if distribution requirements justify it.
