# Submission CI validation — design

**Repo:** `nimiq/miniappscompetition-submissions`
**Date:** 2026-07-13
**Status:** approved design, pre-implementation

## Goal

A GitHub Actions workflow that verifies every submission PR against the mechanically
checkable subset of the competition rules, and **blocks merge** until it passes. It gives
human judges a trustworthy at-a-glance "structurally valid + repo/demo live" signal so they
can spend their attention on the subjective criteria (design, UX, originality, real Nimiq Pay
integration, functionality) that CI cannot judge.

## Background: how submissions arrive

Submissions are produced by the authenticated `/submit` portal in the competition repo
(`nimiq/miniappscompetition`). The portal:

1. Validates fields (`server/utils/submission.ts`) and images (`server/utils/images.ts`)
   server-side.
2. Commits `cycleN/<login>/submission.yaml` + `icon.<ext>`, `thumbnail.<ext>`,
   `screenshot-1.<ext>…screenshot-K.<ext>` in one commit on branch `submission-<login>`.
3. Opens the PR **as the GitHub App / bot** (not as the participant).

`submission.yaml` schema (produced by `buildSubmissionYaml`):

```yaml
app_name: string            # required, ≤80 chars
category: string            # required, one of CATEGORIES (enum below)
tagline: string             # required, ≤120 chars
description: string         # required, ≤280 chars
pricing: string             # required, one of: Free | Freemium | Paid
repo_url: string            # required, http(s) URL
demo_url: string            # required, http(s) URL
video_url: string           # required, http(s) URL
contact_email: string       # required, email
team_name: string | null    # optional, ≤80 chars
team_members: string[] | null   # optional, ≤5 entries, each ≤80 chars
x_account: string | null    # optional, ≤80 chars
builder_story: string | null    # optional, ≤4000 chars
icon: string                # required, bare filename e.g. icon.png
thumbnail: string           # required, bare filename e.g. thumbnail.png
screenshots: string[]       # required, 3–5 bare filenames
github_login: string        # required, MUST equal the folder name
submitted_at: string        # ISO 8601 timestamp
```

`CATEGORIES` = `Games, Social, Earning, Marketplaces, Productivity, Creator tools, Education,
Health & fitness, Food & dining, Shopping & deals, Lifestyle`.

Image rules (mirrored from `images.ts`): icon + screenshots accept `png`/`jpg`/`webp`;
thumbnail also accepts `gif`. Per-file ≤2 MB, total ≤14 MB, 3–5 screenshots. Format is
sniffed from magic bytes, not the file extension.

## Why CI is needed even though the portal validates

The portal validates only at creation time. After a PR is open:

- A participant can push more commits to `submission-<login>` and **hand-edit the YAML** or
  swap images.
- A PR can be **opened manually** (not through the portal), bypassing server validation
  entirely.
- A malicious/careless PR could touch files **outside its own folder** (another submission,
  the CI config, the README).

CI is the enforcement layer that runs on the final PR content regardless of how it got there.

## Non-goals

CI does **not** attempt to judge subjective rules; these stay human-judged:
design/UX, "fully functional / not a prototype", genuine Nimiq Pay integration, USDT/NIM
usage as a core experience, originality, marketing/distribution, team eligibility, wallet
ownership. It also does **not** clone or execute submitter code, and does **not** secret-scan
the external repo (scope was explicitly set to structural + external liveness only).

Note on the "250-word written description" in `/rules`: there is no 250-word field in the
YAML. The portal's `description` is a short blurb capped at 280 **characters**; `builder_story`
(≤4000 chars) is the long-form field. CI mirrors the **schema's** real limits, not the
marketing copy. Flagged here so the discrepancy is a conscious decision, not an oversight.

## Scope of checks (decided)

**Structural + external liveness. Every failed check blocks merge — with one deliberate
exception:** the MIT-license check on **non-GitHub** hosts is a *non-blocking reviewer notice*,
because CI cannot auto-verify a license there without host-specific APIs or cloning (out of
scope). No override label — resilience otherwise comes from retries + native "Re-run failed
jobs" only.

Public git repos on **any** host are accepted (not github.com only). Public-ness is proven
host-agnostically with anonymous `git ls-remote`; the MIT license is auto-verified only where
CI can (github.com).

### Structural checks (job `structural`, no network)

