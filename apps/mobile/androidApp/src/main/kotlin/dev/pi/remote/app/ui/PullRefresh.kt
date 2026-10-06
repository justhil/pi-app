package dev.pi.remote.app.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshState
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import dev.pi.remote.app.theme.Pi

/** How far the content travels when the pull arms (and while refreshing). */
private val Gap = 56.dp

/**
 * Pull to refresh in the app's quiet style: the list follows the finger and uncovers a thin ring
 * that draws itself with the pull; past the threshold it ticks once and swells a little, then
 * spins until [refreshing] clears and the list springs back. [content] must scroll vertically.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PullRefresh(refreshing: Boolean, onRefresh: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val state = rememberPullToRefreshState()
    val haptic = LocalHapticFeedback.current
    val armed by remember { derivedStateOf { state.distanceFraction >= 1f } }
    LaunchedEffect(armed) { if (armed && !refreshing) haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = modifier,
        state = state,
        indicator = { RefreshRing(state, refreshing, armed, Modifier.align(Alignment.TopCenter)) },
    ) {
        // Past the threshold the list keeps following, but with growing resistance.
        Box(Modifier.fillMaxSize().graphicsLayer { translationY = Gap.toPx() * resist(state.distanceFraction) }) { content() }
    }
}

private fun resist(f: Float): Float = if (f <= 1f) f.coerceAtLeast(0f) else 1f + (1f - 1f / (1f + (f - 1f) * 1.5f)) * 0.6f

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RefreshRing(state: PullToRefreshState, refreshing: Boolean, armed: Boolean, modifier: Modifier) {
    val fg = Pi.c.fg2
    val track = Pi.c.line
    val still = reducedMotion()
    val spin by rememberInfiniteTransition(label = "refresh").animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "refresh")
    val scale by animateFloatAsState(if (armed || refreshing) 1.12f else 1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMedium), label = "swell")
    Box(Modifier.fillMaxWidth().height(Gap).then(modifier), contentAlignment = Alignment.Center) {
        Canvas(
            Modifier.size(20.dp).graphicsLayer {
                val f = state.distanceFraction
                alpha = if (refreshing) 1f else ((f - 0.15f) / 0.6f).coerceIn(0f, 1f)
                scaleX = scale; scaleY = scale
                translationY = Gap.toPx() * (resist(f) - 1f) / 2f
                rotationZ = if (refreshing) (if (still) 0f else spin) else f * 200f
            },
        ) {
            val w = 1.8.dp.toPx()
            val inset = w / 2
            val box = Size(size.width - w, size.height - w)
            drawArc(track, 0f, 360f, false, Offset(inset, inset), box, style = Stroke(w))
            val sweep = if (refreshing) 90f else 300f * state.distanceFraction.coerceIn(0f, 1f)
            drawArc(fg, -90f, sweep, false, Offset(inset, inset), box, style = Stroke(w, cap = StrokeCap.Round))
        }
    }
}
