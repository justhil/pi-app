package dev.pi.remote.app.ui.rich

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.State
import com.mikepenz.markdown.model.markdownAnnotator
import com.mikepenz.markdown.model.markdownInlineContent
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import dev.pi.remote.text.MathText
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.getTextInNode
import com.mikepenz.markdown.model.markdownDimens
import com.mikepenz.markdown.model.parseMarkdown
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.theme.Tokens
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.piui.PiUiBlock
import dev.pi.remote.text.RichText
import dev.pi.remote.text.Segment

/** Hooks into the session (mermaid script download). Null in previews/tests. */
fun interface MermaidSource {
    suspend fun script(): java.io.File?
}

/**
 * Answer / prose renderer. Text is split into segments (shared RichText): settled markdown is
 * parsed once per segment, the streaming tail stays plain text, rich fences render when closed.
 */
@Composable
fun RichContent(text: String, streaming: Boolean, mermaid: MermaidSource? = null, modifier: Modifier = Modifier) {
    val segments = remember(text, streaming) { RichText.segments(text, streaming) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (s in segments) key(s.key) { SegmentView(s, mermaid) }
    }
}

@Composable
private fun SegmentView(s: Segment, mermaid: MermaidSource?) {
    when (s) {
        is Segment.Markdown -> MarkdownText(s.text)
        is Segment.Tail -> Text(s.text, style = Pi.t.body.copy(color = Pi.c.fg))
        is Segment.Code -> CodeBlock(s.language, s.code)
        is Segment.PiUi -> PiUiBlock(s.raw, s.closed)
        is Segment.Html -> if (s.closed) HtmlCard(s.code) else Skeleton()
        is Segment.Math -> if (s.closed) MathBlock(s.tex) else Skeleton()
        is Segment.Mermaid -> if (s.closed) MermaidBlock(s.code, mermaid) else Skeleton()
    }
}

@Composable
fun Skeleton(label: String = stringResource(R.string.piui_generating)) {
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(label, style = Pi.t.secondary.copy(color = Pi.c.fg3))
    }
}

/** Markdown parsed once, with its inline formulas lifted out (see [MathText.inlinePieces]). */
class ParsedMarkdown(val state: State, val maths: List<String>)

/** Placeholder code span for inline formula `i`; the annotator swaps it for the typeset formula. */
private const val MATH_MARK = '\u2063'
private fun mathMark(i: Int) = "`$MATH_MARK$i$MATH_MARK`"
private val mathMarkRe = Regex("^`$MATH_MARK(\\d+)$MATH_MARK`$")

/**
 * Parsed markdown by source text. mikepenz parses asynchronously per composition, so an item
 * scrolling back in would flash empty and change height; parsing once (prewarmed off the main
 * thread by the session screen) keeps scrolling smooth.
 */
object MarkdownCache {
    private val cache = android.util.LruCache<String, ParsedMarkdown>(256)

    fun parsed(text: String): ParsedMarkdown {
        cache.get(text)?.let { return it }
        val maths = ArrayList<String>()
        val source = MathText.inlinePieces(text).joinToString("") { p ->
            when (p) {
                is MathText.Piece.Text -> p.text
                is MathText.Piece.Math -> mathMark(maths.size).also { maths += p.tex }
            }
        }
        return ParsedMarkdown(parseMarkdown(source), maths).also { cache.put(text, it) }
    }

    /** Parse every settled markdown segment of an answer (call from a background dispatcher). */
    fun prewarm(answer: String) {
        if (answer.isBlank()) return
        for (s in RichText.segments(answer, false)) if (s is Segment.Markdown) parsed(s.text)
    }
}

