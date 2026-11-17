package dev.pi.remote.app.ui.session

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.rich.FileTarget
import dev.pi.remote.app.ui.rich.highlight
import dev.pi.remote.protocol.FileReadResult

private const val PREVIEW_CHAR_DP = 7.3f

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FilePreviewScreen(
    target: FileTarget,
    canWrite: Boolean,
    load: suspend (String) -> Result<FileReadResult>,
    onInsert: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var result by remember(target.path) { mutableStateOf<Result<FileReadResult>?>(null) }
    var selFrom by remember(target) { mutableStateOf(target.lineStart?.minus(1)?.coerceAtLeast(0)) }
    var selTo by remember(target) { mutableStateOf((target.lineEnd ?: target.lineStart)?.minus(1)?.coerceAtLeast(0)) }
    var commenting by remember { mutableStateOf(false) }
    var commentDraft by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current
    val haptic = LocalHapticFeedback.current
    val listState = rememberLazyListState()
    val tokens = Pi.c

    LaunchedEffect(target.path) { result = load(target.path) }

    val loaded = result?.getOrNull()
    val lines = remember(loaded?.content) { loaded?.content?.lines().orEmpty() }
    val lang = remember(target.path) { target.path.substringAfterLast('.', "").lowercase() }

    LaunchedEffect(lines.size, target.lineStart) {
        if (lines.isNotEmpty() && target.lineStart != null) {
            val idx = (target.lineStart - 1).coerceIn(0, lines.lastIndex)
            selFrom = idx
            selTo = ((target.lineEnd ?: target.lineStart) - 1).coerceIn(idx, lines.lastIndex)
            listState.scrollToItem((idx - 4).coerceAtLeast(0))
        }
    }

    fun clearSelection() {
        selFrom = null
        selTo = null
        commenting = false
        commentDraft = ""
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler {
            if (commenting) commenting = false
            else if (selFrom != null && target.lineStart == null) clearSelection()
            else onDismiss()
        }
        Column(Modifier.fillMaxSize().background(Pi.c.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 4.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconAction(PiIcons.X, stringResource(R.string.close), onDismiss)
                Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    Text(target.path.substringAfterLast('/'), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val meta = buildList {
                        val dir = target.path.substringBeforeLast('/', "")
                        if (dir.isNotEmpty()) add(dir)
                        loaded?.takeIf { it.binary != true }?.let { add(formatSize(it.size)) }
                    }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (loaded != null && loaded.binary != true && loaded.content.isNotEmpty()) {
                    IconAction(PiIcons.Copy, stringResource(R.string.copy), { clipboard.setText(AnnotatedString(loaded.content)) })
                }
            }
            Hairline()

            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    result == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner(Pi.c.fg3, 16.dp) }
                    loaded == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                        Text(result?.exceptionOrNull()?.message ?: stringResource(R.string.file_preview_failed), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    }
                    loaded.binary == true -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.review_binary), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    }
                    lines.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.files_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    }
                    else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                        val gutterChars = remember(lines.size) { lines.size.toString().length.coerceAtLeast(2) }
                        val maxCols = remember(lines) { lines.maxOfOrNull { it.length } ?: 0 }
                        val rowWidth = maxOf(maxWidth.value, (gutterChars + 3 + maxCols) * PREVIEW_CHAR_DP + 24f).dp
                        val a = selFrom?.let { f -> minOf(f, selTo ?: f) }
                        val b = selFrom?.let { f -> maxOf(f, selTo ?: f) }
                        Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
                            LazyColumn(state = listState, modifier = Modifier.width(rowWidth).fillMaxHeight()) {
                                itemsIndexed(lines, key = { i, _ -> i }) { i, line ->
                                    val selected = a != null && b != null && i in a..b
                                    val styled = remember(line, lang, tokens) {
                                        if (line.length <= 400) highlight(line, lang, tokens) else AnnotatedString(line)
                                    }
                                    Row(
                                        Modifier.fillMaxWidth()
                                            .background(if (selected) Pi.c.blue.copy(alpha = 0.14f) else Pi.c.bg)
                                            .combinedClickable(
                                                onClick = { if (selFrom != null && !commenting) selTo = i },
                                                onLongClick = {
                                                    if (!canWrite) return@combinedClickable
                                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                    selFrom = i
                                                    selTo = i
                                                    commenting = false
                                                },
                                            )
                                            .padding(start = 8.dp, end = 14.dp)
                                            .heightIn(min = 21.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Box(Modifier.width(3.dp).height(17.dp).background(if (selected) Pi.c.blue else Pi.c.bg.copy(alpha = 0f)))
                                        Spacer(Modifier.width(6.dp))
                                        Text((i + 1).toString().padStart(gutterChars), style = Pi.t.mono.copy(color = if (selected) Pi.c.fg else Pi.c.fg3, fontSize = 11.sp), maxLines = 1, softWrap = false)
                                        Spacer(Modifier.width(12.dp))
                                        Text(styled, style = Pi.t.mono.copy(color = Pi.c.fg, fontSize = 12.sp), maxLines = 1, softWrap = false)
                                    }
                                }
                                if (loaded.truncated) {
                                    item("trunc") {
                                        Text(stringResource(R.string.review_truncated), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                                    }
                                }
                                item("bottom") { Spacer(Modifier.height(24.dp)) }
                            }
                        }
                    }
                }
            }

            val from = selFrom
            val to = selTo
            AnimatedVisibility(
                visible = canWrite && loaded != null && loaded.binary != true && from != null && to != null && lines.isNotEmpty(),
                enter = fadeIn(tween(120)) + slideInVertically(spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium)) { it },
                exit = fadeOut(tween(100)) + slideOutVertically(tween(120)) { it },
            ) {
                if (from != null && to != null && lines.isNotEmpty()) {
                    val startLine = minOf(from, to).coerceIn(0, lines.lastIndex) + 1
                    val endLine = maxOf(from, to).coerceIn(0, lines.lastIndex) + 1
                    val rangeLabel = if (startLine == endLine) "$startLine" else "$startLine-$endLine"
                    val refTarget = FileTarget(loaded!!.path, startLine, endLine)
                    val focus = remember { FocusRequester() }
                    LaunchedEffect(commenting) { if (commenting) runCatching { focus.requestFocus() } }

                    Column {
                        Hairline()
                        if (!commenting) {
                            Row(
                                Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(stringResource(R.string.review_lines, rangeLabel), style = Pi.t.secondary.copy(color = Pi.c.fg2))
                                    Text(stringResource(R.string.review_extend_hint), style = Pi.t.meta.copy(color = Pi.c.fg3))
                                }
                                QuietButton(stringResource(R.string.cancel), color = Pi.c.fg3, onClick = ::clearSelection)
                                QuietButton(stringResource(R.string.file_preview_cite), color = Pi.c.fg, onClick = {
                                    onInsert(refTarget.mentionRef())
                                    onDismiss()
                                })
                                QuietButton(stringResource(R.string.review_comment), color = Pi.c.blue, onClick = { commenting = true })
                            }
                        } else {
                            Column(
                                Modifier.fillMaxWidth().padding(start = 14.dp, end = 10.dp, top = 8.dp, bottom = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text("${loaded.path}:$rangeLabel", style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 4.dp))
                                Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp)) {
                                    if (commentDraft.isEmpty()) Text(stringResource(R.string.review_comment_hint), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                                    BasicTextField(
                                        value = commentDraft,
                                        onValueChange = { commentDraft = it },
                                        textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                                        cursorBrush = SolidColor(Pi.c.fg),
                                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                                    )
                                }
                                Row(Modifier.align(Alignment.End)) {
                                    QuietButton(stringResource(R.string.cancel), color = Pi.c.fg3, onClick = { commenting = false })
                                    QuietButton(
                                        stringResource(R.string.review_insert),
                                        color = Pi.c.fg,
                                        enabled = commentDraft.isNotBlank(),
                                        onClick = {
                                            val quoted = lines.subList(startLine - 1, endLine).take(12).joinToString("") { "\n  > $it" }
                                            onInsert("- ${loaded.path}:$rangeLabel: ${commentDraft.trim()}$quoted")
                                            onDismiss()
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
