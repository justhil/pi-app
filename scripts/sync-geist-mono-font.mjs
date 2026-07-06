import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRoot = join(root, 'node_modules', 'geist')
const srcDir = join(pkgRoot, 'dist', 'fonts', 'geist-mono')
const destDir = join(root, 'src', 'renderer', 'public', 'fonts', 'geist-mono')

const files = ['GeistMono-Regular.woff2']

if (!existsSync(join(pkgRoot, 'package.json'))) {
  console.warn('[sync-geist-mono] skip: geist not installed')
  process.exit(0)
}

mkdirSync(destDir, { recursive: true })
for (const f of files) {
  copyFileSync(join(srcDir, f), join(destDir, f))
}
copyFileSync(join(pkgRoot, 'LICENSE.txt'), join(destDir, 'OFL.txt'))
console.log('[sync-geist-mono] copied', files.join(', '), '+ OFL.txt →', destDir)