@Composable
fun MarkdownText(text: String) {
    val c = Pi.c
    val t = Pi.t
    val parsed = remember(text) { MarkdownCache.parsed(text) }
    val density = LocalDensity.current
    val fontPx = with(density) { t.body.fontSize.toPx() }
    // Typeset inline formulas natively; ones AndroidMath cannot parse keep an inline-code look.
    val boxes = remember(parsed, fontPx) { parsed.maths.map { inlineMathBox(it, fontPx) } }
    val inline = boxes.mapIndexedNotNull { i, b ->
        b?.let {
            "m$i" to InlineTextContent(
                Placeholder(with(density) { it.widthPx.toSp() }, with(density) { it.heightPx.toSp() }, PlaceholderVerticalAlign.TextCenter),
            ) { _ -> InlineMath(it, c.fg) }
        }
    }.toMap()
    val codeStyle = SpanStyle(fontFamily = FontFamily.Monospace, background = c.surface)
    val annotator = remember(parsed, boxes, codeStyle) {
        markdownAnnotator { content, child ->
            if (child.type != MarkdownElementTypes.CODE_SPAN) return@markdownAnnotator false
            val i = mathMarkRe.find(child.getTextInNode(content).toString())?.groupValues?.get(1)?.toIntOrNull() ?: return@markdownAnnotator false
            val tex = parsed.maths.getOrNull(i) ?: return@markdownAnnotator false
            if (boxes.getOrNull(i) != null) appendInlineContent("m$i", tex) else withStyle(codeStyle) { append(tex) }
            true
        }
    }
    Markdown(
        state = parsed.state,
        colors = markdownColor(text = c.fg, codeBackground = c.surface, inlineCodeBackground = c.surface, dividerColor = c.line, tableBackground = c.bg),
        typography = markdownTypography(
            h1 = t.title.copy(color = c.fg, fontSize = t.title.fontSize * 1.12f),
            h2 = t.title.copy(color = c.fg, fontSize = t.title.fontSize * 1.05f),
            h3 = t.title.copy(color = c.fg),
            h4 = t.bodyMedium.copy(color = c.fg),
            h5 = t.bodyMedium.copy(color = c.fg),
            h6 = t.bodyMedium.copy(color = c.fg2),
            text = t.body.copy(color = c.fg),
            code = t.mono.copy(color = c.fg),
            inlineCode = t.mono.copy(color = c.fg),
            quote = t.body.copy(color = c.fg2),
            paragraph = t.body.copy(color = c.fg),
            ordered = t.body.copy(color = c.fg),
            bullet = t.body.copy(color = c.fg),
            list = t.body.copy(color = c.fg),
            table = t.secondary.copy(color = c.fg),
        ),
        dimens = markdownDimens(tableCellWidth = 104.dp, tableCellPadding = 8.dp, tableCornerSize = 12.dp),
        annotator = annotator,
        inlineContent = markdownInlineContent(inline),
    )
}

@Composable
fun CodeBlock(language: String, code: String) {
    val clipboard = LocalClipboardManager.current
    val tokens = Pi.c
    val highlighted = remember(code, language, tokens) { highlight(code, language, tokens) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Pi.c.code)) {
        Row(Modifier.fillMaxWidth().height(34.dp).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(language.ifEmpty { "text" }, style = Pi.t.meta.copy(color = Pi.c.fg3, fontFamily = FontFamily.Monospace), modifier = Modifier.weight(1f))
            IconAction(PiIcons.Copy, stringResource(R.string.copy), { clipboard.setText(AnnotatedString(code)) }, tint = Pi.c.fg3, size = 14.dp)
        }
        Box(Modifier.horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
            Text(highlighted, style = Pi.t.mono.copy(color = Pi.c.fg), softWrap = false)
        }
    }
}

private val keywords = setOf(
    "fun", "val", "var", "class", "object", "interface", "if", "else", "when", "for", "while", "return", "import", "package", "private", "public", "override",
    "const", "let", "function", "async", "await", "export", "default", "from", "type", "new", "true", "false", "null", "undefined", "def", "self", "None",
    "True", "False", "in", "is", "as", "try", "catch", "finally", "throw", "break", "continue", "static", "struct", "enum", "impl", "pub", "fn", "mut",
    "echo", "then", "fi", "do", "done", "case", "esac", "shl", "suspend", "data", "sealed",
)
private val tokenRe = Regex("""(//[^\n]*|#(?![{\w])[^\n]*|/\*[\s\S]*?\*/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|(\b[A-Za-z_]\w*\b)(\s*\()?""")

/** Tiny tokenizer: comments, strings, numbers, keywords, calls. Good enough for answers; cached per block. */
fun highlight(code: String, language: String, c: Tokens): AnnotatedString = buildAnnotatedString {
    if (code.length > 20_000) {
        append(code)
        return@buildAnnotatedString
    }
    val hashComments = language in setOf("bash", "sh", "shell", "zsh", "py", "python", "yaml", "yml", "toml", "rb", "ruby")
    var last = 0
    for (m in tokenRe.findAll(code)) {
        append(code.substring(last, m.range.first))
        val (comment, str, num, word, call) = m.destructured
        when {
            comment.isNotEmpty() && (comment.startsWith("#").not() || hashComments) -> withStyle(SpanStyle(color = c.com)) { append(comment) }
            comment.isNotEmpty() -> append(comment)
            str.isNotEmpty() -> withStyle(SpanStyle(color = c.str)) { append(str) }
            num.isNotEmpty() -> withStyle(SpanStyle(color = c.str)) { append(num) }
            word.isNotEmpty() && word in keywords -> {
                withStyle(SpanStyle(color = c.kw)) { append(word) }
                append(call)
            }
            word.isNotEmpty() && call.isNotEmpty() -> {
                withStyle(SpanStyle(color = c.fn)) { append(word) }
                append(call)
            }
            else -> append(m.value)
        }
        last = m.range.last + 1
    }
    append(code.substring(last))
}
