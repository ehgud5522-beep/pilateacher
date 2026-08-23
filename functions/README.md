# PilaTeacher AI Gateway

Firebase Cloud Functions v2 HTTP gateway for all four authenticated AI
operations. The exported `aiGateway` function accepts only:

```text
POST /v1/ai/execute
```

The request body is the existing `GatewayAIProvider` envelope:
`{ schemaVersion: 1, requestId, provider: "openai", operation, input }`.
`operation` is one of `analyzeBody`, `summarizeVoice`, `recommendSequence`, or
`generateReport`. The `X-Idempotency-Key` header must exactly equal
`requestId`.

## Required production configuration

The function is fail-closed unless all of these are configured:

1. Create the server-only Firebase Secret. Never put this value in a `VITE_*`
   variable, source file, Android resource, or client Firebase config.

   ```text
   firebase functions:secrets:set OPENAI_API_KEY
   ```

2. Set `AI_POLICY_MODE=legacy_owner_backup`. This is the only value that
   activates the current ownership policy. Missing or different values deny
   every request. Optional settings are `AI_MODEL` (default `gpt-5-mini`),
   `AI_ALLOWED_ORIGINS`, `AI_RATE_LIMIT_PER_MINUTE` (default 8), and
   `AI_RATE_LIMIT_PER_DAY` (default 80). Put non-secret runtime values in the
   Firebase Functions environment file for the target project (for example,
   `functions/.env.<project-id>`); do not prefix server values with `VITE_`.
   This repository includes the non-secret production values in
   `functions/.env.pilateacher`; the provider key is intentionally absent.

3. For each member, write the user's explicit consent to
   `users/{uid}/aiConsents/{memberId}` using this exact schema:

   ```js
   {
     status: "granted",
     policyVersion: "2026-08-23",
     scopes: [
       "analyzeBody",
       "summarizeVoice",
       "recommendSequence",
       "generateReport"
     ],
     grantedAt: FirestoreTimestamp,
     revokedAt: null,
     updatedAt: FirestoreTimestamp
   }
   ```

   A missing record, a version mismatch, a missing operation scope, or any
   `revokedAt` value denies the request. The verified Firebase user must also
   own the member in `users/{uid}/backup/latest.data.members`.
   When `summarizeVoice` includes a lesson id, it additionally requires that
   lesson in `backup/latest.data.schedule` to contain the member by `memberId`,
   `memberIds`, or `attendees[].memberId`. Member-detail notes created before a
   lesson id exists remain restricted by verified user + member ownership.
   The app asks the instructor to confirm this consent at first AI use and
   writes only the consent metadata above; it never stores the transcript or
   photo in the consent document.

Validate and deploy the consent security rules before the function, then use
the repository's dedicated Functions config:

```text
firebase emulators:exec --only firestore --project pilateacher-dev --config firebase.foundation.json "node --test tests/rules/firestore.rules.test.js"
firebase firestore:indexes --database="(default)" --project <project-id>
firebase deploy --config firebase.foundation.json --project <project-id> --only firestore:rules
firebase deploy --config firebase.foundation.json --project <project-id> --only firestore:indexes
firebase deploy --config firebase.ai-gateway.json --project <project-id> --only functions:aiGateway
```

Before the index deployment, compare the `firebase firestore:indexes` output
with `firestore.foundation.indexes.json` and merge any production index or
field-override definitions that are not yet tracked. This prevents an index
deployment from proposing removal of unrelated remote configuration.

The Firestore deployment includes the repository-owned TTL field override for
`_aiGatewayIdempotency.expiresAt`. It enables TTL and disables the unused
single-field index on that timestamp. No provider API key is needed to deploy
or verify this Firestore policy. After an authorized deployment, verify that
the policy reaches `ACTIVE`:

```text
gcloud firestore fields ttls list --collection-group=_aiGatewayIdempotency --database="(default)" --project=<project-id>
gcloud firestore operations list --database="(default)" --project=<project-id>
```

TTL policy creation can take ten minutes or more. Expired documents are not
deleted synchronously; Firebase says they are typically removed within 24
hours after `expiresAt`. The gateway itself treats an expired idempotency record
as stale immediately, but the server-internal Firestore document may remain
until the asynchronous TTL deletion completes. TTL deletions are billed as
document deletes. Configuring or viewing the policy requires the corresponding
`datastore.indexes.*` permissions (and `datastore.operations.*` to inspect an
in-progress operation).

The browser-safe gateway URL then ends in
`/aiGateway/v1/ai/execute`, for example
`https://asia-northeast3-<project-id>.cloudfunctions.net/aiGateway/v1/ai/execute`.

## Privacy and provider behavior

- Firebase ID tokens are verified with revocation checking. IDs from the body
  are never accepted as identity.
- The gateway rejects media/Base64, secret, token, phone, and email fields.
  It removes member, lesson, assessment, user, name, and contact identifiers
  before provider calls and redacts recognizable emails, Korean mobile phone
  numbers, labelled Korean names, the owned member's exact name, bearer tokens,
  and secret-key patterns from free text.
- Photos and audio blobs are never sent. Body analysis receives only numeric
  joints/measurements; voice summary receives only the bounded transcript.
- Prompts live only on the server. Data-embedded instructions are explicitly
  treated as untrusted data. Each operation has a strict JSON schema and the
  server validates the returned object again.
- OpenAI Responses requests set `store: false` and use a one-way Firebase-user
  safety identifier. Application logs must never contain request input,
  provider input, outputs, tokens, or keys.
- `_aiGatewayUsage` stores only hashed-user counters. `_aiGatewayIdempotency`
  stores a request fingerprint and the derived response with a 24-hour logical
  expiry so a retry does not create another provider call. Both are
  server-internal collections. Firestore TTL is declared in
  `firestore.foundation.indexes.json`; physical deletion is asynchronous as
  described above.

## Local verification

```text
npm --prefix functions install
npm --prefix functions run lint
npm --prefix functions test
```

Unit tests inject a mock OpenAI client and never make an external AI request.
The Functions tests also verify that every idempotency document uses a Firestore
date value for `expiresAt` and that the deployable index configuration retains
the exact TTL field override.
A missing `OPENAI_API_KEY` must continue to return `provider_unavailable`; do
not bypass that behavior for local or review builds.
