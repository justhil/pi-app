package dev.pi.remote.app.ui.session

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.protocol.BranchInfo

/**
 * The session's branches (rewinds and forks-in-place leave turns on other branches). Tap one to
 * switch, with an inline confirm; viewers and running sessions only look.
 */
@Composable
fun BranchSheet(branches: List<BranchInfo>?, failed: Boolean, canSwitch: Boolean, running: Boolean, onSwitch: (String) -> Unit, onDismiss: () -> Unit) {
    var confirming by remember { mutableStateOf<String?>(null) }
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 14.dp)) {
            Text(stringResource(R.string.branches_title), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            when {
                branches == null && !failed -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Spinner(Pi.c.fg3, 16.dp) }
                branches == null -> Text(stringResource(R.string.branches_failed), style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
                else -> Column(Modifier.verticalScroll(rememberScrollState())) {
                    if (running && canSwitch && branches.size > 1) {
                        Text(stringResource(R.string.branches_running), style = Pi.t.meta.copy(color = Pi.c.warn), modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                    }
                    for ((i, b) in branches.withIndex()) {
                        if (i > 0) Hairline(Modifier.padding(start = 51.dp))
                        BranchRow(b, enabled = canSwitch && !running && !b.current, onClick = { confirming = if (confirming == b.leafId) null else b.leafId })
                        AnimatedVisibility(confirming == b.leafId, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                            Row(Modifier.fillMaxWidth().padding(start = 51.dp, end = 16.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.branches_switch_hint), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    stringResource(R.string.branches_switch),
                                    style = Pi.t.secondary.copy(color = Pi.c.bg),
                                    modifier = Modifier.clip(RoundedCornerShape(16.dp)).background(Pi.c.fg).clickable(role = Role.Button) {
                                        onSwitch(b.leafId)
                                        onDismiss()
                                    }.padding(horizontal = 14.dp, vertical = 8.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BranchRow(b: BranchInfo, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        PiIcon(PiIcons.Branch, if (b.current) Pi.c.fg else Pi.c.fg3, 16.dp, Modifier.padding(top = 2.dp))
        Spacer(Modifier.width(15.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(b.title, style = Pi.t.body.copy(color = if (b.current) Pi.c.fg else Pi.c.fg2), maxLines = 2, overflow = TextOverflow.Ellipsis)
            b.reply?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            val meta = listOfNotNull(pluralStringResource(R.plurals.branches_turns, b.turns, b.turns), b.updatedAt?.let { formatAgo(it) }).joinToString(" · ")
            Text(meta, style = Pi.t.meta.copy(color = Pi.c.fg3))
            b.divergedAt?.let { Text(stringResource(R.string.branches_diverged, it), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (b.current) {
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.branches_current), style = Pi.t.meta.copy(color = Pi.c.fg2))
        }
    }
}
