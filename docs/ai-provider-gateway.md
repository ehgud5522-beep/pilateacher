# PilaTeacher AI Provider Gateway contract

The web app never receives provider secrets. It sends a structured request to an authenticated HTTPS gateway configured with `VITE_AI_GATEWAY_URL`. The default is disabled.

Server-only environment variables may include `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`; none may use the `VITE_` prefix. The gateway must authenticate the signed-in organization, verify member AI consent and role authorization, enforce quotas, remove direct identifiers where possible, and keep provider secrets in its secret manager.

## Request

`POST VITE_AI_GATEWAY_URL`

```json
{
  "schemaVersion": 1,
  "requestId": "deterministic idempotency key",
  "provider": "openai | gemini | anthropic",
  "operation": "analyzeBody | summarizeVoice | recommendSequence | generateReport",
  "input": {}
}
```

The same request ID must return the same stored result. Do not charge usage twice.
The server must reject provider IDs outside its organization-level allowlist; it must not trust the browser's provider choice by itself.

## Response

```json
{
  "requestId": "same request id",
  "provider": "openai",
  "model": "server-selected model",
  "modelVersion": "provider model version",
  "promptVersion": "versioned prompt",
  "pipelineVersion": "versioned pipeline",
  "createdAt": "UTC ISO-8601 timestamp",
  "output": {}
}
```

The gateway must request provider-native structured JSON output and validate it against the operation schema before responding. It must never return a fabricated fallback when a provider is unavailable. Store operational logs without photo bytes, audio bytes, transcripts, generated health text, API keys, or bearer tokens.

`analyzeBody` returns body characteristics, asymmetries, pelvis, thorax, scapula, head, knees, feet, recommended exercises, and precautions. `summarizeVoice` returns today's exercises, member condition, pain, improvements, next goals, homework, and precautions. `recommendSequence` returns a title, exercise list, rationale, and precautions. `generateReport` returns a title, summary, highlights, recommendations, precautions, and disclosure.
