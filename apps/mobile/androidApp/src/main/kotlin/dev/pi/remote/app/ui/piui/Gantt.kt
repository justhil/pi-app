package dev.pi.remote.app.ui.piui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.BlockCard
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.text.GanttMath
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val ROW = 30.dp
private val HEADER = 36.dp

/**
 * Mobile gantt (desktop gantt-math ported to shared): fixed task-name column, horizontally
 * scrolling timeline, day/week/month scale, collapsible groups, tap a task to highlight its
 * whole dependency chain (arrows would clutter a phone screen).
 */
@Composable
fun Gantt(props: JsonObject) {
    val tasks = remember(props) {
        GanttMath.resolveTasks(props.objs("tasks").take(200).map { t ->
            val deps = when (val d = t["dependsOn"]) {
                is JsonArray -> d.mapNotNull { (it as? JsonPrimitive)?.content }
                is JsonPrimitive -> listOf(d.content)
                else -> emptyList()
            }
            GanttMath.TaskInput(t.str("id"), t.str("name").orEmpty(), t.str("start").orEmpty(), t.str("end"), t.num("duration"), t.num("progress"), t.str("group"), deps, t.bool("milestone") == true)
        })
    }
    if (tasks.isEmpty()) return Fallback(stringResource(R.string.piui_invalid), props.toString())
    val (minDay, maxDay) = remember(tasks) { GanttMath.taskExtent(tasks) }
    val auto = remember(tasks) {
        // Phones are narrow: day scale only for short plans, week up to ~4 months.
        props.str("scale")?.let { s -> GanttMath.Scale.entries.firstOrNull { it.name.equals(s, true) } } ?: when {
            maxDay - minDay <= 14 -> GanttMath.Scale.Day
            maxDay - minDay <= 120 -> GanttMath.Scale.Week
            else -> GanttMath.Scale.Month
        }
    }
    var scale by remember { mutableStateOf(auto) }
    var collapsed by remember { mutableStateOf(setOf<String>()) }
    var selected by remember { mutableStateOf<String?>(null) }
    val domain = GanttMath.scaleDomain(minDay, maxDay, scale)
    val ppd: Dp = when (scale) {
        GanttMath.Scale.Day -> 18.dp
        GanttMath.Scale.Week -> 9.dp
        GanttMath.Scale.Month -> 2.5.dp
    }
    val rows = GanttMath.buildRows(tasks, collapsed)
    val chain = selected?.let { GanttMath.dependencyChain(tasks, it) }
    val today = props.str("today")?.let(GanttMath::parseDay) ?: run {
        val tz = java.util.TimeZone.getDefault()
        val now = System.currentTimeMillis()
        Math.floorDiv(now + tz.getOffset(now), 86_400_000L).toInt()
    }
    fun x(day: Int): Dp = ppd * (day - domain.first)

    BlockCard {
        Column {
            BlockHeader(props.str("title")) {
                Segmented(
                    listOf(GanttMath.Scale.Day.name to stringResource(R.string.piui_day), GanttMath.Scale.Week.name to stringResource(R.string.piui_week), GanttMath.Scale.Month.name to stringResource(R.string.piui_month)),
                    scale.name,
                    { scale = GanttMath.Scale.valueOf(it) },
                )
            }
            Row(Modifier.padding(top = 8.dp, bottom = 6.dp)) {
                Column(Modifier.width(112.dp).padding(start = 12.dp)) {
                    Spacer(Modifier.height(HEADER))
                    for (r in rows) {
                        when (r) {
                            is GanttMath.Row.Group -> Row(
                                Modifier.height(ROW).fillMaxWidth().clickable(role = Role.Button) { collapsed = if (r.name in collapsed) collapsed - r.name else collapsed + r.name },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                PiIcon(PiIcons.ChevronDown, Pi.c.fg2, 11.dp, Modifier.rotate(if (r.collapsed) -90f else 0f))
                                Spacer(Modifier.width(4.dp))
                                Text(r.name, style = Pi.t.meta.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            is GanttMath.Row.TaskRow -> Text(
                                r.task.name,
                                style = Pi.t.meta.copy(color = if (selected == r.task.key) Pi.c.fg else Pi.c.fg2),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.height(ROW).fillMaxWidth().padding(start = if (r.grouped) 15.dp else 0.dp, top = 7.dp)
                                    .alpha(if (chain != null && r.task.key !in chain) 0.3f else 1f)
                                    .clickable(role = Role.Button) { selected = if (selected == r.task.key) null else r.task.key },
                            )
                        }
                    }
                }
                Box(Modifier.width(1.dp).height(HEADER + ROW * rows.size).background(Pi.c.line))
                Box(Modifier.weight(1f).horizontalScroll(rememberScrollState())) {
                    val width = ppd * (domain.second - domain.first)
                    Box(Modifier.width(width).height(HEADER + ROW * rows.size)) {
                        for (run in GanttMath.weekendRuns(domain)) {
                            if (scale == GanttMath.Scale.Month) break
                            Box(Modifier.offset(x = x(run.first), y = HEADER).width(ppd * (run.last - run.first + 1)).fillMaxHeight().background(Pi.c.surface))
                        }
                        Text(GanttMath.dayParts(domain.first).let { "${it.year}-${it.month + 1}" }, style = Pi.t.small.copy(color = Pi.c.fg3), modifier = Modifier.offset(x = 6.dp, y = 2.dp))
                        for (cell in GanttMath.bottomTier(domain, scale)) {
                            val isToday = cell.start <= today && today < cell.end && scale == GanttMath.Scale.Day
                            Text(cell.label, style = Pi.t.small.copy(color = if (isToday) Pi.c.s2 else if (cell.weekend) Pi.c.fg3 else Pi.c.fg2), modifier = Modifier.offset(x = x(cell.start) + 2.dp, y = 18.dp))
                        }
                        Box(Modifier.offset(y = HEADER - 1.dp).width(width).height(1.dp).background(Pi.c.line))
                        if (today in domain.first until domain.second) {
                            Box(Modifier.offset(x = x(today) + ppd / 2, y = HEADER).width(1.dp).fillMaxHeight().background(Pi.c.s2))
                        }
                        rows.forEachIndexed { i, r ->
                            val top = HEADER + ROW * i
                            when (r) {
                                is GanttMath.Row.Group -> Box(Modifier.offset(x = x(r.start), y = top + 13.dp).width(ppd * maxOf(1, r.end - r.start)).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Pi.c.fg3.copy(alpha = 0.45f)))
                                is GanttMath.Row.TaskRow -> {
                                    val t = r.task
                                    val dim = chain != null && t.key !in chain
                                    val desc = "${t.name}, ${t.start}..${t.end}"
                                    if (t.milestone) {
                                        Box(
                                            Modifier.offset(x = x(t.start) + ppd / 2 - 5.5.dp, y = top + 9.5.dp).size(11.dp).rotate(45f).clip(RoundedCornerShape(2.dp)).background(Pi.c.s2)
                                                .alpha(if (dim) 0.3f else 1f).clickable(role = Role.Button) { selected = if (selected == t.key) null else t.key }.semantics { contentDescription = desc },
                                        )
                                    } else {
                                        Box(
                                            Modifier.offset(x = x(t.start), y = top + 8.dp).width(ppd * maxOf(1, t.end - t.start)).height(14.dp).clip(RoundedCornerShape(4.dp))
                                                .background(Pi.c.s1.copy(alpha = 0.22f)).then(if (selected == t.key) Modifier.border(1.5.dp, Pi.c.s1, RoundedCornerShape(4.dp)) else Modifier)
                                                .alpha(if (dim) 0.3f else 1f).clickable(role = Role.Button) { selected = if (selected == t.key) null else t.key }.semantics { contentDescription = desc },
                                        ) {
                                            Box(Modifier.fillMaxHeight().fillMaxWidth((t.progress ?: 0.0).toFloat()).background(Pi.c.s1))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            val sel = tasks.firstOrNull { it.key == selected }
            if (sel != null) {
                Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    fun d(day: Int) = GanttMath.dayParts(day).let { "${it.month + 1}/${it.date}" }
                    Row {
                        Text(sel.name, style = Pi.t.secondary.copy(color = Pi.c.fg), modifier = Modifier.weight(1f))
                        Text(if (sel.milestone) "${d(sel.start)} · ${stringResource(R.string.piui_milestone)}" else "${d(sel.start)} → ${d(sel.end - 1)} · ${stringResource(R.string.piui_days, sel.end - sel.start)}", style = Pi.t.meta.copy(color = Pi.c.fg3))
                    }
                    val deps = sel.deps.mapNotNull { k -> tasks.firstOrNull { it.key == k }?.name }
                    Text(
                        (if (deps.isEmpty()) stringResource(R.string.piui_no_deps) else stringResource(R.string.piui_depends, deps.joinToString("、"))) + (sel.progress?.let { " · ${(it * 100).toInt()}%" } ?: ""),
                        style = Pi.t.meta.copy(color = Pi.c.fg3),
                    )
                }
            } else {
                Text(stringResource(R.string.piui_tap_task), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp))
            }
        }
    }
}
