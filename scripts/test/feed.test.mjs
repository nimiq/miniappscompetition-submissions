import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stringify as stringifyYaml } from 'yaml'
import { buildFeed } from '../lib/feed.mjs'

const BASE = 'https://nimiq.github.io/miniappscompetition-submissions'

const manifest = (over = {}) => stringifyYaml({
  app_name: 'Nimiq Bazar',
  category: 'Marketplaces',
  tagline: 'Buy and sell with NIM.',
  description: 'A lightweight marketplace powered by Nimiq.',
  pricing: 'Free',
  repo_url: 'https://github.com/example/nimiq-bazar',
  demo_url: 'https://bazar.nimiq.fyi/',
  video_url: 'https://youtube.com/watch?v=example',
  icon: 'icon.png',
  contact_email: 'someone@example.com',
  thumbnail: 'thumbnail.png',
  screenshots: ['screenshot-1.png', 'screenshot-2.png', 'screenshot-3.png'],
  github_login: 'NimiqBlue',
  x_account: 'nimiqblue',
  team_name: 'Blue Team',
  team_members: ['Alice', 'Bob'],
  builder_story: 'secret builder story',
  submitted_at: '2026-07-11T11:26:58.040Z',
  ...over,
})

const mediaFiles = (dir) => Object.fromEntries([
  'icon.png',
  'thumbnail.png',
  'screenshot-1.png',
  'screenshot-2.png',
  'screenshot-3.png',
].map((name) => [`${dir}/${name}`, 'PNG']))

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

test('emits catalog metadata and absolute same-origin media URLs', () => {
  const { feed, assets, errors } = build({
    'cycle1/NimiqBlue/submission.yaml': manifest(),
    ...mediaFiles('cycle1/NimiqBlue'),
  })

  assert.deepEqual(errors, [])
  assert.deepEqual(feed.apps, [{
    cycle: 'cycle1',
    app_name: 'Nimiq Bazar',
    category: 'Marketplaces',
    tagline: 'Buy and sell with NIM.',
    description: 'A lightweight marketplace powered by Nimiq.',
    pricing: 'Free',
    url: 'https://bazar.nimiq.fyi/',
    repo_url: 'https://github.com/example/nimiq-bazar',
    video_url: 'https://youtube.com/watch?v=example',
    icon: `${BASE}/cycle1/NimiqBlue/icon.png`,
    thumbnail: `${BASE}/cycle1/NimiqBlue/thumbnail.png`,
    screenshots: [
      `${BASE}/cycle1/NimiqBlue/screenshot-1.png`,
      `${BASE}/cycle1/NimiqBlue/screenshot-2.png`,
      `${BASE}/cycle1/NimiqBlue/screenshot-3.png`,
    ],
    github_login: 'NimiqBlue',
    x_account: 'nimiqblue',
    team_name: 'Blue Team',
    team_members: ['Alice', 'Bob'],
    submitted_at: '2026-07-11T11:26:58.040Z',
  }])
  assert.deepEqual(assets, [
    'cycle1/NimiqBlue/icon.png',
    'cycle1/NimiqBlue/thumbnail.png',
    'cycle1/NimiqBlue/screenshot-1.png',
    'cycle1/NimiqBlue/screenshot-2.png',
    'cycle1/NimiqBlue/screenshot-3.png',
  ])
  assert.deepEqual(feed.generated_at, '2026-07-14T00:00:00.000Z')
  assert.deepEqual(feed.commit, 'abc1234')
})

test('excludes contact email and builder story from the public feed', () => {
  const { feed } = build({
    'cycle1/NimiqBlue/submission.yaml': manifest(),
    ...mediaFiles('cycle1/NimiqBlue'),
  })
  assert.doesNotMatch(JSON.stringify(feed), /someone@example\.com/)
  assert.doesNotMatch(JSON.stringify(feed), /secret builder story/)
})

test('preserves optional public profile fields as null', () => {
  const { feed, errors } = build({
    'cycle1/NimiqBlue/submission.yaml': manifest({
      x_account: null,
      team_name: null,
      team_members: null,
    }),
    ...mediaFiles('cycle1/NimiqBlue'),
  })

  assert.deepEqual(errors, [])
  assert.equal(feed.apps[0].x_account, null)
  assert.equal(feed.apps[0].team_name, null)
  assert.equal(feed.apps[0].team_members, null)
})

