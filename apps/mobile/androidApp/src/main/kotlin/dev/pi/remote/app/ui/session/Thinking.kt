package dev.pi.remote.app.ui.session

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.ui.PiSheet
import kotlinx.coroutines.launch
import kotlin.math.abs

/** pi's thinking scale, as on the desktop (`THINKING_LEVELS`). Names stay English. */
val THINKING_LEVELS = listOf("off", "minimal", "low", "medium", "high", "xhigh", "max")

fun thinkingLabel(level: String?): String = when (level) {
    null, "" -> "Off"
    "xhigh" -> "XHigh"
    else -> level.replaceFirstChar { it.uppercase() }
}

@Composable
private fun thinkingDesc(level: String): String = stringResource(
    when (level) {
        "off" -> R.string.think_off
        "minimal" -> R.string.think_minimal
        "low" -> R.string.think_low
        "medium" -> R.string.think_medium
        "high" -> R.string.think_high
        "xhigh" -> R.string.think_xhigh
        else -> R.string.think_max
    },
)

/** Nearest usable stop to a 0..1 position (desktop `nearestUsableStop`). */
private fun nearestUsable(frac: Float, usable: List<Boolean>): Int {
    val n = usable.size
    var best = -1
    var bestD = Float.MAX_VALUE
    for (i in 0 until n) {
        if (!usable[i]) continue
        val d = abs(frac - i / (n - 1f))
        if (d < bestD) { bestD = d; best = i }
    }
    return best
}

/**
 * Desktop thinking slider: one stop per level, unsupported stops hollow and skipped. The thumb
 * follows the finger while dragging, snaps to the nearest usable stop with a spring, and every stop
 * crossed ticks the haptics. Commit happens on release (or on tap).
 */
@Composable
fun ThinkingSlider(current: String?, available: List<String>, enabled: Boolean, onCommit: (String) -> Unit, modifier: Modifier = Modifier) {
    val usable = THINKING_LEVELS.map { available.isEmpty() || it in available }
    val currentIndex = THINKING_LEVELS.indexOf(current ?: "off").coerceAtLeast(0)
    val pos = remember { Animatable(currentIndex.toFloat()) }
    var preview by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val commit by rememberUpdatedState(onCommit)
    val n = THINKING_LEVELS.size
    LaunchedEffect(currentIndex) { if (preview == null) pos.animateTo(currentIndex.toFloat(), spring(dampingRatio = 0.78f, stiffness = Spring.StiffnessMediumLow)) }

    val shown = preview ?: currentIndex
    val fg = Pi.c.fg
    val bg = Pi.c.bg
    val line = Pi.c.fg.copy(alpha = 0.10f)
    val label = stringResource(R.string.thinking)
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
            Text(label, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
            Text(thinkingLabel(THINKING_LEVELS[shown]), style = Pi.t.secondary.copy(color = Pi.c.fg))
        }
        Canvas(
            Modifier.fillMaxWidth().height(40.dp)
                .semantics {
                    contentDescription = label
                    stateDescription = thinkingLabel(THINKING_LEVELS[shown])
                    progressBarRangeInfo = ProgressBarRangeInfo(shown.toFloat(), 0f..(n - 1f), steps = n - 2)
                    setProgress { v ->
                        val i = nearestUsable(v / (n - 1), usable)
                        if (i >= 0 && enabled) commit(THINKING_LEVELS[i])
                        i >= 0
                    }
                }
                .pointerInput(enabled, usable) {
                    if (!enabled) return@pointerInput
                    val inset = 12.dp.toPx()
                    fun frac(x: Float) = ((x - inset) / (size.width - inset * 2)).coerceIn(0f, 1f)
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        var last = nearestUsable(frac(down.position.x), usable)
                        if (last < 0) return@awaitEachGesture
                        preview = last
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        scope.launch { pos.animateTo(last.toFloat(), spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMedium)) }
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            ch.consume()
                            val f = frac(ch.position.x)
                            // Thumb tracks the finger; the value snaps to stops.
                            scope.launch { pos.snapTo(f * (n - 1)) }
                            val i = nearestUsable(f, usable)
                            if (i >= 0 && i != last) {
                                last = i
                                preview = i
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            }
                        }
                        val target = last
                        scope.launch {
                            pos.animateTo(target.toFloat(), spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow))
                        }
                        preview = null
                        if (target != currentIndex) {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            commit(THINKING_LEVELS[target])
                        }
                    }
                },
        ) {
            val inset = 12.dp.toPx()
            val w = size.width - inset * 2
            val cy = size.height / 2
            val x = { i: Float -> inset + w * i / (n - 1) }
            drawLine(line, Offset(inset, cy), Offset(inset + w, cy), 3.dp.toPx(), StrokeCap.Round)
            drawLine(fg.copy(alpha = 0.65f), Offset(inset, cy), Offset(x(pos.value), cy), 3.dp.toPx(), StrokeCap.Round)
            for (i in 0 until n) {
                if (i <= pos.value + 0.01f && usable[i]) continue
                val c = Offset(x(i.toFloat()), cy)
                if (usable[i]) drawCircle(fg.copy(alpha = 0.3f), 2.dp.toPx(), c)
                else {
                    drawCircle(bg, 2.5.dp.toPx(), c)
                    drawCircle(fg.copy(alpha = 0.3f), 2.5.dp.toPx(), c, style = Stroke(1.dp.toPx()))
                }
            }
            val pressed = preview != null
            val r = (if (pressed) 9.5f else 8f).dp.toPx()
            val tc = Offset(x(pos.value), cy)
            drawCircle(fg.copy(alpha = 0.10f), r + 1.5.dp.toPx(), tc.copy(y = tc.y + 1.dp.toPx()))
            drawCircle(bg, r, tc)
            drawCircle(fg.copy(alpha = 0.15f), r, tc, style = Stroke(1.dp.toPx()))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
            Text(thinkingLabel("off"), style = Pi.t.small.copy(color = Pi.c.fg3))
            Spacer(Modifier.weight(1f))
            Text(thinkingLabel("max"), style = Pi.t.small.copy(color = Pi.c.fg3))
        }
        Text(
            if (usable[shown]) thinkingDesc(THINKING_LEVELS[shown]) else stringResource(R.string.think_unsupported),
            style = Pi.t.meta.copy(color = Pi.c.fg2),
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
        )
    }
}

@Composable
fun ThinkingSheet(current: String?, available: List<String>, canWrite: Boolean, onCommit: (String) -> Unit, onDismiss: () -> Unit) {
    PiSheet(onDismiss) {
        ThinkingSlider(current, available, canWrite, onCommit, Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 18.dp))
    }
}
