package dev.pi.remote.text

import dev.pi.remote.protocol.RemoteJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * Answer text → render segments. Ports the desktop's `splitStreamingMarkdown`
 * (src/renderer/src/features/timeline/markdown-stream-split.ts) and the pi-ui envelope rules
 * (src/renderer/src/features/ui-blocks/envelope.ts). Rich fences (pi-ui / html / mermaid / math)
 * render only once closed; while streaming they show a skeleton.
 */

sealed interface Segment {
    /** Stable within one text: index-based, so Compose keeps state across appends. */
    val key: String

    data class Markdown(override val key: String, val text: String) : Segment
    data class Code(override val key: String, val language: String, val code: String, val closed: Boolean) : Segment
    data class PiUi(override val key: String, val raw: String, val closed: Boolean) : Segment
    data class Html(override val key: String, val code: String, val closed: Boolean) : Segment
    data class Mermaid(override val key: String, val code: String, val closed: Boolean) : Segment
    data class Math(override val key: String, val tex: String, val closed: Boolean) : Segment
    /** Streaming tail after the last safe boundary: plain text, no markdown reflow. */
    data class Tail(override val key: String, val text: String) : Segment
}

object RichText {
    private val fenceOpen = Regex("^(\\s{0,3})(`{3,}|~{3,})\\s*([^`\\s]*)[^`]*$")

    /** Split into markdown and fenced blocks. `streaming` turns the unsafe end into a [Segment.Tail]. */
    fun segments(text: String, streaming: Boolean): List<Segment> {
        val out = ArrayList<Segment>()
        // Same delimiters as the desktop: \[…\] / one-line $$…$$ become $$ blocks first.
        val lines = MathText.convertDelimiters(text).split('\n')
        val md = StringBuilder()
        var i = 0
        fun flushMd() {
            if (md.isNotBlank()) out += Segment.Markdown("md${out.size}", md.toString().trimEnd('\n'))
            md.clear()
        }
        while (i < lines.size) {
            val line = lines[i]
            val open = fenceOpen.matchEntire(line)
            val mathOpen = line.trim() == "$$"
            if (open == null && !mathOpen) {
                md.append(line).append('\n')
                i++
                continue
            }
            flushMd()
            val fence = open?.groupValues?.get(2)
            val lang = open?.groupValues?.get(3)?.lowercase().orEmpty()
            val body = StringBuilder()
            var closed = false
            i++
            while (i < lines.size) {
                val l = lines[i]
                val isClose = if (fence != null) l.trim().startsWith(fence) && l.trim().trimStart(fence[0]).isBlank() else l.trim() == "$$"
                if (isClose) {
                    closed = true
                    i++
                    break
                }
                body.append(l).append('\n')
                i++
            }
            val code = body.toString().trimEnd('\n')
            val key = "b${out.size}"
            out += when {
                mathOpen -> Segment.Math(key, code, closed)
                lang == "pi-ui" -> Segment.PiUi(key, code, closed)
                lang == "html" -> Segment.Html(key, code, closed)
                lang == "mermaid" -> Segment.Mermaid(key, code, closed)
                lang == "math" || lang == "latex" || lang == "tex" -> Segment.Math(key, code, closed)
                else -> Segment.Code(key, lang, code, closed)
            }
        }
        if (md.isNotEmpty()) {
            val rest = md.toString().trimEnd('\n')
            if (streaming) {
                val (committed, tail) = splitStreamingMarkdown(rest)
                if (committed.isNotBlank()) out += Segment.Markdown("md${out.size}", committed.trimEnd('\n'))
                if (tail.isNotEmpty()) out += Segment.Tail("tail", tail)
            } else if (rest.isNotBlank()) {
                out += Segment.Markdown("md${out.size}", rest)
            }
        }
        return out
    }

    /** Desktop `splitStreamingMarkdown`: stable prefix up to a safe boundary + live plain tail. */
    fun splitStreamingMarkdown(text: String): Pair<String, String> {
        if (text.isEmpty()) return "" to ""
        val cut = findCut(text)
        return if (cut > 0) text.substring(0, cut) to text.substring(cut) else "" to text
    }

    private fun findCut(text: String): Int {
        val minTail = 28
        val para = text.lastIndexOf("\n\n")
        if (para >= 0 && text.length - (para + 2) >= minTail) return para + 2
        val line = text.lastIndexOf('\n')
        if (line >= 0 && text.length - (line + 1) >= minTail * 2) return line + 1
        var lastSentEnd = -1
        Regex("[.!?。！？…][\"')\\]]*\\s+").findAll(text).forEach { lastSentEnd = it.range.last + 1 }
        if (lastSentEnd > 0 && text.length - lastSentEnd >= minTail && lastSentEnd >= minOf(80, (text.length * 0.2).toInt())) return lastSentEnd
        return 0
    }

    // ── pi-ui envelope ──

    sealed interface PiUiParse {
        data object Incomplete : PiUiParse
        data class Invalid(val message: String) : PiUiParse
        data class Ok(val component: String, val id: String, val props: JsonObject) : PiUiParse
    }

    private fun bracketsBalanced(text: String): Boolean {
        var depth = 0
        var inString = false
        var escape = false
        for (c in text) {
            if (inString) {
                if (escape) escape = false else if (c == '\\') escape = true else if (c == '"') inString = false
                continue
            }
            when (c) {
                '"' -> inString = true
                '{', '[' -> depth++
                '}', ']' -> depth--
            }
        }
        return depth == 0 && !inString
    }

    /** Trailing commas and // or /* */ comments: the slips models make most often. */
    private fun repair(text: String): String =
        text.replace(Regex("(?m)^\\s*//.*$"), "").replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex(",\\s*([}\\]])"), "$1")

    fun parsePiUi(raw: String, closed: Boolean): PiUiParse {
        val text = raw.trim()
        if (text.isEmpty() || (!closed && !bracketsBalanced(text))) return PiUiParse.Incomplete
        val json = runCatching { RemoteJson.parseToJsonElement(text) }.recoverCatching { RemoteJson.parseToJsonElement(repair(text)) }.getOrNull()
            ?: return if (!closed) PiUiParse.Incomplete else PiUiParse.Invalid("invalid JSON")
        val obj = json as? JsonObject ?: return PiUiParse.Invalid("expected a JSON object")
        val component = (obj["component"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim().orEmpty()
        if (component.isEmpty()) return PiUiParse.Invalid("missing \"component\"")
        val props = obj["props"] as? JsonObject ?: return PiUiParse.Invalid("\"props\" must be an object")
        val idPrim = obj["id"] as? JsonPrimitive
        val id = idPrim?.content?.trim()?.takeIf { it.isNotEmpty() } ?: idPrim?.intOrNull?.toString() ?: component
        return PiUiParse.Ok(component, id, props)
    }
}
