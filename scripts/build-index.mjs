#!/usr/bin/env node
// Builds the public app feed published to GitHub Pages:
//
//   <out>/apps.json                     the feed
//   <out>/cycleN/<login>/<icon>         icons, same-origin with the feed
//
// Icon URLs are derived from PAGES_BASE_URL (the base_url output of
// actions/configure-pages) rather than hardcoded, so attaching a custom domain
// to Pages later regenerates correct URLs with no code change.
//
// Usage: PAGES_BASE_URL=https://example.github.io/repo node scripts/build-index.mjs [outDir]
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildFeed } from './lib/feed.mjs'

const outDir = process.argv[2] || 'dist'
const baseUrl = process.env.PAGES_BASE_URL
const commit = process.env.GITHUB_SHA || null

if (!baseUrl) {
  console.error('PAGES_BASE_URL is required (e.g. https://nimiq.github.io/miniappscompetition-submissions).')
  process.exit(1)
}

const root = process.cwd()

const listDirs = (p) => readdirSync(join(root, p), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

const readFile = (p) => {
  try {
    return readFileSync(join(root, p))
  } catch {
    return null
  }
}

const { feed, assets, errors } = buildFeed({
  listDirs,
  readFile,
  baseUrl,
  commit,
  generatedAt: new Date().toISOString(),
})

if (errors.length > 0) {
  console.error('Cannot build the app feed:')
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (const asset of assets) {
  const dest = join(outDir, asset)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(root, asset), dest)
}
writeFileSync(join(outDir, 'apps.json'), `${JSON.stringify(feed, null, 2)}\n`)

console.log(`Built ${feed.apps.length} app(s) and ${assets.length} icon(s) into ${outDir}/`)
for (const app of feed.apps) console.log(`  • ${app.cycle}  ${app.app_name} — ${app.url}`)