1. The PR's changed files all live under a **single** `cycleN/<login>/` directory
   (`^cycle\d+/[^/]+/` — generalized so cycle 2, 3, … work without edits). Any changed path
   outside that one folder → fail (prevents touching other submissions, CI config, README).
2. `cycleN/<login>/submission.yaml` exists and parses as YAML.
3. YAML matches the schema: all required fields present and correctly typed; `category` ∈
   `CATEGORIES`; `pricing` ∈ `{Free, Freemium, Paid}`; every length cap above respected;
   optional fields, when present, correctly typed and within caps; `team_members` ≤5.
4. `github_login` **equals the folder name** `<login>`.
5. Every referenced image (`icon`, `thumbnail`, each `screenshots[]`) exists as a file in the
   folder; its magic-byte-sniffed type is allowed for its slot; each ≤2 MB; total ≤14 MB;
   3–5 screenshots.
6. The folder contains **no undeclared files** — its contents are exactly `submission.yaml`
   plus the referenced images. (Blocks smuggling stray/extra files.)

### External liveness checks (job `external`, network, retried)

7. **`repo_url` is a public, anonymously-cloneable git repo on any host** — verified with
   `git ls-remote <repo_url>` (run with `GIT_TERMINAL_PROMPT=0` so a private repo fails fast
   instead of prompting for credentials). Exit 0 → public. Host-agnostic; **blocking**.
