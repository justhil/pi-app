// Frontend-rendered README visuals: copy, crops of real screenshots, and render jobs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, VIEWPORT } from './config.mjs'

const px = (v) => v * VIEWPORT.scale

/** Crop a logical-pixel rectangle out of a 2× screenshot. */
function crop(input, out, { x, y, width, height }) {
  execFileSync('magick', [input, '-crop', `${px(width)}x${px(height)}+${px(x)}+${px(y)}`, '+repage', out])
  return out
}

/** Built-in adapter display names from the catalog; adapters with desktop UI come first. */
export function builtinAdapterNames() {
  const dir = join(REPO, 'src/extension-compat/builtin')
  const rank = { native: 0, partial: 1, headless: 2, none: 3 }
  return readdirSync(dir)
    .filter((file) => file.endsWith('.adapter.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')))
    .sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3))
    .map((adapter) => adapter.displayName || adapter.id)
}

const COPY = {
  en: {
    timeline: ['Timeline', 'Steps stream in, then fold', 'Commands, reads and edits appear as they run and collapse into one line once the answer starts.'],
    review: ['Review', 'Diffs, side by side', 'Turn, session or Git scope. Stage single hunks and send line comments back to the chat.'],
    parallel: ['Sessions', 'Turns keep running in parallel', 'Each session has its own worker; switching away never stops a turn.'],
    composer: ['Composer', '@ any project file', 'Fuzzy search that respects .gitignore, inserted as a file reference.'],
    context: ['Run', 'Where the context goes', 'The context window split between user, assistant and tool messages.'],
    adapters: ['Extensions', 'built-in adapters', 'Installed pi extensions get native dialogs, tool cards and panels.'],
    themes: ['Appearance', 'Light, dark, or your own', 'Presets or custom palettes, theme strings and custom CSS.'],
    shared: ['Data', 'The same files as the CLI', 'Nothing to import or migrate.'],
    files: [['sessions/', 'conversations'], ['auth.json', 'model logins'], ['settings.json', 'defaults & packages'], ['models.json', 'custom providers'], ['extensions/', 'local extensions']],
    more: (n) => `+${n} more`,
    platforms: 'Windows · macOS · Linux',
    arch: {
      eyebrow: 'How it fits together',
      termEyebrow: 'Terminal', termTitle: 'pi CLI',
      deskEyebrow: 'Desktop', deskTitle: 'pi Desktop', deskNote: 'One worker process per session runs the same pi SDK — on the host or inside a WSL distribution.',
      layers: [['Renderer', 'Timeline · Review · Files · Tree · Composer'], ['Main process', 'IPC · worker pool · Git · previews · notifications']],
      workersLabel: 'Workers', workers: [['session A · running', true], ['session B · running', true], ['session C · idle', false]],
      cliEdge: 'read / write', deskEdge: 'read / write',
    },
    wipe: ['Light', 'Dark'],
  },
  zh: {
    timeline: ['时间线', '步骤实时出现，随后折叠', '命令、读文件、改文件按执行顺序出现，正文开始输出后收成一行摘要。'],
    review: ['Review', '并排看 diff', '按本轮、本对话或 Git 工作区查看；按 hunk 暂存，行评可发回对话。'],
    parallel: ['会话', '多个回合并行', '每个会话一个 Worker，切走也不会打断正在跑的回合。'],
    composer: ['输入框', '@ 引用项目文件', '模糊搜索，遵守 .gitignore，插入为文件引用。'],
    context: ['Run', '上下文花在哪', '上下文窗口在用户、助手、工具消息之间的占比。'],
    adapters: ['扩展', '个内置适配器', '已安装的 pi 扩展获得原生弹窗、工具卡片和面板。'],
    themes: ['外观', '浅色、深色或自定义', '预设或自定义配色，支持主题字符串和自定义 CSS。'],
    shared: ['数据', '和 CLI 用同一份文件', '无需导入或迁移。'],
    files: [['sessions/', '会话记录'], ['auth.json', '模型登录'], ['settings.json', '默认值与扩展包'], ['models.json', '自定义服务商'], ['extensions/', '本地扩展']],
    more: (n) => `另 ${n} 个`,
    platforms: 'Windows · macOS · Linux',
    arch: {
      eyebrow: '整体结构',
      termEyebrow: '终端', termTitle: 'pi CLI',
      deskEyebrow: '桌面', deskTitle: 'pi Desktop', deskNote: '每个会话一个 Worker 进程，运行同一个 pi SDK——在本机或 WSL 发行版里。',
      layers: [['Renderer', '时间线 · Review · 文件 · 会话树 · 输入框'], ['Main 进程', 'IPC · Worker 池 · Git · 预览 · 通知']],
      workersLabel: 'Workers', workers: [['会话 A · 运行中', true], ['会话 B · 运行中', true], ['会话 C · 空闲', false]],
      cliEdge: '读 / 写', deskEdge: '读 / 写',
    },
    wipe: ['浅色', '深色'],
  },
}

