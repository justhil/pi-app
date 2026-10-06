package dev.pi.remote.app.ui.session

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Dot
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.piui.uibColor
import dev.pi.remote.protocol.ContextStats
import dev.pi.remote.protocol.ReviewDiffResult
import dev.pi.remote.protocol.SessionUsage
import dev.pi.remote.sync.SessionTimeline
import dev.pi.remote.text.formatClock
import kotlin.math.roundToInt

/** 32100 → "32.1k", 1_200_000 → "1.2M" (desktop `formatTokens`). */
/** `$0.41`, `<$0.01` for tiny amounts. */
fun formatCost(usd: Double): String = when {
    usd <= 0.0 -> "$0"
    usd < 0.01 -> "<$0.01"
    usd >= 100 -> "$" + "%.0f".format(usd)
    else -> "$" + "%.2f".format(usd)
}

fun formatTokens(n: Long): String = when {
    n < 1000 -> "$n"
    n < 1_000_000 -> (if (n < 10_000) "%.1fk".format(n / 1000.0) else "${(n / 1000.0).roundToInt()}k").replace(".0k", "k")
    else -> "%.1fM".format(n / 1_000_000.0).replace(".0M", "M")
}

/** Everything the panel shows that the phone already knows. */
data class SessionFacts(
    val title: String,
    val projectPath: String,
    val status: String,
    val statusColor: Color,
    val model: String?,
    val thinking: String?,
    val turns: Int,
    val toolCalls: Int,
    val files: Int,
    val added: Int,
    val deleted: Int,
    val workedMs: Long,
    val toolsOn: Int,
    val queued: Int,
    val todoDone: Int?,
    val todoTotal: Int?,
    val sessionFile: String,
)

fun sessionFacts(title: String, projectPath: String, status: String, statusColor: Color, timeline: SessionTimeline?, toolsOn: Int): SessionFacts {
    val turns = timeline?.turns.orEmpty()
    val files = turns.flatMap { it.files }.groupBy { it.path }
    val todo = timeline?.state?.todo
    return SessionFacts(
        title = title,
        projectPath = projectPath,
        status = status,
        statusColor = statusColor,
        model = timeline?.state?.model,
        thinking = timeline?.state?.thinking,
        turns = turns.size,
        toolCalls = turns.sumOf { t -> t.activity.counts.let { it.read + it.edit + it.write + it.run + it.search + it.other } },
        files = files.size,
        added = files.values.sumOf { list -> list.sumOf { it.add } },
        deleted = files.values.sumOf { list -> list.sumOf { it.del } },
        workedMs = turns.sumOf { it.durationMs ?: 0L },
        toolsOn = toolsOn,
        queued = timeline?.state?.queue?.let { it.steering.size + it.followUp.size } ?: 0,
        todoDone = todo?.items?.count { it.status == "completed" },
        todoTotal = todo?.items?.count { it.status != "cancelled" },
        sessionFile = timeline?.sessionKey.orEmpty(),
    )
}

/**
 * Right-hand session panel: slides over the timeline without covering it fully (the page stays
 * visible under a scrim, with a shadow on the panel edge). [progress] is 0 (closed) … 1 (open)
 * and follows the finger while dragging.
 */
