import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Release job source availability (H-01)', () => {
  it('release job checks out repo before SBOM/checksums', () => {
    const yml = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    const releaseJob = yml.split('release:')[1] || ''
    const checkoutIdx = releaseJob.indexOf('actions/checkout')
    const sbomIdx = releaseJob.indexOf('generate-release-sbom')
    const sumsIdx = releaseJob.indexOf('generate-release-checksums')
    assert.ok(checkoutIdx >= 0, 'checkout step missing in release job')
    assert.ok(sbomIdx >= 0 && checkoutIdx < sbomIdx, 'checkout must precede SBOM')
    assert.ok(sumsIdx >= 0 && checkoutIdx < sumsIdx, 'checkout must precede checksums')
  })
})