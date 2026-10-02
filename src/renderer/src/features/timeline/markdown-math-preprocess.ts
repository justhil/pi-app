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

  // remark-math 只认 $ / $$：把 LaTeX 的 \[ \] 与 \( \) 改写过去，否则 Markdown 把 \[ 当转义只剩裸方括号
  text = convertLatexDelimiters(text)

  // 金额等非公式的单个 $ 转义，避免「$13.43/task，比 … $3.97」被当成行内公式
  text = escapeNonMathDollars(text)

  return text
}

const INLINE_PAREN_MATH_RE = /\\\((.+?)\\\)/g

/**
 * Rewrites `\[ … \]` display blocks (the delimiters alone on their lines, or the whole line) to
 * `$$` blocks and `\( … \)` to `$…$`, outside code fences, inline code and `$$` blocks. A `\[`
 * in the middle of prose (`参考 \[1\]`) is a Markdown escape and stays as it is.
 */
export function convertLatexDelimiters(text: string): string {
  if (!text.includes('\\[') && !text.includes('\\(')) return text
  let fence: string | null = null
  let inDollarDisplay = false
  let bracketIndent: string | null = null
  const out: string[] = []
  for (const line of text.split('\n')) {
    const fenceMatch = FENCE_RE.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (fenceMatch && bracketIndent === null) {
      fence = fenceMatch[1]
      out.push(line)
      continue
    }
    const indent = /^\s*/.exec(line)![0]
    const body = line.trim()
    if (bracketIndent !== null) {
      if (body.endsWith('\\]')) {
        const rest = body.slice(0, -2).trimEnd()
        if (rest) out.push(`${bracketIndent}${rest}`)
        out.push(`${bracketIndent}$$`)
        bracketIndent = null
      } else {
        out.push(line)
      }
      continue
    }
    if (line.includes('$$')) {
      if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1) inDollarDisplay = !inDollarDisplay
      out.push(line)
      continue
    }
    if (inDollarDisplay) {
      out.push(line)
      continue
    }
    if (body === '\\[') {
      out.push(`${indent}$$`)
      bracketIndent = indent
      continue
    }
    if (body.startsWith('\\[') && body.endsWith('\\]') && body.length > 4) {
      out.push(`${indent}$$`, `${indent}${body.slice(2, -2).trim()}`, `${indent}$$`)
      continue
    }
    if (!line.includes('\\(')) {
      out.push(line)
      continue
    }
    // Odd parts of a backtick split are inline code.
    out.push(
      line
        .split(/(`+[^`]*`+)/)
        .map((part, index) => (index % 2 === 1 ? part : part.replace(INLINE_PAREN_MATH_RE, (_m, math: string) => `$${math.trim()}$`)))
        .join(''),
    )
  }
  return out.join('\n')
}

// CJK 字符与全角标点：裸写在 $…$ 里几乎总是误判（公式里的中文应写在 \text{} 中）
const CJK_RE = /[　-〿㐀-鿿豈-﫿＀-￯]/
const TEXT_GROUP_RE = /\\(?:text|mbox|mathrm|textrm|operatorname)\s*\{[^{}]*\}/g
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

function isSingleDollar(s: string, i: number): boolean {
  return s[i] === '$' && s[i - 1] !== '\\' && s[i - 1] !== '$' && s[i + 1] !== '$'
}

/**
 * Pandoc-style inline math rules (remark-math has none): the opening $ must be followed by a
 * non-space, the closing $ preceded by a non-space and not followed by a digit, and the body may
 * not contain bare CJK text. Any single $ that does not form such a pair is escaped as literal.
 */
function escapeDollarsInText(s: string): string {
  if (!s.includes('$')) return s
  let out = ''
  let i = 0
  while (i < s.length) {
    if (!isSingleDollar(s, i)) {
      out += s[i]
      i++
      continue
    }
    let close = -1
    if (s[i + 1] && !/\s/.test(s[i + 1])) {
      for (let j = i + 2; j < s.length; j++) {
        if (!isSingleDollar(s, j)) continue
        if (!/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] ?? '')) close = j
        break
      }
    }
    const body = close > 0 ? s.slice(i + 1, close) : ''
    if (close > 0 && !CJK_RE.test(body.replace(TEXT_GROUP_RE, ''))) {
      out += s.slice(i, close + 1)
      i = close + 1
    } else {
      out += '\\$'
      i++
    }
  }
  return out
}

/** Escapes stray `$` outside code fences, inline code and `$$` display blocks. */
export function escapeNonMathDollars(text: string): string {
  if (!text.includes('$')) return text
  let fence: string | null = null
  let inDisplay = false
  return text
    .split('\n')
    .map((line) => {
      const fenceMatch = FENCE_RE.exec(line)
      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
        return line
      }
      if (fenceMatch) {
        fence = fenceMatch[1]
        return line
      }
      if (line.includes('$$')) {
        if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1) inDisplay = !inDisplay
        return line
      }
      if (inDisplay) return line
      // Leave inline code spans untouched: odd parts of a backtick split are code.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, index) => (index % 2 === 1 ? part : escapeDollarsInText(part)))
        .join('')
    })
    .join('\n')
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
