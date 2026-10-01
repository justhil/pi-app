import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Release job source availability (H-01)', () => {
  it('should_block_release_when_dependency_audit_has_failed', () => {
    const yml = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    assert.match(yml, /\n  dependency-audit:\n/)
    const auditJob = yml.split('\n  dependency-audit:\n')[1]?.split('\n  build-win:')[0] || ''
    assert.match(auditJob, /npm ci/)
    assert.match(auditJob, /node scripts\/ci-audit\.mjs/)
    const releaseJob = yml.split('\n  release:\n')[1] || ''
    assert.match(releaseJob, /needs: \[dependency-audit, build-win, build-mac, build-linux\]/)
  })

  it('should_use_tracked_fonts_without_installing_an_unused_next_peer', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    assert.equal(pkg.devDependencies.geist, undefined)
    assert.equal(lock.packages['node_modules/next'], undefined)
    assert.equal(pkg.scripts.build, 'electron-vite build')
    assert.ok(readFileSync(join(root, 'src/renderer/public/fonts/geist-mono/GeistMono-Regular.woff2')).length > 0)
    assert.match(readFileSync(join(root, 'src/renderer/public/fonts/geist-mono/OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/)
  })

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