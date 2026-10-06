package dev.pi.remote.app.ui.session

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.ui.clockOf
import dev.pi.remote.text.Scrubber
import kotlin.math.roundToInt

data class ScrubMark(val turnIndex: Int, val preview: String, val at: Long?)

private val MARK_GAP = 22.dp
private val TRACK_PAD = 16.dp
private val TRACK_W = 30.dp

/**
 * Desktop-style timeline scrubber: one mark per user message on a translucent track at the right
 * edge. Touch and drag right away (the track is excluded from the system back gesture); a tap
 * jumps to the nearest mark. Marks magnify like a dock, and a bubble shows "n / N · time" plus the
 * message. Jumps happen while dragging, so the list follows the finger.
 */
@Composable
fun ScrubberRail(marks: List<ScrubMark>, active: Int, onJump: (Int) -> Unit, modifier: Modifier = Modifier) {
    if (marks.size < 2) return
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    var pointerY by remember { mutableStateOf<Float?>(null) }
    var hover by remember { mutableStateOf<Int?>(null) }
    val jump by rememberUpdatedState(onJump)
    val list by rememberUpdatedState(marks)
    val fg = Pi.c.fg
    val label = stringResource(R.string.scrubber)
    val engaged by animateFloatAsState(if (hover != null) 1f else 0f, label = "rail")
    BoxWithConstraints(modifier.fillMaxHeight()) {
        val n = marks.size
        val pad = with(density) { TRACK_PAD.toPx() }
        val avail = with(density) { maxHeight.toPx() } - pad * 2
        val gap = minOf(with(density) { MARK_GAP.toPx() }, avail / (n - 1))
        val trackH = gap * (n - 1) + pad * 2
        val trackTop = (with(density) { maxHeight.toPx() } - trackH) / 2
        fun markY(i: Int) = pad + i * gap
        fun nearest(y: Float) = ((y - pad) / gap).roundToInt().coerceIn(0, n - 1)

        Box(
            Modifier.align(Alignment.CenterEnd).padding(end = 4.dp).width(TRACK_W).height(with(density) { trackH.toDp() })
                .systemGestureExclusion()
                .clip(RoundedCornerShape(TRACK_W / 2))
                .background(fg.copy(alpha = 0.05f + 0.05f * engaged))
                .semantics { contentDescription = label }
                .pointerInput(n) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        down.consume()
                        fun at(y: Float) {
                            pointerY = y
                            val i = nearest(y)
                            if (i != hover) {
                                hover = i
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                jump(list[i].turnIndex)
                            }
                        }
                        at(down.position.y)
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) break
                            if (change.positionChange() != Offset.Zero) at(change.position.y)
                            change.consume()
                        }
                        hover = null
                        pointerY = null
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                for (i in 0 until n) {
                    val y = markY(i)
                    val lift = when {
                        hover == i -> 1f
                        pointerY == null -> 0f
                        else -> Scrubber.magnify(pointerY!! - y, radius = gap * 2.2f) * 0.6f
                    }
                    val base = if (i == active) 0.55f else 0.24f
                    val w = ((if (i == active) 14f else 10f) + lift * 8f).dp.toPx()
                    drawRoundRect(
                        fg.copy(alpha = minOf(0.85f, base + lift * 0.3f)),
                        Offset((size.width - w) / 2, y - 1.5.dp.toPx()),
                        Size(w, 3.dp.toPx()),
                        CornerRadius(1.5.dp.toPx()),
                    )
                }
            }
        }
        hover?.let { i ->
            val m = marks[i]
            Column(
                Modifier.align(Alignment.TopEnd).offset { IntOffset(-(TRACK_W + 12.dp).roundToPx(), (trackTop + markY(i) - 24.dp.toPx()).roundToInt()) }
                    .width(230.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.bg).border(1.dp, Pi.c.line, RoundedCornerShape(10.dp)).padding(horizontal = 11.dp, vertical = 7.dp),
            ) {
                Text("${i + 1} / ${marks.size}" + (m.at?.let { " · ${clockOf(it)}" } ?: ""), style = Pi.t.small.copy(color = Pi.c.fg3))
                Text(m.preview, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
