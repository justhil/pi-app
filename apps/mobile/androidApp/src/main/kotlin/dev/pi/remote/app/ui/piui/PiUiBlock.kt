package dev.pi.remote.app.ui.piui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.BlockCard
import dev.pi.remote.app.ui.rich.Skeleton
import dev.pi.remote.text.RichText
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/** pi-ui fence → native component (the desktop's 8 components; see docs in src/main/capabilities/pi-ui.md). */
@Composable
fun PiUiBlock(raw: String, closed: Boolean) {
    when (val p = remember(raw, closed) { RichText.parsePiUi(raw, closed) }) {
        is RichText.PiUiParse.Incomplete -> Skeleton()
        is RichText.PiUiParse.Invalid -> Fallback(stringResource(R.string.piui_invalid), raw)
        is RichText.PiUiParse.Ok -> when (p.component) {
            "stat-grid" -> StatGrid(p.props)
            "chart" -> ChartBlock(p.props)
            "data-table" -> DataTable(p.props)
            "card-grid" -> CardGrid(p.props)
            "diff" -> DiffBlock(p.props)
            "decision-tree" -> DecisionTree(p.props)
            "quiz" -> Quiz(p.props)
            "gantt" -> Gantt(p.props)
            else -> Fallback(stringResource(R.string.piui_unsupported, p.component), raw)
        }
    }
}

@Composable
fun Fallback(label: String, source: String) {
    var open by remember { mutableStateOf(false) }
    BlockCard {
        Column {
            Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.Monitor, Pi.c.fg3, 14.dp)
                Spacer(Modifier.width(8.dp))
                Text(label, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
                Text(stringResource(R.string.piui_show_source), style = Pi.t.meta.copy(color = Pi.c.fg3))
            }
            if (open) {
                Box(Modifier.fillMaxWidth().background(Pi.c.code).horizontalScroll(rememberScrollState()).padding(12.dp)) {
                    Text(source, style = Pi.t.monoSmall.copy(color = Pi.c.fg2), softWrap = false)
                }
            }
        }
    }
}

/** Title row shared by blocks: "构建耗时（周）" + optional trailing control. */
@Composable
fun BlockHeader(title: String?, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).padding(start = 12.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(title.orEmpty(), style = Pi.t.secondary.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f))
        trailing()
    }
}

// ── JSON helpers ──

fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonObject.num(k: String): Double? = (this[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.booleanOrNull
fun JsonObject.arr(k: String): List<JsonElement> = (this[k] as? JsonArray).orEmpty()
fun JsonObject.objs(k: String): List<JsonObject> = arr(k).filterIsInstance<JsonObject>()
fun JsonObject.strings(k: String): List<String> = arr(k).mapNotNull { (it as? JsonPrimitive)?.content }

fun JsonElement?.display(): String = when (this) {
    null, is JsonNull -> ""
    is JsonPrimitive -> content
    else -> toString()
}

fun JsonElement?.asNumber(): Double? = (this as? JsonPrimitive)?.let { if (it.isString) it.content.toDoubleOrNull() else it.doubleOrNull }

/** 1284.0 → "1,284", 6.7 → "6.7". */
fun formatNumber(v: Double): String {
    if (v.isNaN()) return ""
    val abs = kotlin.math.abs(v)
    return if (v == kotlin.math.floor(v) && abs < 1e15) "%,d".format(v.toLong()) else if (abs >= 100) "%,.0f".format(v) else "%.${if (abs >= 10) 1 else 2}f".format(v).trimEnd('0').trimEnd('.')
}
