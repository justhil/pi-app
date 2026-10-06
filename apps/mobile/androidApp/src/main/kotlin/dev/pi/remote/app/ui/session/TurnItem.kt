package dev.pi.remote.app.ui.session

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.runtime.remember
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import dev.pi.remote.R
import dev.pi.remote.app.data.PromptAttachments
import dev.pi.remote.app.data.ImageSource
import dev.pi.remote.app.data.LocalAttachmentImages
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.linkify
import dev.pi.remote.app.ui.ShimmerText
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.countsLine
import dev.pi.remote.app.ui.dividerLabel
import dev.pi.remote.app.ui.rich.MermaidSource
import dev.pi.remote.app.ui.rich.RichContent
import dev.pi.remote.app.ui.verbFor
import dev.pi.remote.app.ui.workedLine
import dev.pi.remote.protocol.ProseStep
import dev.pi.remote.protocol.Step
import dev.pi.remote.protocol.ThinkingStep
import dev.pi.remote.protocol.ToolStep
import dev.pi.remote.protocol.Turn
import dev.pi.remote.text.formatClock
import dev.pi.remote.text.formatDuration
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

@Immutable
data class TurnCallbacks(
    val onToggle: (String) -> Unit,
    val onStep: (Turn, ToolStep) -> Unit,
    val onFile: (Turn, String) -> Unit,
    /** Tap on a message: open it full screen. */
    val onOpen: (Turn, MessagePart) -> Unit = { _, _ -> },
    /** Long-press on a message: copy / select / share / edit. */
    val onActions: (Turn, MessagePart) -> Unit = { _, _ -> },
)

enum class MessagePart { User, Answer }

fun categoryIcon(category: String): ImageVector = when (category) {
    "read" -> PiIcons.Eye
    "edit" -> PiIcons.Pencil
    "write" -> PiIcons.File
    "run" -> PiIcons.Terminal
    "search" -> PiIcons.Search
    else -> PiIcons.Sparkles
}

/**
 * One turn: user message → collapsed activity → answer → files touched. Completed turns show one
 * activity line (expand on tap); the running turn shows live status plus its last three steps.
 */
@Composable
fun TurnItem(turn: Turn, expanded: Boolean, divider: Long?, now: Long, mermaid: MermaidSource?, cb: TurnCallbacks) {
    val haptic = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        divider?.let {
            Text(dividerLabel(it), style = Pi.t.small.copy(color = Pi.c.fg3), modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp))
        }
        if (turn.user.text.isNotBlank()) {
            UserBubble(
                turn.user.text,
                Modifier.combinedClickable(
                    interactionSource = null,
                    indication = null,
                    onClick = { cb.onOpen(turn, MessagePart.User) },
                    onLongClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        cb.onActions(turn, MessagePart.User)
                    },
                ),
            )
        }
        if (turn.steps.isNotEmpty() || turn.running) {
            if (turn.running) LiveActivity(turn, now, cb) else ActivityRow(turn, expanded, cb)
            if (expanded && !turn.running) StepList(turn, turn.steps, cb)
        }
        if (turn.answer.isNotBlank()) {
            // Links, code-copy and pi-ui controls inside consume their own taps first.
            RichContent(
                turn.answer, streaming = turn.running, mermaid = mermaid,
                modifier = Modifier.combinedClickable(
                    interactionSource = null,
                    indication = null,
                    onClick = { cb.onOpen(turn, MessagePart.Answer) },
                    onLongClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        cb.onActions(turn, MessagePart.Answer)
                    },
                ),
            )
        }
        turn.error?.let { e ->
            Row(verticalAlignment = Alignment.Top) {
                PiIcon(if (e.kind == "aborted") PiIcons.Pause else PiIcons.Alert, if (e.kind == "aborted") Pi.c.fg3 else Pi.c.bad, 14.dp, Modifier.padding(top = 2.dp))
                Spacer(Modifier.width(7.dp))
                Text(e.text, style = Pi.t.secondary.copy(color = if (e.kind == "aborted") Pi.c.fg3 else Pi.c.bad), maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
        if (!turn.running && turn.files.isNotEmpty()) FileList(turn, cb)
        if (!turn.running) {
            val meta = listOfNotNull(turn.meta?.model?.substringAfter('/'), turn.meta?.thinking?.replaceFirstChar { it.uppercase() }, turn.durationMs?.let(::formatDuration)).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, style = Pi.t.meta.copy(color = Pi.c.fg3))
        }
    }
}

/** The phone's own message before the host echoes it back as a turn. */
@Composable
fun PendingBubble(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        UserBubble(text, dim = true)
        Text(stringResource(R.string.sending), style = Pi.t.meta.copy(color = Pi.c.fg3))
    }
}

