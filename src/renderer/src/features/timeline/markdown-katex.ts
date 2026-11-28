// Everything that pulls in KaTeX (~0.8 MB). Loaded on demand by markdown-katex-runtime.ts —
// import it from nowhere else, or KaTeX is back in the Markdown chunk.
import rehypeKatex from 'rehype-katex'
import type { Pluggable } from 'unified'
import 'katex/dist/katex.min.css'
import 'katex/contrib/mhchem/mhchem.js'
import { KATEX_MACROS } from '@renderer/features/timeline/markdown-math-preprocess'

export { FencedMathBlock } from '@renderer/features/timeline/markdown-math'

export const KATEX_REHYPE_PLUGINS: Pluggable[] = [
  [
    rehypeKatex,
    {
      trust: false,
      // 'warn' 只会刷控制台（中文进公式等），渲染结果不变
      strict: 'ignore',
      macros: KATEX_MACROS,
      output: 'htmlAndMathml',
    },
  ],
]