@Composable
fun SessionPanel(
    progress: () -> Float,
    width: Dp,
    facts: SessionFacts,
    stats: ContextStats?,
    statsLoading: Boolean,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    changes: ReviewDiffResult? = null,
    onChanges: (() -> Unit)? = null,
    branchCount: Int? = null,
    onBranches: (() -> Unit)? = null,
    usage: SessionUsage? = null,
) {
    val p = progress()
    if (p <= 0.001f) return
    // [modifier] carries the same horizontal drag as the page, so the panel follows the finger closed too.
    Box(modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().graphicsLayer { alpha = p }.background(Pi.c.scrim)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        )
        Column(
            Modifier.align(Alignment.CenterEnd).offset { IntOffset((width.toPx() * (1f - progress())).roundToInt(), 0) }.width(width).fillMaxHeight()
                .shadow(elevation = (16 * p).dp, shape = RoundedCornerShape(topStart = 18.dp, bottomStart = 18.dp), ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.3f))
                .clip(RoundedCornerShape(topStart = 18.dp, bottomStart = 18.dp)).background(Pi.c.bg)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .statusBarsPadding().navigationBarsPadding(),
        ) {
            Row(Modifier.fillMaxWidth().height(52.dp).padding(start = 20.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.panel_title), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
                Box(Modifier.size(40.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClose), contentAlignment = Alignment.Center) {
                    PiIcon(PiIcons.X, Pi.c.fg2, 15.dp, contentDescription = stringResource(R.string.close))
                }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp)) {
                Text(facts.title.ifEmpty { "—" }, style = Pi.t.bodyMedium.copy(color = Pi.c.fg), maxLines = 3, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(4.dp))
                Text(facts.projectPath, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(facts.statusColor, 7.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(facts.status, style = Pi.t.secondary.copy(color = Pi.c.fg2))
                }

                Section(stringResource(R.string.panel_context)) {
                    ContextBlock(stats, statsLoading)
                }

                if (onChanges != null) {
                    Section(stringResource(R.string.panel_changes)) {
                        val files = changes?.files.orEmpty()
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onChanges),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                when {
                                    changes == null -> stringResource(R.string.panel_changes_open)
                                    files.isEmpty() -> stringResource(R.string.panel_changes_none)
                                    else -> stringResource(R.string.panel_files_value, files.size, files.sumOf { it.add }, files.sumOf { it.del })
                                },
                                style = Pi.t.secondary.copy(color = Pi.c.fg), modifier = Modifier.weight(1f),
                            )
                            PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 14.dp)
                        }
                    }
                }

                if (onBranches != null) {
                    Section(stringResource(R.string.panel_branches)) {
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onBranches),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                when {
                                    branchCount == null -> stringResource(R.string.panel_branches)
                                    branchCount <= 1 -> stringResource(R.string.panel_branches_one)
                                    else -> pluralStringResource(R.plurals.panel_branches_count, branchCount, branchCount)
                                },
                                style = Pi.t.secondary.copy(color = Pi.c.fg), modifier = Modifier.weight(1f),
                            )
                            PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 14.dp)
                        }
                    }
                }

                Section(stringResource(R.string.panel_session)) {
                    Fact(stringResource(R.string.model), facts.model?.substringAfter('/') ?: "—")
                    Fact(stringResource(R.string.thinking), thinkingLabel(facts.thinking))
                    Fact(stringResource(R.string.panel_turns), "${facts.turns}")
                    if (usage != null && usage.calls > 0) Fact(stringResource(R.string.panel_cost), pluralStringResource(R.plurals.panel_cost_value, usage.calls, formatCost(usage.cost), usage.calls))
                    Fact(stringResource(R.string.panel_tool_calls), "${facts.toolCalls}")
                    if (facts.files > 0) Fact(stringResource(R.string.panel_files), stringResource(R.string.panel_files_value, facts.files, facts.added, facts.deleted))
                    if (facts.workedMs > 0) Fact(stringResource(R.string.panel_worked), formatClock(facts.workedMs))
                    Fact(stringResource(R.string.panel_capabilities), "${facts.toolsOn}")
                    if (facts.queued > 0) Fact(stringResource(R.string.panel_queued), "${facts.queued}")
                    if (facts.todoTotal != null && facts.todoTotal > 0) Fact(stringResource(R.string.panel_todo), "${facts.todoDone ?: 0} / ${facts.todoTotal}")
                }

                if (facts.sessionFile.isNotEmpty()) {
                    Section(stringResource(R.string.panel_file)) {
                        Text(facts.sessionFile.substringAfterLast('/').substringAfterLast('\\'), style = Pi.t.mono.copy(color = Pi.c.fg2), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Spacer(Modifier.height(20.dp))
    Hairline()
    Spacer(Modifier.height(14.dp))
    Text(title, style = Pi.t.meta.copy(color = Pi.c.fg3))
    Spacer(Modifier.height(8.dp))
    content()
}

@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 30.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
        Text(value, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun roleLabel(role: String): String = stringResource(
    when (role) {
        "system" -> R.string.role_system
        "user" -> R.string.role_user
        "assistant" -> R.string.role_assistant
        "tool" -> R.string.role_tool
        "summary" -> R.string.role_summary
        else -> R.string.role_other
    },
)

@Composable
private fun ContextBlock(stats: ContextStats?, loading: Boolean) {
    if (stats == null) {
        Box(Modifier.fillMaxWidth().height(48.dp), contentAlignment = Alignment.CenterStart) {
            if (loading) Spinner(Pi.c.fg3, 14.dp) else Text(stringResource(R.string.panel_context_none), style = Pi.t.secondary.copy(color = Pi.c.fg3))
        }
        return
    }
    val window = stats.window
    val pct = window?.takeIf { it > 0 }?.let { (stats.tokens.toFloat() / it).coerceIn(0f, 1f) }
    Row(verticalAlignment = Alignment.Bottom) {
        Text(pct?.let { "${(it * 100).roundToInt()}%" } ?: formatTokens(stats.tokens), style = Pi.t.title.copy(color = if ((pct ?: 0f) >= 0.85f) Pi.c.warn else Pi.c.fg))
        Spacer(Modifier.width(8.dp))
        Text(
            if (window != null) stringResource(R.string.panel_context_of, formatTokens(stats.tokens), formatTokens(window)) else stringResource(R.string.panel_context_tokens, formatTokens(stats.tokens)),
            style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(bottom = 3.dp),
        )
    }
    Spacer(Modifier.height(10.dp))
    // Segmented bar: each role's share of the window (or of the total when the window is unknown).
    val total = (window ?: stats.tokens).coerceAtLeast(1)
    val grow by animateFloatAsState(1f, spring(dampingRatio = 0.9f, stiffness = 300f), label = "ctx")
    Row(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Pi.c.fg.copy(alpha = 0.07f))) {
        stats.breakdown.forEachIndexed { i, s ->
            val w = s.tokens.toFloat() / total * grow
            if (w > 0.002f) Box(Modifier.weight(w).fillMaxHeight().background(uibColor(i)))
        }
        val used = stats.breakdown.sumOf { it.tokens }.toFloat() / total * grow
        if (used < 1f) Spacer(Modifier.weight(1f - used))
    }
    Spacer(Modifier.height(10.dp))
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        stats.breakdown.forEachIndexed { i, s ->
            Row(Modifier.fillMaxWidth().heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(uibColor(i)))
                Spacer(Modifier.width(8.dp))
                Text(roleLabel(s.role), style = Pi.t.meta.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f))
                Text(formatTokens(s.tokens), style = Pi.t.meta.copy(color = Pi.c.fg3))
            }
        }
    }
    Spacer(Modifier.height(6.dp))
    Text(stringResource(R.string.panel_context_messages, stats.messages), style = Pi.t.small.copy(color = Pi.c.fg3))
    if ((pct ?: 0f) >= 0.85f) {
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.panel_context_high), style = Pi.t.small.copy(color = Pi.c.warn))
    }
}
