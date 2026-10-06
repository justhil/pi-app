package dev.pi.remote.app.ui.session

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.pi.remote.R
import dev.pi.remote.app.data.PromptAttachments
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.rich.MermaidSource
import dev.pi.remote.app.ui.rich.RichContent
import dev.pi.remote.protocol.Turn

/** Raw text of a message part, as it should be copied or shared (markdown for replies). */
fun Turn.textOf(part: MessagePart): String = when (part) {
    MessagePart.User -> user.text
    MessagePart.Answer -> answer
}

fun shareText(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, null))
}

/**
 * One message full screen, text selectable. Reads the live turn, so a streaming reply keeps
 * growing while it is open.
 */
@Composable
fun MessageViewer(turn: Turn, part: MessagePart, mermaid: MermaidSource?, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val text = turn.textOf(part)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Pi.c.bg).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconAction(PiIcons.X, stringResource(R.string.close), onDismiss)
                Text(
                    stringResource(if (part == MessagePart.User) R.string.msg_user else R.string.msg_answer),
                    style = Pi.t.bodyMedium.copy(color = Pi.c.fg),
                    modifier = Modifier.weight(1f).padding(start = 6.dp),
                )
                IconAction(PiIcons.Copy, stringResource(R.string.copy), { clipboard.setText(AnnotatedString(text)) })
                IconAction(PiIcons.Share, stringResource(R.string.msg_share), { shareText(context, text) })
            }
            Hairline()
            SelectionContainer(Modifier.weight(1f)) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 16.dp)) {
                    when (part) {
                        MessagePart.User -> {
                            val body = remember(text) { PromptAttachments.split(text) }
                            body.second.forEach { r -> Text(r.name, style = Pi.t.meta.copy(color = Pi.c.fg3)) }
                            if (body.second.isNotEmpty()) Spacer(Modifier.padding(top = 8.dp))
                            Text(body.first, style = Pi.t.body.copy(color = Pi.c.fg))
                        }
                        MessagePart.Answer -> RichContent(text, streaming = turn.running, mermaid = mermaid)
                    }
                }
            }
        }
    }
}

/** Long-press menu for a message. */
@Composable
fun MessageActionsSheet(
    turn: Turn,
    part: MessagePart,
    canEdit: Boolean,
    onFullscreen: () -> Unit,
    onEdit: (String) -> Unit,
    onDismiss: () -> Unit,
    /** Turns after this one (they leave the branch too); null hides rewind. */
    rewindLater: Int? = null,
    onRewind: () -> Unit = {},
    /** Fork into a new session before this message; null hides it. */
    onFork: (() -> Unit)? = null,
) {
    var confirmRewind by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val text = turn.textOf(part)
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 14.dp)) {
            Text(
                PromptAttachments.split(text).first.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty(),
                style = Pi.t.secondary.copy(color = Pi.c.fg3),
                maxLines = 2,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            ActionRow(PiIcons.Copy, stringResource(R.string.copy)) {
                clipboard.setText(AnnotatedString(text))
                onDismiss()
            }
            ActionRow(PiIcons.TextSelect, stringResource(R.string.msg_select)) { onFullscreen() }
            ActionRow(PiIcons.Share, stringResource(R.string.msg_share)) {
                shareText(context, text)
                onDismiss()
            }
            if (part == MessagePart.User && canEdit) {
                ActionRow(PiIcons.Pencil, stringResource(R.string.msg_edit)) {
                    onEdit(text)
                    onDismiss()
                }
            }
            if (onFork != null) {
                ActionRow(PiIcons.Fork, stringResource(R.string.msg_fork)) {
                    onFork()
                    onDismiss()
                }
            }
            if (rewindLater != null) {
                ActionRow(PiIcons.Undo, stringResource(R.string.msg_rewind)) { confirmRewind = !confirmRewind }
                AnimatedVisibility(confirmRewind, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                    Row(Modifier.fillMaxWidth().padding(start = 51.dp, end = 16.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (rewindLater > 0) stringResource(R.string.msg_rewind_hint_more, rewindLater) else stringResource(R.string.msg_rewind_hint),
                            style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            stringResource(R.string.msg_rewind_confirm),
                            style = Pi.t.secondary.copy(color = Pi.c.bg),
                            modifier = Modifier.clip(RoundedCornerShape(16.dp)).background(Pi.c.fg).clickable(role = Role.Button) {
                                onRewind()
                                onDismiss()
                            }.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start,
    ) {
        PiIcon(icon, Pi.c.fg2, 17.dp)
        Spacer(Modifier.width(14.dp))
        Text(label, style = Pi.t.body.copy(color = Pi.c.fg))
    }
}

/** Attach menu: native camera, system photo picker, any file. */
@Composable
fun AttachSheet(onCamera: () -> Unit, onPhotos: () -> Unit, onFiles: () -> Unit, onDismiss: () -> Unit) {
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 14.dp)) {
            ActionRow(PiIcons.Camera, stringResource(R.string.attach_camera)) { onDismiss(); onCamera() }
            ActionRow(PiIcons.Image, stringResource(R.string.attach_photos)) { onDismiss(); onPhotos() }
            ActionRow(PiIcons.Paperclip, stringResource(R.string.attach_files)) { onDismiss(); onFiles() }
        }
    }
}
