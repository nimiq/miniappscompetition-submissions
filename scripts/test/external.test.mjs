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
