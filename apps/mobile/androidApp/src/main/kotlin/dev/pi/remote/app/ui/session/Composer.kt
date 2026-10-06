package dev.pi.remote.app.ui.session

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import dev.pi.remote.R
import dev.pi.remote.app.data.Attachment
import dev.pi.remote.app.data.ImageSource
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.protocol.PromptQueue

/**
 * Bottom composer. Idle: send = new prompt. Running: send steers the run, long-press queues a
 * follow-up, and the stop button aborts. Model · thinking and tools open their sheets.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Composer(
    text: TextFieldValue,
    onText: (TextFieldValue) -> Unit,
    running: Boolean,
    /** Connected and allowed to write: sending and stopping need it. */
    enabled: Boolean,
    /** Allowed to write at all (operator role). Typing and attaching work while reconnecting. */
    editable: Boolean = enabled,
    modelLabel: String,
    thinkingLabel: String? = null,
    onThinking: () -> Unit = {},
    toolsOn: Int,
    queue: PromptQueue?,
    onSend: (mode: String) -> Unit,
    onStop: () -> Unit,
    onModel: () -> Unit,
    onTools: () -> Unit,
    attachments: List<Attachment> = emptyList(),
    onAttach: () -> Unit = {},
    onRemoveAttachment: (String) -> Unit = {},
    onRetryAttachment: (String) -> Unit = {},
    /** Images pasted or inserted from the keyboard (GIF/sticker keyboards, clipboard). */
    onReceiveUris: (List<android.net.Uri>) -> Unit = {},
) {
    val haptic = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth().background(Pi.c.bg)) {
        Hairline()
        Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val queued = queue?.let { it.steering + it.followUp }.orEmpty()
            queued.takeLast(2).forEach { q ->
                Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    PiIcon(PiIcons.Queue, Pi.c.fg3, 13.dp)
                    Spacer(Modifier.width(7.dp))
                    Text(stringResource(R.string.queued, q), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (attachments.isNotEmpty()) AttachmentRow(attachments, onRemoveAttachment, onRetryAttachment)
            val label = stringResource(R.string.composer_label)
            Box(Modifier.fillMaxWidth().heightIn(min = 44.dp, max = 160.dp).clip(RoundedCornerShape(20.dp)).background(Pi.c.surface).padding(horizontal = 15.dp, vertical = 11.dp)) {
                if (text.text.isEmpty()) Text(stringResource(if (running) R.string.composer_hint_running else R.string.composer_hint_idle), style = Pi.t.body.copy(color = Pi.c.fg3))
                BasicTextField(
                    text, onText, enabled = editable, textStyle = Pi.t.body.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = label }.contentReceiver { content ->
                        if (!content.hasMediaType(MediaType.Image)) return@contentReceiver content
                        val uris = mutableListOf<android.net.Uri>()
                        val rest = content.consume { item -> item.uri?.also { uris += it } != null }
                        if (uris.isNotEmpty()) onReceiveUris(uris)
                        rest
                    },
                )
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(36.dp).clip(CircleShape).clickable(enabled = editable, role = Role.Button, onClick = onAttach),
                    contentAlignment = Alignment.Center,
                ) { PiIcon(PiIcons.Plus, Pi.c.fg2, 18.dp, contentDescription = stringResource(R.string.attach)) }
                Row(Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onModel).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(modelLabel, style = Pi.t.secondary.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.width(4.dp))
                    PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 12.dp)
                }
                if (thinkingLabel != null) {
                    Row(
                        Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onThinking).padding(horizontal = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PiIcon(PiIcons.Bulb, Pi.c.fg3, 14.dp)
                        Spacer(Modifier.width(4.dp))
                        Text(thinkingLabel, style = Pi.t.secondary.copy(color = Pi.c.fg2), maxLines = 1)
                    }
                }
                val toolsDesc = stringResource(R.string.tools_count, toolsOn)
                Row(
                    Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onTools).semantics { contentDescription = toolsDesc }.padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PiIcon(PiIcons.Sparkles, Pi.c.fg2, 16.dp)
                    if (toolsOn > 0) {
                        Spacer(Modifier.width(3.dp))
                        Text("$toolsOn", style = Pi.t.meta.copy(color = Pi.c.fg2))
                    }
                }
                Spacer(Modifier.weight(1f))
                if (running) {
                    Box(
                        Modifier.size(36.dp).clip(CircleShape).border(1.dp, Pi.c.line, CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onStop),
                        contentAlignment = Alignment.Center,
                    ) { PiIcon(PiIcons.Stop, Pi.c.fg, 13.dp, contentDescription = stringResource(R.string.stop)) }
                    Spacer(Modifier.width(8.dp))
                }
                val canSend = enabled && (text.text.isNotBlank() || attachments.any { it.status == Attachment.Status.Ready }) && attachments.none { it.status == Attachment.Status.Failed }
                val sendDesc = stringResource(if (running) R.string.send_steer else R.string.send)
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(Pi.c.fg.copy(alpha = if (canSend) 1f else 0.35f))
                        .combinedClickable(
                            enabled = canSend,
                            role = Role.Button,
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSend(if (running) "steer" else "prompt")
                            },
                            onLongClick = {
                                if (running) {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onSend("followUp")
                                }
                            },
                        ).semantics { contentDescription = sendDesc },
                    contentAlignment = Alignment.Center,
                ) { PiIcon(PiIcons.ArrowUp, Pi.c.bg, 17.dp) }
            }
        }
    }
}

