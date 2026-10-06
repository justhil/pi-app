package dev.pi.remote.app.ui.session

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.protocol.DiffFile
import dev.pi.remote.protocol.DiffLine
import dev.pi.remote.protocol.ReviewDiffResult

/** What the review screen opens on: the working tree, or one turn's changes (optionally one file). */
data class ReviewTarget(val scope: String, val turnId: String? = null, val path: String? = null)

/** A comment on lines [from]..[to] (indices into the file's lines) of [path]. */
data class LineComment(val path: String, val from: Int, val to: Int, val label: String?, val quote: List<String>, val text: String)

/** `11` or `11-14`: new-file line numbers, old ones for removed lines; null when the diff has none. */
fun lineRangeLabel(lines: List<DiffLine>): String? {
    val nums = lines.mapNotNull { it.n ?: it.o }
    if (nums.isEmpty()) return null
    val a = nums.first()
    val b = nums.last()
    return if (a == b) "$a" else "$a-$b"
}

/**
 * Comments as prompt text, one bullet per comment like the desktop review panel
 * (`- path:line: text`), with the commented code quoted underneath.
 */
fun formatLineComments(comments: List<LineComment>): String = comments.joinToString("\n") { c ->
    val quote = c.quote.take(12).joinToString("") { "\n  > $it" }
    "- ${c.path}${c.label?.let { ":$it" }.orEmpty()}: ${c.text.trim()}$quote"
}

private fun statusLetter(status: String) = when (status) {
    "added" -> "A"
    "deleted" -> "D"
    "renamed" -> "R"
    "binary" -> "B"
    else -> "M"
}

