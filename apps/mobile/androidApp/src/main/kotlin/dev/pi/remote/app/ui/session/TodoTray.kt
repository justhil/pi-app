package dev.pi.remote.app.ui.session

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.protocol.TodoItem
import dev.pi.remote.protocol.TodoState

/**
 * Todo summary above the composer (desktop `ComposerAdapterWidgetHost`): names the item being worked
 * on, with a progress ring; tap to unfold the list, which floats over the timeline ([TodoList]) so
 * opening it does not push the conversation around.
 */
@Composable
fun TodoTray(todo: TodoState, open: Boolean, onToggle: () -> Unit) {
    if (todo.items.isEmpty()) return
    val done = todo.items.count { it.status == "completed" }
    val allDone = todo.items.none { it.status == "in_progress" || it.status == "pending" }
    val current = todo.items.firstOrNull { it.status == "in_progress" }
    val next = todo.items.firstOrNull { it.status == "pending" }
    val focus = when {
        allDone -> stringResource(R.string.todo_complete)
        current != null -> current.text
        next != null -> stringResource(R.string.todo_next, next.text)
        else -> ""
    }
    val angle by animateFloatAsState(if (open) 180f else 0f, label = "todo")
    val desc = "${todo.title} $done/${todo.items.size} $focus"
    Column(Modifier.fillMaxWidth().background(Pi.c.bg)) {
        Hairline()
        Row(
            Modifier.fillMaxWidth().heightIn(min = 38.dp).clickable(role = Role.Button, onClick = onToggle).padding(horizontal = 16.dp).semantics { contentDescription = desc },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (allDone) PiIcon(PiIcons.Check, Pi.c.ok, 14.dp) else ProgressRing(done, todo.items.size)
            Spacer(Modifier.width(7.dp))
            Text(todo.title, style = Pi.t.meta.copy(color = Pi.c.fg2, fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
            Spacer(Modifier.width(5.dp))
            Text("$done/${todo.items.size}", style = Pi.t.meta.copy(color = Pi.c.fg3))
            if (focus.isNotEmpty()) {
                Text("  ·  ", style = Pi.t.meta.copy(color = Pi.c.fg3.copy(alpha = 0.5f)))
                Text(focus, style = Pi.t.meta.copy(color = if (allDone) Pi.c.fg3 else Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            } else Spacer(Modifier.weight(1f))
            PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 12.dp, Modifier.rotate(angle))
        }
    }
}

/** The unfolded todo list, drawn over the bottom of the timeline, right above the summary. */
@Composable
fun TodoList(todo: TodoState, open: Boolean, modifier: Modifier = Modifier) {
    AnimatedVisibility(open && todo.items.isNotEmpty(), modifier = modifier, enter = expandVertically(expandFrom = Alignment.Bottom) + fadeIn(), exit = shrinkVertically(shrinkTowards = Alignment.Bottom) + fadeOut()) {
        Column(
            Modifier.fillMaxWidth()
                .shadow(12.dp, RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp), clip = false, ambientColor = Pi.c.fg.copy(alpha = 0.12f), spotColor = Pi.c.fg.copy(alpha = 0.12f))
                .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .background(Pi.c.bg)
                .heightIn(max = 300.dp)
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            todo.items.forEach { TodoRow(it) }
        }
    }
}

@Composable
private fun TodoRow(item: TodoItem) {
    val current = item.status == "in_progress"
    val color = when (item.status) {
        "in_progress" -> Pi.c.fg
        "pending" -> Pi.c.fg2
        else -> Pi.c.fg3
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 2.dp).size(13.dp), contentAlignment = Alignment.Center) { StatusMark(item.status) }
        Spacer(Modifier.width(8.dp))
        Text(
            item.text,
            style = Pi.t.secondary.copy(
                color = color,
                fontWeight = if (current) FontWeight.Medium else FontWeight.Normal,
                textDecoration = if (item.status == "cancelled") TextDecoration.LineThrough else null,
            ),
            modifier = Modifier.weight(1f),
        )
        item.priority?.let { p ->
            val tone = when (p) {
                "high" -> Pi.c.warn
                "medium" -> Pi.c.fg2
                else -> Pi.c.fg3
            }
            Row(Modifier.padding(start = 8.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(5.dp).clip(CircleShape).background(tone))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(when (p) { "high" -> R.string.todo_high; "medium" -> R.string.todo_medium; else -> R.string.todo_low }), style = Pi.t.small.copy(color = tone))
            }
        }
    }
}

/** Desktop icons: hollow circle (pending), half-filled (in progress), check (completed), cross (cancelled). */
@Composable
private fun StatusMark(status: String) {
    val ok = Pi.c.ok
    val muted = Pi.c.fg3
    val blue = Pi.c.blue
    Canvas(Modifier.size(12.dp)) {
        val r = size.minDimension / 2 - 0.8.dp.toPx()
        val c = Offset(size.width / 2, size.height / 2)
        val sw = 1.4.dp.toPx()
        when (status) {
            "in_progress" -> {
                drawCircle(blue, r, c, style = Stroke(sw))
                drawArc(blue, -90f, 180f, true, Offset(c.x - r * 0.62f, c.y - r * 0.62f), Size(r * 1.24f, r * 1.24f))
            }
            "completed" -> {
                drawCircle(ok, r, c, style = Stroke(sw))
                val p = Path().apply { moveTo(c.x - r * 0.45f, c.y); lineTo(c.x - r * 0.1f, c.y + r * 0.38f); lineTo(c.x + r * 0.5f, c.y - r * 0.35f) }
                drawPath(p, ok, style = Stroke(sw, cap = StrokeCap.Round))
            }
            "cancelled" -> {
                drawCircle(muted, r, c, style = Stroke(sw))
                drawLine(muted, Offset(c.x - r * 0.4f, c.y - r * 0.4f), Offset(c.x + r * 0.4f, c.y + r * 0.4f), sw, StrokeCap.Round)
                drawLine(muted, Offset(c.x + r * 0.4f, c.y - r * 0.4f), Offset(c.x - r * 0.4f, c.y + r * 0.4f), sw, StrokeCap.Round)
            }
            else -> drawCircle(muted.copy(alpha = 0.8f), r, c, style = Stroke(sw))
        }
    }
}

@Composable
private fun ProgressRing(done: Int, total: Int) {
    val track = Pi.c.fg.copy(alpha = 0.12f)
    val value = Pi.c.blue
    val ratio by animateFloatAsState(if (total > 0) done / total.toFloat() else 0f, label = "ring")
    Canvas(Modifier.size(14.dp)) {
        val sw = 1.8.dp.toPx()
        val inset = sw / 2 + 1.dp.toPx()
        val sz = Size(size.width - inset * 2, size.height - inset * 2)
        drawArc(track, 0f, 360f, false, Offset(inset, inset), sz, style = Stroke(sw))
        drawArc(value, -90f, 360f * ratio, false, Offset(inset, inset), sz, style = Stroke(sw, cap = StrokeCap.Round))
    }
}