/** Thumbnails (photos) or name tiles (files) with remove; failed uploads retry on tap. */
@Composable
private fun AttachmentRow(items: List<Attachment>, onRemove: (String) -> Unit, onRetry: (String) -> Unit) {
    var viewing by remember { mutableStateOf<Int?>(null) }
    val photos = items.filter { it.thumb != null }
    viewing?.let { start -> ImageViewer(photos.map { ImageSource.Local(it.uri) }, start, onDismiss = { viewing = null }) }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (a in items) {
            val shape = RoundedCornerShape(10.dp)
            val failed = a.status == Attachment.Status.Failed
            Box(
                Modifier.size(width = if (a.thumb != null) 56.dp else 132.dp, height = 56.dp).clip(shape).background(Pi.c.surface)
                    .border(1.dp, if (failed) Pi.c.bad else Pi.c.line, shape)
                    .clickable(enabled = failed || a.thumb != null, role = Role.Button) {
                        if (failed) onRetry(a.id) else viewing = photos.indexOf(a).coerceAtLeast(0)
                    },
            ) {
                if (a.thumb != null) {
                    Image(a.thumb, a.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(), alpha = if (a.status == Attachment.Status.Ready) 1f else 0.45f)
                } else {
                    Row(Modifier.fillMaxSize().padding(start = 9.dp, end = 22.dp), verticalAlignment = Alignment.CenterVertically) {
                        PiIcon(PiIcons.File, Pi.c.fg3, 15.dp)
                        Spacer(Modifier.width(6.dp))
                        Text(a.name, style = Pi.t.meta.copy(color = if (a.status == Attachment.Status.Ready) Pi.c.fg2 else Pi.c.fg3), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
                when (a.status) {
                    Attachment.Status.Uploading -> PiIcon(PiIcons.Loader, Pi.c.fg2, 14.dp, Modifier.align(Alignment.BottomStart).padding(5.dp))
                    Attachment.Status.Failed -> PiIcon(PiIcons.Alert, Pi.c.bad, 14.dp, Modifier.align(Alignment.BottomStart).padding(5.dp), contentDescription = a.error ?: stringResource(R.string.attach_failed))
                    Attachment.Status.Ready -> {}
                }
                Box(
                    Modifier.align(Alignment.TopEnd).size(22.dp).clickable(role = Role.Button) { onRemove(a.id) },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(16.dp).clip(CircleShape).background(Pi.c.bg.copy(alpha = 0.85f)), contentAlignment = Alignment.Center) {
                        PiIcon(PiIcons.X, Pi.c.fg2, 10.dp, contentDescription = stringResource(R.string.attach_remove))
                    }
                }
            }
        }
    }
}
