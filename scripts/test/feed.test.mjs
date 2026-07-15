import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFeed } from '../lib/feed.mjs'

const BASE = 'https://nimiq.github.io/miniappscompetition-submissions'

const manifest = (over = {}) => Object.entries({
  app_name: 'Nimiq Bazar',
  category: 'Marketplaces',
  demo_url: 'https://bazar.nimiq.fyi/',
  icon: 'icon.png',
  contact_email: 'someone@example.com',
  thumbnail: 'thumbnail.png',
  ...over,
}).filter(([, v]) => v !== undefined)
  .map(([k, v]) => `${k}: ${v === null ? 'null' : v}`)
  .join('\n')

// Builds { listDirs, readFile } from a { path: contents } map. Directories are
// inferred from the paths, so a test only declares the files it cares about.
function repo(files) {
  const listDirs = (p) => {
    const prefix = p === '.' ? '' : `${p}/`
    const names = new Set()
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest.includes('/')) names.add(rest.split('/')[0])
    }
    return [...names]
  }
  const readFile = (p) => (p in files ? Buffer.from(files[p]) : null)
  return { listDirs, readFile }
}

const build = (files, over = {}) => buildFeed({
  ...repo(files),
  baseUrl: BASE,
  commit: 'abc1234',
  generatedAt: '2026-07-14T00:00:00.000Z',
  ...over,
})

test('emits name, category, url and an absolute same-origin icon URL', () => {
  const { feed, assets, errors } = build({
    'cycle1/NimiqBlue/submission.yaml': manifest(),
    'cycle1/NimiqBlue/icon.png': 'PNG',
  })

  assert.deepEqual(errors, [])
  assert.deepEqual(feed.apps, [{
    cycle: 'cycle1',
    app_name: 'Nimiq Bazar',
    category: 'Marketplaces',
    url: 'https://bazar.nimiq.fyi/',
    icon: `${BASE}/cycle1/NimiqBlue/icon.png`,
  }])
  assert.deepEqual(assets, ['cycle1/NimiqBlue/icon.png'])
  assert.deepEqual(feed.generated_at, '2026-07-14T00:00:00.000Z')
  assert.deepEqual(feed.commit, 'abc1234')
})

test('never leaks fields beyond cycle, name, category, url and icon', () => {
  const { feed } = build({
    'cycle1/NimiqBlue/submission.yaml': manifest({ builder_story: 'secret', x_account: 'someone' }),
    'cycle1/NimiqBlue/icon.png': 'PNG',
  })
  assert.deepEqual(Object.keys(feed.apps[0]), ['cycle', 'app_name', 'category', 'url', 'icon'])
  assert.doesNotMatch(JSON.stringify(feed), /someone@example\.com/)
})

test('a trailing slash on the base URL does not double up', () => {
  const { feed } = build({
    'cycle1/foo/submission.yaml': manifest(),
    'cycle1/foo/icon.png': 'PNG',
  }, { baseUrl: `${BASE}/` })
  assert.equal(feed.apps[0].icon, `${BASE}/cycle1/foo/icon.png`)
})

test('orders cycles numerically, then logins alphabetically', () => {
  const files = {}
  for (const dir of ['cycle10/b', 'cycle10/a', 'cycle2/z', 'cycle1/m']) {
    files[`${dir}/submission.yaml`] = manifest()
    files[`${dir}/icon.png`] = 'PNG'
  }
  const { feed, errors } = build(files)
  assert.deepEqual(errors, [])
  assert.deepEqual(feed.apps.map((a) => a.icon.slice(`${BASE}/`.length)), [
    'cycle1/m/icon.png',
    'cycle2/z/icon.png',
    'cycle10/a/icon.png',
    'cycle10/b/icon.png',
  ])
})

test('ignores non-cycle top-level directories', () => {
  const { feed, errors } = build({
    'scripts/lib/feed.mjs': 'code',
    '.github/workflows/publish-apps.yml': 'yaml',
    'cycle1/foo/submission.yaml': manifest(),
    'cycle1/foo/icon.png': 'PNG',
  })
  assert.deepEqual(errors, [])
  assert.equal(feed.apps.length, 1)
})

// Every error case below is drift that PR validation should already have
// caught, so the feed reports it rather than silently dropping the app.
test('reports a missing manifest', () => {
  const { feed, errors } = build({ 'cycle1/foo/icon.png': 'PNG' })
  assert.deepEqual(feed.apps, [])
  assert.match(errors[0], /cycle1\/foo: submission\.yaml is missing/)
})

test('reports an unparseable manifest', () => {
  const { errors } = build({ 'cycle1/foo/submission.yaml': 'a: [unclosed' })
  assert.match(errors[0], /could not be parsed/)
})

test('reports a manifest that is not a mapping', () => {
  const { errors } = build({ 'cycle1/foo/submission.yaml': '- just\n- a list\n' })
  assert.match(errors[0], /not a mapping/)
})

test('reports a missing app_name', () => {
  const { errors } = build({
    'cycle1/foo/submission.yaml': manifest({ app_name: null }),
    'cycle1/foo/icon.png': 'PNG',
  })
  assert.match(errors[0], /app_name is missing/)
})

test('reports a category that is missing or unknown', () => {
  const { errors: missing } = build({
    'cycle1/foo/submission.yaml': manifest({ category: null }),
    'cycle1/foo/icon.png': 'PNG',
  })
  assert.match(missing[0], /category is missing or not one of the known categories/)

  const { errors: unknown } = build({
    'cycle1/foo/submission.yaml': manifest({ category: 'Wizardry' }),
    'cycle1/foo/icon.png': 'PNG',
  })
  assert.match(unknown[0], /category is missing or not one of the known categories/)
})

test('reports a demo_url that is not http(s)', () => {
  const { errors } = build({
    'cycle1/foo/submission.yaml': manifest({ demo_url: 'javascript:alert(1)' }),
    'cycle1/foo/icon.png': 'PNG',
  })
  assert.match(errors[0], /demo_url is missing or not an http\(s\) URL/)
})

test('reports an icon filename that escapes the folder', () => {
  const { errors } = build({
    'cycle1/foo/submission.yaml': manifest({ icon: '../../etc/passwd' }),
  })
  assert.match(errors[0], /not a plain safe filename/)
})

test('reports an icon that is referenced but absent', () => {
  const { errors } = build({ 'cycle1/foo/submission.yaml': manifest() })
  assert.match(errors[0], /icon\.png" is referenced but not present/)
})

test('collects errors across submissions and still builds the healthy ones', () => {
  const { feed, errors } = build({
    'cycle1/bad/submission.yaml': manifest({ app_name: null }),
    'cycle1/bad/icon.png': 'PNG',
    'cycle1/good/submission.yaml': manifest({ app_name: 'Good' }),
    'cycle1/good/icon.png': 'PNG',
  })
  assert.equal(errors.length, 1)
  assert.deepEqual(feed.apps.map((a) => a.app_name), ['Good'])
})
