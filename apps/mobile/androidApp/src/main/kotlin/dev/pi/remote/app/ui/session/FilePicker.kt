package dev.pi.remote.app.ui.session

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.protocol.FileEntry
import dev.pi.remote.protocol.FileListResult
import kotlinx.coroutines.delay

/** Desktop `fileReference`: `@path`, quoted when the path has whitespace. */
fun fileMention(path: String): String {
    val p = path.replace('\\', '/')
    return if (p.none { it.isWhitespace() }) "@$p" else "@\"" + p.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

/** Insert mentions at the cursor, keeping one space on each side. */
fun insertMentions(v: TextFieldValue, paths: List<String>): TextFieldValue {
    if (paths.isEmpty()) return v
    val at = v.selection.end.coerceIn(0, v.text.length)
    val before = v.text.substring(0, at)
    val after = v.text.substring(at)
    val lead = if (before.isNotEmpty() && !before.last().isWhitespace()) " " else ""
    val chunk = lead + paths.joinToString(" ") { fileMention(it) } + if (after.firstOrNull()?.isWhitespace() == true) "" else " "
    return TextFieldValue(before + chunk + after, TextRange(at + chunk.length))
}

fun formatSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
    else -> "%.1f MB".format(bytes / 1048576.0)
}

/**
 * Floating file manager over the session (the composer's `@` button): browse the project folder by
 * folder or search it, tick files (long-press ticks a folder), insert them as `@path` mentions.
 * Back goes up a folder before it closes.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FilePicker(
    projectName: String,
    load: suspend (String) -> FileListResult?,
    search: suspend (String) -> List<FileEntry>?,
    onInsert: (List<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val shown = remember { MutableTransitionState(false).apply { targetState = true } }
    var closing by remember { mutableStateOf(false) }
    fun close() {
        closing = true
        shown.targetState = false
    }
    LaunchedEffect(shown.currentState, shown.isIdle) { if (closing && shown.isIdle && !shown.currentState) onDismiss() }

    var path by remember { mutableStateOf("") }
    var forward by remember { mutableStateOf(true) }
    val cache = remember { mutableStateMapOf<String, FileListResult>() }
    val failed = remember { mutableStateMapOf<String, Boolean>() }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<FileEntry>?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    val haptic = LocalHapticFeedback.current

    LaunchedEffect(path) {
        if (path !in cache) {
            failed.remove(path)
            load(path.ifEmpty { "." })?.let { cache[path] = it } ?: run { failed[path] = true }
        }
    }
    LaunchedEffect(query) {
        if (query.isBlank()) {
            results = null
            return@LaunchedEffect
        }
        delay(180)
        results = search(query.trim()).orEmpty()
    }
    fun open(dir: String) {
        forward = true
        path = dir
    }
    fun up() {
        forward = false
        path = path.substringBeforeLast('/', "")
    }
    fun toggle(p: String) {
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        if (p in picked) picked.remove(p) else picked.add(p)
    }

    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        // Inside the dialog: its window receives back, not the activity.
        BackHandler {
            when {
                query.isNotEmpty() -> query = ""
                path.isNotEmpty() -> up()
                else -> close()
            }
        }
        Box(
            Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = ::close)
                .statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 16.dp),
            contentAlignment = Alignment.BottomCenter,
        ) {
            AnimatedVisibility(
                shown,
                enter = fadeIn(tween(160)) + scaleIn(spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow), initialScale = 0.94f) +
                    slideInVertically(spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)) { it / 12 },
                exit = fadeOut(tween(120)) + scaleOut(tween(140), targetScale = 0.96f) + slideOutVertically(tween(140)) { it / 16 },
            ) {
                val shape = RoundedCornerShape(20.dp)
                val maxH = (LocalConfiguration.current.screenHeightDp * 0.74f).dp
                Column(
                    Modifier.fillMaxWidth().heightIn(max = maxH).shadow(18.dp, shape, ambientColor = Pi.c.fg.copy(alpha = 0.25f), spotColor = Pi.c.fg.copy(alpha = 0.25f))
                        .clip(shape).background(Pi.c.bg).border(1.dp, Pi.c.line, shape)
                        // Swallow taps so they do not reach the dismiss layer.
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
                ) {
                    Breadcrumbs(projectName, path, onJump = { target ->
                        if (target != path) {
                            forward = target.length > path.length
                            path = target
                        }
                    }, onClose = ::close)
                    Row(
                        Modifier.padding(horizontal = 12.dp).padding(bottom = 8.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PiIcon(PiIcons.Search, Pi.c.fg3, 14.dp)
                        Spacer(Modifier.width(8.dp))
                        Box(Modifier.weight(1f)) {
                            if (query.isEmpty()) Text(stringResource(R.string.files_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                            BasicTextField(query, { query = it }, textStyle = Pi.t.secondary.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
                        }
                        if (query.isNotEmpty()) PiIcon(PiIcons.X, Pi.c.fg3, 14.dp, Modifier.clip(CircleShape).clickable(role = Role.Button) { query = "" })
                    }
                    Hairline()
                    Box(Modifier.weight(1f, fill = false).heightIn(min = 240.dp)) {
                        if (query.isNotBlank()) {
                            val r = results
                            when {
                                r == null -> Centered { Spinner(Pi.c.fg3, 16.dp) }
                                r.isEmpty() -> Centered { Text(stringResource(R.string.files_none), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
                                else -> LazyColumn(Modifier.fillMaxWidth()) {
                                    items(r, key = { "s" + it.path }) { e ->
                                        EntryRow(e, e.path in picked, showPath = true, onClick = { if (e.dir) { query = ""; open(e.path) } else toggle(e.path) }, onLongClick = { toggle(e.path) }, modifier = Modifier.animateItem())
                                    }
                                }
                            }
                        } else {
                            AnimatedContent(
                                path,
                                transitionSpec = {
                                    val dir = if (forward) 1 else -1
                                    (slideInHorizontally(spring(dampingRatio = 0.92f, stiffness = Spring.StiffnessMediumLow)) { dir * it / 3 } + fadeIn(tween(180))) togetherWith
                                        (slideOutHorizontally(tween(160)) { -dir * it / 4 } + fadeOut(tween(120)))
                                },
                                label = "folder",
                            ) { dir ->
                                val listing = cache[dir]
                                when {
                                    listing != null && listing.entries.isEmpty() -> Centered { Text(stringResource(R.string.files_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
                                    listing != null -> LazyColumn(Modifier.fillMaxWidth()) {
                                        items(listing.entries, key = { it.path }) { e ->
                                            EntryRow(e, e.path in picked, showPath = false, onClick = { if (e.dir) open(e.path) else toggle(e.path) }, onLongClick = { toggle(e.path) })
                                        }
                                        if (listing.truncated) item("more") {
                                            Text(stringResource(R.string.files_truncated), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                                        }
                                    }
                                    failed[dir] == true -> Centered { Text(stringResource(R.string.files_failed), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
                                    else -> Centered { Spinner(Pi.c.fg3, 16.dp) }
                                }
                            }
                        }
                    }
                    AnimatedVisibility(
                        picked.isNotEmpty(),
                        enter = fadeIn(tween(140)) + slideInVertically(spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMedium)) { it },
                        exit = fadeOut(tween(100)) + slideOutVertically(tween(140)) { it },
                    ) {
                        Column {
                            Hairline()
                            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    picked.joinToString("  ") { it.substringAfterLast('/') },
                                    style = Pi.t.meta.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    stringResource(R.string.files_insert, picked.size),
                                    style = Pi.t.secondary.copy(color = Pi.c.bg),
                                    modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(Pi.c.fg).clickable(role = Role.Button) {
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        onInsert(picked.toList())
                                        close()
                                    }.padding(horizontal = 16.dp, vertical = 9.dp),
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
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 240.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun Breadcrumbs(projectName: String, path: String, onJump: (String) -> Unit, onClose: () -> Unit) {
    val scroll = rememberScrollState()
    LaunchedEffect(path) { scroll.animateScrollTo(scroll.maxValue) }
    val segments = if (path.isEmpty()) emptyList() else path.split('/')
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp, top = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(scroll), verticalAlignment = Alignment.CenterVertically) {
            Crumb(projectName.ifEmpty { "/" }, current = segments.isEmpty()) { onJump("") }
            segments.forEachIndexed { i, s ->
                PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 11.dp)
                Crumb(s, current = i == segments.lastIndex) { onJump(segments.take(i + 1).joinToString("/")) }
            }
        }
        Box(Modifier.size(36.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClose), contentAlignment = Alignment.Center) {
            PiIcon(PiIcons.X, Pi.c.fg2, 15.dp, contentDescription = stringResource(R.string.close))
        }
    }
}

@Composable
private fun Crumb(text: String, current: Boolean, onClick: () -> Unit) {
    Text(
        text,
        style = (if (current) Pi.t.secondary.copy(color = Pi.c.fg) else Pi.t.secondary.copy(color = Pi.c.fg3)),
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(enabled = !current, role = Role.Button, onClick = onClick).padding(horizontal = 6.dp, vertical = 6.dp),
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun EntryRow(e: FileEntry, picked: Boolean, showPath: Boolean, onClick: () -> Unit, onLongClick: () -> Unit, modifier: Modifier = Modifier) {
    val bg by animateFloatAsState(if (picked) 1f else 0f, spring(stiffness = Spring.StiffnessMedium), label = "picked")
    Row(
        modifier.fillMaxWidth().background(Pi.c.surface.copy(alpha = bg)).combinedClickable(role = Role.Button, onClick = onClick, onLongClick = onLongClick)
            .heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PiIcon(if (e.dir) PiIcons.Folder else PiIcons.File, if (e.dir) Pi.c.fg2 else Pi.c.fg3, 17.dp)
        Column(Modifier.weight(1f)) {
            Text(e.name, style = Pi.t.body.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val meta = if (showPath) e.path.substringBeforeLast('/', "").ifEmpty { null }
            else listOfNotNull(e.size?.takeIf { !e.dir }?.let(::formatSize), e.mtime?.let { formatAgo(it) }).joinToString(" · ").ifEmpty { null }
            meta?.let { Text(it, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        when {
            picked -> Box(Modifier.size(20.dp).clip(CircleShape).background(Pi.c.fg), contentAlignment = Alignment.Center) { PiIcon(PiIcons.Check, Pi.c.bg, 12.dp) }
            e.dir -> PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 14.dp)
            else -> Box(Modifier.size(20.dp).clip(CircleShape).border(1.dp, Pi.c.line, CircleShape))
        }
    }
}
