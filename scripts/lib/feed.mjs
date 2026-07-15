import { parse as parseYaml } from 'yaml'
import { CATEGORIES, SAFE_FILENAME_RE, isHttpUrl } from './schema.mjs'

const CYCLE_RE = /^cycle(\d+)$/

const byCycleNumber = (a, b) => Number(a.match(CYCLE_RE)[1]) - Number(b.match(CYCLE_RE)[1])

const joinUrl = (base, path) => `${base.replace(/\/+$/, '')}/${path}`

// Builds the public app feed from every cycleN/<login>/submission.yaml in the
// repo. Pure: filesystem access is injected, so the whole thing is testable
// without a fixture tree.
//
// Only what the Pay app needs to list an app is published — name, category,
// live URL, icon. Everything else in the manifest (contact_email above all)
// stays out of the feed.
//
// Returns { feed, assets, errors }. `assets` are the icon files to copy into
// the published site, at the same repo-relative path the icon URLs point to.
// A non-empty `errors` means the feed is incomplete and must not be published:
// main is already gated by validate-submission.yml, so anything wrong here is
// drift that should be loud rather than a silently dropped app.
export function buildFeed({ listDirs, readFile, baseUrl, commit, generatedAt }) {
  const apps = []
  const assets = []
  const errors = []

  const cycles = listDirs('.').filter((n) => CYCLE_RE.test(n)).sort(byCycleNumber)

  for (const cycle of cycles) {
    for (const login of listDirs(cycle).sort()) {
      const dir = `${cycle}/${login}`
      const buf = readFile(`${dir}/submission.yaml`)
      if (!buf) {
        errors.push(`${dir}: submission.yaml is missing.`)
        continue
      }

      let value
      try {
        value = parseYaml(buf.toString('utf-8'))
      } catch (err) {
        errors.push(`${dir}: submission.yaml could not be parsed: ${err?.message || err}`)
        continue
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${dir}: submission.yaml is not a mapping.`)
        continue
      }

      const { app_name: appName, category, demo_url: demoUrl, icon } = value

      if (typeof appName !== 'string' || appName.trim() === '') {
        errors.push(`${dir}: app_name is missing.`)
        continue
      }
      if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
        errors.push(`${dir}: category is missing or not one of the known categories.`)
        continue
      }
      if (typeof demoUrl !== 'string' || !isHttpUrl(demoUrl)) {
        errors.push(`${dir}: demo_url is missing or not an http(s) URL.`)
        continue
      }
      if (typeof icon !== 'string' || !SAFE_FILENAME_RE.test(icon)) {
        errors.push(`${dir}: icon is missing or not a plain safe filename.`)
        continue
      }
      if (!readFile(`${dir}/${icon}`)) {
        errors.push(`${dir}: icon "${icon}" is referenced but not present in the folder.`)
        continue
      }

      apps.push({ cycle, app_name: appName, category, url: demoUrl, icon: joinUrl(baseUrl, `${dir}/${icon}`) })
      assets.push(`${dir}/${icon}`)
    }
  }

  return { feed: { generated_at: generatedAt, commit, apps }, assets, errors }
}