/** User message, right-aligned; attachment paths render as small chips above the text. */
@Composable
fun UserBubble(text: String, modifier: Modifier = Modifier, dim: Boolean = false) {
    val (body, refs) = remember(text) { PromptAttachments.split(text) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
      Column(modifier, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val loader = LocalAttachmentImages.current
        val images = if (loader != null) refs.filter { it.isImage } else emptyList()
        val chips = refs - images.toSet()
        if (images.isNotEmpty()) {
            var viewing by remember { mutableStateOf<Int?>(null) }
            Row(Modifier.widthIn(max = 300.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                images.take(4).forEachIndexed { i, r ->
                    val src = remember(r.path) { ImageSource.Remote(r.path) }
                    val thumb by produceState<ImageBitmap?>(null, src) { value = loader?.thumb(src) }
                    Box(
                        Modifier.size(if (images.size == 1) 132.dp else 68.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface)
                            .border(1.dp, Pi.c.line, RoundedCornerShape(10.dp)).clickable(role = Role.Image) { viewing = i },
                        contentAlignment = Alignment.Center,
                    ) {
                        thumb?.let { Image(it, r.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                            ?: PiIcon(PiIcons.Image, Pi.c.fg3, 16.dp)
                        if (i == 3 && images.size > 4) {
                            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                                Text("+${images.size - 4}", style = Pi.t.bodyMedium.copy(color = Color.White))
                            }
                        }
                    }
                }
            }
            viewing?.let { start -> ImageViewer(images.map { ImageSource.Remote(it.path) }, start, onDismiss = { viewing = null }) }
        }
        if (chips.isNotEmpty()) {
            Row(Modifier.widthIn(max = 300.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (r in chips.take(4)) {
                    Row(
                        Modifier.clip(RoundedCornerShape(8.dp)).border(1.dp, Pi.c.line, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 5.dp).widthIn(max = 140.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PiIcon(if (r.isImage) PiIcons.Image else PiIcons.File, Pi.c.fg3, 13.dp)
                        Spacer(Modifier.width(5.dp))
                        Text(r.name, style = Pi.t.meta.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (chips.size > 4) Text("+${chips.size - 4}", style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.align(Alignment.CenterVertically))
            }
        }
        if (body.isNotBlank()) {
            Text(
                remember(body) { linkify(body) },
                style = Pi.t.body.copy(color = if (dim) Pi.c.fg2 else Pi.c.fg),
                modifier = Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(16.dp)).background(Pi.c.surface).padding(horizontal = 13.dp, vertical = 9.dp),
            )
        }
      }
    }
}

@Composable
private fun DiffStat(add: Int, del: Int) {
    Row {
        if (add > 0) Text("+$add", style = Pi.t.monoSmall.copy(color = Pi.c.ok))
        if (add > 0 && del > 0) Spacer(Modifier.width(5.dp))
        if (del > 0) Text("−$del", style = Pi.t.monoSmall.copy(color = Pi.c.bad))
    }
}

@Composable
private fun ActivityRow(turn: Turn, expanded: Boolean, cb: TurnCallbacks) {
    val angle by animateFloatAsState(if (expanded) 90f else 0f, label = "chev")
    val add = turn.files.sumOf { it.add }
    val del = turn.files.sumOf { it.del }
    val state = stringResource(if (expanded) R.string.collapse else R.string.expand)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 36.dp).clickable(role = Role.Button) { cb.onToggle(turn.id) }.semantics { stateDescription = state },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 14.dp, Modifier.rotate(angle))
        Spacer(Modifier.width(6.dp))
        Text(workedLine(turn.durationMs, turn.activity.counts), style = Pi.t.secondary.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (turn.activity.failed > 0) Text("${turn.activity.failed} ${stringResource(R.string.step_failed)}  ", style = Pi.t.meta.copy(color = Pi.c.bad))
        DiffStat(add, del)
    }
}

@Composable
private fun LiveActivity(turn: Turn, now: Long, cb: TurnCallbacks) {
    val elapsed = turn.startedAt?.let { formatClock(now - it) }
    Row(Modifier.fillMaxWidth().heightIn(min = 30.dp), verticalAlignment = Alignment.CenterVertically) {
        Spinner()
        Spacer(Modifier.width(6.dp))
        val counts = countsLine(turn.activity.counts)
        Text(listOf(stringResource(R.string.act_working), counts).filter { it.isNotEmpty() }.joinToString(" · "), style = Pi.t.secondary.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f), maxLines = 1)
        elapsed?.let { Text(it, style = Pi.t.monoSmall.copy(color = Pi.c.fg3)) }
    }
    val recent = turn.steps.filter { it !is ProseStep }.takeLast(3)
    if (recent.isNotEmpty()) StepList(turn, recent, cb, liveId = turn.activity.live)
}

@Composable
private fun StepList(turn: Turn, steps: List<Step>, cb: TurnCallbacks, liveId: String? = null) {
    Column(Modifier.fillMaxWidth().padding(start = 20.dp).animateContentSize()) {
        for (s in steps) {
            when (s) {
                is ThinkingStep -> ThinkingRow(s, live = s.id == liveId)
                is ToolStep -> {
                    val right: String? = when {
                        s.status == "running" -> null
                        s.category == "run" -> {
                            val code = (s.node.fields["exitCode"] as? JsonPrimitive)?.intOrNull
                            val ok = s.status == "ok" && (code == null || code == 0)
                            stringResource(if (ok) R.string.step_ok else R.string.step_failed) + (s.ms?.let { " · ${formatDuration(it)}" } ?: "")
                        }
                        s.status == "error" -> stringResource(R.string.step_failed)
                        else -> null
                    }
                    val add = (s.node.fields["add"] as? JsonPrimitive)?.intOrNull
                    val del = (s.node.fields["del"] as? JsonPrimitive)?.intOrNull
                    StepRow(
                        categoryIcon(s.category),
                        if (s.category == "other") s.toolName else verbFor(s.category),
                        s.node.title,
                        right,
                        live = s.status == "running",
                        add = add,
                        del = del,
                        failed = s.status == "error",
                        onClick = { cb.onStep(turn, s) },
                    )
                }
                is ProseStep -> Text(s.text.lines().firstOrNull { it.isNotBlank() }.orEmpty(), style = Pi.t.secondary.copy(color = Pi.c.fg3), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(vertical = 4.dp, horizontal = 0.dp))
                else -> Unit
            }
        }
    }
}

/** Thinking step: tap to read the reasoning; while live, its last lines show underneath. */
@Composable
private fun ThinkingRow(s: ThinkingStep, live: Boolean) {
    var open by rememberSaveable(s.id) { mutableStateOf(false) }
    val hasText = s.text.isNotBlank()
    val angle by animateFloatAsState(if (open) 90f else 0f, label = "think")
    val line = Pi.c.line
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 32.dp).clickable(enabled = hasText, role = Role.Button) { open = !open },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PiIcon(PiIcons.Bulb, Pi.c.fg3, 14.dp)
            Spacer(Modifier.width(9.dp))
            val label = if (live) stringResource(R.string.thinking_live) else stringResource(R.string.thought_for, s.ms?.let(::formatDuration) ?: "…")
            if (live) ShimmerText(label, Pi.t.secondary) else Text(label, style = Pi.t.secondary.copy(color = Pi.c.fg2))
            Spacer(Modifier.weight(1f))
            if (hasText) PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp, Modifier.rotate(angle))
        }
        when {
            open -> SelectionContainer {
                Text(
                    s.text.trim(), style = Pi.t.secondary.copy(color = Pi.c.fg3),
                    modifier = Modifier.padding(start = 23.dp, bottom = 6.dp).drawBehind {
                        drawLine(line, Offset(-9.dp.toPx(), 0f), Offset(-9.dp.toPx(), size.height), 1.dp.toPx())
                    },
                )
            }
            live && hasText -> Text(
                s.text.trim().lines().filter { it.isNotBlank() }.takeLast(2).joinToString("\n"),
                style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 23.dp, bottom = 4.dp),
            )
        }
    }
}

