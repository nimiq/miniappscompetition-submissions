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
