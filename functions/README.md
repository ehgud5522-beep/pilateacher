# PilaTeacher AI Gateway

Firebase Cloud Functions v2 HTTP gateway for authenticated AI operations. This
version exposes only `POST /v1/ai/voice-summary` through the exported
`aiGateway` function.

## Security state

- Firebase ID tokens are verified with the Admin SDK. Identity and roles from
  the request body are ignored.
- `OPENAI_API_KEY` is read only through a Firebase Secret binding.
- CORS uses an exact allowlist. Add deployed web origins through
  `AI_ALLOWED_ORIGINS` as a comma-separated runtime environment value.
- The model can be overridden with `AI_VOICE_SUMMARY_MODEL`; the default is
  `gpt-5-mini`.
- Provider requests use Structured Outputs and `store: false`.
- Request and error logging must not include transcripts, tokens, member data,
  or API keys.

The deployed entry point currently uses `createDisabledPolicyService()`. It
always denies consent and therefore cannot call OpenAI until a production policy
implementation is connected. That implementation must use the verified `uid` to
check lesson/member/organization access and explicit AI consent, and must provide
a durable rate limiter. A durable idempotency store must be connected at the
same time. The in-memory idempotency implementation exists only for unit tests.

## Local verification

```text
npm --prefix functions install
npm --prefix functions run lint
npm --prefix functions test
```

Unit tests inject a mock OpenAI client and never make an external AI request.
