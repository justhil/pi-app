package dev.pi.remote.app.ui.session

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.QuietSwitch
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.app.ui.piui.DiffRow
import dev.pi.remote.app.ui.piui.display
import dev.pi.remote.app.ui.verbFor
import dev.pi.remote.protocol.CapabilityRow
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.ToolStep
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/** Unified diff → numbered rows; hunk headers reset the counters. */
private data class DLine(val sign: Char, val text: String, val number: String)

private fun parseUnified(diff: String): List<DLine> {
    var oldN = 0
    var newN = 0
    val out = ArrayList<DLine>()
    for (l in diff.split('\n')) {
        if (l.startsWith("+++") || l.startsWith("---")) continue
        val hunk = Regex("^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)").find(l)
        when {
            hunk != null -> {
                oldN = hunk.groupValues[1].toInt()
                newN = hunk.groupValues[2].toInt()
                out += DLine('@', l, "")
            }
            l.startsWith("+") -> out += DLine('+', l.drop(1), (newN++).toString())
            l.startsWith("-") -> out += DLine('-', l.drop(1), "").also { oldN++ }
            else -> {
                out += DLine(' ', l.removePrefix(" "), newN.toString())
                oldN++
                newN++
            }
        }
    }
    return out
}

@Composable
fun StepDetailSheet(steps: List<ToolStep>, start: Int, loadDetail: suspend (ToolStep) -> String?, onDismiss: () -> Unit) {
    var index by remember { mutableStateOf(start.coerceIn(0, (steps.size - 1).coerceAtLeast(0))) }
    val step = steps.getOrNull(index) ?: return onDismiss()
    var full by remember(step.id) { mutableStateOf<String?>(null) }
    LaunchedEffect(step.id) { if (step.node.detail == true) full = loadDetail(step) }
    val clipboard = LocalClipboardManager.current
    val maxH = (LocalConfiguration.current.screenHeightDp * 0.82f).dp
    PiSheet(onDismiss) {
        Column(Modifier.heightIn(max = maxH)) {
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(categoryIcon(step.category), Pi.c.fg3, 16.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(step.node.title, style = Pi.t.mono.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val add = (step.node.fields["add"] as? JsonPrimitive)?.intOrNull
                    val del = (step.node.fields["del"] as? JsonPrimitive)?.intOrNull
                    val meta = listOfNotNull(if (step.category == "other") step.toolName else verbFor(step.category), add?.let { "+$it" }, del?.let { "−$it" }, if (step.status == "error") stringResource(R.string.step_failed) else null).joinToString(" · ")
                    Text(meta, style = Pi.t.meta.copy(color = if (step.status == "error") Pi.c.bad else Pi.c.fg3))
                }
                IconAction(PiIcons.Copy, stringResource(R.string.copy), { clipboard.setText(AnnotatedString(full ?: step.node.preview ?: step.node.title)) })
            }
            Hairline()
            Box(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
                    val body = full ?: step.node.preview.orEmpty()
                    when (step.node.template) {
                        "edit" -> parseUnified(body).forEach { l ->
                            when (l.sign) {
                                '@' -> DiffRow("", l.text, Pi.c.surface, Pi.c.fg3)
                                '+' -> DiffRow("+", l.text, Pi.c.addBg, Pi.c.fg, l.number)
                                '-' -> DiffRow("−", l.text, Pi.c.delBg, Pi.c.fg, l.number)
                                else -> DiffRow("", l.text, Color.Transparent, Pi.c.fg, l.number)
                            }
                        }
                        "bash", "read", "write", "search" -> {
                            if (step.node.template == "bash") Text("$ ${step.node.fields["command"].display()}", style = Pi.t.monoSmall.copy(color = Pi.c.fg2), softWrap = false, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                            Text(body, style = Pi.t.monoSmall.copy(color = Pi.c.fg), softWrap = false, modifier = Modifier.padding(horizontal = 16.dp))
                        }
                        else -> {
                            for ((k, v) in step.node.fields) {
                                Row(Modifier.padding(horizontal = 16.dp, vertical = 3.dp)) {
                                    Text(k, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.width(96.dp))
                                    Text(v.display(), style = Pi.t.monoSmall.copy(color = Pi.c.fg), softWrap = false)
                                }
                            }
                            if (body.isNotEmpty()) Text(body, style = Pi.t.monoSmall.copy(color = Pi.c.fg), softWrap = false, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                        }
                    }
                }
            }
            Hairline()
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                QuietButton(stringResource(R.string.detail_prev), { index-- }, icon = PiIcons.ChevronLeft, enabled = index > 0)
                Spacer(Modifier.weight(1f))
                Text("${index + 1} / ${steps.size}", style = Pi.t.meta.copy(color = Pi.c.fg3))
                Spacer(Modifier.weight(1f))
                QuietButton(stringResource(R.string.detail_next), { index++ }, enabled = index < steps.lastIndex)
            }
        }
    }
}

