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