/**
 * Render jobs for one language. Expects raw screenshots from capture.mjs and the parallel still.
 * @returns {import('./render.mjs').RenderJob[]}
 */
export function visualJobs({ lang, rawDir, parallelStill, tmp, outDir }) {
  const c = COPY[lang]
  const dir = join(tmp, `visual-${lang}`)
  mkdirSync(dir, { recursive: true })
  const raw = (name) => join(rawDir, `${lang}-${name}.png`)
  const assets = {
    'timeline.png': crop(raw('light-tools'), join(dir, 'timeline.png'), { x: 340, y: 140, width: 680, height: 560 }),
    'review.png': crop(raw('light-review-wide'), join(dir, 'review.png'), { x: 700, y: 196, width: 740, height: 260 }),
    'parallel.png': crop(parallelStill, join(dir, 'parallel.png'), { x: 12, y: 228, width: 236, height: 268 }),
    'parallel-chat.png': crop(parallelStill, join(dir, 'parallel-chat.png'), { x: 396, y: 52, width: 620, height: 190 }),
    'status.png': crop(parallelStill, join(dir, 'status.png'), { x: 0, y: 878, width: 140, height: 22 }),
    'composer.png': crop(raw('light-mention-chip'), join(dir, 'composer.png'), { x: 417, y: 714, width: 578, height: 160 }),
    'context.png': crop(raw('light-run'), join(dir, 'context.png'), { x: 1152, y: 178, width: 288, height: 150 }),
    'light.png': raw('light-hero'),
    'dark.png': raw('dark-hero'),
  }
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  const names = builtinAdapterNames()
  const shown = names.slice(0, 14)
  const tile = (key, extra = {}) => ({ eyebrow: c[key][0], title: c[key][1], desc: c[key][2], ...extra })
  return [
    {
      template: 'overview.html', width: 1280, height: 1460, assets, out: join(outDir, 'overview.png'),
      data: {
        lang,
        meta: `v${version} · ${c.platforms}`,
        tiles: {
          timeline: tile('timeline', { img: 'timeline.png' }),
          review: tile('review', { img: 'review.png' }),
          parallel: tile('parallel', { img: 'parallel.png', chat: 'parallel-chat.png', status: 'status.png' }),
          composer: tile('composer', { img: 'composer.png' }),
          context: tile('context', { img: 'context.png' }),
          adapters: { ...tile('adapters'), title: `${names.length} ${c.adapters[1]}`, names: shown, more: c.more(names.length - shown.length) },
          themes: tile('themes', { light: 'light.png', dark: 'dark.png' }),
          shared: tile('shared', { files: c.files }),
        },
      },
    },
    ...['light', 'dark'].map((theme) => ({
      template: 'architecture.html', width: 1280, height: 650, out: join(outDir, `architecture-${theme}.png`),
      data: { lang, theme, ...c.arch, termCode: '<i>$</i> pi\n<i>›</i> /tree\n<i>›</i> /model', items: ['sessions/*.jsonl', 'auth.json', 'settings.json', 'models.json', 'extensions/'] },
    })),
    {
      template: 'theme-wipe.html', width: 1280, height: 840, scale: 1, frames: 64, frameMs: 70,
      assets: { 'light.png': raw('light-hero'), 'dark.png': raw('dark-hero') }, out: join(tmp, `frames-theme-${lang}`),
      data: { lang, light: 'light.png', dark: 'dark.png', lightLabel: c.wipe[0], darkLabel: c.wipe[1] },
    },
  ]
}
