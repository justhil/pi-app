#!/usr/bin/env node
/**
 * Draft user-facing GitHub Release body from CHANGELOG.md.
 * Printed to stdout — review/edit before softprops/action-gh-release or manual paste.
 *
 * The output is shown in the in-app update dialog. Prefer short, user-readable notes
 * (fix / new / notes). Do not emit link-only placeholders.
 *
 * Usage: node scripts/generate-release-notes.mjs [version]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Extract and clean the CHANGELOG section for a version into release notes.
 * @param {string} changelogMarkdown
 * @param {string} version e.g. "0.4.18" (no leading v)
 * @returns {string}
 */
export function buildReleaseNotesFromChangelog(changelogMarkdown, version) {
  const normalized = String(version || '')
    .trim()
    .replace(/^v/i, '')
  if (!normalized) {
    throw new Error('version is required')
  }

  // Avoid /m: under multiline mode `$` matches end-of-line and a non-greedy
  // `*?` would truncate the section body to the first line.
  // Match section headers mid-file with `(?:^|\n)` instead.
  const header = new RegExp(
    `(?:^|\\n)## \\[${normalized.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`,
  )
  const match = String(changelogMarkdown || '').match(header)
  if (!match) {
    throw new Error(`No CHANGELOG section for ${normalized}`)
  }

  const body = match[1]
    // Drop meta lines that only point at CHANGELOG / RELEASE docs
    .replace(/^>.*GitHub Release.*$/gim, '')
    .replace(/^>.*CHANGELOG\.md.*$/gim, '')
    .replace(/^完整更新日志[：:].*$/gim, '')
    .replace(/^Release 说明[：:].*$/gim, '')
    .replace(/^\s*完整变更记录见.*$/gim, '')
    .trim()

  if (!body) {
    throw new Error(`CHANGELOG section for ${normalized} is empty after cleanup`)
  }

  return [
    `## pi Desktop v${normalized}`,
    '',
    body,
    '',
    '---',
    '',
    '安装包见本页 Assets。更新说明以本正文为准（应用内「发现新版本」弹窗会展示）。',
    '',
  ].join('\n')
}

function main() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = String(process.argv[2] || pkg.version).replace(/^v/i, '')
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  try {
    process.stdout.write(buildReleaseNotesFromChangelog(changelog, version))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

const invokedAsCli =
  Boolean(process.argv[1]) &&
  (pathToFileURL(resolve(process.argv[1])).href === import.meta.url ||
    /generate-release-notes\.mjs$/i.test(String(process.argv[1]).replace(/\\/g, '/')))

if (invokedAsCli) {
  main()
}
