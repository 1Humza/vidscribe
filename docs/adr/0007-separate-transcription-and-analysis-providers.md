# Separate transcription and analysis behind provider boundaries

Vidscribe v1 uses Groq Whisper to establish the timestamped Transcript baseline and Gemini to correct and structure the analysis, while canonical Analysis Audio, Transcript, Analysis Result, and Session-state contracts remain independent of either provider. Provider adapters own model identifiers, uploads, streaming, retries, effort controls, and provider errors; this permits later model changes without building a generic plugin system or weakening v1 around untested providers.
