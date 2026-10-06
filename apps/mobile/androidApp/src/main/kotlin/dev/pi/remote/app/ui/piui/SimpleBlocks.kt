package dev.pi.remote.app.ui.piui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.ui.BlockCard
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.QuietButton
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// ── stat-grid ──

@Composable
fun StatGrid(props: JsonObject) {
    val items = props.objs("items").take(24)
    BlockCard {
        Column {
            props.str("title")?.let { BlockHeader(it) }
            items.chunked(2).forEachIndexed { row, pair ->
                if (row > 0) Hairline()
                Row(Modifier.height(IntrinsicSize.Min)) {
                    pair.forEachIndexed { i, item ->
                        if (i == 1) Box(Modifier.width(1.dp).fillMaxHeight().background(Pi.c.line))
                        StatCell(item, Modifier.weight(1f))
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun StatCell(item: JsonObject, modifier: Modifier) {
    val delta = item.str("delta")
    val trend = item.str("trend")
    val negative = delta?.trim()?.startsWith("-") == true || delta?.trim()?.startsWith("−") == true
    val color = when (trend) {
        "up" -> Pi.c.ok
        "down" -> Pi.c.bad
        "flat" -> Pi.c.fg3
        else -> if (delta == null) Pi.c.fg3 else if (negative) Pi.c.bad else Pi.c.ok
    }
    Column(modifier.padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(item.str("label").orEmpty(), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(item["value"].display(), style = Pi.t.title.copy(color = Pi.c.fg, fontSize = Pi.t.title.fontSize * 1.25f))
            item.str("unit")?.let { Text(" $it", style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(bottom = 3.dp)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            delta?.let { Text("${if (negative) "↓" else "↑"} ${it.trimStart('+', '-', '−')}", style = Pi.t.meta.copy(color = color), modifier = Modifier.weight(1f)) } ?: Spacer(Modifier.weight(1f))
            val history = item.arr("history").mapNotNull { it.asNumber() }
            if (history.size >= 2) Sparkline(history, color, Modifier.size(width = 56.dp, height = 16.dp))
        }
        item.str("note")?.let { Text(it, style = Pi.t.small.copy(color = Pi.c.fg3)) }
    }
}

@Composable
fun Sparkline(values: List<Double>, color: Color, modifier: Modifier) {
    Canvas(modifier) {
        val min = values.min()
        val span = (values.max() - min).takeIf { it > 0 } ?: 1.0
        val path = Path()
        values.forEachIndexed { i, v ->
            val x = i * size.width / (values.size - 1)
            val y = size.height - ((v - min) / span * (size.height - 2) + 1).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color, style = Stroke(width = 1.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

// ── card-grid ──

@Composable
fun CardGrid(props: JsonObject) {
    val items = props.objs("items").take(60)
    val tags = items.mapNotNull { it.str("tag") }.distinct()
    var tag by remember { mutableStateOf<String?>(null) }
    val uri = LocalUriHandler.current
    BlockCard {
        Column {
            props.str("title")?.let { BlockHeader(it) }
            if (tags.size >= 2) {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    (listOf<String?>(null) + tags).forEach { t ->
                        Text(t ?: stringResource(R.string.inbox_all), style = Pi.t.meta.copy(color = if (tag == t) Pi.c.fg else Pi.c.fg3), modifier = Modifier.clickable(role = Role.Tab) { tag = t }.padding(vertical = 4.dp))
                    }
                }
            }
            items.filter { tag == null || it.str("tag") == tag }.forEachIndexed { i, it ->
                if (i > 0 || tags.size >= 2) Hairline()
                val url = it.str("url")?.takeIf { u -> u.startsWith("https://") || u.startsWith("http://") }
                Column(
                    Modifier.fillMaxWidth().then(if (url != null) Modifier.clickable(role = Role.Button) { uri.openUri(url) } else Modifier).padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(it.str("title").orEmpty(), style = Pi.t.body.copy(color = Pi.c.fg))
                    it.str("summary")?.let { s -> Text(s, style = Pi.t.secondary.copy(color = Pi.c.fg2), maxLines = 3, overflow = TextOverflow.Ellipsis) }
                    val meta = listOfNotNull(it.str("tag"), it.str("source") ?: url?.substringAfter("://")?.substringBefore('/')).joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = Pi.t.meta.copy(color = Pi.c.fg3))
                }
            }
        }
    }
}

// ── diff ──

private sealed interface DiffLine {
    data class Same(val text: String) : DiffLine
    data class Add(val text: String) : DiffLine
    data class Del(val text: String) : DiffLine
    data class Fold(val count: Int) : DiffLine
}

/** Line LCS diff with long unchanged runs folded (keeps 2 lines of context around changes). */
private fun lineDiff(before: String, after: String): List<DiffLine> {
    val a = before.split('\n')
    val b = after.split('\n')
    if (a.size * b.size > 400_000) return a.map { DiffLine.Del(it) } + b.map { DiffLine.Add(it) }
    val lcs = Array(a.size + 1) { IntArray(b.size + 1) }
    for (i in a.indices.reversed()) for (j in b.indices.reversed()) lcs[i][j] = if (a[i] == b[j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
    val raw = ArrayList<DiffLine>()
    var i = 0
    var j = 0
    while (i < a.size && j < b.size) {
        when {
            a[i] == b[j] -> { raw += DiffLine.Same(a[i]); i++; j++ }
            lcs[i + 1][j] >= lcs[i][j + 1] -> { raw += DiffLine.Del(a[i]); i++ }
            else -> { raw += DiffLine.Add(b[j]); j++ }
        }
    }
    while (i < a.size) raw += DiffLine.Del(a[i++])
    while (j < b.size) raw += DiffLine.Add(b[j++])
    val out = ArrayList<DiffLine>()
    var k = 0
    while (k < raw.size) {
        if (raw[k] !is DiffLine.Same) { out += raw[k++]; continue }
        var end = k
        while (end < raw.size && raw[end] is DiffLine.Same) end++
        val run = end - k
        if (run > 6) {
            val head = if (k == 0) 0 else 2
            val tail = if (end == raw.size) 0 else 2
            out += raw.subList(k, k + head)
            out += DiffLine.Fold(run - head - tail)
            out += raw.subList(end - tail, end)
        } else out += raw.subList(k, end)
        k = end
    }
    return out
}

@Composable
fun DiffBlock(props: JsonObject) {
    val lines = remember(props) { lineDiff(props.str("before").orEmpty(), props.str("after").orEmpty()) }
    BlockCard {
        Column {
            BlockHeader(props.str("title") ?: listOfNotNull(props.str("beforeLabel"), props.str("afterLabel")).joinToString(" → ").ifEmpty { null })
            Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
                for (l in lines) {
                    when (l) {
                        is DiffLine.Same -> DiffRow(" ", l.text, Color.Transparent, Pi.c.fg)
                        is DiffLine.Add -> DiffRow("+", l.text, Pi.c.addBg, Pi.c.fg)
                        is DiffLine.Del -> DiffRow("−", l.text, Pi.c.delBg, Pi.c.fg)
                        is DiffLine.Fold -> DiffRow("", "⋯ ${l.count}", Pi.c.surface, Pi.c.fg3)
                    }
                }
            }
        }
    }
}

@Composable
fun DiffRow(sign: String, text: String, bg: Color, fg: Color, number: String = "") {
    Row(Modifier.background(bg).padding(end = 16.dp)) {
        if (number.isNotEmpty() || sign.isNotEmpty()) {
            Text(number, style = Pi.t.monoSmall.copy(color = Pi.c.fg3, fontSize = Pi.t.small.fontSize), modifier = Modifier.width(34.dp).padding(end = 6.dp), maxLines = 1)
        }
        Text(sign, style = Pi.t.monoSmall.copy(color = Pi.c.fg3), modifier = Modifier.width(14.dp))
        Text(text, style = Pi.t.monoSmall.copy(color = fg), softWrap = false, maxLines = 1)
    }
}

// ── decision-tree ──

@Composable
fun DecisionTree(props: JsonObject) {
    val nodes = remember(props) { props.objs("nodes").take(200).associateBy { it.str("id").orEmpty() } }
    val start = props.str("start")?.takeIf { it in nodes } ?: props.objs("nodes").firstOrNull()?.str("id").orEmpty()
    val path = remember(props) { mutableStateListOf(start) }
    val node = nodes[path.last()] ?: return Fallback(stringResource(R.string.piui_invalid), props.toString())
    val options = node.objs("options")
    BlockCard {
        Column(Modifier.padding(bottom = 10.dp)) {
            BlockHeader(props.str("title"))
            Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(node.str("text").orEmpty(), style = Pi.t.body.copy(color = Pi.c.fg))
                node.str("detail")?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.fg2)) }
            }
            for (o in options) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp).clip(RoundedCornerShape(10.dp)).clickable(role = Role.Button) {
                        o.str("next")?.takeIf { it in nodes }?.let { path.add(it) }
                    }.padding(horizontal = 8.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(o.str("label").orEmpty(), style = Pi.t.body.copy(color = Pi.c.fg), modifier = Modifier.weight(1f))
                    Text("›", style = Pi.t.body.copy(color = Pi.c.fg3))
                }
            }
            if (path.size > 1) {
                Row(Modifier.padding(horizontal = 4.dp)) {
                    QuietButton(stringResource(R.string.piui_back), { path.removeAt(path.lastIndex) })
                    QuietButton(stringResource(R.string.piui_restart), { path.clear(); path.add(start) })
                }
            }
        }
    }
}

// ── quiz ──

@Composable
fun Quiz(props: JsonObject) {
    val questions = props.objs("questions").take(50)
    val step = (props.str("mode") ?: if (questions.size <= 3) "list" else "step") == "step"
    var index by remember(props) { mutableStateOf(0) }
    val picks = remember(props) { mutableStateMapOf<Int, Set<Int>>() }
    val checked = remember(props) { mutableStateMapOf<Int, Boolean>() }
    BlockCard {
        Column(Modifier.padding(bottom = 8.dp)) {
            BlockHeader(props.str("title"), trailing = { if (step) Text("${index + 1} / ${questions.size}", style = Pi.t.meta.copy(color = Pi.c.fg3)) })
            val shown = if (step) listOfNotNull(questions.getOrNull(index)?.let { index to it }) else questions.withIndex().map { it.index to it.value }
            for ((qi, q) in shown) QuizQuestion(q, picks[qi].orEmpty(), checked[qi] == true, { picks[qi] = it }, { checked[qi] = true })
            if (step && questions.size > 1) {
                Row(Modifier.padding(horizontal = 4.dp)) {
                    if (index > 0) QuietButton(stringResource(R.string.detail_prev), { index-- })
                    Spacer(Modifier.weight(1f))
                    if (index < questions.lastIndex) QuietButton(stringResource(R.string.detail_next), { index++ }, color = Pi.c.fg)
                }
            }
        }
    }
}

private fun answerIndexes(q: JsonObject, options: List<String>): Set<Int>? {
    val a = q["answer"] ?: return null
    fun one(e: kotlinx.serialization.json.JsonElement): Int? {
        val p = e as? JsonPrimitive ?: return null
        return if (p.isString) options.indexOf(p.content).takeIf { it >= 0 } else p.content.toDoubleOrNull()?.toInt()
    }
    return if (a is JsonArray) a.mapNotNull(::one).toSet() else one(a)?.let { setOf(it) }
}

@Composable
private fun QuizQuestion(q: JsonObject, picked: Set<Int>, checked: Boolean, onPick: (Set<Int>) -> Unit, onCheck: () -> Unit) {
    val options = q.strings("options").take(10)
    val answer = answerIndexes(q, options)
    val multi = (answer?.size ?: 0) > 1
    Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(q.str("question").orEmpty(), style = Pi.t.body.copy(color = Pi.c.fg))
        options.forEachIndexed { i, o ->
            val on = i in picked
            val tone = when {
                !checked || answer == null -> if (on) Pi.c.surface else Color.Transparent
                i in answer -> Pi.c.addBg
                on -> Pi.c.delBg
                else -> Color.Transparent
            }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(tone).border(1.dp, if (on) Pi.c.fg3 else Pi.c.line, RoundedCornerShape(10.dp))
                    .clickable(enabled = !checked, role = if (multi) Role.Checkbox else Role.RadioButton) { onPick(if (multi) (if (on) picked - i else picked + i) else setOf(i)) }
                    .heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${'A' + i}.", style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.width(22.dp))
                Text(o, style = Pi.t.body.copy(color = Pi.c.fg))
            }
        }
        if (answer != null) {
            if (!checked) {
                Row {
                    Spacer(Modifier.weight(1f))
                    QuietButton(stringResource(R.string.piui_check), onCheck, enabled = picked.isNotEmpty(), color = Pi.c.fg)
                }
            } else {
                val right = picked == answer
                Text(stringResource(if (right) R.string.piui_correct else R.string.piui_wrong), style = Pi.t.secondary.copy(color = if (right) Pi.c.ok else Pi.c.bad))
                q.str("explanation")?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.fg2)) }
            }
        }
    }
}

/** Desktop pi-ui palette (`--uib-c1…8`), shared by every block. */
@Composable
fun seriesColor(i: Int): Color = uibColor(i)

internal fun Offset.dist(o: Offset) = kotlin.math.hypot((x - o.x).toDouble(), (y - o.y).toDouble())
