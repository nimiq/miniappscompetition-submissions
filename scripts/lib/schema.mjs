// Schema constants for submission validation.
// SOURCE OF TRUTH: nimiq/miniappscompetition frontend/server/utils/submission.ts
// and frontend/server/utils/images.ts. Keep these mirrored — if the portal
// changes an enum or cap, update it here too.

export const CATEGORIES = [
  'Games', 'Social', 'Earning', 'Marketplaces', 'Productivity',
  'Creator tools', 'Education', 'Health & fitness', 'Food & dining',
  'Shopping & deals', 'Lifestyle',
]

export const PRICING = ['Free', 'Freemium', 'Paid']

export const MAX = {
  appName: 80,
  tagline: 120,
  description: 280,
  teamName: 80,
  teamMember: 80,
  xAccount: 80,
  builderStory: 4000,
  teamMembers: 5,
}

// Mirrored from submission.ts EMAIL_RE.
export const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/

export const IMAGE = {
  maxBytes: 2 * 1024 * 1024,
  maxTotalBytes: 14 * 1024 * 1024,
  minScreens: 3,
  maxScreens: 5,
  stillTypes: ['png', 'jpg', 'webp'],
  thumbTypes: ['png', 'jpg', 'webp', 'gif'],
}

// cycleN/<login>/... — capture group 1 = cycle folder, group 2 = login.
export const SUBMISSION_DIR_RE = /^(cycle\d+)\/([^/]+)\//

// Bare, traversal-safe image filenames only.
export const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/

export function isHttpUrl(s) {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
