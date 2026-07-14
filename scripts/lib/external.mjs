// External liveness checks:
//   repo-public    — repo_url is an anonymously-cloneable public git repo on ANY
//                    host (git ls-remote). Blocking.
//   repo-license   — github.com repos: strict SPDX == MIT via the GitHub API
//                    (blocking). Other hosts: a non-blocking 'notice' — CI can't
//                    auto-verify a license off GitHub, so a reviewer must confirm.
//   demo-reachable — demo_url returns 200. Blocking.
//   video-public   — video_url is a public demo video on YouTube, Loom, Vimeo,
//                    or X, verified via the platform's oEmbed API. Blocking.
// Transient failures (network / HTTP 5xx / ls-remote error) retry before giving up.
import { execFile } from 'node:child_process'

const finding = (id, label, ok, details = [], level = 'error') => ({ id, label, ok, details, level })
const LABELS = {
  'repo-public': 'Repo is a public git repo',
  'repo-license': 'Repo license is MIT',
  'demo-reachable': 'Demo reachable (HTTP 200)',
  'video-public': 'Demo video is a public YouTube/Loom/Vimeo/X video',
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Anonymous public-repo probe that works on any git host. Resolves { code }
// (0 = reachable/public). GIT_TERMINAL_PROMPT=0 + an echo askpass make a private
// repo fail fast instead of blocking on a credential prompt.
const defaultGitLsRemote = (url) => new Promise((resolve) => {
  execFile('git', ['ls-remote', url], {
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo' },
  }, (err) => resolve({ code: err ? 1 : 0 }))
})

// github.com only — used to decide the license path. Returns null for any other
// host (those go down the non-blocking notice branch).
export function parseGithubRepo(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null
  const segs = u.pathname.split('/').filter(Boolean)
  if (segs.length < 2) return null
  return { owner: segs[0], repo: segs[1].replace(/\.git$/i, '') }
}

// Resolves rawUrl to its platform oEmbed endpoint (YouTube / Vimeo / Loom / X).
// Returns null if the URL doesn't parse or the host isn't an allowed platform.
export function videoOembedUrl(rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const enc = encodeURIComponent(rawUrl)
  if (['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    return `https://www.youtube.com/oembed?url=${enc}&format=json`
  }
  if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
    return `https://vimeo.com/api/oembed.json?url=${enc}`
  }
  if (host === 'loom.com') {
    return `https://www.loom.com/v1/oembed?url=${enc}`
  }
  // X: must be a link to a post (/…/status/<id>), the only thing X's oEmbed
  // resolves. Accepts the legacy twitter.com domain and the /i/status/<id> form.
  if (['x.com', 'mobile.x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) {
    if (!/\/status(?:es)?\/\d+/.test(u.pathname)) return null
    return `https://publish.x.com/oembed?url=${enc}&format=json`
  }
  return null
}

export async function withRetry(attempt, { retries = 3, sleep = defaultSleep } = {}) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      return await attempt()
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await sleep(500 * 2 ** i)
    }
  }
  throw lastErr
}

// GitHub API GET. Throws on network error or HTTP 5xx (retryable); returns
// { status, body } for everything else (200, 404, ...).
async function ghGet(path, token, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      'User-Agent': 'nimiq-submissions-ci',
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status >= 500) throw new Error(`GitHub API ${res.status}`)
  const body = res.status === 200 ? await res.json() : null
  return { status: res.status, body }
}

