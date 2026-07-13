import { parse as parseYaml } from 'yaml'
import { SUBMISSION_DIR_RE, CATEGORIES, PRICING, MAX, EMAIL_RE, isHttpUrl } from './schema.mjs'

// Validates the parsed submission.yaml against the mirrored schema. Returns a
// list of error strings (empty = valid). Mirrors validateSubmission() in the
// portal, adapted to the snake_case YAML shape.
export function validateManifest(v) {
  const errors = []
  const o = v && typeof v === 'object' ? v : {}

  const reqStr = (key, max, label) => {
    const val = o[key]
    if (typeof val !== 'string' || val.trim() === '') {
      errors.push(`${label} (${key}) is required.`)
      return null
    }
    if (val.length > max) errors.push(`${label} (${key}) exceeds ${max} characters.`)
    return val
  }

  reqStr('app_name', MAX.appName, 'App name')

  if (!CATEGORIES.includes(o.category)) errors.push(`category must be one of the allowed categories.`)

  reqStr('tagline', MAX.tagline, 'Tagline')
  reqStr('description', MAX.description, 'Description')

  if (!PRICING.includes(o.pricing)) errors.push(`pricing must be one of ${PRICING.join(', ')}.`)

  for (const key of ['repo_url', 'demo_url', 'video_url']) {
    const val = o[key]
    if (typeof val !== 'string' || val.trim() === '') errors.push(`${key} is required.`)
    else if (!isHttpUrl(val)) errors.push(`${key} must be a valid http(s) URL.`)
  }

  const email = o.contact_email
  if (typeof email !== 'string' || email.trim() === '') errors.push('contact_email is required.')
  else if (!EMAIL_RE.test(email) || email.length > 254) errors.push('contact_email must be a valid email.')

  // Optional fields.
  if (o.team_name != null) {
    if (typeof o.team_name !== 'string') errors.push('team_name must be text or null.')
    else if (o.team_name.length > MAX.teamName) errors.push(`team_name exceeds ${MAX.teamName} characters.`)
  }
  if (o.team_members != null) {
    if (!Array.isArray(o.team_members)) errors.push('team_members must be a list or null.')
    else {
      if (o.team_members.length > MAX.teamMembers) errors.push(`team_members can have at most ${MAX.teamMembers} entries.`)
      if (o.team_members.some((m) => typeof m !== 'string' || m.length > MAX.teamMember)) {
        errors.push(`each team member must be text under ${MAX.teamMember} characters.`)
      }
    }
  }
  if (o.x_account != null) {
    if (typeof o.x_account !== 'string') errors.push('x_account must be text or null.')
    else if (o.x_account.length > MAX.xAccount) errors.push(`x_account exceeds ${MAX.xAccount} characters.`)
  }
  if (o.builder_story != null) {
    if (typeof o.builder_story !== 'string') errors.push('builder_story must be text or null.')
    else if (o.builder_story.length > MAX.builderStory) errors.push(`builder_story exceeds ${MAX.builderStory} characters.`)
  }

  // Image reference fields (existence/type checked separately in checkImages).
  if (typeof o.icon !== 'string' || o.icon.trim() === '') errors.push('icon is required.')
  if (typeof o.thumbnail !== 'string' || o.thumbnail.trim() === '') errors.push('thumbnail is required.')
  if (!Array.isArray(o.screenshots) || o.screenshots.length < 3 || o.screenshots.length > 5
    || o.screenshots.some((s) => typeof s !== 'string')) {
    errors.push('screenshots must be a list of 3 to 5 filenames.')
  }

  if (typeof o.github_login !== 'string' || o.github_login.trim() === '') errors.push('github_login is required.')

  return errors
}

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

  const schemaErrors = validateManifest(r.value)
  const schema = finding('schema', LABELS.schema, schemaErrors.length === 0, schemaErrors)

  const loginOk = r.value.github_login === r.login
  const loginMatch = finding('login-match', LABELS['login-match'], loginOk,
    loginOk ? [] : [`github_login is "${r.value.github_login}" but the folder is "${r.login}". They must match.`])

  const images = finding('images', LABELS.images, true) // real logic added in Task 5
  return [pathScope, yaml, schema, loginMatch, images]
}
