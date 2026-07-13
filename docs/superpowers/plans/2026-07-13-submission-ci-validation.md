# Submission CI Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Actions workflow that structurally validates every submission PR and verifies the linked repo is a public MIT-licensed GitHub repo with a reachable demo, blocking merge until all checks pass.

**Architecture:** A small Node package under `scripts/` holds pure check functions (`lib/*.mjs`) plus two thin CLI entrypoints (`validate.mjs`, `comment.mjs`). The workflow `.github/workflows/validate-submission.yml` runs two required gate jobs — `structural` (no network) and `external` (GitHub API + demo fetch, retried) — each writing a `findings-<phase>.json` artifact, then a non-blocking `summary` job renders one sticky PR comment from both. All check logic is unit-tested with `node:test` using injected file/fetch stubs (no real network).

**Tech Stack:** Node ≥20 (ESM `.mjs`), the `yaml` package (matches the portal's serializer), `node:test` + `node:assert`, GitHub Actions, `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`.

## Global Constraints

- **Schema is mirrored, not imported.** All enums/caps below are copied verbatim from the competition repo's `frontend/server/utils/submission.ts` and `frontend/server/utils/images.ts`. Every file that hardcodes one of these MUST carry a comment naming that source of truth.
- `CATEGORIES` = `Games, Social, Earning, Marketplaces, Productivity, Creator tools, Education, Health & fitness, Food & dining, Shopping & deals, Lifestyle` (exact strings, order irrelevant).
- `PRICING` = `Free, Freemium, Paid`.
- Length caps (characters): `app_name` ≤80, `tagline` ≤120, `description` ≤280, `team_name` ≤80, each `team_members` entry ≤80, `x_account` ≤80, `builder_story` ≤4000. `team_members` ≤5 entries.
- Email regex: `/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/`.
- Image rules: per-file ≤ 2 MB (`2*1024*1024`), total ≤ 14 MB (`14*1024*1024`), screenshots 3–5. icon + screenshots accept `png`/`jpg`/`webp`; thumbnail additionally accepts `gif`. Type is sniffed from magic bytes, never the extension.
- Submission folder shape: `cycleN/<login>/` where `<login>` == the manifest's `github_login`. Referenced image filenames must be bare and safe (`^[A-Za-z0-9._-]+$`).
- MIT check is **strict**: GitHub license API `spdx_id` must equal `MIT` exactly. No LICENSE-text fallback.
- `video_url` is NOT liveness-checked.
- All new code is ESM. `scripts/package.json` has `"type": "module"`.
- Commit after each task. Work on the existing `ci-submission-validation` branch.

---

### Task 1: Scaffold the `scripts/` package and shared schema constants

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/lib/schema.mjs`
- Create: `scripts/.gitignore`
- Test: `scripts/test/schema.test.mjs`

**Interfaces:**
- Produces: from `lib/schema.mjs` — `CATEGORIES: string[]`, `PRICING: string[]`, `MAX` (object of numeric caps), `EMAIL_RE: RegExp`, `IMAGE` (object), `SUBMISSION_DIR_RE: RegExp`, `SAFE_FILENAME_RE: RegExp`, `isHttpUrl(s: string): boolean`.

- [ ] **Step 1: Create `scripts/package.json`**

```json
{
  "name": "submission-ci",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "description": "CI validation for competition submission PRs.",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "yaml": "^2.5.1"
  }
}
```

- [ ] **Step 2: Create `scripts/.gitignore`**

```gitignore
node_modules/
findings-*.json
```

- [ ] **Step 3: Install to generate the lockfile**

Run: `cd scripts && npm install`
Expected: creates `scripts/node_modules/` and `scripts/package-lock.json` with the `yaml` dep. (`package-lock.json` MUST be committed for `npm ci` in CI.)

- [ ] **Step 4: Write the failing test `scripts/test/schema.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIES, PRICING, MAX, EMAIL_RE, IMAGE,
  SUBMISSION_DIR_RE, SAFE_FILENAME_RE, isHttpUrl,
} from '../lib/schema.mjs'

test('category & pricing enums match the portal', () => {
  assert.equal(CATEGORIES.length, 11)
  assert.ok(CATEGORIES.includes('Creator tools'))
  assert.deepEqual(PRICING, ['Free', 'Freemium', 'Paid'])
})

test('caps match the portal', () => {
  assert.equal(MAX.description, 280)
  assert.equal(MAX.teamMembers, 5)
  assert.equal(IMAGE.maxBytes, 2 * 1024 * 1024)
  assert.equal(IMAGE.maxScreens, 5)
})

test('email regex accepts/rejects', () => {
  assert.ok(EMAIL_RE.test('a@b.co'))
  assert.ok(!EMAIL_RE.test('nope'))
})

test('submission dir regex captures cycle + login', () => {
  const m = 'cycle1/harmssam/submission.yaml'.match(SUBMISSION_DIR_RE)
  assert.equal(m[1], 'cycle1')
  assert.equal(m[2], 'harmssam')
  assert.equal('cycle12/foo/icon.png'.match(SUBMISSION_DIR_RE)[1], 'cycle12')
  assert.equal('README.md'.match(SUBMISSION_DIR_RE), null)
  assert.equal('cycle1/loose.txt'.match(SUBMISSION_DIR_RE), null)
})

test('safe filename regex blocks traversal', () => {
  assert.ok(SAFE_FILENAME_RE.test('icon.png'))
  assert.ok(!SAFE_FILENAME_RE.test('../secret'))
  assert.ok(!SAFE_FILENAME_RE.test('a/b.png'))
})