export async function checkExternal({ value, fetchImpl = fetch, token, retries = 3, sleep = defaultSleep, gitLsRemote = defaultGitLsRemote }) {
  if (!value || typeof value !== 'object') {
    return ['repo-public', 'repo-license', 'demo-reachable', 'video-public'].map((id) =>
      finding(id, LABELS[id], false, ['Not evaluated — submission.yaml could not be read/parsed.']))
  }

  const repoUrl = typeof value.repo_url === 'string' ? value.repo_url.trim() : ''
  const demoUrl = typeof value.demo_url === 'string' ? value.demo_url.trim() : ''
  const videoUrl = typeof value.video_url === 'string' ? value.video_url.trim() : ''

  // repo-public — host-agnostic anonymous git ls-remote.
  let repoPublic
  if (!repoUrl) {
    repoPublic = finding('repo-public', LABELS['repo-public'], false, ['repo_url is missing.'])
  } else {
    try {
      await withRetry(async () => {
        const { code } = await gitLsRemote(repoUrl)
        if (code !== 0) throw new Error(`git ls-remote exited ${code}`)
      }, { retries, sleep })
      repoPublic = finding('repo-public', LABELS['repo-public'], true)
    } catch (err) {
      repoPublic = finding('repo-public', LABELS['repo-public'], false,
        [`repo_url is not an anonymously-cloneable public git repo (${String(err.message || err)}).`])
    }
  }

  // repo-license — github.com: strict SPDX (blocking). Other hosts: notice.
  let repoLicense
  const gh = parseGithubRepo(repoUrl)
  if (gh) {
    try {
      const r = await withRetry(() => ghGet(`/repos/${gh.owner}/${gh.repo}/license`, token, fetchImpl), { retries, sleep })
      if (r.status === 200 && r.body?.license?.spdx_id === 'MIT') {
        repoLicense = finding('repo-license', LABELS['repo-license'], true)
      } else if (r.status === 404) {
        repoLicense = finding('repo-license', LABELS['repo-license'], false, ['No license file detected in the repo — an MIT LICENSE is required.'])
      } else {
        const spdx = r.body?.license?.spdx_id || 'none'
        repoLicense = finding('repo-license', LABELS['repo-license'], false, [`Repo license must be MIT (GitHub detected: ${spdx}).`])
      }
    } catch (err) {
      repoLicense = finding('repo-license', LABELS['repo-license'], false, [`Could not read the repo license: ${String(err.message || err)}`])
    }
  } else if (repoUrl) {
    repoLicense = finding('repo-license', LABELS['repo-license'], false,
      ['Repo is not on github.com — the MIT license could not be auto-verified. A reviewer must confirm the repo is MIT-licensed.'],
      'notice')
  } else {
    repoLicense = finding('repo-license', LABELS['repo-license'], false, ['Not evaluated — repo_url is missing.'])
  }

  // demo-reachable
  let demoReachable
  if (!demoUrl) {
    demoReachable = finding('demo-reachable', LABELS['demo-reachable'], false, ['demo_url is missing.'])
  } else {
    try {
      const res = await withRetry(async () => {
        const r = await fetchImpl(demoUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) })
        if (r.status >= 500 || r.status === 429 || r.status === 408) throw new Error(`status ${r.status}`)
        return r
      }, { retries, sleep })
      demoReachable = res.status === 200
        ? finding('demo-reachable', LABELS['demo-reachable'], true)
        : finding('demo-reachable', LABELS['demo-reachable'], false, [`Demo URL returned HTTP ${res.status} (expected 200).`])
    } catch (err) {
      demoReachable = finding('demo-reachable', LABELS['demo-reachable'], false, [`Demo URL could not be reached: ${String(err.message || err)}`])
    }
  }

  // video-public — video_url must be a public YouTube/Loom/Vimeo/X demo video,
  // verified via the platform's oEmbed API.
  let videoPublic
  if (!videoUrl) {
    videoPublic = finding('video-public', LABELS['video-public'], false, ['video_url is missing.'])
  } else {
    const oembedUrl = videoOembedUrl(videoUrl)
    if (!oembedUrl) {
      videoPublic = finding('video-public', LABELS['video-public'], false,
        [`Demo video must be a public YouTube, Loom, or Vimeo link, or a link to an X post (got "${videoUrl}").`])
    } else {
      try {
        const res = await withRetry(async () => {
          const r = await fetchImpl(oembedUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'nimiq-submissions-ci' },
          })
          if (r.status >= 500 || r.status === 429 || r.status === 408) throw new Error(`status ${r.status}`)
          return r
        }, { retries, sleep })
        videoPublic = res.status === 200
          ? finding('video-public', LABELS['video-public'], true)
          : finding('video-public', LABELS['video-public'], false,
            [`The video isn't publicly viewable (the platform's oEmbed API returned HTTP ${res.status}). Make sure it's public or unlisted, not private or deleted.`])
      } catch (err) {
        videoPublic = finding('video-public', LABELS['video-public'], false,
          [`Could not verify the video via the platform's oEmbed API: ${String(err.message || err)}`])
      }
    }
  }

  return [repoPublic, repoLicense, demoReachable, videoPublic]
}
