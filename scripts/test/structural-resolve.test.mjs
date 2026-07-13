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
