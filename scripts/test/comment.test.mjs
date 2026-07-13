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
