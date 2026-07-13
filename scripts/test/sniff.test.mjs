import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sniffImageType } from '../lib/sniff.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

test('sniffs known formats', () => {
  assert.equal(sniffImageType(png), 'png')
  assert.equal(sniffImageType(jpg), 'jpg')
  assert.equal(sniffImageType(gif), 'gif')
  assert.equal(sniffImageType(webp), 'webp')
})

test('returns null for junk or short buffers', () => {
  assert.equal(sniffImageType(Buffer.from([0, 1, 2])), null)
  assert.equal(sniffImageType(Buffer.from('%PDF-1.7 aaaa')), null)
})
