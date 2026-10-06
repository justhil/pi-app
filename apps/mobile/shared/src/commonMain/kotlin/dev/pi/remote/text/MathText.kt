package dev.pi.remote.text

/**
 * Math delimiters, ported from the desktop's `markdown-math-preprocess.ts` so the phone treats the
 * same text as math: `$…$` / `$$…$$` / `\(…\)` / `\[…\]` / ```math|latex|tex fences, pandoc rules
 * for single dollars (money like "$13.43/task … $3.97" stays text), no bare CJK inside `$…$`.
 */
object MathText {
    private val fenceRe = Regex("^ {0,3}(`{3,}|~{3,})")
    private val inlineParenRe = Regex("""\\\((.+?)\\\)""")
    private val codeSplitRe = Regex("(`+[^`]*`+)")
    private val cjkRe = Regex("[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]")
    private val textGroupRe = Regex("""\\(?:text|mbox|mathrm|textrm|operatorname)\s*\{[^{}]*\}""")

    /** Desktop `KATEX_MACROS`. */
    val macros = mapOf(
        "\\RR" to "\\mathbb{R}", "\\NN" to "\\mathbb{N}", "\\ZZ" to "\\mathbb{Z}", "\\QQ" to "\\mathbb{Q}", "\\CC" to "\\mathbb{C}",
        "\\dd" to "\\mathrm{d}", "\\ee" to "\\mathrm{e}", "\\ii" to "\\mathrm{i}",
    )

    fun expandMacros(tex: String): String {
        if (!tex.contains('\\')) return tex
        var out = tex
        for ((k, v) in macros) out = out.replace(Regex(Regex.escape(k) + "(?![A-Za-z])"), Regex.escapeReplacement(v))
        return out
    }

    /**
     * Desktop `convertLatexDelimiters`: `\[ … \]` display blocks (delimiters on their own lines or
     * the whole line) → `$$` blocks, `\( … \)` → `$…$`, outside fences, inline code and `$$` blocks.
     * A `\[` in the middle of prose (`参考 \[1\]`) is a Markdown escape and stays.
     * Also: a line that is exactly `$$ … $$` becomes a display block.
     */
    fun convertDelimiters(text: String): String {
        if (!text.contains("\\[") && !text.contains("\\(") && !text.contains("$$")) return text
        var fence: String? = null
        var inDollarDisplay = false
        var bracketIndent: String? = null
        val out = ArrayList<String>()
        for (line in text.split('\n')) {
            val fenceMatch = fenceRe.find(line)
            if (fence != null) {
                if (fenceMatch != null && fenceMatch.groupValues[1][0] == fence[0] && fenceMatch.groupValues[1].length >= fence.length) fence = null
                out += line
                continue
            }
            if (fenceMatch != null && bracketIndent == null) {
                fence = fenceMatch.groupValues[1]
                out += line
                continue
            }
            val indent = line.takeWhile { it.isWhitespace() }
            val body = line.trim()
            if (bracketIndent != null) {
                if (body.endsWith("\\]")) {
                    val rest = body.dropLast(2).trimEnd()
                    if (rest.isNotEmpty()) out += "$bracketIndent$rest"
                    out += "$bracketIndent$$"
                    bracketIndent = null
                } else {
                    out += line
                }
                continue
            }
            if (line.contains("$$")) {
                val count = Regex("\\$\\$").findAll(line).count()
                if (!inDollarDisplay && count == 2 && body.startsWith("$$") && body.endsWith("$$") && body.length > 4) {
                    out += "$indent$$"
                    out += "$indent${body.substring(2, body.length - 2).trim()}"
                    out += "$indent$$"
                    continue
                }
                if (count % 2 == 1) inDollarDisplay = !inDollarDisplay
                out += line
                continue
            }
            if (inDollarDisplay) {
                out += line
                continue
            }
            if (body == "\\[") {
                out += "$indent$$"
                bracketIndent = indent
                continue
            }
            if (body.startsWith("\\[") && body.endsWith("\\]") && body.length > 4) {
                out += "$indent$$"
                out += "$indent${body.substring(2, body.length - 2).trim()}"
                out += "$indent$$"
                continue
            }
            if (!line.contains("\\(")) {
                out += line
                continue
            }
            out += splitCode(line).mapIndexed { i, part -> if (i % 2 == 1) part else inlineParenRe.replace(part) { m -> "$" + m.groupValues[1].trim().replace("$", "\\$") + "$" } }.joinToString("")
        }
        return out.joinToString("\n")
    }

    /** Odd parts are inline code spans (same split the desktop uses). */
    private fun splitCode(line: String): List<String> {
        val parts = ArrayList<String>()
        var last = 0
        for (m in codeSplitRe.findAll(line)) {
            parts += line.substring(last, m.range.first)
            parts += m.value
            last = m.range.last + 1
        }
        parts += line.substring(last)
        return parts
    }

    private fun isSingleDollar(s: String, i: Int): Boolean =
        s[i] == '$' && s.getOrNull(i - 1) != '\\' && s.getOrNull(i - 1) != '$' && s.getOrNull(i + 1) != '$'

    sealed interface Piece {
        data class Text(val text: String) : Piece
        data class Math(val tex: String) : Piece
    }

    /**
     * Inline math in one Markdown segment (no fences inside): pandoc rules for `$…$` like the
     * desktop's `escapeDollarsInText`, plus inline `$$…$$`. Inline code spans and `$$` display
     * blocks are left alone. Unpaired `$` stay literal text.
     */
    fun inlinePieces(markdown: String): List<Piece> {
        if (!markdown.contains('$')) return listOf(Piece.Text(markdown))
        val out = ArrayList<Piece>()
        val text = StringBuilder()
        fun flush() {
            if (text.isNotEmpty()) out += Piece.Text(text.toString())
            text.clear()
        }
        var inDisplay = false
        val lines = markdown.split('\n')
        lines.forEachIndexed { li, line ->
            if (line.trim() == "$$" || (line.contains("$$") && Regex("\\$\\$").findAll(line).count() % 2 == 1)) {
                inDisplay = !inDisplay
                text.append(line)
            } else if (inDisplay) {
                text.append(line)
            } else {
                splitCode(line).forEachIndexed { pi, part ->
                    if (pi % 2 == 1) text.append(part) else scanDollars(part, text) { tex ->
                        flush()
                        out += Piece.Math(tex)
                    }
                }
            }
            if (li < lines.size - 1) text.append('\n')
        }
        flush()
        return out
    }

    private fun scanDollars(s: String, text: StringBuilder, onMath: (String) -> Unit) {
        var i = 0
        while (i < s.length) {
            // Inline $$…$$ on one line.
            if (s.startsWith("$$", i) && s.getOrNull(i - 1) != '\\') {
                val close = s.indexOf("$$", i + 2)
                if (close > i + 2) {
                    onMath(s.substring(i + 2, close).trim())
                    i = close + 2
                    continue
                }
            }
            if (!isSingleDollar(s, i)) {
                text.append(s[i])
                i++
                continue
            }
            var close = -1
            if (i + 1 < s.length && !s[i + 1].isWhitespace()) {
                for (j in i + 2 until s.length) {
                    if (!isSingleDollar(s, j)) continue
                    if (!s[j - 1].isWhitespace() && s.getOrNull(j + 1)?.isDigit() != true) close = j
                    break
                }
            }
            val body = if (close > 0) s.substring(i + 1, close) else ""
            if (close > 0 && !cjkRe.containsMatchIn(textGroupRe.replace(body, ""))) {
                onMath(body)
                i = close + 1
            } else {
                text.append('$')
                i++
            }
        }
    }
}
