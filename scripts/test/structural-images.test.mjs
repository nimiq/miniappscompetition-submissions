import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkImages } from '../lib/structural.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const JUNK = Buffer.from('not an image at all')

function ctx(files, value) {
  const readFile = (p) => (p in files ? files[p] : null)
  const listDir = (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1))
  return { dir: 'cycle1/foo', value, readFile, listDir }
}
const baseValue = {
  icon: 'icon.png', thumbnail: 'thumbnail.png',
  screenshots: ['screenshot-1.png', 'screenshot-2.png', 'screenshot-3.png'],
}
const goodFiles = {
  'cycle1/foo/submission.yaml': Buffer.from('x'),
  'cycle1/foo/icon.png': PNG,
  'cycle1/foo/thumbnail.png': PNG,
  'cycle1/foo/screenshot-1.png': PNG,
  'cycle1/foo/screenshot-2.png': PNG,
  'cycle1/foo/screenshot-3.png': PNG,
}

test('valid images pass', () => {
  const r = checkImages(ctx(goodFiles, baseValue))
  assert.equal(r.ok, true, r.details.join('; '))
})

test('missing referenced image fails', () => {
  const files = { ...goodFiles }
  delete files['cycle1/foo/screenshot-2.png']
  const r = checkImages(ctx(files, baseValue))
  assert.equal(r.ok, false)
  assert.match(r.details.join(' '), /screenshot-2\.png/)
})

test('wrong type fails', () => {
  const r = checkImages(ctx({ ...goodFiles, 'cycle1/foo/icon.png': JUNK }, baseValue))
  assert.equal(r.ok, false)
})

test('thumbnail may be a gif but a screenshot may not', () => {
  const okThumb = checkImages(ctx({ ...goodFiles, 'cycle1/foo/thumbnail.png': GIF }, baseValue))
  assert.equal(okThumb.ok, true, okThumb.details.join('; '))
  const badShot = checkImages(ctx({ ...goodFiles, 'cycle1/foo/screenshot-1.png': GIF }, baseValue))
  assert.equal(badShot.ok, false)
})

test('oversize image fails', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])
  const r = checkImages(ctx({ ...goodFiles, 'cycle1/foo/icon.png': big }, baseValue))
  assert.equal(r.ok, false)
})

test('undeclared extra file fails', () => {
  const r = checkImages(ctx({ ...goodFiles, 'cycle1/foo/sneaky.txt': Buffer.from('hi') }, baseValue))
  assert.equal(r.ok, false)
  assert.match(r.details.join(' '), /sneaky\.txt/)
})

test('unsafe filename in manifest fails', () => {
  const r = checkImages(ctx(goodFiles, { ...baseValue, icon: '../evil.png' }))
  assert.equal(r.ok, false)
})
