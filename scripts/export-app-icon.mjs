/**
 * 从 resources/icon.svg 导出 build/icon.png (1024) 供 electron-builder → icon.ico
 * 需要: npm i -D sharp
 * 运行: node scripts/export-app-icon.mjs
 */
import { mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'resources', 'icon.svg')
const outDir = join(root, 'build')
const outPng = join(outDir, 'icon.png')

async function main() {
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.error('请先安装: npm i -D sharp')
    process.exit(1)
  }
  const svg = await readFile(svgPath)
  await mkdir(outDir, { recursive: true })
  await sharp(svg, { density: 300 }).resize(1024, 1024).png().toFile(outPng)
  console.log('Wrote', outPng)
  console.log('打包: npm run package:win 会使用 build/icon.ico（需 electron-builder 从 icon.png 生成，或自行转 ico）')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})