@Composable
fun ToolsSheet(caps: List<CapabilityRow>, cacheMode: String?, canWrite: Boolean, onCapability: (String, Boolean) -> Unit, onCache: (String) -> Unit, onDismiss: () -> Unit) {
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 18.dp)) {
            Text(stringResource(R.string.tools), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            Text(stringResource(R.string.tools_session), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 6.dp))
            caps.firstOrNull { it.id == "pi-ui" }?.let { c ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
                    PiIcon(PiIcons.Sparkles, Pi.c.fg3, 18.dp, Modifier.padding(top = 1.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(stringResource(R.string.tool_piui), style = Pi.t.body.copy(color = Pi.c.fg))
                        Text(stringResource(R.string.tool_piui_desc), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                        Text(stringResource(R.string.tool_tokens, "%.1fk".format(c.promptTokens / 1000.0)), style = Pi.t.meta.copy(color = Pi.c.fg3))
                    }
                    Spacer(Modifier.width(10.dp))
                    QuietSwitch(c.enabled, { onCapability(c.id, it) }, stringResource(R.string.tool_piui), enabled = canWrite && c.available)
                }
            }
            Hairline(Modifier.padding(horizontal = 20.dp))
            Text(stringResource(R.string.tools_global), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 6.dp))
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
                PiIcon(PiIcons.Flame, Pi.c.fg3, 18.dp, Modifier.padding(top = 1.dp))
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(stringResource(R.string.cache), style = Pi.t.body.copy(color = Pi.c.fg))
                    Text(stringResource(R.string.cache_desc), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                }
            }
            val mode = cacheMode ?: "streaming"
            Column(Modifier.padding(start = 50.dp, end = 20.dp)) {
                Segmented(
                    listOf("off" to stringResource(R.string.cache_off), "streaming" to stringResource(R.string.cache_streaming), "idle" to stringResource(R.string.cache_idle)),
                    mode,
                    { if (canWrite) onCache(it) },
                    fill = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    stringResource(when (mode) { "off" -> R.string.cache_off_hint; "idle" -> R.string.cache_idle_hint; else -> R.string.cache_streaming_hint }),
                    style = Pi.t.meta.copy(color = Pi.c.fg3),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

/**
 * Model list grouped like the desktop picker sorts it: custom (models.json) first, then API-key
 * providers, then models from an OAuth sign-in. Thinking has its own sheet ([ThinkingSheet]).
 */
@Composable
fun ModelSheet(models: ModelListResult?, canWrite: Boolean, onModel: (String) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val all = models?.models.orEmpty()
    val shown = if (query.isBlank()) all else all.filter { m -> listOfNotNull(m.id, m.name, m.provider).any { it.contains(query.trim(), ignoreCase = true) } }
    val groups = listOf("custom" to R.string.model_group_custom, "apiKey" to R.string.model_group_key, "login" to R.string.model_group_login)
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 18.dp).heightIn(max = 600.dp).verticalScroll(rememberScrollState())) {
            if (models == null) {
                Text("…", style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
                return@Column
            }
            if (all.size > 8) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp)) {
                    if (query.isEmpty()) Text(stringResource(R.string.piui_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    BasicTextField(query, { query = it }, textStyle = Pi.t.secondary.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            }
            for ((g, title) in groups) {
                val list = shown.filter { (it.group ?: "apiKey") == g }
                if (list.isEmpty()) continue
                Text(stringResource(title), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 4.dp))
                for (m in list) {
                    val on = m.id == models.current
                    Row(
                        Modifier.fillMaxWidth().background(if (on) Pi.c.surface else Color.Transparent).clickable(enabled = canWrite, role = Role.RadioButton) { onModel(m.id) }.heightIn(min = 46.dp).padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(m.name ?: m.id.substringAfter('/'), style = Pi.t.secondary.copy(color = Pi.c.fg))
                            m.provider?.let { Text(it, style = Pi.t.small.copy(color = Pi.c.fg3)) }
                        }
                        if (on) PiIcon(PiIcons.Check, Pi.c.fg2, 14.dp)
                    }
                }
            }
        }
    }
}