8. **MIT license:**
   - If `repo_url` is a `github.com` repo → license SPDX id must be exactly **`MIT`** (GitHub API
     `GET /repos/{owner}/{repo}/license` → `license.spdx_id === "MIT"`). Strict, no LICENSE-text
     fallback. **Blocking.**
   - Otherwise (GitLab, Bitbucket, Codeberg, self-hosted, …) → CI cannot auto-verify the license,
     so it emits a **non-blocking `notice`** ("license not auto-verified — reviewer must confirm
     MIT") rendered with ⚠️. Does not gate the merge.
9. `demo_url` returns HTTP **200** (follow redirects; `GET`). **Blocking.**

`video_url` is **not** checked for liveness (placeholders like `ComingSoon.com` are permitted
by the portal; a demo/video liveness gate there would be too brittle and isn't required).

### Flakiness handling

External checks (7–9) **retry 3× with exponential backoff** before declaring failure (the
`git ls-remote`, the GitHub API call, and the demo fetch each retry). A persistently-down demo,
a private/unreachable repo, or a GitHub repo that isn't MIT blocks the PR until fixed — that is
intended. The non-GitHub license `notice` never blocks. Transient outages are cleared by
GitHub's native **Re-run failed jobs** button (preserves the PR context); no new commit
required.

The `structural` and `external` jobs each write a `findings-<phase>.json` and upload it as an
artifact (`if: always()`); the `summary` job downloads both and renders one comment. Each gate
job's own exit code is what actually blocks — the artifacts are only for the comment.

## Workflow architecture

Single workflow `.github/workflows/validate-submission.yml`.

**Triggers:** `pull_request` (`opened`, `synchronize`, `reopened`) targeting `main`, restricted
to PRs that touch a submission folder via `paths: ['cycle*/**']` — so infra/docs PRs (which
change no `cycleN/<login>/` files) are not falsely gated by submission checks.
(No `workflow_dispatch` — a manual dispatch carries no PR context, so it can't validate a PR.
Transient re-runs use GitHub's native "Re-run failed jobs", which preserves the PR context.)

**Permissions:** `contents: read`, `pull-requests: write` (for the summary comment),
`statuses: write`.

**Jobs:**

| Job | Needs | Network | Required gate? | Responsibility |
|---|---|---|---|---|
| `structural` | — | none | **yes** | Checks 1–6. Fails fast with a per-check message list. |
| `external`   | — | yes  | **yes** | Checks 7–9 with retry/backoff. |
| `summary`    | `structural`, `external` (`if: always()`) | — | no (reporter) | Render/update one checklist comment on the PR from both jobs' results. |

`structural` and `external` run in parallel for fast feedback; **both are branch-protection-
required**, so the merge gate reflects both. `summary` is a best-effort reporter — it runs even
when the gates fail so the comment always reflects reality, and it is **not** a required check
(so an inability to comment, e.g. on a fork PR, never blocks a merge on its own).

**Which submission to validate:** derived from the PR diff. CI computes changed files
(`base…head`), extracts the single `cycleN/<login>/` prefix, and validates that folder at the
PR head. If zero or more-than-one submission folders are touched, `structural` fails with an
explanatory message (a valid submission PR touches exactly one).

**Token / fork nuance:** portal PRs are same-repo branches, so `GITHUB_TOKEN` has write access
→ status + summary comment both work. A rare manually-opened **fork** PR gets a read-only
token: the checks still run and report the required status, but the summary comment is
best-effort (skipped when write is unavailable). We never execute submitter code, so a
read-context run is safe. `pull_request_target` is deliberately **not** used (keeps the gate
simple and avoids the base-context write footgun); the trade-off is no bot comment on fork PRs.

## Repo layout added

```
.github/workflows/validate-submission.yml   the workflow
scripts/
  package.json            scoped tooling manifest; deps: yaml (+ pinned). type: module
  package-lock.json        committed for reproducible CI installs
  validate.mjs            entrypoint: reads changed-file list + submission dir, runs checks,
                          prints results, sets exit code, emits a machine-readable result
                          (JSON on stdout / step output) for the summary job
  lib/
    schema.mjs            CATEGORIES, PRICING, caps, image type tables — mirrored from the
                          competition repo's submission.ts / images.ts, with a header comment
                          naming that source of truth to fight drift
    structural.mjs        checks 1–6 (pure; takes file contents/paths, returns findings)
    external.mjs          checks 7–9 (git ls-remote + GitHub license API + demo fetch, retried)
    sniff.mjs             magic-byte image sniffing (ported from images.ts)
    report.mjs            findings → checklist markdown + pass/fail rollup
  test/
    *.test.mjs           node:test unit tests over fixtures
    fixtures/            valid + each failure mode
```

The validator core is **pure** (takes file contents and a diff list, returns a list of
findings). Network and GitHub-API access are isolated in `external.mjs` behind a small
injectable client so tests can mock them. The workflow YAML is a thin shell: install, run
`node scripts/validate.mjs`, hand its JSON to the summary step.

## Findings & reporting

Each check yields a finding `{ id, label, ok, details: string[], level: 'error' | 'notice' }`
(`level` defaults to `'error'`). A job exits non-zero when any **blocking** finding failed —
i.e. `level !== 'notice' && !ok` — so a `notice` (the non-GitHub license case) is rendered but
never fails the gate. The `summary` job renders a single sticky PR comment (created once,
updated in place via a stable marker) — a checklist of ✅ (pass) / ❌ (blocking fail) / ⚠️
(notice) per check with messages inline, e.g. a GitHub repo with the wrong license:

```
### Submission check: cycle1/harmssam
✅ Folder structure & path scoping
✅ Manifest schema
✅ github_login matches folder
✅ Images present & valid
✅ Repo is public on GitHub
❌ Repo license is MIT — GitHub detected: NOASSERTION
✅ Demo reachable (HTTP 200)
```

…and a non-GitHub repo, where the license is a manual-review notice:

```
### Submission check: cycle2/someone
✅ Repo is a public git repo
⚠️ Repo license is MIT — not on github.com; a reviewer must confirm the repo is MIT-licensed
✅ Demo reachable (HTTP 200)
```

## Testing

`node --test scripts/test`. Fixtures cover, at minimum:

- valid submission (all pass, external mocked green)
- missing required field; wrong type; `category`/`pricing` not in enum; over a length cap
- `github_login` ≠ folder name
- referenced image missing; image wrong type for slot; image >2 MB; wrong screenshot count;
  undeclared extra file in folder
- PR touches a path outside the folder; PR touches two submission folders; PR touches zero
- external: repo not github.com host; repo private/404; license SPDX ≠ MIT; demo ≠ 200;
  demo flaky then 200 within retry budget (asserts retry works)

External-dependent tests inject a fake client — no real network in unit tests.

## Rollout considerations

- Run the workflow against the **5 currently-open PRs** (#1–#5) as the first real test. Expect
  some to fail the external gate (a repo may be private or lack an MIT license, a demo may be
  down) — that is the gate working as designed, not a bug. Surface the results to the
  maintainer before enabling branch protection.
- Enabling the three jobs as **required status checks** in branch protection is the final,
  manual switch that makes CI actually block merges.

## Open items (non-blocking, note for the plan)

- Schema drift between this validator and the competition repo's `submission.ts` is managed by
  a mirror comment only. If it becomes a maintenance pain, a later option is to publish the
  schema as a shared artifact from the competition repo and consume it here.
- Multi-cycle is handled by the `cycleN` regex; no per-cycle config needed.
