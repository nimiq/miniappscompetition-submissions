import { parse as parseYaml } from 'yaml'
import { SUBMISSION_DIR_RE } from './schema.mjs'

export const finding = (id, label, ok, details = [], level = 'error') => ({ id, label, ok, details, level })

const LABELS = {
  'path-scope': 'Folder structure & path scoping',
  yaml: 'submission.yaml parses',
  schema: 'Manifest schema',
  'login-match': 'github_login matches folder',
  images: 'Images present & valid',
}

// From the PR's changed-file list, find the single submission folder and read
// its manifest. Never throws.
export function resolveSubmission({ changedPaths, readFile }) {
  const folders = new Set()
  for (const p of changedPaths) {
    const m = p.match(SUBMISSION_DIR_RE)
    if (m) folders.add(`${m[1]}/${m[2]}`)
  }
  const folderList = [...folders]
  if (folderList.length !== 1) {
    return { folders: folderList, dir: null, login: null, outside: [], value: null, yamlError: null }
  }
  const dir = folderList[0]
  const login = dir.split('/')[1]
  const outside = changedPaths.filter((p) => !p.startsWith(`${dir}/`))
  const buf = readFile(`${dir}/submission.yaml`)
  if (!buf) return { folders: folderList, dir, login, outside, value: null, yamlError: 'missing' }
  try {
    const value = parseYaml(buf.toString('utf-8'))
    if (!value || typeof value !== 'object') {
      return { folders: folderList, dir, login, outside, value: null, yamlError: 'not a mapping' }
    }
    return { folders: folderList, dir, login, outside, value, yamlError: null }
  } catch (err) {
    return { folders: folderList, dir, login, outside, value: null, yamlError: String(err?.message || err) }
  }
}

function pathScopeFinding(r, changedPaths) {
  if (r.folders.length === 0) {
    return finding('path-scope', LABELS['path-scope'], false, [
      'No files under a cycleN/<login>/ folder were changed. A submission PR must add files under exactly one such folder.',
    ])
  }
  if (r.folders.length > 1) {
    return finding('path-scope', LABELS['path-scope'], false, [
      `This PR changes ${r.folders.length} submission folders (${r.folders.join(', ')}). A PR must contain exactly one submission.`,
    ])
  }
  if (r.outside.length > 0) {
    return finding('path-scope', LABELS['path-scope'], false, [
      `These changed files are outside ${r.dir}/:`,
      ...r.outside,
    ])
  }
  return finding('path-scope', LABELS['path-scope'], true)
}

const notEvaluated = (id) => finding(id, LABELS[id], false, ['Not evaluated until earlier checks pass.'])

export function checkStructural({ changedPaths, readFile, listDir }) {
  const r = resolveSubmission({ changedPaths, readFile })
  const pathScope = pathScopeFinding(r, changedPaths)

  if (!r.dir) {
    return [pathScope, notEvaluated('yaml'), notEvaluated('schema'), notEvaluated('login-match'), notEvaluated('images')]
  }

  if (r.yamlError || !r.value) {
    const detail = r.yamlError === 'missing'
      ? 'submission.yaml is missing from the folder.'
      : `submission.yaml could not be parsed: ${r.yamlError}`
    const yaml = finding('yaml', LABELS.yaml, false, [detail])
    return [pathScope, yaml, notEvaluated('schema'), notEvaluated('login-match'), notEvaluated('images')]
  }

  const yaml = finding('yaml', LABELS.yaml, true)
  // Schema / login-match / images are filled in by later tasks. For now,
  // return them as passing placeholders so the checklist shape is stable.
  const schema = finding('schema', LABELS.schema, true)
  const loginMatch = finding('login-match', LABELS['login-match'], true)
  const images = finding('images', LABELS.images, true)
  return [pathScope, yaml, schema, loginMatch, images]
}
