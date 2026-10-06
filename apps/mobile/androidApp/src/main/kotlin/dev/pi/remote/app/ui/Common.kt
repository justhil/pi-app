package dev.pi.remote.app.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import android.provider.Settings
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons

/** True when the user asked the system for reduced motion (animator scale 0). */
@Composable
fun reducedMotion(): Boolean {
    val ctx = LocalContext.current
    return runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE) == 0f }.getOrDefault(false)
}

@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Pi.c.line))
}

@Composable
fun Dot(color: Color, size: Dp = 7.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

/** 44dp touch target around a 20dp icon. */
@Composable
fun IconAction(icon: ImageVector, description: String, onClick: () -> Unit, tint: Color = Pi.c.fg2, size: Dp = 20.dp, enabled: Boolean = true) {
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { PiIcon(icon, tint.copy(alpha = if (enabled) 1f else 0.4f), size) }
}

@Composable
fun Spinner(color: Color = Pi.c.blue, size: Dp = 14.dp) {
    val still = reducedMotion()
    val angle by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "spin")
    PiIcon(PiIcons.Loader, color, size, Modifier.rotate(if (still) 0f else angle))
}

/** Desktop-style shimmer on live text (static under reduced motion). */
@Composable
fun ShimmerText(text: String, style: TextStyle, modifier: Modifier = Modifier) {
    val base = Pi.c.fg2
    val hi = Pi.c.fg3.copy(alpha = 0.55f)
    if (reducedMotion()) {
        Text(text, style = style.copy(color = base), modifier = modifier, maxLines = 1, overflow = TextOverflow.Ellipsis)
        return
    }
    val x by rememberInfiniteTransition(label = "shimmer").animateFloat(-1f, 2f, infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart), label = "shimmer")
    val brush = Brush.linearGradient(listOf(base, hi, base), start = Offset(x * 400f - 200f, 0f), end = Offset(x * 400f + 200f, 0f))
    Text(text, style = style.copy(brush = brush), modifier = modifier, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
fun TopBar(title: String, subtitle: (@Composable () -> Unit)? = null, onBack: (() -> Unit)? = null, backLabel: String = "", actions: @Composable RowScope.() -> Unit = {}) {
    Column {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) IconAction(PiIcons.ChevronLeft, backLabel, onBack) else Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, style = Pi.t.bodyMedium.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                subtitle?.invoke()
            }
            actions()
        }
        Hairline()
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = modifier.padding(start = 18.dp, end = 18.dp, top = 18.dp, bottom = 6.dp))
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true) {
    Row(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(Pi.c.fg.copy(alpha = if (enabled) 1f else 0.4f)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            PiIcon(icon, Pi.c.bg, 18.dp)
            Spacer(Modifier.width(9.dp))
        }
        Text(text, style = Pi.t.body.copy(color = Pi.c.bg))
    }
}

@Composable
fun QuietButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Pi.c.fg2, icon: ImageVector? = null, enabled: Boolean = true) {
    Row(
        modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 10.dp).alpha(if (enabled) 1f else 0.4f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            PiIcon(icon, color, 14.dp)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = Pi.t.secondary.copy(color = color))
    }
}

/** Compact segmented control (views, scales). Selected = background lift, no bold. */
@Composable
fun Segmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier, fill: Boolean = false) {
    Row(modifier.clip(RoundedCornerShape(8.dp)).background(Pi.c.surface).padding(2.dp)) {
        for ((id, label) in options) {
            val on = id == selected
            Box(
                (if (fill) Modifier.weight(1f) else Modifier).heightIn(min = 30.dp).clip(RoundedCornerShape(6.dp)).background(if (on) Pi.c.bg else Color.Transparent)
                    .clickable(role = Role.RadioButton) { onSelect(id) }.padding(horizontal = 10.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = Pi.t.meta.copy(color = if (on) Pi.c.fg else Pi.c.fg3)) }
        }
    }
}

/** Small quiet switch (38×22). */
@Composable
fun QuietSwitch(on: Boolean, onChange: (Boolean) -> Unit, description: String, enabled: Boolean = true) {
    Box(
        Modifier.size(width = 38.dp, height = 22.dp).clip(RoundedCornerShape(11.dp)).background(if (on) Pi.c.fg else Pi.c.line)
            .clickable(enabled = enabled, role = Role.Switch) { onChange(!on) }.semantics { contentDescription = description }.alpha(if (enabled) 1f else 0.5f),
    ) {
        Box(Modifier.padding(start = if (on) 19.dp else 3.dp, top = 3.dp).size(16.dp).clip(CircleShape).background(Pi.c.bg))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PiSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Pi.c.bg,
        contentColor = Pi.c.fg,
        scrimColor = Pi.c.scrim,
        shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
        tonalElevation = 0.dp,
        dragHandle = { Box(Modifier.padding(top = 8.dp, bottom = 4.dp).size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(Pi.c.line)) },
    ) { content() }
}

/** Plain bordered card used by rich blocks. */
@Composable
fun BlockCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Box(modifier.fillMaxWidth().clip(shape).background(Pi.c.card).border(1.dp, Pi.c.line, shape)) { content() }
}

@Composable
fun Banner(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().background(Pi.c.surface).padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = Pi.t.meta.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f))
        if (action != null) Text(action, style = Pi.t.meta.copy(color = Pi.c.blue), modifier = Modifier.clickable(role = Role.Button, onClick = onAction).padding(6.dp))
    }
}

@Composable
fun MaxWidth(content: @Composable () -> Unit) = Box(Modifier.widthIn(max = 720.dp)) { content() }

/** Re-reads the clock every [periodMs] while [active] (live elapsed times). */
@Composable
fun useTicker(active: Boolean, periodMs: Long = 1000): Long {
    var now by androidx.compose.runtime.remember { androidx.compose.runtime.mutableLongStateOf(System.currentTimeMillis()) }
    androidx.compose.runtime.LaunchedEffect(active) {
        while (active) {
            kotlinx.coroutines.delay(periodMs)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/** Thin top banner only while not connected — never a modal. */
@Composable
fun ConnectionBanner(state: dev.pi.remote.net.HostConnection.State, onRetry: () -> Unit) {
    when (state) {
        is dev.pi.remote.net.HostConnection.State.Backoff -> Banner(androidx.compose.ui.res.stringResource(dev.pi.remote.R.string.conn_reconnecting), androidx.compose.ui.res.stringResource(dev.pi.remote.R.string.conn_retry), onRetry)
        is dev.pi.remote.net.HostConnection.State.Connecting -> if (state.attempt > 0) Banner(androidx.compose.ui.res.stringResource(dev.pi.remote.R.string.conn_reconnecting))
        is dev.pi.remote.net.HostConnection.State.Refused -> Banner(androidx.compose.ui.res.stringResource(dev.pi.remote.R.string.conn_refused))
        else -> Unit
    }
}
