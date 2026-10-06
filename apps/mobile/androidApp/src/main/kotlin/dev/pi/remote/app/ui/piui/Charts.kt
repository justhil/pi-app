package dev.pi.remote.app.ui.piui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.BlockCard
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.Segmented
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// ── data-table ──

private data class Col(val key: String, val label: String, val numeric: Boolean)

@Composable
fun DataTable(props: JsonObject) {
    val rows = remember(props) { props.objs("rows").take(2000) }
    val cols = remember(props) {
        val declared = props.objs("columns").map { c -> Col(c.str("key").orEmpty(), c.str("label") ?: c.str("key").orEmpty(), c.str("type") == "number") }
        declared.ifEmpty { rows.firstOrNull()?.keys?.map { k -> Col(k, k, rows.firstOrNull()?.get(k).asNumber() != null && rows.first()[k].let { it is kotlinx.serialization.json.JsonPrimitive && !it.isString }) }.orEmpty() }
    }
    val pageSize = (props.num("pageSize") ?: 10.0).toInt().coerceIn(5, 100)
    var sortKey by remember { mutableStateOf<String?>(null) }
    var desc by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }
    var searching by remember { mutableStateOf(false) }
    var page by remember { mutableStateOf(0) }
    val filtered = remember(rows, query) { if (query.isBlank()) rows else rows.filter { r -> r.values.any { it.display().contains(query, ignoreCase = true) } } }
    val sorted = remember(filtered, sortKey, desc) {
        val k = sortKey ?: return@remember filtered
        filtered.sortedWith { a, b ->
            val va = a[k].asNumber()
            val vb = b[k].asNumber()
            val c = if (va != null && vb != null) va.compareTo(vb) else a[k].display().compareTo(b[k].display())
            if (desc) -c else c
        }
    }
    val pages = max(1, (sorted.size + pageSize - 1) / pageSize)
    val current = sorted.drop(page.coerceAtMost(pages - 1) * pageSize).take(pageSize)
    BlockCard {
        Column {
            BlockHeader(props.str("title")) { IconAction(PiIcons.Search, stringResource(R.string.piui_search), { searching = !searching }, tint = Pi.c.fg3, size = 15.dp) }
            if (searching) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp)) {
                    if (query.isEmpty()) Text(stringResource(R.string.piui_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    BasicTextField(query, { query = it; page = 0 }, textStyle = Pi.t.secondary.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            }
            Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                Row(Modifier.heightIn(min = 34.dp), verticalAlignment = Alignment.CenterVertically) {
                    cols.forEach { c ->
                        val on = sortKey == c.key
                        Text(
                            c.label + if (on) (if (desc) " ↓" else " ↑") else "",
                            style = Pi.t.meta.copy(color = if (on) Pi.c.fg else Pi.c.fg3),
                            textAlign = if (c.numeric) TextAlign.End else TextAlign.Start,
                            modifier = Modifier.width(if (c.numeric) 92.dp else 132.dp).padding(end = 12.dp).clickable(role = Role.Button) {
                                if (on) desc = !desc else { sortKey = c.key; desc = true }
                            },
                            maxLines = 1,
                        )
                    }
                }
                Hairline()
                current.forEach { r ->
                    Row(Modifier.heightIn(min = 38.dp), verticalAlignment = Alignment.CenterVertically) {
                        cols.forEach { c ->
                            val v: JsonElement? = r[c.key]
                            val text = if (c.numeric) v.asNumber()?.let(::formatNumber) ?: v.display() else v.display()
                            Text(text, style = Pi.t.secondary.copy(color = Pi.c.fg), textAlign = if (c.numeric) TextAlign.End else TextAlign.Start, modifier = Modifier.width(if (c.numeric) 92.dp else 132.dp).padding(end = 12.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Hairline()
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.piui_rows, sorted.size, page.coerceAtMost(pages - 1) + 1, pages), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
                IconAction(PiIcons.ChevronLeft, stringResource(R.string.detail_prev), { page = max(0, page - 1) }, tint = Pi.c.fg3, size = 14.dp, enabled = page > 0)
                IconAction(PiIcons.ChevronRight, stringResource(R.string.detail_next), { page = min(pages - 1, page + 1) }, tint = Pi.c.fg3, size = 14.dp, enabled = page < pages - 1)
            }
        }
    }
}