test('isHttpUrl', () => {
  assert.ok(isHttpUrl('https://x.com'))
  assert.ok(isHttpUrl('http://x.com'))
  assert.ok(!isHttpUrl('ftp://x.com'))
  assert.ok(!isHttpUrl('not a url'))
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd scripts && node --test test/schema.test.mjs`
Expected: FAIL — cannot find module `../lib/schema.mjs`.

- [ ] **Step 6: Create `scripts/lib/schema.mjs`**

```js
// Schema constants for submission validation.
// SOURCE OF TRUTH: nimiq/miniappscompetition frontend/server/utils/submission.ts
// and frontend/server/utils/images.ts. Keep these mirrored — if the portal
// changes an enum or cap, update it here too.

export const CATEGORIES = [
  'Games', 'Social', 'Earning', 'Marketplaces', 'Productivity',
  'Creator tools', 'Education', 'Health & fitness', 'Food & dining',
  'Shopping & deals', 'Lifestyle',
]

export const PRICING = ['Free', 'Freemium', 'Paid']

export const MAX = {
  appName: 80,
  tagline: 120,
  description: 280,
  teamName: 80,
  teamMember: 80,
  xAccount: 80,
  builderStory: 4000,
  teamMembers: 5,
}

// Mirrored from submission.ts EMAIL_RE.
export const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/

export const IMAGE = {
  maxBytes: 2 * 1024 * 1024,
  maxTotalBytes: 14 * 1024 * 1024,
  minScreens: 3,
  maxScreens: 5,
  stillTypes: ['png', 'jpg', 'webp'],
  thumbTypes: ['png', 'jpg', 'webp', 'gif'],
}

// cycleN/<login>/... — capture group 1 = cycle folder, group 2 = login.
export const SUBMISSION_DIR_RE = /^(cycle\d+)\/([^/]+)\//

// Bare, traversal-safe image filenames only.
export const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/

export function isHttpUrl(s) {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd scripts && node --test test/schema.test.mjs`
Expected: PASS (all subtests).

- [ ] **Step 8: Commit**

```bash
git add scripts/package.json scripts/package-lock.json scripts/.gitignore scripts/lib/schema.mjs scripts/test/schema.test.mjs
git commit -m "feat(ci): scaffold scripts package + schema constants"
```

---

### Task 2: Image magic-byte sniffing

**Files:**
- Create: `scripts/lib/sniff.mjs`
- Test: `scripts/test/sniff.test.mjs`

**Interfaces:**
- Produces: `sniffImageType(buf: Buffer): 'png'|'jpg'|'webp'|'gif'|null` — ported from `images.ts`.

- [ ] **Step 1: Write the failing test `scripts/test/sniff.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sniffImageType } from '../lib/sniff.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

test('sniffs known formats', () => {
  assert.equal(sniffImageType(png), 'png')
  assert.equal(sniffImageType(jpg), 'jpg')
  assert.equal(sniffImageType(gif), 'gif')
  assert.equal(sniffImageType(webp), 'webp')
})

test('returns null for junk or short buffers', () => {
  assert.equal(sniffImageType(Buffer.from([0, 1, 2])), null)
  assert.equal(sniffImageType(Buffer.from('%PDF-1.7 aaaa')), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/sniff.test.mjs`
Expected: FAIL — cannot find module `../lib/sniff.mjs`.

- [ ] **Step 3: Create `scripts/lib/sniff.mjs`**

```js
// Magic-byte image sniffing. Ported verbatim from
// nimiq/miniappscompetition frontend/server/utils/images.ts (sniffImageType).
// Never trust the file extension — sniff the real bytes.

export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'gif'
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && node --test test/sniff.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sniff.mjs scripts/test/sniff.test.mjs
git commit -m "feat(ci): magic-byte image sniffing"
```

---

### Task 3: Resolve the submission folder + path-scoping + YAML parse

**Files:**
- Create: `scripts/lib/structural.mjs` (partial — `resolveSubmission` + `checkStructural` skeleton returning the `path-scope` and `yaml` findings; schema/login/images added in later tasks)
- Test: `scripts/test/structural-resolve.test.mjs`

**Interfaces:**
- Consumes: `SUBMISSION_DIR_RE` from `lib/schema.mjs`; `parse` from `yaml`.
- Produces:
  - `resolveSubmission({ changedPaths: string[], readFile: (p:string)=>Buffer|null }): { folders: string[], dir: string|null, login: string|null, outside: string[], value: object|null, yamlError: string|null }`
  - `finding(id, label, ok, details?): { id, label, ok, details: string[] }`
  - `checkStructural({ changedPaths, readFile, listDir }): Finding[]` — in this task it returns exactly the `path-scope` and `yaml` findings plus three placeholder findings (`schema`, `login-match`, `images`) marked not-evaluated when resolution/parse fails. Later tasks replace the placeholders with real logic.

- [ ] **Step 1: Write the failing test `scripts/test/structural-resolve.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSubmission, checkStructural } from '../lib/structural.mjs'

// Build a readFile from a { path: string } map (utf8 → Buffer).
function fsFrom(map) {
  return (p) => (p in map ? Buffer.from(map[p]) : null)
}
const VALID_YAML = `app_name: X
github_login: foo
`

function find(findings, id) { return findings.find((f) => f.id === id) }

test('resolves a single submission folder', () => {
  const r = resolveSubmission({
    changedPaths: ['cycle1/foo/submission.yaml', 'cycle1/foo/icon.png'],
    readFile: fsFrom({ 'cycle1/foo/submission.yaml': VALID_YAML }),
  })
  assert.equal(r.dir, 'cycle1/foo')
  assert.equal(r.login, 'foo')
  assert.deepEqual(r.outside, [])
  assert.equal(r.value.github_login, 'foo')
})

test('path-scope fails when files touch outside the folder', () => {
  const findings = checkStructural({
    changedPaths: ['cycle1/foo/submission.yaml', 'README.md'],
    readFile: fsFrom({ 'cycle1/foo/submission.yaml': VALID_YAML }),
    listDir: () => ['submission.yaml'],
  })
  assert.equal(find(findings, 'path-scope').ok, false)
  assert.match(find(findings, 'path-scope').details.join(' '), /README\.md/)
})

test('path-scope fails with two submission folders', () => {
  const findings = checkStructural({
    changedPaths: ['cycle1/a/submission.yaml', 'cycle1/b/submission.yaml'],
    readFile: fsFrom({}),
    listDir: () => [],
  })
  assert.equal(find(findings, 'path-scope').ok, false)
  assert.match(find(findings, 'path-scope').details.join(' '), /exactly one/i)
})

test('path-scope fails with zero submission folders', () => {
  const findings = checkStructural({
    changedPaths: ['docs/thing.md'],
    readFile: fsFrom({}),
    listDir: () => [],
  })
  assert.equal(find(findings, 'path-scope').ok, false)
})

test('yaml finding fails when submission.yaml missing', () => {
  const findings = checkStructural({
    changedPaths: ['cycle1/foo/icon.png'],
    readFile: fsFrom({}),
    listDir: () => ['icon.png'],
  })
  assert.equal(find(findings, 'yaml').ok, false)
  assert.match(find(findings, 'yaml').details.join(' '), /missing/i)
})

test('yaml finding fails on unparseable yaml', () => {
  const findings = checkStructural({
    changedPaths: ['cycle1/foo/submission.yaml'],
    readFile: fsFrom({ 'cycle1/foo/submission.yaml': 'a: [unterminated' }),
    listDir: () => ['submission.yaml'],
  })
  assert.equal(find(findings, 'yaml').ok, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/structural-resolve.test.mjs`
Expected: FAIL — cannot find module `../lib/structural.mjs`.

- [ ] **Step 3: Create `scripts/lib/structural.mjs`**

```js
import { parse as parseYaml } from 'yaml'
import { SUBMISSION_DIR_RE } from './schema.mjs'

export const finding = (id, label, ok, details = [], level = 'error') => ({ id, label, ok, details, level })

const LABELS = {
  'path-scope': 'Folder structure & path scoping',
  yaml: 'submission.yaml parses',
  schema: 'Manifest schema',
  'login-match': 'github_login matches folder',
  images: 'Images present & valid',
}

// From the PR's changed-file list, find the single submission folder and read
// its manifest. Never throws.
export function resolveSubmission({ changedPaths, readFile }) {
  const folders = new Set()
  for (const p of changedPaths) {
    const m = p.match(SUBMISSION_DIR_RE)
    if (m) folders.add(`${m[1]}/${m[2]}`)
  }
  const folderList = [...folders]
  if (folderList.length !== 1) {
    return { folders: folderList, dir: null, login: null, outside: [], value: null, yamlError: null }
  }
  const dir = folderList[0]
  const login = dir.split('/')[1]
  const outside = changedPaths.filter((p) => !p.startsWith(`${dir}/`))
  const buf = readFile(`${dir}/submission.yaml`)
  if (!buf) return { folders: folderList, dir, login, outside, value: null, yamlError: 'missing' }
  try {
    const value = parseYaml(buf.toString('utf-8'))
    if (!value || typeof value !== 'object') {
      return { folders: folderList, dir, login, outside, value: null, yamlError: 'not a mapping' }
    }
    return { folders: folderList, dir, login, outside, value, yamlError: null }
  } catch (err) {
    return { folders: folderList, dir, login, outside, value: null, yamlError: String(err?.message || err) }
  }
}

function pathScopeFinding(r, changedPaths) {
  if (r.folders.length === 0) {
    return finding('path-scope', LABELS['path-scope'], false, [
      'No files under a cycleN/<login>/ folder were changed. A submission PR must add files under exactly one such folder.',
    ])
  }
  if (r.folders.length > 1) {
    return finding('path-scope', LABELS['path-scope'], false, [
      `This PR changes ${r.folders.length} submission folders (${r.folders.join(', ')}). A PR must contain exactly one submission.`,
    ])
  }
  if (r.outside.length > 0) {
    return finding('path-scope', LABELS['path-scope'], false, [
      `These changed files are outside ${r.dir}/:`,
      ...r.outside,
    ])
  }
  return finding('path-scope', LABELS['path-scope'], true)
}

const notEvaluated = (id) => finding(id, LABELS[id], false, ['Not evaluated until earlier checks pass.'])

export function checkStructural({ changedPaths, readFile, listDir }) {
  const r = resolveSubmission({ changedPaths, readFile })
  const pathScope = pathScopeFinding(r, changedPaths)

  if (!r.dir) {
    return [pathScope, notEvaluated('yaml'), notEvaluated('schema'), notEvaluated('login-match'), notEvaluated('images')]
  }

  if (r.yamlError || !r.value) {
    const detail = r.yamlError === 'missing'
      ? 'submission.yaml is missing from the folder.'
      : `submission.yaml could not be parsed: ${r.yamlError}`
    const yaml = finding('yaml', LABELS.yaml, false, [detail])
    return [pathScope, yaml, notEvaluated('schema'), notEvaluated('login-match'), notEvaluated('images')]
  }

  const yaml = finding('yaml', LABELS.yaml, true)
  // Schema / login-match / images are filled in by later tasks. For now,
  // return them as passing placeholders so the checklist shape is stable.
  const schema = finding('schema', LABELS.schema, true)
  const loginMatch = finding('login-match', LABELS['login-match'], true)
  const images = finding('images', LABELS.images, true)
  return [pathScope, yaml, schema, loginMatch, images]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && node --test test/structural-resolve.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/structural.mjs scripts/test/structural-resolve.test.mjs
git commit -m "feat(ci): resolve submission folder, path-scoping, yaml parse"
```

---

### Task 4: Manifest schema validation

**Files:**
- Modify: `scripts/lib/structural.mjs` (add `validateManifest`; wire the `schema` + `login-match` findings)
- Test: `scripts/test/structural-schema.test.mjs`

**Interfaces:**
- Consumes: `CATEGORIES`, `PRICING`, `MAX`, `EMAIL_RE`, `isHttpUrl` from `lib/schema.mjs`; the parsed `value` from `resolveSubmission`.
- Produces: `validateManifest(value: object): string[]` (list of human-readable field errors, empty when valid). `checkStructural` now returns a real `schema` finding (`ok` = no errors) and real `login-match` finding (`value.github_login === login`).

- [ ] **Step 1: Write the failing test `scripts/test/structural-schema.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/structural.mjs'

const base = {
  app_name: 'VeriLock',
  category: 'Productivity',
  tagline: 'Sign together.',
  description: 'A working mini app.',
  pricing: 'Freemium',
  repo_url: 'https://github.com/harmssam/verilock',
  demo_url: 'https://verilock.online/',
  video_url: 'https://example.com/v',
  contact_email: 'a@b.co',
  team_name: null,
  team_members: null,
  x_account: 'harmssam',
  builder_story: null,
  icon: 'icon.png',
  thumbnail: 'thumbnail.png',
  screenshots: ['screenshot-1.png', 'screenshot-2.png', 'screenshot-3.png'],
  github_login: 'harmssam',
  submitted_at: '2026-07-07T00:27:55.091Z',
}

test('valid manifest has no errors', () => {
  assert.deepEqual(validateManifest(base), [])
})

test('missing required field errors', () => {
  const v = { ...base }
  delete v.app_name
  assert.ok(validateManifest(v).some((e) => /app_name/i.test(e)))
})

test('bad category & pricing enums error', () => {
  assert.ok(validateManifest({ ...base, category: 'Nope' }).some((e) => /category/i.test(e)))
  assert.ok(validateManifest({ ...base, pricing: 'Cheap' }).some((e) => /pricing/i.test(e)))
})

test('over-length description errors', () => {
  assert.ok(validateManifest({ ...base, description: 'x'.repeat(281) }).some((e) => /description/i.test(e)))
})

test('non-http repo_url errors', () => {
  assert.ok(validateManifest({ ...base, repo_url: 'git@github.com:a/b' }).some((e) => /repo_url/i.test(e)))
})

test('bad email errors', () => {
  assert.ok(validateManifest({ ...base, contact_email: 'nope' }).some((e) => /email/i.test(e)))
})

test('too many team members errors', () => {
  assert.ok(validateManifest({ ...base, team_members: ['a', 'b', 'c', 'd', 'e', 'f'] }).some((e) => /team_members/i.test(e)))
})

test('screenshots must be 3-5 strings', () => {
  assert.ok(validateManifest({ ...base, screenshots: ['a.png'] }).some((e) => /screenshots/i.test(e)))
  assert.ok(validateManifest({ ...base, screenshots: 'a.png' }).some((e) => /screenshots/i.test(e)))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/structural-schema.test.mjs`
Expected: FAIL — `validateManifest` is not exported.

- [ ] **Step 3: Add `validateManifest` to `scripts/lib/structural.mjs`**

Add these imports at the top (extend the existing schema import line):

```js
import { SUBMISSION_DIR_RE, CATEGORIES, PRICING, MAX, EMAIL_RE, isHttpUrl } from './schema.mjs'
```

Add the function (anywhere after the imports):

```js
// Validates the parsed submission.yaml against the mirrored schema. Returns a
// list of error strings (empty = valid). Mirrors validateSubmission() in the
// portal, adapted to the snake_case YAML shape.
export function validateManifest(v) {
  const errors = []
  const o = v && typeof v === 'object' ? v : {}

  const reqStr = (key, max, label) => {
    const val = o[key]
    if (typeof val !== 'string' || val.trim() === '') {
      errors.push(`${label} (${key}) is required.`)
      return null
    }
    if (val.length > max) errors.push(`${label} (${key}) exceeds ${max} characters.`)
    return val
  }

  reqStr('app_name', MAX.appName, 'App name')

  if (!CATEGORIES.includes(o.category)) errors.push(`category must be one of the allowed categories.`)

  reqStr('tagline', MAX.tagline, 'Tagline')
  reqStr('description', MAX.description, 'Description')

  if (!PRICING.includes(o.pricing)) errors.push(`pricing must be one of ${PRICING.join(', ')}.`)

  for (const key of ['repo_url', 'demo_url', 'video_url']) {
    const val = o[key]
    if (typeof val !== 'string' || val.trim() === '') errors.push(`${key} is required.`)
    else if (!isHttpUrl(val)) errors.push(`${key} must be a valid http(s) URL.`)
  }

  const email = o.contact_email
  if (typeof email !== 'string' || email.trim() === '') errors.push('contact_email is required.')
  else if (!EMAIL_RE.test(email) || email.length > 254) errors.push('contact_email must be a valid email.')

  // Optional fields.
  if (o.team_name != null) {
    if (typeof o.team_name !== 'string') errors.push('team_name must be text or null.')
    else if (o.team_name.length > MAX.teamName) errors.push(`team_name exceeds ${MAX.teamName} characters.`)
  }
  if (o.team_members != null) {
    if (!Array.isArray(o.team_members)) errors.push('team_members must be a list or null.')
    else {
      if (o.team_members.length > MAX.teamMembers) errors.push(`team_members can have at most ${MAX.teamMembers} entries.`)
      if (o.team_members.some((m) => typeof m !== 'string' || m.length > MAX.teamMember)) {
        errors.push(`each team member must be text under ${MAX.teamMember} characters.`)
      }
    }
  }
  if (o.x_account != null) {
    if (typeof o.x_account !== 'string') errors.push('x_account must be text or null.')
    else if (o.x_account.length > MAX.xAccount) errors.push(`x_account exceeds ${MAX.xAccount} characters.`)
  }
  if (o.builder_story != null) {
    if (typeof o.builder_story !== 'string') errors.push('builder_story must be text or null.')
    else if (o.builder_story.length > MAX.builderStory) errors.push(`builder_story exceeds ${MAX.builderStory} characters.`)
  }

  // Image reference fields (existence/type checked separately in checkImages).
  if (typeof o.icon !== 'string' || o.icon.trim() === '') errors.push('icon is required.')
  if (typeof o.thumbnail !== 'string' || o.thumbnail.trim() === '') errors.push('thumbnail is required.')
  if (!Array.isArray(o.screenshots) || o.screenshots.length < 3 || o.screenshots.length > 5
    || o.screenshots.some((s) => typeof s !== 'string')) {
    errors.push('screenshots must be a list of 3 to 5 filenames.')
  }

  if (typeof o.github_login !== 'string' || o.github_login.trim() === '') errors.push('github_login is required.')

  return errors
}
```

- [ ] **Step 4: Wire the real `schema` + `login-match` findings in `checkStructural`**

Replace the three placeholder lines (`const schema = ...`, `const loginMatch = ...`, `const images = ...` and the final `return`) at the end of `checkStructural` with:

```js
  const schemaErrors = validateManifest(r.value)
  const schema = finding('schema', LABELS.schema, schemaErrors.length === 0, schemaErrors)

  const loginOk = r.value.github_login === r.login
  const loginMatch = finding('login-match', LABELS['login-match'], loginOk,
    loginOk ? [] : [`github_login is "${r.value.github_login}" but the folder is "${r.login}". They must match.`])

  const images = finding('images', LABELS.images, true) // real logic added in Task 5
  return [pathScope, yaml, schema, loginMatch, images]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd scripts && node --test test/structural-schema.test.mjs test/structural-resolve.test.mjs`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/structural.mjs scripts/test/structural-schema.test.mjs
git commit -m "feat(ci): manifest schema validation + login-match"
```

---

### Task 5: Image presence, type, size, and undeclared-file checks

**Files:**
- Modify: `scripts/lib/structural.mjs` (add `checkImages`; wire the `images` finding)
- Test: `scripts/test/structural-images.test.mjs`

**Interfaces:**
- Consumes: `IMAGE`, `SAFE_FILENAME_RE` from `lib/schema.mjs`; `sniffImageType` from `lib/sniff.mjs`; `readFile`, `listDir`.
- Produces: `checkImages({ dir, value, readFile, listDir }): { ok: boolean, details: string[] }`. `checkStructural` now uses it for the real `images` finding.

- [ ] **Step 1: Write the failing test `scripts/test/structural-images.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkImages } from '../lib/structural.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const JUNK = Buffer.from('not an image at all')

function ctx(files, value) {
  const readFile = (p) => (p in files ? files[p] : null)
  const listDir = (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1))
  return { dir: 'cycle1/foo', value, readFile, listDir }
}
const baseValue = {
  icon: 'icon.png', thumbnail: 'thumbnail.png',
  screenshots: ['screenshot-1.png', 'screenshot-2.png', 'screenshot-3.png'],
}
const goodFiles = {
  'cycle1/foo/submission.yaml': Buffer.from('x'),
  'cycle1/foo/icon.png': PNG,
  'cycle1/foo/thumbnail.png': PNG,
  'cycle1/foo/screenshot-1.png': PNG,
  'cycle1/foo/screenshot-2.png': PNG,
  'cycle1/foo/screenshot-3.png': PNG,
}

test('valid images pass', () => {
  const r = checkImages(ctx(goodFiles, baseValue))
  assert.equal(r.ok, true, r.details.join('; '))
})

test('missing referenced image fails', () => {
  const files = { ...goodFiles }
  delete files['cycle1/foo/screenshot-2.png']
  const r = checkImages(ctx(files, baseValue))
  assert.equal(r.ok, false)
  assert.match(r.details.join(' '), /screenshot-2\.png/)
})

test('wrong type fails', () => {
  const r = checkImages(ctx({ ...goodFiles, 'cycle1/foo/icon.png': JUNK }, baseValue))
  assert.equal(r.ok, false)
})

test('thumbnail may be a gif but a screenshot may not', () => {
  const okThumb = checkImages(ctx({ ...goodFiles, 'cycle1/foo/thumbnail.png': GIF }, baseValue))
  assert.equal(okThumb.ok, true, okThumb.details.join('; '))
  const badShot = checkImages(ctx({ ...goodFiles, 'cycle1/foo/screenshot-1.png': GIF }, baseValue))
  assert.equal(badShot.ok, false)
})

test('oversize image fails', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])
  const r = checkImages(ctx({ ...goodFiles, 'cycle1/foo/icon.png': big }, baseValue))
  assert.equal(r.ok, false)
})

test('undeclared extra file fails', () => {
  const r = checkImages(ctx({ ...goodFiles, 'cycle1/foo/sneaky.txt': Buffer.from('hi') }, baseValue))
  assert.equal(r.ok, false)
  assert.match(r.details.join(' '), /sneaky\.txt/)
})

test('unsafe filename in manifest fails', () => {
  const r = checkImages(ctx(goodFiles, { ...baseValue, icon: '../evil.png' }))
  assert.equal(r.ok, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/structural-images.test.mjs`
Expected: FAIL — `checkImages` is not exported.

- [ ] **Step 3: Add `checkImages` to `scripts/lib/structural.mjs`**

Extend the imports:

```js
import { SUBMISSION_DIR_RE, CATEGORIES, PRICING, MAX, EMAIL_RE, isHttpUrl, IMAGE, SAFE_FILENAME_RE } from './schema.mjs'
import { sniffImageType } from './sniff.mjs'
```

Add the function:

```js
// Verifies every referenced image exists, sniffs to an allowed type for its
// slot, is within size caps, screenshot count is 3-5, total size is bounded,
// and the folder contains no undeclared files. Mirrors images.ts rules.
export function checkImages({ dir, value, readFile, listDir }) {
  const details = []
  const o = value && typeof value === 'object' ? value : {}

  const icon = typeof o.icon === 'string' ? o.icon : null
  const thumbnail = typeof o.thumbnail === 'string' ? o.thumbnail : null
  const screenshots = Array.isArray(o.screenshots) ? o.screenshots.filter((s) => typeof s === 'string') : []

  let total = 0
  const referenced = new Set()

  const checkOne = (name, allowed, label) => {
    if (name == null) return // schema check already flagged the missing field
    referenced.add(name)
    if (!SAFE_FILENAME_RE.test(name)) {
      details.push(`${label} filename "${name}" is not a plain safe filename.`)
      return
    }
    const buf = readFile(`${dir}/${name}`)
    if (!buf) {
      details.push(`${label} "${name}" is referenced but not present in the folder.`)
      return
    }
    total += buf.length
    if (buf.length > IMAGE.maxBytes) details.push(`${label} "${name}" is larger than 2 MB.`)
    const t = sniffImageType(buf)
    if (!t || !allowed.includes(t)) {
      details.push(`${label} "${name}" must be one of: ${allowed.join(', ')} (detected: ${t || 'unknown'}).`)
    }
  }

  checkOne(icon, IMAGE.stillTypes, 'Icon')
  checkOne(thumbnail, IMAGE.thumbTypes, 'Thumbnail')

  if (screenshots.length < IMAGE.minScreens || screenshots.length > IMAGE.maxScreens) {
    details.push(`There must be ${IMAGE.minScreens}-${IMAGE.maxScreens} screenshots (found ${screenshots.length}).`)
  }
  for (const s of screenshots) checkOne(s, IMAGE.stillTypes, 'Screenshot')

  if (total > IMAGE.maxTotalBytes) details.push('The images add up to more than 14 MB in total.')

  // Undeclared files: everything in the folder except submission.yaml and the
  // referenced images.
  const present = listDir(dir)
  const allowedNames = new Set(['submission.yaml', ...referenced])
  for (const name of present) {
    if (!allowedNames.has(name)) details.push(`Undeclared file in folder: "${name}". Only submission.yaml and referenced images are allowed.`)
  }

  return { ok: details.length === 0, details }
}
```

- [ ] **Step 4: Wire the real `images` finding in `checkStructural`**

Replace the placeholder `const images = finding('images', LABELS.images, true) // real logic added in Task 5` line with:

```js
  const imageResult = checkImages({ dir: r.dir, value: r.value, readFile, listDir })
  const images = finding('images', LABELS.images, imageResult.ok, imageResult.details)
```

- [ ] **Step 5: Run all structural tests to verify they pass**

Run: `cd scripts && node --test test/structural-images.test.mjs test/structural-schema.test.mjs test/structural-resolve.test.mjs`
Expected: PASS (all three files).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/structural.mjs scripts/test/structural-images.test.mjs
git commit -m "feat(ci): image presence/type/size + undeclared-file checks"
```

---

### Task 6: External checks — public git repo (any host), MIT license, reachable demo

**Files:**
- Create: `scripts/lib/external.mjs`
- Test: `scripts/test/external.test.mjs`

**Interfaces:**
- Consumes: nothing from other lib files (self-contained). Uses `node:child_process` (`execFile`) for the default `git ls-remote` probe.
- Produces:
  - `parseGithubRepo(url: string): { owner, repo } | null` (github.com only — used to pick the license path)
  - `withRetry(attempt: ()=>Promise<T>, opts?: { retries?: number, sleep?: (ms)=>Promise<void> }): Promise<T>`
  - `checkExternal({ value: object|null, fetchImpl?: typeof fetch, token?: string, retries?: number, sleep?: (ms)=>Promise<void>, gitLsRemote?: (url:string)=>Promise<{code:number}> }): Promise<Finding[]>` — returns findings with ids `repo-public`, `repo-license`, `demo-reachable`.
- **Finding shape gains an optional `level`:** `{ id, label, ok, details: string[], level: 'error' | 'notice' }` (defaults to `'error'`). `repo-public` is host-agnostic (anonymous `git ls-remote`). `repo-license` is `level:'error'` (blocking) for github.com repos and `level:'notice'` (non-blocking, ⚠️) for every other host, because CI can't auto-verify a license off GitHub. `gitLsRemote` is injected so tests never shell out.

- [ ] **Step 1: Write the failing test `scripts/test/external.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGithubRepo, checkExternal } from '../lib/external.mjs'

const noSleep = async () => {}
const publicRepo = async () => ({ code: 0 })   // git ls-remote stub: reachable/public
const privateRepo = async () => ({ code: 1 })  // git ls-remote stub: not public
function find(fs, id) { return fs.find((f) => f.id === id) }

// A fake fetch driven by a route map: url-substring → { status, json } or a
// function returning that (to vary across retries).
function fakeFetch(routes) {
  const calls = {}
  return async (url) => {
    for (const [key, resp] of Object.entries(routes)) {
      if (url.includes(key)) {
        calls[key] = (calls[key] || 0) + 1
        const r = typeof resp === 'function' ? resp(calls[key]) : resp
        return { status: r.status, json: async () => r.body }
      }
    }
    throw new Error(`unrouted ${url}`)
  }
}

test('parseGithubRepo', () => {
  assert.deepEqual(parseGithubRepo('https://github.com/harmssam/verilock'), { owner: 'harmssam', repo: 'verilock' })
  assert.deepEqual(parseGithubRepo('https://github.com/NimiqBlue/nimiq-bazar/'), { owner: 'NimiqBlue', repo: 'nimiq-bazar' })
  assert.deepEqual(parseGithubRepo('https://github.com/a/b.git'), { owner: 'a', repo: 'b' })
  assert.equal(parseGithubRepo('https://gitlab.com/a/b'), null)
  assert.equal(parseGithubRepo('https://github.com/onlyowner'), null)
  assert.equal(parseGithubRepo('not a url'), null)
})

test('github repo: public + MIT + live demo all pass (license is error-level)', async () => {
  const findings = await checkExternal({
    value: { repo_url: 'https://github.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({
      '/repos/a/b/license': { status: 200, body: { license: { spdx_id: 'MIT' } } },
      'https://demo.test': { status: 200 },
    }),
    token: 't', sleep: noSleep, gitLsRemote: publicRepo,
  })
  assert.equal(find(findings, 'repo-public').ok, true)
  assert.equal(find(findings, 'repo-license').ok, true)
  assert.equal(find(findings, 'repo-license').level, 'error')
  assert.equal(find(findings, 'demo-reachable').ok, true)
})

test('private/unreachable github repo fails public (ls-remote != 0) + license 404', async () => {
  const findings = await checkExternal({
    value: { repo_url: 'https://github.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({ '/repos/a/b/license': { status: 404, body: null }, 'https://demo.test': { status: 200 } }),
    token: 't', sleep: noSleep, gitLsRemote: privateRepo,
  })
  assert.equal(find(findings, 'repo-public').ok, false)
  assert.equal(find(findings, 'repo-license').ok, false)
})

test('github repo with non-MIT license: public ok, license is a BLOCKING fail', async () => {
  const findings = await checkExternal({
    value: { repo_url: 'https://github.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({
      '/repos/a/b/license': { status: 200, body: { license: { spdx_id: 'Apache-2.0' } } },
      'https://demo.test': { status: 200 },
    }),
    token: 't', sleep: noSleep, gitLsRemote: publicRepo,
  })
  assert.equal(find(findings, 'repo-public').ok, true)
  assert.equal(find(findings, 'repo-license').ok, false)
  assert.equal(find(findings, 'repo-license').level, 'error')
  assert.match(find(findings, 'repo-license').details.join(' '), /Apache-2\.0/)
})

test('non-github public repo: public ok, license is a non-blocking NOTICE', async () => {
  const findings = await checkExternal({
    value: { repo_url: 'https://gitlab.com/a/b', demo_url: 'https://demo.test' },
    // No GitHub API route needed — the license path for non-github is a notice.
    fetchImpl: fakeFetch({ 'https://demo.test': { status: 200 } }),
    token: 't', sleep: noSleep, gitLsRemote: publicRepo,
  })
  assert.equal(find(findings, 'repo-public').ok, true)
  const lic = find(findings, 'repo-license')
  assert.equal(lic.level, 'notice')
  assert.match(lic.details.join(' '), /reviewer|confirm|not on github/i)
})

test('non-github private repo fails public', async () => {
  const findings = await checkExternal({
    value: { repo_url: 'https://gitlab.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({ 'https://demo.test': { status: 200 } }),
    token: 't', sleep: noSleep, gitLsRemote: privateRepo,
  })
  assert.equal(find(findings, 'repo-public').ok, false)
})

test('ls-remote retries a transient error then succeeds', async () => {
  let n = 0
  const flakyGit = async () => { n += 1; if (n < 2) throw new Error('transient'); return { code: 0 } }
  const findings = await checkExternal({
    value: { repo_url: 'https://gitlab.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({ 'https://demo.test': { status: 200 } }),
    token: 't', sleep: noSleep, gitLsRemote: flakyGit,
  })
  assert.equal(find(findings, 'repo-public').ok, true)
})

test('demo non-200 fails after retries; transient 503 then 200 passes', async () => {
  const down = await checkExternal({
    value: { repo_url: 'https://github.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({
      '/repos/a/b/license': { status: 200, body: { license: { spdx_id: 'MIT' } } },
      'https://demo.test': { status: 404 },
    }),
    token: 't', sleep: noSleep, gitLsRemote: publicRepo,
  })
  assert.equal(find(down, 'demo-reachable').ok, false)

  const flaky = await checkExternal({
    value: { repo_url: 'https://github.com/a/b', demo_url: 'https://demo.test' },
    fetchImpl: fakeFetch({
      '/repos/a/b/license': { status: 200, body: { license: { spdx_id: 'MIT' } } },
      'https://demo.test': (n) => (n < 2 ? { status: 503 } : { status: 200 }),
    }),
    token: 't', sleep: noSleep, gitLsRemote: publicRepo,
  })
  assert.equal(find(flaky, 'demo-reachable').ok, true)
})

test('null value (unresolved submission) fails all three at error level', async () => {
  const findings = await checkExternal({ value: null, fetchImpl: fakeFetch({}), token: 't', sleep: noSleep, gitLsRemote: publicRepo })
  assert.equal(findings.length, 3)
  assert.ok(findings.every((f) => !f.ok))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/external.test.mjs`
Expected: FAIL — cannot find module `../lib/external.mjs`.

- [ ] **Step 3: Create `scripts/lib/external.mjs`**

```js
// External liveness checks:
//   repo-public    — repo_url is an anonymously-cloneable public git repo on ANY
//                    host (git ls-remote). Blocking.
//   repo-license   — github.com repos: strict SPDX == MIT via the GitHub API
//                    (blocking). Other hosts: a non-blocking 'notice' — CI can't
//                    auto-verify a license off GitHub, so a reviewer must confirm.
//   demo-reachable — demo_url returns 200. Blocking.
// Transient failures (network / HTTP 5xx / ls-remote error) retry before giving up.
import { execFile } from 'node:child_process'

const finding = (id, label, ok, details = [], level = 'error') => ({ id, label, ok, details, level })
const LABELS = {
  'repo-public': 'Repo is a public git repo',
  'repo-license': 'Repo license is MIT',
  'demo-reachable': 'Demo reachable (HTTP 200)',
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Anonymous public-repo probe that works on any git host. Resolves { code }
// (0 = reachable/public). GIT_TERMINAL_PROMPT=0 + an echo askpass make a private
// repo fail fast instead of blocking on a credential prompt.
const defaultGitLsRemote = (url) => new Promise((resolve) => {
  execFile('git', ['ls-remote', url], {
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo' },
  }, (err) => resolve({ code: err ? 1 : 0 }))
})

// github.com only — used to decide the license path. Returns null for any other
// host (those go down the non-blocking notice branch).
export function parseGithubRepo(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null
  const segs = u.pathname.split('/').filter(Boolean)
  if (segs.length < 2) return null
  return { owner: segs[0], repo: segs[1].replace(/\.git$/i, '') }
}

export async function withRetry(attempt, { retries = 3, sleep = defaultSleep } = {}) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      return await attempt()
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await sleep(500 * 2 ** i)
    }
  }
  throw lastErr
}

// GitHub API GET. Throws on network error or HTTP 5xx (retryable); returns
// { status, body } for everything else (200, 404, ...).
async function ghGet(path, token, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      'User-Agent': 'nimiq-submissions-ci',
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status >= 500) throw new Error(`GitHub API ${res.status}`)
  const body = res.status === 200 ? await res.json() : null
  return { status: res.status, body }
}

export async function checkExternal({ value, fetchImpl = fetch, token, retries = 3, sleep = defaultSleep, gitLsRemote = defaultGitLsRemote }) {
  if (!value || typeof value !== 'object') {
    return ['repo-public', 'repo-license', 'demo-reachable'].map((id) =>
      finding(id, LABELS[id], false, ['Not evaluated — submission.yaml could not be read/parsed.']))
  }

  const repoUrl = typeof value.repo_url === 'string' ? value.repo_url.trim() : ''
  const demoUrl = typeof value.demo_url === 'string' ? value.demo_url.trim() : ''

  // repo-public — host-agnostic anonymous git ls-remote.
  let repoPublic
  if (!repoUrl) {
    repoPublic = finding('repo-public', LABELS['repo-public'], false, ['repo_url is missing.'])
  } else {
    try {
      await withRetry(async () => {
        const { code } = await gitLsRemote(repoUrl)
        if (code !== 0) throw new Error(`git ls-remote exited ${code}`)
      }, { retries, sleep })
      repoPublic = finding('repo-public', LABELS['repo-public'], true)
    } catch (err) {
      repoPublic = finding('repo-public', LABELS['repo-public'], false,
        [`repo_url is not an anonymously-cloneable public git repo (${String(err.message || err)}).`])
    }
  }

  // repo-license — github.com: strict SPDX (blocking). Other hosts: notice.
  let repoLicense
  const gh = parseGithubRepo(repoUrl)
  if (gh) {
    try {
      const r = await withRetry(() => ghGet(`/repos/${gh.owner}/${gh.repo}/license`, token, fetchImpl), { retries, sleep })
      if (r.status === 200 && r.body?.license?.spdx_id === 'MIT') {
        repoLicense = finding('repo-license', LABELS['repo-license'], true)
      } else if (r.status === 404) {
        repoLicense = finding('repo-license', LABELS['repo-license'], false, ['No license file detected in the repo — an MIT LICENSE is required.'])
      } else {
        const spdx = r.body?.license?.spdx_id || 'none'
        repoLicense = finding('repo-license', LABELS['repo-license'], false, [`Repo license must be MIT (GitHub detected: ${spdx}).`])
      }
    } catch (err) {
      repoLicense = finding('repo-license', LABELS['repo-license'], false, [`Could not read the repo license: ${String(err.message || err)}`])
    }
  } else if (repoUrl) {
    repoLicense = finding('repo-license', LABELS['repo-license'], false,
      ['Repo is not on github.com — the MIT license could not be auto-verified. A reviewer must confirm the repo is MIT-licensed.'],
      'notice')
  } else {
    repoLicense = finding('repo-license', LABELS['repo-license'], false, ['Not evaluated — repo_url is missing.'])
  }

  // demo-reachable
  let demoReachable
  if (!demoUrl) {
    demoReachable = finding('demo-reachable', LABELS['demo-reachable'], false, ['demo_url is missing.'])
  } else {
    try {
      const res = await withRetry(async () => {
        const r = await fetchImpl(demoUrl, { method: 'GET', redirect: 'follow' })
        if (r.status >= 500) throw new Error(`status ${r.status}`)
        return r
      }, { retries, sleep })
      demoReachable = res.status === 200
        ? finding('demo-reachable', LABELS['demo-reachable'], true)
        : finding('demo-reachable', LABELS['demo-reachable'], false, [`Demo URL returned HTTP ${res.status} (expected 200).`])
    } catch (err) {
      demoReachable = finding('demo-reachable', LABELS['demo-reachable'], false, [`Demo URL could not be reached: ${String(err.message || err)}`])
    }
  }

  return [repoPublic, repoLicense, demoReachable]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && node --test test/external.test.mjs`
Expected: PASS (all subtests, and fast — `sleep` is a no-op stub).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/external.mjs scripts/test/external.test.mjs
git commit -m "feat(ci): external repo/license/demo liveness checks"
```

---

### Task 7: Render the PR checklist comment

**Files:**
- Create: `scripts/lib/report.mjs`
- Test: `scripts/test/report.test.mjs`

**Interfaces:**
- Produces: `COMMENT_MARKER: string`; `renderComment({ dir: string|null, findings: Finding[] }): string`.

- [ ] **Step 1: Write the failing test `scripts/test/report.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderComment, COMMENT_MARKER } from '../lib/report.mjs'

const findings = [
  { id: 'path-scope', label: 'Folder structure & path scoping', ok: true, details: [] },
  { id: 'repo-license', label: 'Repo license is MIT', ok: false, details: ['GitHub detected: Apache-2.0'] },
]

test('includes the marker, the dir, and a line per finding', () => {
  const md = renderComment({ dir: 'cycle1/foo', findings })
  assert.ok(md.startsWith(COMMENT_MARKER))
  assert.match(md, /cycle1\/foo/)
  assert.match(md, /✅ Folder structure & path scoping/)
  assert.match(md, /❌ Repo license is MIT/)
  assert.match(md, /Apache-2\.0/)
  assert.match(md, /blocked/i)
})

test('all-pass shows a success line', () => {
  const md = renderComment({ dir: 'cycle1/foo', findings: [{ id: 'x', label: 'X', ok: true, details: [] }] })
  assert.match(md, /All automated checks passed/i)
})

test('a notice renders ⚠️ + a manual-review line and never says blocked', () => {
  const md = renderComment({ dir: 'cycle2/x', findings: [
    { id: 'repo-public', label: 'Repo is a public git repo', ok: true, details: [], level: 'error' },
    { id: 'repo-license', label: 'Repo license is MIT', ok: false, level: 'notice', details: ['reviewer must confirm'] },
  ] })
  assert.match(md, /⚠️ Repo license is MIT/)
  assert.match(md, /reviewer must confirm/)
  assert.match(md, /confirm manually/i)
  assert.doesNotMatch(md, /blocked/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/report.test.mjs`
Expected: FAIL — cannot find module `../lib/report.mjs`.

- [ ] **Step 3: Create `scripts/lib/report.mjs`**

```js
// Renders the sticky PR checklist comment from the combined findings.
// A finding is { id, label, ok, details, level }. level 'notice' (⚠️) never
// blocks — it flags something a human reviewer must confirm (e.g. the MIT
// license on a non-github.com host). Everything else is a blocking gate.

export const COMMENT_MARKER = '<!-- nimiq-submission-check -->'

const iconFor = (f) => (f.level === 'notice' ? '⚠️' : (f.ok ? '✅' : '❌'))
const isBlocking = (f) => f.level !== 'notice'

export function renderComment({ dir, findings }) {
  const lines = [
    COMMENT_MARKER,
    `### Submission check${dir ? `: \`${dir}\`` : ''}`,
    '',
  ]
  for (const f of findings) {
    lines.push(`${iconFor(f)} ${f.label}`)
    if (!f.ok) for (const d of f.details) lines.push(`  - ${d}`)
  }

  const blockingFailed = findings.some((f) => isBlocking(f) && !f.ok)
  const hasNotice = findings.some((f) => f.level === 'notice')
  lines.push('')
  if (blockingFailed) {
    lines.push('**Some automated checks failed — see above. This PR is blocked until they pass.**')
  } else if (hasNotice) {
    lines.push('**Automated checks passed. Items marked ⚠️ need a reviewer to confirm manually.**')
  } else {
    lines.push('**All automated checks passed.**')
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && node --test test/report.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/report.mjs scripts/test/report.test.mjs
git commit -m "feat(ci): render PR checklist comment"
```

---

### Task 8: `validate.mjs` entrypoint (wires fs + git + phase → findings JSON + exit code)

**Files:**
- Create: `scripts/validate.mjs`
- Create: `scripts/test/fixtures/valid/cycle1/foo/submission.yaml`
- Create (binary): `scripts/test/fixtures/valid/cycle1/foo/icon.png`, `thumbnail.png`, `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`
- Test: `scripts/test/validate-cli.test.mjs`

**Interfaces:**
- Consumes: `checkStructural`, `resolveSubmission` from `lib/structural.mjs`; `checkExternal` from `lib/external.mjs`.
- Produces: a CLI: `node validate.mjs <structural|external>`. Reads changed paths from `CHANGED_PATHS` env (newline-separated) or falls back to `git diff --name-only origin/$BASE_REF...HEAD`. Reads files relative to `cwd`. Writes `findings-<phase>.json` = `{ dir, findings }`. Prints a per-check PASS/FAIL/NOTE log. Exits `1` if any **blocking** finding failed (a `notice` never fails the job), `0` otherwise, `2` on bad usage.

- [ ] **Step 1: Create the valid fixture manifest `scripts/test/fixtures/valid/cycle1/foo/submission.yaml`**

```yaml
app_name: Foo App
category: Productivity
tagline: Do the thing.
description: A working mini app for the test fixture.
pricing: Free
repo_url: https://github.com/foo/foo
demo_url: https://foo.example
video_url: https://foo.example/v
contact_email: foo@example.com
team_name: null
team_members: null
x_account: foo
builder_story: null
icon: icon.png
thumbnail: thumbnail.png
screenshots:
  - screenshot-1.png
  - screenshot-2.png
  - screenshot-3.png
github_login: foo
submitted_at: 2026-07-13T00:00:00.000Z
```

- [ ] **Step 2: Create the fixture PNGs**

Run (from repo root) to generate minimal valid PNG files:

```bash
node -e '
  const fs = require("fs");
  const dir = "scripts/test/fixtures/valid/cycle1/foo";
  // 1x1 transparent PNG.
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000d49444154789c6360000002000100ffff03000006" +
    "0005570a4dcb0000000049454e44ae426082", "hex");
  for (const f of ["icon.png","thumbnail.png","screenshot-1.png","screenshot-2.png","screenshot-3.png"])
    fs.writeFileSync(`${dir}/${f}`, png);
  console.log("wrote fixtures");
'
```
Expected: prints `wrote fixtures`; five `.png` files exist. Verify: `node -e 'console.log(require("./scripts/lib/sniff.mjs"))' 2>/dev/null; node --input-type=module -e "import {sniffImageType} from './scripts/lib/sniff.mjs'; import {readFileSync} from 'node:fs'; console.log(sniffImageType(readFileSync('scripts/test/fixtures/valid/cycle1/foo/icon.png')))"`
Expected: `png`.

- [ ] **Step 3: Write the failing test `scripts/test/validate-cli.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = resolve(here, 'fixtures/valid')
const validateJs = resolve(here, '../validate.mjs')

function runStructural(changed) {
  const out = execFileSync('node', [validateJs, 'structural'], {
    cwd: fixtureRoot,
    env: { ...process.env, CHANGED_PATHS: changed.join('\n') },
    encoding: 'utf8',
    // execFileSync throws on non-zero exit; capture via try/catch by callers.
  })
  return out
}

test('structural phase passes on a valid fixture and writes findings JSON', () => {
  const changed = [
    'cycle1/foo/submission.yaml',
    'cycle1/foo/icon.png',
    'cycle1/foo/thumbnail.png',
    'cycle1/foo/screenshot-1.png',
    'cycle1/foo/screenshot-2.png',
    'cycle1/foo/screenshot-3.png',
  ]
  const jsonPath = resolve(fixtureRoot, 'findings-structural.json')
  if (existsSync(jsonPath)) rmSync(jsonPath)
  const out = runStructural(changed)
  assert.match(out, /PASS/)
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
  assert.equal(parsed.dir, 'cycle1/foo')
  assert.ok(parsed.findings.every((f) => f.ok))
  rmSync(jsonPath)
})

test('structural phase exits non-zero when a file is outside the folder', () => {
  let threw = false
  try {
    execFileSync('node', [validateJs, 'structural'], {
      cwd: fixtureRoot,
      env: { ...process.env, CHANGED_PATHS: 'cycle1/foo/submission.yaml\nREADME.md' },
      encoding: 'utf8',
    })
  } catch (err) {
    threw = true
    assert.equal(err.status, 1)
  }
  assert.ok(threw, 'expected non-zero exit')
  const jsonPath = resolve(fixtureRoot, 'findings-structural.json')
  if (existsSync(jsonPath)) rmSync(jsonPath)
})

test('bad usage exits 2', () => {
  let status = 0
  try {
    execFileSync('node', [validateJs, 'nonsense'], { cwd: fixtureRoot, encoding: 'utf8' })
  } catch (err) { status = err.status }
  assert.equal(status, 2)
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd scripts && node --test test/validate-cli.test.mjs`
Expected: FAIL — cannot find `../validate.mjs`.

- [ ] **Step 5: Create `scripts/validate.mjs`**

```js
#!/usr/bin/env node
// CI entrypoint. Runs one phase of checks against the submission touched by the
// current PR, writes findings-<phase>.json, prints a log, and exits non-zero if
// any check failed.
//
// Usage: node validate.mjs <structural|external>
// Inputs (env): CHANGED_PATHS (newline list) or BASE_REF for a git-diff fallback;
//               GITHUB_TOKEN (external phase, for the GitHub API).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkStructural, resolveSubmission } from './lib/structural.mjs'
import { checkExternal } from './lib/external.mjs'

const phase = process.argv[2]
if (phase !== 'structural' && phase !== 'external') {
  console.error('usage: validate.mjs <structural|external>')
  process.exit(2)
}

const root = process.cwd()
const readFile = (p) => {
  const abs = `${root}/${p}`
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : null
}
const listDir = (d) => {
  const abs = `${root}/${d}`
  if (!existsSync(abs)) return []
  return readdirSync(abs).filter((f) => statSync(`${abs}/${f}`).isFile())
}

function changedPaths() {
  if (process.env.CHANGED_PATHS != null) {
    return process.env.CHANGED_PATHS.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  const base = process.env.BASE_REF || 'main'
  const out = execFileSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { encoding: 'utf8' })
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
}

const paths = changedPaths()
const resolved = resolveSubmission({ changedPaths: paths, readFile })

let findings
if (phase === 'structural') {
  findings = checkStructural({ changedPaths: paths, readFile, listDir })
} else {
  findings = await checkExternal({ value: resolved.value, token: process.env.GITHUB_TOKEN })
}

writeFileSync(`findings-${phase}.json`, JSON.stringify({ dir: resolved.dir, findings }, null, 2))

for (const f of findings) {
  const tag = f.level === 'notice' ? 'NOTE' : (f.ok ? 'PASS' : 'FAIL')
  console.log(`${tag}  ${f.label}`)
  if (!f.ok) for (const d of f.details) console.log(`        - ${d}`)
}

// Only blocking findings gate the job — a 'notice' (e.g. non-github license)
// is reported but never fails the check.
const blockingFailed = findings.some((f) => f.level !== 'notice' && !f.ok)
process.exit(blockingFailed ? 1 : 0)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd scripts && node --test test/validate-cli.test.mjs`
Expected: PASS. (The valid-fixture structural run passes because the fixture folder contains exactly submission.yaml + the five referenced PNGs.)

- [ ] **Step 7: Run the whole suite**

Run: `cd scripts && npm test`
Expected: all test files PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate.mjs scripts/test/validate-cli.test.mjs scripts/test/fixtures
git commit -m "feat(ci): validate.mjs entrypoint + valid fixture"
```

---

### Task 9: `comment.mjs` — post/update the sticky PR comment

**Files:**
- Create: `scripts/comment.mjs`
- Test: `scripts/test/comment.test.mjs`

**Interfaces:**
- Consumes: `renderComment`, `COMMENT_MARKER` from `lib/report.mjs`.
- Produces: exports `buildAndPost({ structural, external, repo, pr, token, fetchImpl }): Promise<'created'|'updated'|'skipped'>` and, when run as a CLI, reads `findings-structural.json` + `findings-external.json` + env (`GITHUB_REPOSITORY`, `PR_NUMBER`, `GITHUB_TOKEN`) and calls it. Splitting the logic out makes it unit-testable with an injected fetch.

- [ ] **Step 1: Write the failing test `scripts/test/comment.test.mjs`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAndPost } from '../comment.mjs'
import { COMMENT_MARKER } from '../lib/report.mjs'

const structural = { dir: 'cycle1/foo', findings: [{ id: 'path-scope', label: 'Folder structure & path scoping', ok: true, details: [] }] }
const external = { dir: 'cycle1/foo', findings: [{ id: 'demo-reachable', label: 'Demo reachable (HTTP 200)', ok: false, details: ['HTTP 500'] }] }

// Records requests; drives responses from a queue.
function recorder(responses) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body })
    const r = responses.shift() || { status: 200, body: [] }
    return { status: r.status, json: async () => r.body, ok: r.status < 400 }
  }
  return { fetchImpl, calls }
}

test('creates a new comment when none exists', async () => {
  const { fetchImpl, calls } = recorder([{ status: 200, body: [] }, { status: 201, body: {} }])
  const result = await buildAndPost({ structural, external, repo: 'o/r', pr: '7', token: 't', fetchImpl })
  assert.equal(result, 'created')
  const post = calls.find((c) => c.method === 'POST')
  assert.ok(post.url.includes('/repos/o/r/issues/7/comments'))
  assert.ok(post.body.includes(COMMENT_MARKER))
  assert.ok(post.body.includes('Demo reachable'))
})

test('updates the existing marked comment', async () => {
  const { fetchImpl, calls } = recorder([
    { status: 200, body: [{ id: 99, body: `${COMMENT_MARKER}\nold` }] },
    { status: 200, body: {} },
  ])
  const result = await buildAndPost({ structural, external, repo: 'o/r', pr: '7', token: 't', fetchImpl })
  assert.equal(result, 'updated')
  const patch = calls.find((c) => c.method === 'PATCH')
  assert.ok(patch.url.includes('/repos/o/r/issues/comments/99'))
})

test('returns "skipped" and does not throw when the API is read-only (403)', async () => {
  const { fetchImpl } = recorder([{ status: 200, body: [] }, { status: 403, body: {} }])
  const result = await buildAndPost({ structural, external, repo: 'o/r', pr: '7', token: 't', fetchImpl })
  assert.equal(result, 'skipped')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && node --test test/comment.test.mjs`
Expected: FAIL — cannot find `../comment.mjs`.

- [ ] **Step 3: Create `scripts/comment.mjs`**

```js
#!/usr/bin/env node
// Posts (or updates) the sticky submission-check comment on the PR from the two
// findings-*.json artifacts. Best-effort: a read-only token (fork PR) makes the
// write 403 and we return 'skipped' rather than failing the job.
import { existsSync, readFileSync } from 'node:fs'
import { renderComment, COMMENT_MARKER } from './lib/report.mjs'

const api = (fetchImpl, token, path, init = {}) =>
  fetchImpl(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'User-Agent': 'nimiq-submissions-ci',
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })

export async function buildAndPost({ structural, external, repo, pr, token, fetchImpl = fetch }) {
  const dir = structural?.dir || external?.dir || null
  const findings = [...(structural?.findings || []), ...(external?.findings || [])]
  const body = renderComment({ dir, findings })

  try {
    const listRes = await api(fetchImpl, token, `/repos/${repo}/issues/${pr}/comments?per_page=100`)
    const list = listRes.status === 200 ? await listRes.json() : []
    const existing = Array.isArray(list) ? list.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER)) : null

    const writeRes = existing
      ? await api(fetchImpl, token, `/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
      : await api(fetchImpl, token, `/repos/${repo}/issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) })

    if (writeRes.status >= 400) {
      console.log(`comment write returned ${writeRes.status} — skipping (likely a read-only token on a fork PR).`)
      return 'skipped'
    }
    return existing ? 'updated' : 'created'
  } catch (err) {
    console.log('could not post comment:', String(err?.message || err))
    return 'skipped'
  }
}

// CLI: only runs when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('comment.mjs')
if (invokedDirectly) {
  const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { dir: null, findings: [] })
  const result = await buildAndPost({
    structural: load('findings-structural.json'),
    external: load('findings-external.json'),
    repo: process.env.GITHUB_REPOSITORY,
    pr: process.env.PR_NUMBER,
    token: process.env.GITHUB_TOKEN,
  })
  console.log(`comment: ${result}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && node --test test/comment.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/comment.mjs scripts/test/comment.test.mjs
git commit -m "feat(ci): sticky PR comment poster"
```

---

### Task 10: The GitHub Actions workflow

**Files:**
- Create: `.github/workflows/validate-submission.yml`

**Interfaces:**
- Consumes: `scripts/validate.mjs`, `scripts/comment.mjs`, the committed `scripts/package-lock.json`.
- Produces: three jobs — `structural`, `external` (required gates), `summary` (reporter). Provides `changed.txt` to the scripts via the `CHANGED_PATHS` env.

- [ ] **Step 1: Create `.github/workflows/validate-submission.yml`**

```yaml
name: Validate submission

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

# Least-privilege: read the code, write PR comments, set commit statuses.
permissions:
  contents: read
  pull-requests: write
  statuses: read

concurrency:
  group: validate-submission-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  structural:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install script deps
        working-directory: scripts
        run: npm ci
      - name: Compute changed files
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh api "repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/files" \
            --paginate -q '.[].filename' > changed.txt
          echo "Changed files:"; cat changed.txt
      - name: Run structural checks
        run: |
          CHANGED_PATHS="$(cat changed.txt)" node scripts/validate.mjs structural
      - name: Upload findings
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: findings-structural
          path: findings-structural.json
          if-no-files-found: ignore

  external:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install script deps
        working-directory: scripts
        run: npm ci
      - name: Compute changed files
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh api "repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/files" \
            --paginate -q '.[].filename' > changed.txt
      - name: Run external checks
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          CHANGED_PATHS="$(cat changed.txt)" node scripts/validate.mjs external
      - name: Upload findings
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: findings-external
          path: findings-external.json
          if-no-files-found: ignore

  summary:
    needs: [structural, external]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Download structural findings
        uses: actions/download-artifact@v4
        with:
          name: findings-structural
        continue-on-error: true
      - name: Download external findings
        uses: actions/download-artifact@v4
        with:
          name: findings-external
        continue-on-error: true
      - name: Post/update PR comment
        env:
          GITHUB_TOKEN: ${{ github.token }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: node scripts/comment.mjs
```

- [ ] **Step 2: Lint the workflow**

Run: `cd scripts && npx --yes actionlint ../.github/workflows/validate-submission.yml || echo "actionlint not available — skip"`
Expected: no errors (or the skip message if actionlint can't be fetched). If actionlint reports real issues, fix them.

- [ ] **Step 3: Sanity-check YAML parses**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; import {parse} from './scripts/node_modules/yaml/dist/index.js'; parse(readFileSync('.github/workflows/validate-submission.yml','utf8')); console.log('workflow yaml ok')"`
Expected: `workflow yaml ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/validate-submission.yml
git commit -m "feat(ci): submission validation workflow (structural + external + summary)"
```

---

### Task 11: Dry-run against the five open submission PRs

**Files:**
- Create: `scripts/test/fixtures/README.md` (documents how to regenerate the smoke-run below; no product code)

**Interfaces:** none (verification task).

This task confirms the validator behaves correctly against real submissions before branch protection is enabled. It has no automated test — it is a manual smoke run whose results are reported to the maintainer.

- [ ] **Step 1: Fetch each open PR's folder into a temp workspace and run the structural phase**

Run (requires `gh` authenticated; from repo root):

```bash
for n in 1 2 3 4 5; do
  br=$(gh pr view "$n" --json headRefName -q .headRefName)
  login=$(gh pr view "$n" --json files -q '.files[].path' | grep submission.yaml | cut -d/ -f2)
  echo "=== PR #$n  ($login) ==="
  tmp=$(mktemp -d)
  git --work-tree="$tmp" checkout "origin/$br" -- "cycle1/$login" 2>/dev/null || \
    gh api "repos/${GITHUB_REPOSITORY:-nimiq/miniappscompetition-submissions}/contents/cycle1/$login?ref=$br" >/dev/null
  # Structural against a checkout of the PR head:
  git fetch origin "$br":"pr-$n" >/dev/null 2>&1
  git --work-tree="$tmp" checkout "pr-$n" -- "cycle1/$login"
  ( cd "$tmp" && CHANGED_PATHS="$(git -C "$OLDPWD" diff --name-only main..pr-$n)" \
      node "$OLDPWD/scripts/validate.mjs" structural ) || true
  rm -rf "$tmp"
done
```

> If the loop's git plumbing is awkward in your environment, the reliable fallback is: `gh pr checkout <n>`, then from the repo root run `CHANGED_PATHS="$(git diff --name-only main...HEAD)" node scripts/validate.mjs structural`, then `git checkout main`. Do that for each PR.

Expected: each prints a PASS/FAIL checklist. Note which PRs fail structural and why.

- [ ] **Step 2: Run the external phase for each (network required)**

For each PR branch checked out (`gh pr checkout <n>`), from repo root:

```bash
CHANGED_PATHS="$(git diff --name-only main...HEAD)" GITHUB_TOKEN="$(gh auth token)" node scripts/validate.mjs external
git checkout main
```

Expected: PASS/FAIL/NOTE per repo-public / repo-license / demo-reachable. The 5 current PRs are all github.com repos, so their license is auto-checked (strict MIT) — expect real failures where a repo lacks an MIT license or a demo is down (that is the gate working). `video_url: https://ComingSoon.com` is fine (video isn't checked). If a future submission links a non-github host, its license will show a ⚠️ NOTE (non-blocking) instead of PASS/FAIL — confirm that renders as expected.

- [ ] **Step 3: Write `scripts/test/fixtures/README.md`**

```markdown
# Fixtures

`valid/cycle1/foo/` is a minimal passing submission used by the CLI tests
(`test/validate-cli.test.mjs`). The five PNGs are 1×1 transparent images; the
manifest mirrors the portal schema.

## Smoke-running against real PRs

See `docs/superpowers/plans/2026-07-13-submission-ci-validation.md` Task 11:
`gh pr checkout <n>`, then
`CHANGED_PATHS="$(git diff --name-only main...HEAD)" node scripts/validate.mjs structural`.
```

- [ ] **Step 4: Report results to the maintainer**

Summarize per-PR pass/fail (structural + external) so the maintainer can decide whether to (a) ask submitters to fix, and (b) enable the three checks as required in branch protection. **Do not** enable branch protection automatically — that is a maintainer action in repo settings.

- [ ] **Step 5: Commit**

```bash
git add scripts/test/fixtures/README.md
git commit -m "docs(ci): fixtures readme + smoke-run notes"
```

---

## Self-Review

**1. Spec coverage** (checked against `docs/superpowers/specs/2026-07-13-submission-ci-validation-design.md`):

- Structural checks 1–6 → Tasks 3 (path-scope, yaml), 4 (schema, login-match), 5 (images, undeclared files). ✓
- External checks 7–9 → Task 6: repo-public via host-agnostic `git ls-remote`; repo-license = strict SPDX MIT on github.com (blocking) / `notice` on other hosts (non-blocking); demo-reachable. ✓
- Any-host public repos accepted (not github-only) → Task 6 `git ls-remote` + non-github tests. ✓
- Non-github license is a non-blocking reviewer notice → Task 6 (`level:'notice'`), rendered ⚠️ in Task 7, ignored by the exit gate in Task 8. ✓
- Retry/backoff on external (ls-remote, GitHub API, demo) → Task 6 `withRetry` + tests (flaky-503-then-200, ls-remote-retry). ✓
- Three jobs, two required + reporter, artifacts → Task 10. ✓
- One sticky comment → Tasks 7 + 9 + 10 summary job. ✓
- Node + `yaml` + `node:test` → Task 1. ✓
- Fork/read-only token best-effort comment → Task 9 (`'skipped'` on 403) + Task 10 permissions. ✓
- `github_login` == folder → Task 4. ✓
- Path-traversal-safe image filenames → Task 5 (`SAFE_FILENAME_RE`). ✓
- Multi-cycle `cycleN` regex → Task 1 (`SUBMISSION_DIR_RE`) + Task 3. ✓
- Mirror-comment drift note → Task 1/2 source-of-truth comments. ✓
- Rollout against 5 open PRs, don't auto-enable branch protection → Task 11. ✓
- `video_url` not liveness-checked → Task 6 (only demo is fetched). ✓
- No `workflow_dispatch` → Task 10 triggers are `pull_request` only. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows full code. ✓

**3. Type consistency:** `Finding = { id, label, ok, details: string[], level: 'error' | 'notice' }` is used identically in `structural.mjs`, `external.mjs`, `report.mjs`, `comment.mjs`, and every test; both `finding()` helpers default `level` to `'error'`, and only the non-github license finding sets `'notice'`. `report.mjs` (icon + summary) and `validate.mjs` (exit gate) both branch on `level !== 'notice'`. `resolveSubmission` returns `{ folders, dir, login, outside, value, yamlError }` and is consumed with those exact names in `checkStructural` (Task 3) and `validate.mjs` (Task 8). `checkExternal({ value, ... })` matches its caller in `validate.mjs`. `buildAndPost({ structural, external, repo, pr, token, fetchImpl })` matches its test and CLI caller. ✓
