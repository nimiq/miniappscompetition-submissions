# HTTP Retry Hardening Report

## Summary
Fixed transient HTTP errors (429, 408) that should be retried but were previously treated as definitive failures.

## Changes

### Code Changes
**File:** `scripts/lib/external.mjs`

Two locations updated with identical retry condition changes:

**Line 154** (demo-reachable check):
- Before: `if (r.status >= 500) throw new Error(\`status ${r.status}\`)`
- After: `if (r.status >= 500 || r.status === 429 || r.status === 408) throw new Error(\`status ${r.status}\`)`

**Line 184** (video-public check):
- Before: `if (r.status >= 500) throw new Error(\`status ${r.status}\`)`
- After: `if (r.status >= 500 || r.status === 429 || r.status === 408) throw new Error(\`status ${r.status}\`)`

### Test Coverage
**File:** `scripts/test/external.test.mjs`

Added 5 new tests following TDD pattern (all passing):

1. **demo-reachable: transient 429 then 200 retries to pass** — Verifies demo fetch retries on 429
2. **video-public: transient 429 then 200 on oEmbed retries to pass** — Verifies oEmbed retries on 429
3. **demo-reachable: transient 408 then 200 retries to pass** — Verifies demo fetch retries on 408
4. **video-public: transient 408 then 200 on oEmbed retries to pass** — Verifies oEmbed retries on 408
5. **video-public: definitive 404 on oEmbed still FAILS (not retried)** — Confirms non-retryable errors (403, 404, 401) still fail immediately

## Test Results

**RED → GREEN Timeline:**
- Initial run: 65 pass, 4 fail (new tests failing as expected)
- After fix: 69 pass, 0 fail ✓

Full suite summary: **69/69 tests passing** (no network calls, all mocked)

## Behavior Impact

### Before
- 429 Too Many Requests → treated as definitive failure (false negative)
- 408 Request Timeout → treated as definitive failure (false negative)
- 503+ → correctly retried (5xx range already handled)

### After
- 429, 408 → correctly retried (transient, platform rate-limit/timeout scenarios)
- 503+ → retried (unchanged)
- 403, 404, 401 → fail immediately without retry (correct, genuine failures)

## Risk Assessment
- **Low:** Only adds two specific status codes to existing retry condition
- **No regressions:** All existing tests pass unchanged
- **Bounded scope:** Changes isolated to two fetch sites within withRetry wrappers
- **Platform compatibility:** Aligns with YouTube oEmbed, Vimeo, and Loom timeout/rate-limit behaviors