/**
 * Full-screen review of a session's changes: file list → one file's diff. Long-press a line to
 * start a selection, tap another to extend it, then comment; comments go into the composer
 * (never sent from here). Viewers only read.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ReviewScreen(
    target: ReviewTarget,
    canComment: Boolean,
    /** Kept by the session screen so closing the review does not lose unsent comments. */
    comments: SnapshotStateList<LineComment>,
    load: suspend (scope: String, turnId: String?, path: String?) -> Result<ReviewDiffResult>,
    onInsert: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val shown = remember { MutableTransitionState(false).apply { targetState = true } }
    var closing by remember { mutableStateOf(false) }
    fun close() {
        closing = true
        shown.targetState = false
    }
    LaunchedEffect(shown.currentState, shown.isIdle) { if (closing && shown.isIdle && !shown.currentState) onDismiss() }

    var scope by remember { mutableStateOf(target.scope) }
    var path by remember { mutableStateOf(target.path) }
    var list by remember { mutableStateOf<Result<ReviewDiffResult>?>(null) }
    val files = remember { mutableStateMapOf<String, Result<ReviewDiffResult>>() }
    var selFrom by remember { mutableStateOf<Int?>(null) }
    var selTo by remember { mutableStateOf<Int?>(null) }
    var writing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    val haptic = LocalHapticFeedback.current

    fun clearSelection() {
        selFrom = null
        selTo = null
        writing = false
        draft = ""
    }
    LaunchedEffect(scope) {
        list = null
        files.clear()
        list = load(scope, target.turnId, null)
    }
    LaunchedEffect(scope, path) {
        val p = path ?: return@LaunchedEffect
        if (p !in files) load(scope, target.turnId, p).let { files[p] = it }
    }

    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler {
            when {
                selFrom != null -> clearSelection()
                path != null && target.path == null -> path = null
                else -> close()
            }
        }
        AnimatedVisibility(
            shown,
            enter = fadeIn(tween(140)) + slideInHorizontally(spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow)) { it / 5 },
            exit = fadeOut(tween(120)) + slideOutHorizontally(tween(150)) { it / 6 },
        ) {
            Column(Modifier.fillMaxSize().background(Pi.c.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
                Row(Modifier.fillMaxWidth().height(52.dp).padding(start = 4.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button) {
                        if (path != null && target.path == null) { clearSelection(); path = null } else close()
                    }, contentAlignment = Alignment.Center) {
                        PiIcon(PiIcons.ChevronLeft, Pi.c.fg2, 18.dp, contentDescription = stringResource(R.string.back))
                    }
                    Column(Modifier.weight(1f)) {
                        val p = path
                        Text(p?.substringAfterLast('/') ?: stringResource(R.string.review_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val sub = if (p != null) p.substringBeforeLast('/', "") else list?.getOrNull()?.branch.orEmpty()
                        if (sub.isNotEmpty()) Text(sub, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (target.turnId != null && target.path == null) {
                        ScopeTab(stringResource(R.string.review_scope_turn), scope == "turn") { if (scope != "turn") { clearSelection(); path = null; scope = "turn" } }
                        ScopeTab(stringResource(R.string.review_scope_git), scope == "git") { if (scope != "git") { clearSelection(); path = null; scope = "git" } }
                    }
                }
                Hairline()
                Box(Modifier.weight(1f)) {
                    AnimatedContent(
                        path,
                        transitionSpec = {
                            val dir = if (targetState != null) 1 else -1
                            (slideInHorizontally(spring(dampingRatio = 0.92f, stiffness = Spring.StiffnessMediumLow)) { dir * it / 3 } + fadeIn(tween(160))) togetherWith
                                (slideOutHorizontally(tween(150)) { -dir * it / 4 } + fadeOut(tween(110)))
                        },
                        label = "review",
                    ) { p ->
                        if (p == null) FileListPane(list, comments, onOpen = { path = it })
                        else FilePane(
                            files[p], p, comments, selFrom, selTo,
                            onLongPress = { i ->
                                if (!canComment) return@FilePane
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                selFrom = i
                                selTo = i
                                writing = false
                            },
                            onTap = { i -> if (selFrom != null && !writing) selTo = i },
                            onRemoveComment = { comments.remove(it) },
                        )
                    }
                }
                val from = selFrom
                val to = selTo
                val fileLines = path?.let { files[it]?.getOrNull()?.file?.lines }
                AnimatedVisibility(
                    from != null && to != null && fileLines != null,
                    enter = fadeIn(tween(140)) + slideInVertically(spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMedium)) { it },
                    exit = fadeOut(tween(100)) + slideOutVertically(tween(140)) { it },
                ) {
                    if (from != null && to != null && fileLines != null) {
                        val a = minOf(from, to)
                        val b = maxOf(from, to)
                        val picked = fileLines.subList(a, b + 1).filter { it.k != "gap" }
                        CommentBar(
                            label = lineRangeLabel(picked)?.let { stringResource(R.string.review_lines, it) }
                                ?: pluralStringResource(R.plurals.review_lines_count, picked.size, picked.size),
                            writing = writing,
                            draft = draft,
                            onDraft = { draft = it },
                            onStart = { writing = true },
                            onCancel = ::clearSelection,
                            onSave = {
                                if (draft.isNotBlank()) {
                                    comments.add(LineComment(path!!, a, b, lineRangeLabel(picked), picked.map { it.s }, draft))
                                    clearSelection()
                                }
                            },
                        )
                    }
                }
                AnimatedVisibility(
                    comments.isNotEmpty() && selFrom == null,
                    enter = fadeIn(tween(140)) + slideInVertically(spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMedium)) { it },
                    exit = fadeOut(tween(100)) + slideOutVertically(tween(140)) { it },
                ) {
                    Column {
                        Hairline()
                        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, top = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(pluralStringResource(R.plurals.review_comment_count, comments.size, comments.size), style = Pi.t.secondary.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f))
                            QuietButton(stringResource(R.string.review_insert), color = Pi.c.fg, onClick = {
                                onInsert(formatLineComments(comments.toList()))
                                comments.clear()
                                close()
                            })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScopeTab(text: String, active: Boolean, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Tab, onClick = onClick).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(text, style = Pi.t.secondary.copy(color = if (active) Pi.c.fg else Pi.c.fg3))
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun FileListPane(list: Result<ReviewDiffResult>?, comments: List<LineComment>, onOpen: (String) -> Unit) {
    val r = list?.getOrNull()
    when {
        list == null -> Centered { Spinner(Pi.c.fg3, 16.dp) }
        r == null -> Centered { Text(stringResource(R.string.review_failed), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        !r.isRepo -> Centered { Text(stringResource(R.string.review_not_repo), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        r.files.isEmpty() -> Centered { Text(stringResource(R.string.review_clean), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        else -> LazyColumn(Modifier.fillMaxSize()) {
            item("sum") {
                Text(
                    stringResource(R.string.panel_files_value, r.files.size, r.files.sumOf { it.add }, r.files.sumOf { it.del }),
                    style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 18.dp, top = 12.dp, bottom = 6.dp),
                )
            }
            items(r.files, key = { it.path }) { f -> FileRow(f, comments.count { it.path == f.path }) { onOpen(f.path) } }
        }
    }
}

@Composable
private fun FileRow(f: DiffFile, commentCount: Int, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 18.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        val letterColor = when (f.status) {
            "added" -> Pi.c.ok
            "deleted" -> Pi.c.bad
            else -> Pi.c.fg3
        }
        Text(statusLetter(f.status), style = Pi.t.mono.copy(color = letterColor, fontSize = 12.sp), modifier = Modifier.width(18.dp))
        Column(Modifier.weight(1f)) {
            Text(f.path.substringAfterLast('/'), style = Pi.t.body.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val dir = f.path.substringBeforeLast('/', "")
            if (dir.isNotEmpty()) Text(dir, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (commentCount > 0) {
            PiIcon(PiIcons.Pencil, Pi.c.fg3, 12.dp)
            Spacer(Modifier.width(3.dp))
            Text("$commentCount", style = Pi.t.meta.copy(color = Pi.c.fg3))
            Spacer(Modifier.width(10.dp))
        }
        if (f.status != "binary") {
            Text("+${f.add}", style = Pi.t.meta.copy(color = Pi.c.ok))
            Spacer(Modifier.width(6.dp))
            Text("−${f.del}", style = Pi.t.meta.copy(color = Pi.c.bad))
        }
    }
}

/** Monospace 12 sp: about 7.3 dp per character, used to size the horizontally scrolled code column. */
private const val CHAR_DP = 7.3f

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FilePane(
    result: Result<ReviewDiffResult>?,
    path: String,
    comments: List<LineComment>,
    selFrom: Int?,
    selTo: Int?,
    onLongPress: (Int) -> Unit,
    onTap: (Int) -> Unit,
    onRemoveComment: (LineComment) -> Unit,
) {
    val file = result?.getOrNull()?.file
    val status = result?.getOrNull()?.files?.firstOrNull { it.path == path }?.status
    when {
        result == null -> Centered { Spinner(Pi.c.fg3, 16.dp) }
        status == "binary" -> Centered { Text(stringResource(R.string.review_binary), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        file == null -> Centered { Text(stringResource(R.string.review_failed), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        file.lines.isEmpty() -> Centered { Text(stringResource(R.string.review_no_lines), style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        else -> BoxWithConstraints(Modifier.fillMaxSize()) {
            val lines = file.lines
            val gutterChars = remember(lines) { lines.maxOf { maxOf(it.o ?: 0, it.n ?: 0) }.toString().length }
            val codeChars = remember(lines) { lines.maxOf { it.s.length } }
            val width = maxOf(maxWidth.value, (gutterChars * 2 + 4 + codeChars) * CHAR_DP + 24f).dp
            val byEnd = comments.filter { it.path == path }.groupBy { it.to }
            val a = selFrom?.let { f -> minOf(f, selTo ?: f) }
            val b = selFrom?.let { f -> maxOf(f, selTo ?: f) }
            Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
                LazyColumn(Modifier.width(width).fillMaxHeight()) {
                    itemsIndexed(lines, key = { i, _ -> i }) { i, l ->
                        val selected = a != null && b != null && i in a..b
                        val commented = comments.any { it.path == path && i in it.from..it.to }
                        DiffRow(l, gutterChars, selected, commented, Modifier.combinedClickable(onClick = { onTap(i) }, onLongClick = { onLongPress(i) }))
                        byEnd[i]?.forEach { c -> CommentCard(c, onRemove = { onRemoveComment(c) }) }
                    }
                    if (file.truncated) item("trunc") {
                        Text(stringResource(R.string.review_truncated), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                    }
                    item("end") { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
private fun DiffRow(l: DiffLine, gutterChars: Int, selected: Boolean, commented: Boolean, modifier: Modifier) {
    if (l.k == "gap") {
        Row(Modifier.fillMaxWidth().background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 5.dp)) {
            Text(if (l.s.isEmpty()) "⋯" else "⋯  ${l.s}", style = Pi.t.mono.copy(color = Pi.c.fg3, fontSize = 11.sp), maxLines = 1)
        }
        return
    }
    val bg = when {
        selected -> Pi.c.fg.copy(alpha = 0.12f)
        l.k == "add" -> Pi.c.ok.copy(alpha = 0.12f)
        l.k == "del" -> Pi.c.bad.copy(alpha = 0.12f)
        else -> Pi.c.bg
    }
    val sign = when (l.k) { "add" -> "+"; "del" -> "−"; else -> " " }
    val num = { n: Int? -> (n?.toString() ?: "").padStart(gutterChars) }
    Row(modifier.fillMaxWidth().background(bg).padding(start = 8.dp, end = 12.dp).heightIn(min = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(3.dp).height(16.dp).background(if (commented) Pi.c.blue else Pi.c.bg.copy(alpha = 0f)))
        Spacer(Modifier.width(4.dp))
        Text("${num(l.o)} ${num(l.n)}", style = Pi.t.mono.copy(color = Pi.c.fg3, fontSize = 11.sp), maxLines = 1, softWrap = false)
        Spacer(Modifier.width(8.dp))
        Text(sign, style = Pi.t.mono.copy(color = if (l.k == "add") Pi.c.ok else if (l.k == "del") Pi.c.bad else Pi.c.fg3, fontSize = 12.sp))
        Spacer(Modifier.width(4.dp))
        Text(l.s, style = Pi.t.mono.copy(color = Pi.c.fg, fontSize = 12.sp), maxLines = 1, softWrap = false)
    }
}

@Composable
private fun CommentCard(c: LineComment, onRemove: () -> Unit) {
    Row(
        Modifier.padding(start = 36.dp, end = 12.dp, top = 4.dp, bottom = 6.dp).width(340.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(c.text, style = Pi.t.secondary.copy(color = Pi.c.fg), modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.width(6.dp))
        Box(Modifier.size(32.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onRemove), contentAlignment = Alignment.Center) {
            PiIcon(PiIcons.X, Pi.c.fg3, 12.dp, contentDescription = stringResource(R.string.review_remove_comment))
        }
    }
}

@Composable
private fun CommentBar(
    label: String,
    writing: Boolean,
    draft: String,
    onDraft: (String) -> Unit,
    onStart: () -> Unit,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(writing) { if (writing) runCatching { focus.requestFocus() } }
    Column {
        Hairline()
        if (!writing) {
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, top = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(label, style = Pi.t.secondary.copy(color = Pi.c.fg2))
                    Text(stringResource(R.string.review_extend_hint), style = Pi.t.meta.copy(color = Pi.c.fg3))
                }
                QuietButton(stringResource(R.string.cancel), color = Pi.c.fg3, onClick = onCancel)
                QuietButton(stringResource(R.string.review_comment), color = Pi.c.fg, onClick = onStart)
            }
        } else {
            Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 10.dp, top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(label, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 4.dp))
                Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp)) {
                    if (draft.isEmpty()) Text(stringResource(R.string.review_comment_hint), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    BasicTextField(draft, onDraft, textStyle = Pi.t.secondary.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), modifier = Modifier.fillMaxWidth().focusRequester(focus))
                }
                Row(Modifier.align(Alignment.End)) {
                    QuietButton(stringResource(R.string.cancel), color = Pi.c.fg3, onClick = onCancel)
                    QuietButton(stringResource(R.string.review_save), color = Pi.c.fg, enabled = draft.isNotBlank(), onClick = onSave)
                }
            }
        }
    }
}
