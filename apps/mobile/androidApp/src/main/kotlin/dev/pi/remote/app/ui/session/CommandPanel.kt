package dev.pi.remote.app.ui.session

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.protocol.CommandInfo
import kotlinx.coroutines.launch

/** One row of the slash panel. `builtin` rows run on the phone; the rest are inserted as text pi expands. */
data class SlashItem(val name: String, val description: String?, val category: String)

/** Phone-native commands: they open a sheet or start a chat instead of being sent. */
val BUILTIN_SLASH = listOf("/model", "/thinking", "/tools", "/new")

fun slashItems(commands: List<CommandInfo>, builtinDesc: (String) -> String): List<SlashItem> =
    BUILTIN_SLASH.map { SlashItem(it, builtinDesc(it), "builtin") } +
        commands.filter { it.name !in BUILTIN_SLASH }.map { SlashItem(it.name, it.description, it.category) }

/** The `/query` token being typed: it starts a line and runs up to the cursor. */
fun slashToken(v: TextFieldValue): IntRange? {
    val end = v.selection.end
    if (!v.selection.collapsed || end == 0) return null
    val text = v.text
    var i = end - 1
    while (i >= 0 && !text[i].isWhitespace() && text[i] != '/') i--
    if (i < 0 || text[i] != '/') return null
    if (i > 0 && text[i - 1] != '\n') return null
    return i until end
}

/** Replace the typed token, or put the command at the start (pi only expands a leading slash). */
fun insertSlash(v: TextFieldValue, name: String): TextFieldValue {
    val token = slashToken(v)
    val text = if (token != null) v.text.replaceRange(token, "$name ") else listOf("$name ", v.text.trimStart()).joinToString("")
    val cursor = (token?.first ?: 0) + name.length + 1
    return TextFieldValue(text, TextRange(cursor))
}

/** Remove a typed `/token` (after running a builtin from the suggestions). */
fun stripSlash(v: TextFieldValue): TextFieldValue {
    val token = slashToken(v) ?: return v
    val text = v.text.removeRange(token)
    return TextFieldValue(text, TextRange(token.first))
}

/** Name matches first (prefix, then after `skill:`), then description matches. */
fun filterSlash(items: List<SlashItem>, query: String): List<SlashItem> {
    val q = query.trim().removePrefix("/").lowercase()
    if (q.isEmpty()) return items
    fun bare(n: String) = n.removePrefix("/").lowercase()
    return items.mapNotNull { item ->
        val n = bare(item.name)
        val rank = when {
            n.startsWith(q) -> 0
            n.substringAfter(':').startsWith(q) -> 1
            n.contains(q) -> 2
            item.description?.lowercase()?.contains(q) == true -> 3
            else -> return@mapNotNull null
        }
        rank to item
    }.sortedBy { it.first }.map { it.second }
}

@Composable
fun builtinSlashDesc(): (String) -> String {
    val model = stringResource(R.string.slash_model)
    val thinking = stringResource(R.string.slash_thinking)
    val tools = stringResource(R.string.slash_tools)
    val new = stringResource(R.string.slash_new)
    return remember(model) { { n -> when (n) { "/model" -> model; "/thinking" -> thinking; "/tools" -> tools; else -> new } } }
}

@Composable
private fun categoryLabel(c: String): String = stringResource(
    when (c) {
        "builtin" -> R.string.slash_cat_app
        "prompt" -> R.string.slash_cat_prompt
        "skill" -> R.string.slash_cat_skill
        else -> R.string.slash_cat_extension
    },
)

