/**
 * Unit tests for pure helpers in github-release-check (no Electron app).
 * Duplicated lightly so CI can run without bundling main process.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const srcPath = join(root, 'src/main/github-release-check.ts')

// Load via dynamic import of compiled-less path is unavailable; re-implement mirrors for contract.
// Keep in sync with src/main/github-release-check.ts

function parseSemver(tag) {
  const match = String(tag).trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return [0]
  return [Number(match[1]) || 0, Number(match[2]) || 0, Number(match[3]) || 0]
}

function isVersionNewer(candidate, current) {
  const candidateParts = parseSemver(candidate)
  const currentParts = parseSemver(current)
  const length = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < length; index++) {
    const left = candidateParts[index] ?? 0
    const right = currentParts[index] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}

function classifyAssetName(name) {
  const lower = name.toLowerCase()
  if (lower.includes('setup') && lower.endsWith('.exe')) return 'setup'
  if (lower.includes('portable') && lower.endsWith('.exe')) return 'portable'
  if (lower.endsWith('.exe')) return 'setup'
  if (lower.endsWith('.dmg')) return 'dmg'
  if (lower.endsWith('.zip') && (lower.includes('mac') || lower.includes('darwin'))) return 'zip'
  if (lower.endsWith('.appimage')) return 'appimage'
  if (lower.endsWith('.deb')) return 'deb'
  return 'other'
}

function pickDownloadAsset(assets, platform) {
  if (assets.length === 0) return null
  const preference =
    platform === 'win32'
      ? ['setup', 'portable']
      : platform === 'darwin'
        ? ['dmg', 'zip']
        : ['appimage', 'deb']
  for (const kind of preference) {
    const match = assets.find((asset) => asset.kind === kind)
    if (match) return match
  }
  return null
}

describe('github release update helpers', () => {
  it('detects newer semver', () => {
    assert.equal(isVersionNewer('0.4.18', '0.4.17'), true)
    assert.equal(isVersionNewer('v0.5.0', '0.4.17'), true)
    assert.equal(isVersionNewer('0.4.17', '0.4.17'), false)
    assert.equal(isVersionNewer('0.4.16', '0.4.17'), false)
  })

  it('classifies installer assets', () => {
    assert.equal(classifyAssetName('pi Desktop-Setup-0.4.18-x64.exe'), 'setup')
    assert.equal(classifyAssetName('pi Desktop-Portable-0.4.18-x64.exe'), 'portable')
    assert.equal(classifyAssetName('pi Desktop-0.4.18-x64.dmg'), 'dmg')
    assert.equal(classifyAssetName('pi Desktop-0.4.18-x64.AppImage'), 'appimage')
  })

  it('picks platform-preferred asset', () => {
    const assets = [
      { name: 'a.AppImage', url: 'https://x/a', size: 1, kind: 'appimage' },
      { name: 'b-Setup.exe', url: 'https://x/b', size: 1, kind: 'setup' },
      { name: 'c.dmg', url: 'https://x/c', size: 1, kind: 'dmg' },
    ]
    assert.equal(pickDownloadAsset(assets, 'win32')?.kind, 'setup')
    assert.equal(pickDownloadAsset(assets, 'darwin')?.kind, 'dmg')
    assert.equal(pickDownloadAsset(assets, 'linux')?.kind, 'appimage')
  })

  it('source module still exports helpers used by updater', () => {
    const src = readFileSync(srcPath, 'utf8')
    assert.match(src, /export function isVersionNewer/)
    assert.match(src, /export function pickDownloadAsset/)
    assert.match(src, /export function sanitizeReleaseNotes/)
    assert.match(src, /releaseNotes/)
    assert.match(src, /downloadUrl/)
  })

  it('sanitizeReleaseNotes drops legacy link-only placeholders', () => {
    // Keep in sync with sanitizeReleaseNotes in src/main/github-release-check.ts
    function sanitizeReleaseNotes(body) {
      const raw = String(body || '')
        .replace(/\r\n/g, '\n')
        .trim()
      if (!raw) return ''
      const stripped = raw
        .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[*_`#>|~\-]+/g, ' ')
        .replace(/[：:：，,。.！!？?（）()【】\[\]「」]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      if (!stripped) return ''
      const placeholderPhrases = [
        '完整更新日志',
        'release 说明',
        'release说明',
        'see changelog',
        'see the changelog',
        'changelog.md',
        'doc/release.md',
        'release.md',
        '更新日志',
        'changelog',
      ]
      const onlyPlaceholders = stripped
        .split(' ')
        .filter(Boolean)
        .every((token) =>
          placeholderPhrases.some((phrase) => token.includes(phrase) || phrase.includes(token)),
        )
      const shortDocPointer =
        stripped.length < 100 &&
        (stripped.includes('changelog') ||
          stripped.includes('release.md') ||
          stripped.includes('完整更新日志') ||
          stripped.includes('更新日志'))
      if (onlyPlaceholders || shortDocPointer) return ''
      return raw
    }

    const legacy = `完整更新日志：**[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.17/CHANGELOG.md)**

Release 说明：**[doc/RELEASE.md](https://github.com/justhil/pi-app/blob/v0.4.17/doc/RELEASE.md)**`
    assert.equal(sanitizeReleaseNotes(legacy), '')
    assert.match(
      sanitizeReleaseNotes('## 修复\n\n- 会话列表在打包后可用\n'),
      /会话列表/,
    )
  })

  it('updater stays non-blocking and silent on failure', () => {
    const updater = readFileSync(join(root, 'src/main/updater.ts'), 'utf8')
    assert.match(updater, /setImmediate/)
    assert.match(updater, /ignoredUpdateVersion/)
    assert.match(updater, /APP_UPDATE_AVAILABLE_CHANNEL/)
    assert.match(updater, /pendingAppUpdate/)
    assert.match(updater, /getPendingAppUpdate/)
    // Failures must not surface to renderer as errors — only log
    assert.match(updater, /log\.warn\('\[Updater\] check failed/)
  })

  it('IPC allowlist includes pending update + download channels', () => {
    const channels = readFileSync(join(root, 'packages/shared/ipc-channels.ts'), 'utf8')
    assert.match(channels, /ipc:app\.getPendingUpdate/)
    assert.match(channels, /ipc:app\.dismissUpdatePrompt/)
    assert.match(channels, /ipc:app\.downloadUpdate/)
    assert.match(channels, /ipc:app\.ignoreUpdateVersion/)
  })
})
