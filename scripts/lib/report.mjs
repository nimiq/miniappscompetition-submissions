// Renders the sticky PR checklist comment from the combined findings.
// A finding is { id, label, ok, details, level }. level 'notice' (⚠️) never
// blocks — it flags something a human reviewer must confirm (e.g. the MIT
// license on a non-github.com host). Everything else is a blocking gate.

export const COMMENT_MARKER = '<!-- nimiq-submission-check -->'

const iconFor = (f) => (f.level === 'notice' ? '⚠️' : (f.ok ? '✅' : '❌'))
const isBlocking = (f) => f.level !== 'notice'

export function renderComment({ dir, findings }) {
  const lines = [
    COMMENT_MARKER,
    `### Submission check${dir ? `: \`${dir}\`` : ''}`,
    '',
  ]
  for (const f of findings) {
    lines.push(`${iconFor(f)} ${f.label}`)
    if (!f.ok) for (const d of (f.details || [])) lines.push(`  - ${d}`)
  }

  const blockingFailed = findings.some((f) => isBlocking(f) && !f.ok)
  const hasNotice = findings.some((f) => f.level === 'notice')
  lines.push('')
  if (blockingFailed) {
    lines.push('**Some automated checks failed — see above. This PR is blocked until they pass.**')
  } else if (hasNotice) {
    lines.push('**Automated checks passed. Items marked ⚠️ need a reviewer to confirm manually.**')
  } else {
    lines.push('**All automated checks passed.**')
  }
  return lines.join('\n')
}
