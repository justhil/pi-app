package dev.pi.remote.app.ui.piui

import android.icu.text.CompactDecimalFormat
import android.icu.text.NumberFormat
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.ui.BlockCard
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.text.ChartMath
import kotlinx.serialization.json.JsonObject
import java.util.Locale
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * pi-ui `chart`, ported from the desktop's ui-blocks/components/chart.tsx: same scales
 * (ChartMath = chart-math.ts), series typing, bar/line/area/scatter geometry, dual axis, stacking,
 * horizontal bars, pie/donut with a value legend, legend toggles and the 8-colour palette. Desktop
 * pixels are used as dp; hover becomes tap or horizontal drag.
 */

private val LIGHT = listOf(0xFF5B6FD8, 0xFF14A085, 0xFFEC8A3A, 0xFFD8547B, 0xFF8A6BD4, 0xFF2F9DD6, 0xFFB3981F, 0xFF6C7A90)
private val DARK = listOf(0xFF8B9CF4, 0xFF3CC9A7, 0xFFF3A35F, 0xFFEE7B9B, 0xFFAB93EE, 0xFF5CBCEC, 0xFFD6BD4F, 0xFF98A6BB)

/** Desktop `--uib-c1…8` (light / dark). */
@Composable
fun uibColor(i: Int): Color = Color((if (Pi.c.dark) DARK else LIGHT)[((i % 8) + 8) % 8])

private val compact: CompactDecimalFormat by lazy {
    CompactDecimalFormat.getInstance(Locale.getDefault(), CompactDecimalFormat.CompactStyle.SHORT).apply { maximumFractionDigits = 1 }
}
private val full: NumberFormat by lazy { NumberFormat.getInstance(Locale.getDefault()).apply { maximumFractionDigits = 2 } }

/** Desktop `formatCompact`: compact notation from 100k, otherwise grouped with ≤2 decimals. */
fun formatCompact(v: Double): String = if (abs(v) >= 100_000) compact.format(v) else full.format(v)

/** Desktop `formatFull`: `12.5 ms`, but `12.5%`. */
fun formatFull(v: Double, unit: String?): String {
    val t = full.format(v)
    return when {
        unit.isNullOrEmpty() -> t
        unit == "%" -> "$t%"
        else -> "$t $unit"
    }
}

private class ChartSeries(val name: String, val data: List<Double?>, val type: String?, val right: Boolean, val index: Int)

private fun seriesType(s: ChartSeries, chartType: String) = s.type ?: if (chartType == "bar" || chartType == "area") chartType else "line"

private const val CHAR_W = 6.4f

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChartBlock(props: JsonObject) {
    val type = props.str("type") ?: "bar"
    val x = props.strings("x").take(500)
    val series = remember(props) {
        props.objs("series").take(12).mapIndexed { i, s ->
            ChartSeries(s.str("name").orEmpty(), s.arr("data").take(500).map { it.asNumber() }, s.str("type")?.takeIf { it in setOf("line", "bar", "area") }, s.str("axis") == "right", i)
        }
    }
    if (series.isEmpty()) return
    var view by remember { mutableStateOf("chart") }
    var hidden by remember(props) { mutableStateOf(setOf<String>()) }
    val unit = props.str("unit")
    val rightUnit = props.str("rightUnit")
    val pie = type == "pie" || type == "donut"
    val visible = series.filter { it.name !in hidden }.ifEmpty { series }
    BlockCard {
        Column {
            BlockHeader(props.str("title")) {
                Segmented(listOf("chart" to stringResource(R.string.piui_chart), "data" to stringResource(R.string.piui_data)), view, { view = it })
            }
            if (view == "data") {
                ChartTable(x, series, unit)
                return@Column
            }
            if (!pie && series.size > 1) {
                FlowRow(Modifier.padding(start = 6.dp, end = 12.dp, top = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    series.forEach { s ->
                        val off = s.name in hidden
                        Row(
                            Modifier.heightIn(min = 30.dp).clip(RoundedCornerShape(6.dp)).clickable(role = Role.Checkbox) {
                                hidden = if (off) hidden - s.name else hidden + s.name
                            }.padding(horizontal = 7.dp).alpha(if (off) 0.45f else 1f),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(if (off) 6.dp else 8.dp).clip(RoundedCornerShape(2.5.dp)).background(uibColor(s.index)))
                            Spacer(Modifier.width(6.dp))
                            Text(s.name, style = Pi.t.meta.copy(color = Pi.c.fg))
                        }
                    }
                }
            }
            val desc = series.joinToString("; ") { s -> "${s.name}: " + s.data.mapIndexed { i, v -> "${x.getOrNull(i) ?: i + 1} ${v?.let { formatFull(it, if (s.right) rightUnit ?: unit else unit) } ?: "-"}" }.joinToString(", ") }
            Box(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 12.dp).semantics { contentDescription = desc }) {
                when {
                    pie -> PieChart(type == "donut", x, series, unit)
                    type == "horizontal-bar" -> HorizontalBarChart(x, visible, props.bool("stacked") == true, unit)
                    else -> CartesianChart(type, x, visible, props.bool("stacked") == true, unit, rightUnit, (props.num("height") ?: 220.0).roundToInt().coerceIn(160, 420))
                }
            }
        }
    }
}