@Composable
private fun StepRow(icon: ImageVector, verb: String, target: String?, right: String?, live: Boolean, add: Int? = null, del: Int? = null, failed: Boolean = false, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 32.dp).then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PiIcon(icon, if (failed) Pi.c.bad else Pi.c.fg3, 14.dp)
        Spacer(Modifier.width(9.dp))
        if (live) ShimmerText(verb, Pi.t.secondary) else Text(verb, style = Pi.t.secondary.copy(color = Pi.c.fg2))
        if (target != null) {
            Spacer(Modifier.width(9.dp))
            if (live) ShimmerText(target, Pi.t.monoSmall, Modifier.weight(1f)) else Text(target, style = Pi.t.monoSmall.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        } else Spacer(Modifier.weight(1f))
        if (add != null || del != null) DiffStat(add ?: 0, del ?: 0)
        right?.let { Text(it, style = Pi.t.meta.copy(color = if (failed) Pi.c.bad else Pi.c.fg3)) }
    }
}

@Composable
private fun FileList(turn: Turn, cb: TurnCallbacks) {
    Column {
        Hairline()
        for (f in turn.files) {
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).clickable(role = Role.Button) { cb.onFile(turn, f.path) }, verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.File, Pi.c.fg3, 14.dp)
                Spacer(Modifier.width(9.dp))
                Text(f.path, style = Pi.t.monoSmall.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                DiffStat(f.add, f.del)
            }
            Hairline()
        }
    }
}
