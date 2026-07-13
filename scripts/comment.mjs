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
  try {
    const dir = structural?.dir || external?.dir || null
    const findings = [...(structural?.findings || []), ...(external?.findings || [])]
    const body = renderComment({ dir, findings })

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

// Loads a phase's findings-<phase>.json artifact. If the file is entirely
// ABSENT — e.g. the gate job infra-failed before it could write the artifact —
// a missing-artifact default of {dir:null, findings:[]} would render as a
// silent all-pass next to a red check. So an absent file synthesizes a
// blocking finding instead. A file that exists but fails to parse is treated
// as empty (logged, not crashed) rather than synthesized, since that's a
// smaller/rarer failure mode than "job never ran".
export function loadFindingsArtifact(p, phase) {
  if (!existsSync(p)) {
    return {
      dir: null,
      findings: [{
        id: `${phase}-incomplete`,
        label: `${phase} checks did not complete`,
        ok: false,
        level: 'error',
        details: [`The ${phase} job did not produce results — see its job log.`],
      }],
    }
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (err) {
    console.log(`could not parse ${p}:`, String(err?.message || err))
    return { dir: null, findings: [] }
  }
}

// CLI: only runs when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('comment.mjs')
if (invokedDirectly) {
  const result = await buildAndPost({
    structural: loadFindingsArtifact('findings-structural.json', 'structural'),
    external: loadFindingsArtifact('findings-external.json', 'external'),
    repo: process.env.GITHUB_REPOSITORY,
    pr: process.env.PR_NUMBER,
    token: process.env.GITHUB_TOKEN,
  })
  console.log(`comment: ${result}`)
}