@Composable
private fun SlashRow(item: SlashItem, showCategory: Boolean, onPick: (SlashItem) -> Unit, modifier: Modifier = Modifier) {
    val haptic = LocalHapticFeedback.current
    Row(
        modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) {
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onPick(item)
        }.padding(horizontal = 16.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(item.name, style = Pi.t.mono.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
            item.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (showCategory) {
            Spacer(Modifier.width(10.dp))
            Text(categoryLabel(item.category), style = Pi.t.small.copy(color = Pi.c.fg3))
        }
    }
}

/** Inline suggestions above the composer while a `/token` is typed. */
@Composable
fun SlashSuggestions(visible: Boolean, items: List<SlashItem>, onPick: (SlashItem) -> Unit) {
    AnimatedVisibility(
        visible && items.isNotEmpty(),
        enter = fadeIn(spring(stiffness = Spring.StiffnessMediumLow)) + expandVertically(spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow), expandFrom = Alignment.Bottom),
        exit = fadeOut(spring(stiffness = Spring.StiffnessMedium)) + shrinkVertically(spring(stiffness = Spring.StiffnessMedium), shrinkTowards = Alignment.Bottom),
    ) {
        val shape = RoundedCornerShape(14.dp)
        Box(Modifier.fillMaxWidth().clip(shape).background(Pi.c.card).border(1.dp, Pi.c.line, shape)) {
            LazyColumn(Modifier.heightIn(max = 248.dp).padding(vertical = 4.dp)) {
                items(items.take(40), key = { it.category + it.name }) { SlashRow(it, showCategory = true, onPick = onPick) }
            }
        }
    }
}

/**
 * Full command panel from the composer's `/` button: search, then App · Prompts · Extensions,
 * with Skills folded into one group (there are often dozens). Picking inserts, never sends.
 */
@Composable
fun CommandSheet(items: List<SlashItem>?, onPick: (SlashItem) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var skillsOpen by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val shown = filterSlash(items.orEmpty(), query)
    val searching = query.isNotBlank()
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 12.dp)) {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.Search, Pi.c.fg3, 14.dp)
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text(stringResource(R.string.slash_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    BasicTextField(query, { query = it }, textStyle = Pi.t.secondary.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            }
            if (items == null) {
                Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) { Spinner(Pi.c.fg3, 16.dp) }
                return@Column
            }
            if (shown.isEmpty()) {
                Text(stringResource(R.string.slash_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp))
                return@Column
            }
            val skills = shown.filter { it.category == "skill" }
            LazyColumn(state = listState, modifier = Modifier.heightIn(max = 560.dp)) {
                for (cat in listOf("builtin", "prompt", "extension")) section(cat, shown.filter { it.category == cat }, onPick)
                if (skills.isNotEmpty()) {
                    val open = skillsOpen || searching
                    item("h-skill") {
                        val angle by animateFloatAsState(if (open) 0f else -90f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow), label = "chevron")
                        Row(
                            Modifier.animateItem().fillMaxWidth().heightIn(min = 40.dp).clickable(enabled = !searching, role = Role.Button) {
                                skillsOpen = !skillsOpen
                                // Bring the group into view as it unfolds.
                                if (skillsOpen) scope.launch { listState.animateScrollToItem(listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == "h-skill" }?.index ?: return@launch) }
                            }.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(categoryLabel("skill"), style = Pi.t.meta.copy(color = Pi.c.fg3))
                            Spacer(Modifier.width(6.dp))
                            Text("${skills.size}", style = Pi.t.small.copy(color = Pi.c.fg3))
                            Spacer(Modifier.weight(1f))
                            PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 13.dp, Modifier.rotate(angle))
                        }
                    }
                    if (open) items(skills, key = { "skill" + it.name }) { SlashRow(it, showCategory = false, onPick = onPick, modifier = Modifier.animateItem()) }
                }
            }
        }
    }
}

private fun LazyListScope.section(cat: String, rows: List<SlashItem>, onPick: (SlashItem) -> Unit) {
    if (rows.isEmpty()) return
    item("h-$cat") {
        Text(categoryLabel(cat), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.animateItem().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 2.dp))
    }
    items(rows, key = { cat + it.name }) { SlashRow(it, showCategory = false, onPick = onPick, modifier = Modifier.animateItem()) }
}
