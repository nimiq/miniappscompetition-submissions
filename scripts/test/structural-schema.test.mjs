import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, checkStructural } from '../lib/structural.mjs'

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

test('readme fails when the folder has no README.md', () => {
  const dir = 'cycle1/foo'
  const readFile = (p) => (p === `${dir}/submission.yaml` ? Buffer.from('app_name: X\ngithub_login: foo\n') : null)
  const findings = checkStructural({
    changedPaths: [`${dir}/submission.yaml`],
    readFile,
    listDir: () => ['submission.yaml', 'icon.png'],
  })
  const readme = findings.find((f) => f.id === 'readme')
  assert.equal(readme.ok, false)
  assert.match(readme.details.join(' '), /README\.md is missing/)
})

test('readme passes when the folder has a README.md, even if the manifest is unparseable', () => {
  const dir = 'cycle1/foo'
  const readFile = (p) => (p === `${dir}/submission.yaml` ? Buffer.from('app_name: "unterminated\n') : null)
  const findings = checkStructural({
    changedPaths: [`${dir}/submission.yaml`],
    readFile,
    listDir: () => ['submission.yaml', 'README.md'],
  })
  assert.equal(findings.find((f) => f.id === 'yaml').ok, false)
  assert.equal(findings.find((f) => f.id === 'readme').ok, true)
})

test('login-match fails when submission.yaml github_login does not match the folder login', () => {
  const dir = 'cycle1/realuser'
  const readFile = (p) => (p === `${dir}/submission.yaml` ? Buffer.from('app_name: X\ngithub_login: someoneelse\n') : null)
  const findings = checkStructural({
    changedPaths: [`${dir}/submission.yaml`],
    readFile,
    listDir: () => ['submission.yaml'],
  })
  const loginMatch = findings.find((f) => f.id === 'login-match')
  assert.equal(loginMatch.ok, false)
  assert.match(loginMatch.details.join(' '), /someoneelse/)
  assert.match(loginMatch.details.join(' '), /realuser/)
})