@Composable
private fun ChartTable(x: List<String>, series: List<ChartSeries>, unit: String?) {
    val n = max(x.size, series.maxOf { it.data.size })
    Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(Modifier.padding(vertical = 6.dp)) {
            Text("", modifier = Modifier.width(72.dp))
            series.forEach { Text(it.name, style = Pi.t.meta.copy(color = Pi.c.fg3), textAlign = TextAlign.End, modifier = Modifier.width(96.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        Hairline()
        for (i in 0 until n) {
            Row(Modifier.padding(vertical = 7.dp)) {
                Text(x.getOrNull(i) ?: "${i + 1}", style = Pi.t.secondary.copy(color = Pi.c.fg), modifier = Modifier.width(72.dp), maxLines = 1)
                series.forEach { s -> Text(s.data.getOrNull(i)?.let { formatFull(it, unit) } ?: "–", style = Pi.t.secondary.copy(color = Pi.c.fg), textAlign = TextAlign.End, modifier = Modifier.width(96.dp)) }
            }
            Hairline()
        }
    }
}

private fun DrawScope.text(tm: TextMeasurer, s: String, x: Float, y: Float, style: TextStyle, align: TextAlign = TextAlign.Start) {
    val l = tm.measure(s, style)
    val dx = when (align) {
        TextAlign.Center -> -l.size.width / 2f
        TextAlign.End -> -l.size.width.toFloat()
        else -> 0f
    }
    drawText(l, topLeft = Offset(x + dx, y - l.size.height / 2f))
}

private val gridDash = PathEffect.dashPathEffect(floatArrayOf(2f * 2.6f, 3f * 2.6f))

/** Tooltip box: head line + one row per series (colour dot, name, value). */
private fun DrawScope.tooltip(tm: TextMeasurer, anchorX: Float, top: Float, maxX: Float, head: String, rows: List<Triple<Color, String, String>>, bg: Color, line: Color, fg: Color, fg2: Color) {
    val headL = tm.measure(head, TextStyle(fontSize = 11.sp, color = fg2))
    val rowLs = rows.map { (_, l, v) -> tm.measure(l, TextStyle(fontSize = 11.5.sp, color = fg2)) to tm.measure(v, TextStyle(fontSize = 11.5.sp, color = fg, fontWeight = FontWeight.Medium)) }
    val pad = 8.dp.toPx()
    val dot = 7.dp.toPx()
    val gap = 6.dp.toPx()
    val rowH = rowLs.maxOfOrNull { max(it.first.size.height, it.second.size.height) }?.toFloat() ?: 0f
    val w = max(headL.size.width.toFloat(), rowLs.maxOfOrNull { dot + gap + it.first.size.width + 14.dp.toPx() + it.second.size.width } ?: 0f) + pad * 2
    val h = headL.size.height + rowH * rowLs.size + pad * 2 + 2.dp.toPx()
    val flip = anchorX + 12.dp.toPx() + w > maxX
    val bx = if (flip) anchorX - 12.dp.toPx() - w else anchorX + 12.dp.toPx()
    drawRoundRect(bg, Offset(bx, top), Size(w, h), CornerRadius(8.dp.toPx()))
    drawRoundRect(line, Offset(bx, top), Size(w, h), CornerRadius(8.dp.toPx()), style = Stroke(1.dp.toPx()))
    drawText(headL, topLeft = Offset(bx + pad, top + pad))
    var y = top + pad + headL.size.height + 2.dp.toPx()
    rows.forEachIndexed { i, (c, _, _) ->
        val (l, v) = rowLs[i]
        drawCircle(c, dot / 2, Offset(bx + pad + dot / 2, y + rowH / 2))
        drawText(l, topLeft = Offset(bx + pad + dot + gap, y + (rowH - l.size.height) / 2))
        drawText(v, topLeft = Offset(bx + w - pad - v.size.width, y + (rowH - v.size.height) / 2))
        y += rowH
    }
}

// ── line / area / bar / scatter (+ mixed, stacked, dual axis) ──

@Composable
private fun CartesianChart(chartType: String, x: List<String>, visible: List<ChartSeries>, stacked: Boolean, unit: String?, rightUnit: String?, heightDp: Int) {
    val tm = rememberTextMeasurer()
    val c = Pi.c
    val axis = TextStyle(fontSize = 10.5.sp, color = c.fg2)
    val colors = (0 until 12).map { uibColor(it) }
    var hover by remember(visible, x) { mutableStateOf<Int?>(null) }
    val scatter = chartType == "scatter"
    val count = max(1, max(x.size, visible.maxOf { it.data.size }))
    val labels = List(count) { x.getOrNull(it) ?: "${it + 1}" }
    val typeOf = { s: ChartSeries -> seriesType(s, chartType) }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val widthDp = maxWidth.value
        val L = remember(visible, stacked, chartType, widthDp, heightDp, labels) {
            fun groupScale(group: List<ChartSeries>): ChartMath.NiceScale? {
                if (group.isEmpty()) return null
                val includeZero = group.any { typeOf(it) != "line" }
                val stackable = stacked && group.any { typeOf(it) != "line" }
                val st = group.filter { stackable && typeOf(it) != "line" }
                val loose = group.filter { it !in st }
                val (a0, a1) = if (st.isNotEmpty()) ChartMath.seriesExtent(st.map { it.data }, true, true) else Double.POSITIVE_INFINITY to Double.NEGATIVE_INFINITY
                val (b0, b1) = if (loose.isNotEmpty()) ChartMath.seriesExtent(loose.map { it.data }, false, includeZero) else Double.POSITIVE_INFINITY to Double.NEGATIVE_INFINITY
                return ChartMath.niceScale(min(a0, b0), max(a1, b1), max(3, (heightDp / 48.0).roundToInt()))
            }
            val leftScale = groupScale(visible.filter { !it.right }) ?: ChartMath.niceScale(0.0, 1.0)
            val rightScale = groupScale(visible.filter { it.right })
            fun tickW(t: List<Double>) = t.maxOf { formatCompact(it).length } * CHAR_W + 12
            val ml = max(30f, tickW(leftScale.ticks))
            val mr = rightScale?.let { max(30f, tickW(it.ticks)) } ?: 14f
            val plotW = max(40f, widthDp - ml - mr)
            object {
                val leftScale = leftScale
                val rightScale = rightScale
                val ml = ml
                val mr = mr
                val plotW = plotW
                val scatterX = if (scatter) labels.mapIndexed { i, l -> l.toDoubleOrNull() ?: i.toDouble() } else emptyList()
                val xs = if (scatter) ChartMath.niceScale(scatterX.min(), scatterX.max(), max(3, (plotW / 90).roundToInt())) else null
                val step = if (scatter) 1 else ChartMath.labelStep(labels, plotW.toDouble())
            }
        }
        val hasBars = visible.any { typeOf(it) == "bar" }
        Canvas(
            Modifier.fillMaxWidth().height(heightDp.dp)
                .pointerInput(L, hasBars, count) {
                    fun index(px: Float): Int {
                        val off = px / density - L.ml
                        val band = L.plotW / count
                        val i = if (hasBars || count == 1) (off / band).toInt() else ((off - 6) / max(1f, L.plotW - 12) * (count - 1)).roundToInt()
                        return i.coerceIn(0, count - 1)
                    }
                    detectTapGestures { p -> if (!scatter) hover = index(p.x).let { if (it == hover) null else it } }
                }
                .pointerInput(L, hasBars, count) {
                    detectHorizontalDragGestures(onDragEnd = {}) { change, _ ->
                        if (scatter) return@detectHorizontalDragGestures
                        val off = change.position.x / density - L.ml
                        val band = L.plotW / count
                        val i = if (hasBars || count == 1) (off / band).toInt() else ((off - 6) / max(1f, L.plotW - 12) * (count - 1)).roundToInt()
                        hover = i.coerceIn(0, count - 1)
                        change.consume()
                    }
                },
        ) {
            val u = density
            val top = 10f * u
            val plotH = size.height - (10f + 24f) * u
            val ml = L.ml * u
            val plotW = L.plotW * u
            val band = plotW / count
            val yLeft = ChartMath.linear(L.leftScale.min, L.leftScale.max, (top + plotH).toDouble(), top.toDouble())
            val yRight = L.rightScale?.let { ChartMath.linear(it.min, it.max, (top + plotH).toDouble(), top.toDouble()) } ?: yLeft
            val xOf: (Int) -> Float = when {
                scatter -> { i -> ChartMath.linear(L.xs!!.min, L.xs.max, ml.toDouble(), (ml + plotW).toDouble())(L.scatterX[i]).toFloat() }
                hasBars || count == 1 -> { i -> ml + band * (i + 0.5f) }
                else -> { i -> ml + 6 * u + (plotW - 12 * u) * i / (count - 1) }
            }
            val yFor = { s: ChartSeries -> if (s.right) yRight else yLeft }

            for (t in L.leftScale.ticks) {
                val y = yLeft(t).toFloat()
                drawLine(c.line.copy(alpha = 0.8f), Offset(ml, y), Offset(ml + plotW, y), 1f, pathEffect = gridDash)
                text(tm, formatCompact(t), ml - 6 * u, y, axis, TextAlign.End)
            }
            L.rightScale?.ticks?.forEach { t -> text(tm, formatCompact(t), ml + plotW + 6 * u, yRight(t).toFloat(), axis) }
            if (L.leftScale.min < 0 && L.leftScale.max > 0) {
                val zy = yLeft(0.0).toFloat()
                drawLine(c.fg2.copy(alpha = 0.4f), Offset(ml, zy), Offset(ml + plotW, zy), 1f)
            }
            if (scatter) {
                for (t in L.xs!!.ticks) text(tm, formatCompact(t), ChartMath.linear(L.xs.min, L.xs.max, ml.toDouble(), (ml + plotW).toDouble())(t).toFloat(), size.height - 10 * u, axis, TextAlign.Center)
            } else {
                for (i in 0 until count step L.step) text(tm, labels[i], xOf(i), size.height - 10 * u, axis, TextAlign.Center)
            }

            val bars = visible.filter { typeOf(it) == "bar" }
            val areas = visible.filter { typeOf(it) == "area" }
            val lines = visible.filter { typeOf(it) == "line" }
            val barStacks = if (stacked) ChartMath.stackSeries(bars.map { it.data }) else null
            val areaStacks = if (stacked) ChartMath.stackSeries(areas.map { it.data }) else null

            areas.forEachIndexed { si, s ->
                val y = yFor(s)
                val tops = ArrayList<Offset>()
                val bases = ArrayList<Offset>()
                s.data.forEachIndexed { i, v ->
                    if (v == null) return@forEachIndexed
                    val span = areaStacks?.getOrNull(si)?.getOrNull(i) ?: (0.0 to v)
                    tops += Offset(xOf(i), y(span.second).toFloat())
                    bases += Offset(xOf(i), y(span.first).toFloat())
                }
                if (tops.size < 2) return@forEachIndexed
                val fill = Path().apply {
                    moveTo(tops[0].x, tops[0].y)
                    tops.drop(1).forEach { lineTo(it.x, it.y) }
                    bases.asReversed().forEach { lineTo(it.x, it.y) }
                    close()
                }
                drawPath(fill, colors[s.index].copy(alpha = 0.14f))
                drawPath(Path().apply { moveTo(tops[0].x, tops[0].y); tops.drop(1).forEach { lineTo(it.x, it.y) } }, colors[s.index], style = Stroke(2 * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }

            val groupW = band * 0.72f
            val barW = if (stacked) min(groupW, 44 * u) else min(30 * u, groupW / max(1, bars.size))
            bars.forEachIndexed { si, s ->
                val y = yFor(s)
                s.data.forEachIndexed { i, v ->
                    if (v == null) return@forEachIndexed
                    val span = barStacks?.getOrNull(si)?.getOrNull(i) ?: (0.0 to v)
                    val y0 = y(span.first).toFloat()
                    val y1 = y(span.second).toFloat()
                    val bx = if (stacked) xOf(i) - barW / 2 else xOf(i) - barW * bars.size / 2 + si * barW
                    val dim = hover != null && hover != i
                    drawRoundRect(
                        colors[s.index].copy(alpha = if (dim) 0.42f else 1f),
                        Offset(bx + 0.5f * u, min(y0, y1)), Size(max(1f, barW - 1 * u), max(1f, abs(y1 - y0))),
                        CornerRadius(min(3 * u, barW / 4)),
                    )
                }
            }

            lines.forEach { s ->
                val y = yFor(s)
                val col = colors[s.index]
                if (scatter) {
                    s.data.forEachIndexed { i, v ->
                        if (v == null) return@forEachIndexed
                        val p = Offset(xOf(i), y(v).toFloat())
                        drawCircle(col.copy(alpha = 0.88f), 3.5f * u, p)
                        drawCircle(c.bg, 3.5f * u, p, style = Stroke(1 * u))
                    }
                    return@forEach
                }
                val path = Path()
                var open = false
                s.data.forEachIndexed { i, v ->
                    if (v == null) { open = false; return@forEachIndexed }
                    val px = xOf(i)
                    val py = y(v).toFloat()
                    if (open) path.lineTo(px, py) else path.moveTo(px, py)
                    open = true
                }
                drawPath(path, col, style = Stroke(2 * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
                if (count <= 24) s.data.forEachIndexed { i, v ->
                    if (v == null) return@forEachIndexed
                    val p = Offset(xOf(i), y(v).toFloat())
                    drawCircle(c.bg, 2.4f * u, p)
                    drawCircle(col, 2.4f * u, p, style = Stroke(1.5f * u))
                }
            }

            val h = hover
            if (h != null && !scatter) {
                val hx = xOf(h)
                drawLine(c.fg2.copy(alpha = 0.55f), Offset(hx, top), Offset(hx, top + plotH), 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3 * u, 3 * u)))
                (lines + areas).forEach { s ->
                    val v = s.data.getOrNull(h) ?: return@forEach
                    val stackTop = if (typeOf(s) == "area") areaStacks?.getOrNull(areas.indexOf(s))?.getOrNull(h)?.second else null
                    val p = Offset(hx, yFor(s)(stackTop ?: v).toFloat())
                    drawCircle(colors[s.index], 4 * u, p)
                    drawCircle(c.bg, 4 * u, p, style = Stroke(2 * u))
                }
                val rows = visible.mapNotNull { s -> s.data.getOrNull(h)?.let { Triple(colors[s.index], s.name, formatFull(it, if (s.right) rightUnit ?: unit else unit)) } }
                tooltip(tm, hx, top + 4 * u, size.width, labels[h], rows, c.bg, c.line, c.fg, c.fg2)
            }
        }
    }
}

// ── horizontal bars ──

@Composable
private fun HorizontalBarChart(x: List<String>, visible: List<ChartSeries>, stacked: Boolean, unit: String?) {
    val tm = rememberTextMeasurer()
    val c = Pi.c
    val axis = TextStyle(fontSize = 10.5.sp, color = c.fg2)
    val strong = TextStyle(fontSize = 11.5.sp, color = c.fg)
    val colors = (0 until 12).map { uibColor(it) }
    var hover by remember(visible, x) { mutableStateOf<Int?>(null) }
    val count = max(1, max(x.size, visible.maxOf { it.data.size }))
    val labels = List(count) { x.getOrNull(it) ?: "${it + 1}" }
    val rowH = if (visible.size > 1 && !stacked) max(26, visible.size * 10 + 10) else 26
    val labelW = (labels.maxOf { it.length } * CHAR_W + 14).coerceIn(56f, 170f)
    val mTop = 4
    val mBottom = 22
    val mRight = if (visible.size == 1) 52 else 16
    val heightDp = mTop + count * rowH + mBottom
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val widthDp = maxWidth.value
        val plotW = max(40f, widthDp - labelW - mRight)
        val stacks = if (stacked) ChartMath.stackSeries(visible.map { it.data }) else null
        val (e0, e1) = ChartMath.seriesExtent(visible.map { it.data }, stacked, true)
        val scale = ChartMath.niceScale(e0, e1, max(3, (plotW / 90).roundToInt()))
        val thickness = if (stacked) min(18, rowH - 8).toFloat() else min(16f, (rowH - 8f) / max(1, visible.size))
        val maxChars = ((labelW - 12) / CHAR_W).toInt()
        Canvas(
            Modifier.fillMaxWidth().height(heightDp.dp).pointerInput(count, rowH) {
                detectTapGestures { p ->
                    val row = ((p.y / density - mTop) / rowH).toInt().coerceIn(0, count - 1)
                    hover = if (hover == row) null else row
                }
            },
        ) {
            val u = density
            val ml = labelW * u
            val sx = ChartMath.linear(scale.min, scale.max, ml.toDouble(), (ml + plotW * u).toDouble())
            for (t in scale.ticks) {
                val tx = sx(t).toFloat()
                drawLine(c.line.copy(alpha = 0.8f), Offset(tx, mTop * u), Offset(tx, size.height - mBottom * u), 1f, pathEffect = gridDash)
                text(tm, formatCompact(t), tx, size.height - 10 * u, axis, TextAlign.Center)
            }
            labels.forEachIndexed { row, label ->
                val cy = (mTop + row * rowH + rowH / 2f) * u
                val dim = hover != null && hover != row
                val shown = if (label.length > maxChars) label.take(max(1, maxChars - 1)) + "…" else label
                text(tm, shown, ml - 8 * u, cy, strong.copy(color = if (dim) c.fg.copy(alpha = 0.42f) else c.fg), TextAlign.End)
                visible.forEachIndexed { si, s ->
                    val v = s.data.getOrNull(row) ?: return@forEachIndexed
                    val span = stacks?.getOrNull(si)?.getOrNull(row) ?: (0.0 to v)
                    val x0 = min(sx(span.first), sx(span.second)).toFloat()
                    val w = max(1f, abs(sx(span.second) - sx(span.first)).toFloat())
                    val t = thickness * u
                    val y = if (stacked) cy - t / 2 else cy - t * visible.size / 2 + si * t
                    drawRoundRect(colors[s.index].copy(alpha = if (dim) 0.42f else 1f), Offset(x0, y + 0.5f * u), Size(w, max(1f, t - 1 * u)), CornerRadius(min(3 * u, t / 4)))
                    if (visible.size == 1) text(tm, formatCompact(v), x0 + w + 6 * u, cy, axis)
                }
            }
            val h = hover
            if (h != null && visible.size > 1) {
                val rows = visible.mapNotNull { s -> s.data.getOrNull(h)?.let { Triple(colors[s.index], s.name, formatFull(it, unit)) } }
                tooltip(tm, ml - 4 * u, (mTop + h * rowH + rowH) * u, size.width, labels[h], rows, c.bg, c.line, c.fg, c.fg2)
            }
        }
    }
}

// ── pie / donut ──

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PieChart(donut: Boolean, x: List<String>, series: List<ChartSeries>, unit: String?) {
    val tm = rememberTextMeasurer()
    val c = Pi.c
    var hover by remember(series, x) { mutableStateOf<Int?>(null) }
    val perSeries = series.size > 1 && series.all { it.data.size <= 1 }
    val raw = if (perSeries) series.map { it.name to (it.data.firstOrNull() ?: 0.0) } else series[0].data.mapIndexed { i, v -> (x.getOrNull(i) ?: "${i + 1}") to (v ?: 0.0) }
    val slices = raw.mapIndexed { i, (l, v) -> Triple(l, v, uibColor(i)) }.filter { it.second > 0 }
    if (slices.isEmpty()) return
    val total = slices.sumOf { it.second }.takeIf { it > 0 } ?: 1.0
    val totalLabel = stringResource(R.string.piui_total)
    val bigStyle = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.fg)
    val axis = TextStyle(fontSize = 10.5.sp, color = c.fg2)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val sizeDp = (maxWidth.value * 0.42f).coerceIn(140f, 220f)
        val pie = @Composable {
            Canvas(
                Modifier.size(sizeDp.dp).pointerInput(slices) {
                    detectTapGestures { p ->
                        val cx = size.width / 2f
                        val cy = size.height / 2f
                        val r = hypot(p.x - cx, p.y - cy)
                        val outer = size.width / 2f - 6 * density
                        if (r > outer + 6 * density || (donut && r < outer * 0.62f)) { hover = null; return@detectTapGestures }
                        // 0 = 12 o'clock, clockwise, like the desktop's arcPath.
                        val ang = ((atan2((p.x - cx).toDouble(), -(p.y - cy).toDouble()) + 2 * PI) % (2 * PI))
                        var acc = 0.0
                        val hit = slices.indexOfFirst { acc += it.second / total * 2 * PI; ang <= acc }
                        hover = if (hit == hover) null else hit
                    }
                },
            ) {
                val u = density
                val outer = size.width / 2 - 6 * u
                val inner = if (donut) outer * 0.62f else 0f
                val ctr = Offset(size.width / 2, size.height / 2)
                var start = 0.0
                slices.forEachIndexed { i, (_, v, col) ->
                    val sweep = v / total * 2 * PI
                    val mid = start + sweep / 2
                    val shift = if (hover == i) Offset((sin(mid) * 5 * u).toFloat(), (-cos(mid) * 5 * u).toFloat()) else Offset.Zero
                    val dim = hover != null && hover != i
                    val startDeg = (start * 180 / PI).toFloat() - 90f
                    val sweepDeg = (sweep * 180 / PI).toFloat().coerceAtMost(359.99f)
                    val w = outer - inner
                    if (donut) {
                        drawArc(col.copy(alpha = if (dim) 0.42f else 1f), startDeg, sweepDeg, false, ctr + shift - Offset(outer - w / 2, outer - w / 2), Size((outer - w / 2) * 2, (outer - w / 2) * 2), style = Stroke(w))
                    } else {
                        drawArc(col.copy(alpha = if (dim) 0.42f else 1f), startDeg, sweepDeg, true, ctr + shift - Offset(outer, outer), Size(outer * 2, outer * 2))
                    }
                    // Slice separator in the surface colour (desktop: stroke 1.5).
                    rotate((start * 180 / PI).toFloat(), ctr) { drawLine(c.bg, ctr + Offset(0f, -inner), ctr + Offset(0f, -outer - 1), 1.5f * u) }
                    start += sweep
                }
                if (donut) {
                    val h = hover
                    text(tm, formatCompact(if (h != null) slices[h].second else total), ctr.x, ctr.y - 6 * u, bigStyle, TextAlign.Center)
                    text(tm, if (h != null) slices[h].first else totalLabel, ctr.x, ctr.y + 14 * u, axis, TextAlign.Center)
                }
            }
        }
        val legend = @Composable { mod: Modifier ->
            Column(mod, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                slices.forEachIndexed { i, (l, v, col) ->
                    val dim = hover != null && hover != i
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 28.dp).clip(RoundedCornerShape(6.dp)).clickable { hover = if (hover == i) null else i }.padding(horizontal = 6.dp).alpha(if (dim) 0.42f else 1f),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(col))
                        Spacer(Modifier.width(8.dp))
                        Text(l, style = Pi.t.meta.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        Text(formatFull(v, unit), style = Pi.t.meta.copy(color = Pi.c.fg))
                        Text("${"%.${if (v / total < 0.1) 1 else 0}f".format(v / total * 100)}%", style = Pi.t.meta.copy(color = Pi.c.fg3), textAlign = TextAlign.End, modifier = Modifier.width(44.dp))
                    }
                }
            }
        }
        // Desktop: pie and legend side by side, wrapping below when narrower than pie + 24 + 180.
        if (maxWidth.value >= sizeDp + 24 + 180) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                pie()
                Spacer(Modifier.width(24.dp))
                legend(Modifier.weight(1f))
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { pie() }
                legend(Modifier.fillMaxWidth())
            }
        }
    }
}