test('a trailing slash on the base URL does not double up', () => {
  const { feed } = build({
    'cycle1/foo/submission.yaml': manifest(),
    ...mediaFiles('cycle1/foo'),
  }, { baseUrl: `${BASE}/` })
  assert.equal(feed.apps[0].icon, `${BASE}/cycle1/foo/icon.png`)
  assert.equal(feed.apps[0].thumbnail, `${BASE}/cycle1/foo/thumbnail.png`)
  assert.equal(feed.apps[0].screenshots[0], `${BASE}/cycle1/foo/screenshot-1.png`)
})

test('orders cycles numerically, then logins alphabetically', () => {
  const files = {}
  for (const dir of ['cycle10/b', 'cycle10/a', 'cycle2/z', 'cycle1/m']) {
    files[`${dir}/submission.yaml`] = manifest()
    Object.assign(files, mediaFiles(dir))
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
    ...mediaFiles('cycle1/foo'),
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

test('reports missing or malformed public catalog fields', () => {
  const cases = [
    [{ tagline: null }, /tagline is missing/],
    [{ description: null }, /description is missing/],
    [{ pricing: 'Unknown' }, /pricing is missing or not one of the known options/],
    [{ repo_url: 'javascript:alert(1)' }, /repo_url is missing or not an http\(s\) URL/],
    [{ video_url: 'javascript:alert(1)' }, /video_url is missing or not an http\(s\) URL/],
    [{ github_login: null }, /github_login is missing/],
    [{ submitted_at: 'not-a-date' }, /submitted_at is missing or not a valid date/],
  ]

  for (const [over, expected] of cases) {
    const { errors } = build({
      'cycle1/foo/submission.yaml': manifest(over),
      ...mediaFiles('cycle1/foo'),
    })
    assert.match(errors.join('\n'), expected)
  }
})

test('reports malformed optional public profile fields', () => {
  const cases = [
    [{ x_account: 42 }, /x_account must be text or null/],
    [{ team_name: 42 }, /team_name must be text or null/],
    [{ team_members: 'Alice' }, /team_members must be a list of text or null/],
    [{ team_members: ['Alice', 42] }, /team_members must be a list of text or null/],
  ]

  for (const [over, expected] of cases) {
    const { errors } = build({
      'cycle1/foo/submission.yaml': manifest(over),
      ...mediaFiles('cycle1/foo'),
    })
    assert.match(errors.join('\n'), expected)
  }
})

test('reports unsafe, missing, or malformed media references', () => {
  const cases = [
    [{ thumbnail: '../../etc/passwd' }, mediaFiles('cycle1/foo'), /thumbnail is missing or not a plain safe filename/],
    [{ thumbnail: 'missing.png' }, mediaFiles('cycle1/foo'), /thumbnail "missing\.png" is referenced but not present/],
    [{ screenshots: ['screenshot-1.png'] }, mediaFiles('cycle1/foo'), /screenshots must contain 3 to 5 safe filenames/],
    [{ screenshots: ['screenshot-1.png', '../../etc/passwd', 'screenshot-3.png'] }, mediaFiles('cycle1/foo'), /screenshots must contain 3 to 5 safe filenames/],
    [{ screenshots: ['screenshot-1.png', 'missing.png', 'screenshot-3.png'] }, mediaFiles('cycle1/foo'), /screenshot "missing\.png" is referenced but not present/],
  ]

  for (const [over, files, expected] of cases) {
    const { errors } = build({
      'cycle1/foo/submission.yaml': manifest(over),
      ...files,
    })
    assert.match(errors.join('\n'), expected)
  }
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
    ...mediaFiles('cycle1/bad'),
    'cycle1/good/submission.yaml': manifest({ app_name: 'Good' }),
    ...mediaFiles('cycle1/good'),
  })
  assert.equal(errors.length, 1)
  assert.deepEqual(feed.apps.map((a) => a.app_name), ['Good'])
})
