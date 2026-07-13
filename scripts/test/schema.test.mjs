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
