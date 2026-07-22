import { parse as parseYaml } from 'yaml'
import { CATEGORIES, IMAGE, MAX, PRICING, SAFE_FILENAME_RE, isHttpUrl } from './schema.mjs'

const CYCLE_RE = /^cycle(\d+)$/

const byCycleNumber = (a, b) => Number(a.match(CYCLE_RE)[1]) - Number(b.match(CYCLE_RE)[1])

const joinUrl = (base, path) => `${base.replace(/\/+$/, '')}/${path}`

const isRequiredText = (value, max) => typeof value === 'string'
  && value.trim() !== ''
  && value.length <= max

const isOptionalText = (value, max) => value == null
  || (typeof value === 'string' && value.length <= max)

const isValidDate = (value) => typeof value === 'string'
  && value.trim() !== ''
  && !Number.isNaN(Date.parse(value))

// Builds the public app feed from every cycleN/<login>/submission.yaml in the
// repo. Pure: filesystem access is injected, so the whole thing is testable
// without a fixture tree.
//
// Publishes public catalog, media and builder-profile data. contact_email and
// builder_story stay out of the feed.
//
// Returns { feed, assets, errors }. `assets` are the image files to copy into
// the published site, at the same repo-relative paths their URLs point to.
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

      const {
        app_name: appName,
        category,
        tagline,
        description,
        pricing,
        repo_url: repoUrl,
        demo_url: demoUrl,
        video_url: videoUrl,
        icon,
        thumbnail,
        screenshots,
        github_login: githubLogin,
        x_account: xAccount,
        team_name: teamName,
        team_members: teamMembers,
        submitted_at: submittedAt,
      } = value

      if (!isRequiredText(appName, MAX.appName)) {
        errors.push(`${dir}: app_name is missing.`)
        continue
      }
      if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
        errors.push(`${dir}: category is missing or not one of the known categories.`)
        continue
      }
      if (!isRequiredText(tagline, MAX.tagline)) {
        errors.push(`${dir}: tagline is missing or too long.`)
        continue
      }
      if (!isRequiredText(description, MAX.description)) {
        errors.push(`${dir}: description is missing or too long.`)
        continue
      }
      if (typeof pricing !== 'string' || !PRICING.includes(pricing)) {
        errors.push(`${dir}: pricing is missing or not one of the known options.`)
        continue
      }
      if (typeof repoUrl !== 'string' || !isHttpUrl(repoUrl)) {
        errors.push(`${dir}: repo_url is missing or not an http(s) URL.`)
        continue
      }
      if (typeof demoUrl !== 'string' || !isHttpUrl(demoUrl)) {
        errors.push(`${dir}: demo_url is missing or not an http(s) URL.`)
        continue
      }
      if (typeof videoUrl !== 'string' || !isHttpUrl(videoUrl)) {
        errors.push(`${dir}: video_url is missing or not an http(s) URL.`)
        continue
      }
      if (typeof githubLogin !== 'string' || githubLogin.trim() === '') {
        errors.push(`${dir}: github_login is missing.`)
        continue
      }
      if (!isOptionalText(xAccount, MAX.xAccount)) {
        errors.push(`${dir}: x_account must be text or null.`)
        continue
      }
      if (!isOptionalText(teamName, MAX.teamName)) {
        errors.push(`${dir}: team_name must be text or null.`)
        continue
      }
      if (teamMembers != null && (!Array.isArray(teamMembers)
        || teamMembers.length > MAX.teamMembers
        || teamMembers.some((member) => typeof member !== 'string' || member.length > MAX.teamMember))) {
        errors.push(`${dir}: team_members must be a list of text or null.`)
        continue
      }
      if (!isValidDate(submittedAt)) {
        errors.push(`${dir}: submitted_at is missing or not a valid date.`)
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
      if (typeof thumbnail !== 'string' || !SAFE_FILENAME_RE.test(thumbnail)) {
        errors.push(`${dir}: thumbnail is missing or not a plain safe filename.`)
        continue
      }
      if (!readFile(`${dir}/${thumbnail}`)) {
        errors.push(`${dir}: thumbnail "${thumbnail}" is referenced but not present in the folder.`)
        continue
      }
      if (!Array.isArray(screenshots)
        || screenshots.length < IMAGE.minScreens
        || screenshots.length > IMAGE.maxScreens
        || screenshots.some((screenshot) => typeof screenshot !== 'string' || !SAFE_FILENAME_RE.test(screenshot))) {
        errors.push(`${dir}: screenshots must contain 3 to 5 safe filenames.`)
        continue
      }
      const missingScreenshot = screenshots.find((screenshot) => !readFile(`${dir}/${screenshot}`))
      if (missingScreenshot) {
        errors.push(`${dir}: screenshot "${missingScreenshot}" is referenced but not present in the folder.`)
        continue
      }

      apps.push({
        cycle,
        app_name: appName,
        category,
        tagline,
        description,
        pricing,
        url: demoUrl,
        repo_url: repoUrl,
        video_url: videoUrl,
        icon: joinUrl(baseUrl, `${dir}/${icon}`),
        thumbnail: joinUrl(baseUrl, `${dir}/${thumbnail}`),
        screenshots: screenshots.map((screenshot) => joinUrl(baseUrl, `${dir}/${screenshot}`)),
        github_login: githubLogin,
        x_account: xAccount ?? null,
        team_name: teamName ?? null,
        team_members: teamMembers ?? null,
        submitted_at: submittedAt,
      })
      assets.push(`${dir}/${icon}`, `${dir}/${thumbnail}`, ...screenshots.map((screenshot) => `${dir}/${screenshot}`))
    }
  }

  return { feed: { generated_at: generatedAt, commit, apps }, assets, errors }
}
