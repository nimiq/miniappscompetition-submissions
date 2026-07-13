#!/usr/bin/env node
// CI entrypoint. Runs one phase of checks against the submission touched by the
// current PR, writes findings-<phase>.json, prints a log, and exits non-zero if
// any check failed.
//
// Usage: node validate.mjs <structural|external>
// Inputs (env): CHANGED_PATHS (newline list) or BASE_REF for a git-diff fallback;
//               GITHUB_TOKEN (external phase, for the GitHub API).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkStructural, resolveSubmission } from './lib/structural.mjs'
import { checkExternal } from './lib/external.mjs'

const phase = process.argv[2]
if (phase !== 'structural' && phase !== 'external') {
  console.error('usage: validate.mjs <structural|external>')
  process.exit(2)
}

const root = process.cwd()
const readFile = (p) => {
  const abs = `${root}/${p}`
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : null
}
const listDir = (d) => {
  const abs = `${root}/${d}`
  if (!existsSync(abs)) return []
  return readdirSync(abs).filter((f) => statSync(`${abs}/${f}`).isFile())
}

function changedPaths() {
  if (process.env.CHANGED_PATHS != null) {
    return process.env.CHANGED_PATHS.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  const base = process.env.BASE_REF || 'main'
  const out = execFileSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { encoding: 'utf8' })
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
}

const paths = changedPaths()
const resolved = resolveSubmission({ changedPaths: paths, readFile })

let findings
if (phase === 'structural') {
  findings = checkStructural({ changedPaths: paths, readFile, listDir })
} else {
  findings = await checkExternal({ value: resolved.value, token: process.env.GITHUB_TOKEN })
}

writeFileSync(`findings-${phase}.json`, JSON.stringify({ dir: resolved.dir, findings }, null, 2))

for (const f of findings) {
  const tag = f.level === 'notice' ? 'NOTE' : (f.ok ? 'PASS' : 'FAIL')
  console.log(`${tag}  ${f.label}`)
  if (!f.ok) for (const d of f.details) console.log(`        - ${d}`)
}

// Only blocking findings gate the job — a 'notice' (e.g. non-github license)
// is reported but never fails the check.
const blockingFailed = findings.some((f) => f.level !== 'notice' && !f.ok)
process.exit(blockingFailed ? 1 : 0)
