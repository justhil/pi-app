/**
 * 规范化常见 LaTeX 写法，并在流式输出时闭合未结束的数学定界符，避免半段公式把后续正文吞进 KaTeX。
 */

const DISPLAY_ENV_RE =
  /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|split|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|array)\}/g

export function preprocessMarkdownMath(source: string, options?: { streaming?: boolean }): string {
  let text = source.replace(/\r\n/g, '\n')

  // ```latex / ```tex → ```math（rehype-katex 识别 language-math）
  text = text.replace(/```(latex|tex)\b/gi, '```math')

  // 部分作者用 ~~~math 或纯 ```math 已支持，此处仅别名

  if (options?.streaming) {
    text = closeUnfinishedMath(text)
  }

  return text
}

function closeUnfinishedMath(text: string): string {
  let out = text

  // 未闭合的 $$ …（奇数个 $$）
  const dollarBlocks = out.match(/\$\$/g)
  if (dollarBlocks && dollarBlocks.length % 2 === 1) {
    out += '\n$$\n'
  }

  // 未闭合的 \[ …
  const openBracket = (out.match(/\\\[/g) || []).length
  const closeBracket = (out.match(/\\\]/g) || []).length
  if (openBracket > closeBracket) {
    out += '\n\\]\n'
  }

  // 未闭合的 \( …
  const openParen = (out.match(/\\\(/g) || []).length
  const closeParen = (out.match(/\\\)/g) || []).length
  if (openParen > closeParen) {
    out += '\n\\)\n'
  }

  // \begin{env} 多于 \end{env}（粗算：仅当末尾像在写公式环境时补一个 \end）
  const begins = [...out.matchAll(DISPLAY_ENV_RE)]
  const ends = (out.match(/\\end\{/g) || []).length
  if (begins.length > ends) {
    const last = begins[begins.length - 1]
    const env = last[1].replace(/\*$/, '')
    out += `\n\\end{${env}}\n`
  }

  return out
}

/** KaTeX 常用宏扩展（与 rehype-katex 共用） */
export const KATEX_MACROS: Record<string, string> = {
  '\\RR': '\\mathbb{R}',
  '\\NN': '\\mathbb{N}',
  '\\ZZ': '\\mathbb{Z}',
  '\\QQ': '\\mathbb{Q}',
  '\\CC': '\\mathbb{C}',
  '\\dd': '\\mathrm{d}',
  '\\ee': '\\mathrm{e}',
  '\\ii': '\\mathrm{i}',
}