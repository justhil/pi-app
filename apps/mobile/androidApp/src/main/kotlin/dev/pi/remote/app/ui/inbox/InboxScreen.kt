package dev.pi.remote.app.ui.inbox

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import dev.pi.remote.app.data.LocalUiPrefs
import dev.pi.remote.app.data.UiPrefs
import dev.pi.remote.app.ui.Banner
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.protocol.ProjectInfo
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.InboxState
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.ConnectionBanner
import dev.pi.remote.app.ui.Dot
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.ShimmerText
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.countsLine
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.app.ui.useTicker
import dev.pi.remote.app.ui.verbFor
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.text.formatClock
import kotlinx.coroutines.launch

@Composable
fun InboxScreen(repo: RemoteRepository, onOpen: (String) -> Unit, onHosts: () -> Unit) {
    val inbox by repo.inbox.collectAsState()
    val active by repo.active.collectAsState()
    val connection by repo.connection.collectAsState()
    val prefs = LocalUiPrefs.current
    val grouping by (prefs?.grouping ?: remember { kotlinx.coroutines.flow.MutableStateFlow("status") }).collectAsState()
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var pendingProject by remember { mutableStateOf<String?>(null) }
    val shared by repo.pendingShare.collectAsState()
    val canCreate = repo.canWrite && connection is HostConnection.State.Ready

    /** Create in [projectId]; with [firstMessage], send it right away (the session opens on the live run). */
    fun create(projectId: String, firstMessage: String? = null) {
        if (pendingProject != null) return
        pendingProject = projectId
        prefs?.lastProject = projectId
        scope.launch {
            // Creating starts a pi worker on the desktop (cold start, ~seconds): show progress meanwhile.
            val key = repo.createSession(projectId, null)
            pendingProject = null
            picking = false
            if (key != null) {
                if (!firstMessage.isNullOrBlank()) launch { repo.send(key, firstMessage.trim(), "prompt") }
                onOpen(key)
            }
        }
    }

    Column {
        if (shared != null) Banner(stringResource(R.string.share_pending), stringResource(R.string.share_discard)) { repo.takeShare() }
        InboxContent(
            hostName = active?.hostName.orEmpty(),
            connection = connection,
            inbox = inbox,
            canCreate = canCreate,
            onOpen = onOpen,
            onHosts = onHosts,
            onRetry = repo::retry,
            onNew = { picking = true },
            grouping = grouping,
            onNewIn = { create(it) },
            onMenu = { menu = true },
            modifier = Modifier.weight(1f),
        )
        val targets = inbox.projects.filter { !it.temporary }
        if (canCreate && targets.isNotEmpty()) {
            QuickStart(
                projects = targets,
                initial = prefs?.lastProject?.takeIf { id -> targets.any { it.id == id } } ?: targets.first().id,
                busy = pendingProject != null,
                onStart = { project, text -> create(project, text) },
            )
        }
    }
    if (picking) {
        PiSheet(onDismiss = { picking = false }) {
            Column(Modifier.padding(bottom = 18.dp)) {
                Text(stringResource(R.string.new_session_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                SectionLabel(stringResource(R.string.new_session_pick))
                // New chats go to real projects; desktop temporary chats are one-offs.
                for (p in inbox.projects.filter { !it.temporary }) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button) { create(p.id) }.padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, style = Pi.t.body.copy(color = Pi.c.fg))
                            Text(p.id, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (pendingProject == p.id) Text(stringResource(R.string.creating), style = Pi.t.meta.copy(color = Pi.c.fg3))
                        else PiIcon(PiIcons.ChevronRight, Pi.c.fg3)
                    }
                }
            }
        }
    }
    if (menu && prefs != null) InboxMenu(prefs, onHosts = { menu = false; onHosts() }, onDismiss = { menu = false })
}

/** Theme and inbox grouping. */
@Composable
private fun InboxMenu(prefs: UiPrefs, onHosts: () -> Unit, onDismiss: () -> Unit) {
    val theme by prefs.theme.collectAsState()
    val grouping by prefs.grouping.collectAsState()
    PiSheet(onDismiss) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.menu_theme), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 6.dp))
            Segmented(listOf("system" to stringResource(R.string.theme_system), "light" to stringResource(R.string.theme_light), "dark" to stringResource(R.string.theme_dark)), theme, prefs::setTheme)
            Text(stringResource(R.string.menu_grouping), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 10.dp))
            Segmented(listOf("status" to stringResource(R.string.group_status), "project" to stringResource(R.string.group_project)), grouping, prefs::setGrouping)
            Hairline(Modifier.padding(top = 10.dp))
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onHosts), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.Monitor, Pi.c.fg2, 16.dp)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.inbox_hosts), style = Pi.t.body.copy(color = Pi.c.fg))
            }
        }
    }
}

/** "Ask something…" bar at the bottom of the inbox: pick a project, type, send → new chat with that message. */
@Composable
private fun QuickStart(projects: List<ProjectInfo>, initial: String, busy: Boolean, onStart: (String, String) -> Unit) {
    var project by rememberSaveable(initial) { mutableStateOf(initial) }
    var text by rememberSaveable { mutableStateOf("") }
    var choosing by remember { mutableStateOf(false) }
    val name = projects.firstOrNull { it.id == project }?.name ?: projects.first().name
    Column(Modifier.fillMaxWidth().background(Pi.c.bg).imePadding()) {
        Hairline()
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button) { choosing = true }.padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(name, style = Pi.t.secondary.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 96.dp))
                Spacer(Modifier.width(3.dp))
                PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 12.dp)
            }
            Spacer(Modifier.width(6.dp))
            Box(Modifier.weight(1f).heightIn(min = 40.dp, max = 120.dp).clip(RoundedCornerShape(20.dp)).background(Pi.c.surface).padding(horizontal = 14.dp, vertical = 10.dp)) {
                if (text.isEmpty()) Text(stringResource(R.string.quick_start_hint), style = Pi.t.body.copy(color = Pi.c.fg3), maxLines = 1)
                BasicTextField(text, { text = it }, textStyle = Pi.t.body.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), modifier = Modifier.fillMaxWidth())
            }
            Spacer(Modifier.width(8.dp))
            val can = text.isNotBlank() && !busy
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(Pi.c.fg.copy(alpha = if (can) 1f else 0.35f)).clickable(enabled = can, role = Role.Button) {
                    onStart(project, text)
                    text = ""
                },
                contentAlignment = Alignment.Center,
            ) { if (busy) Spinner(Pi.c.bg, 14.dp) else PiIcon(PiIcons.ArrowUp, Pi.c.bg, 17.dp, contentDescription = stringResource(R.string.send)) }
        }
    }
    if (choosing) {
        PiSheet(onDismiss = { choosing = false }) {
            Column(Modifier.padding(bottom = 18.dp)) {
                SectionLabel(stringResource(R.string.new_session_pick))
                for (p in projects) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.RadioButton) { project = p.id; choosing = false }.padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(p.name, style = Pi.t.body.copy(color = Pi.c.fg), modifier = Modifier.weight(1f))
                        if (p.id == project) PiIcon(PiIcons.Check, Pi.c.fg2, 14.dp)
                    }
                }
            }
        }
    }
}

private const val TEMPORARY = "__temporary__"

private fun dayBucket(ms: Long, now: Long): Int {
    val day = 86_400_000L
    val off = java.util.TimeZone.getDefault().getOffset(now).toLong()
    val diff = Math.floorDiv(now + off, day) - Math.floorDiv(ms + off, day)
    return when {
        diff <= 0 -> 0
        diff == 1L -> 1
        diff < 7 -> 2
        else -> 3
    }
}

/** Stateless inbox (also used by screenshot tests). */
@Composable
fun InboxContent(
    hostName: String,
    connection: HostConnection.State,
    inbox: InboxState,
    canCreate: Boolean,
    onOpen: (String) -> Unit,
    onHosts: () -> Unit,
    onRetry: () -> Unit,
    onNew: () -> Unit,
    grouping: String = "status",
    onNewIn: ((String) -> Unit)? = null,
    onMenu: (() -> Unit)? = null,
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    val byProject = grouping == "project"
    val temporaryIds = inbox.projects.filter { it.temporary }.map { it.id }.toSet()
    val regular = inbox.projects.filter { !it.temporary }
    val sessions = inbox.sessions.filter {
        byProject || filter == null || (if (filter == TEMPORARY) it.projectId in temporaryIds else it.projectId == filter)
    }
    val needs = sessions.filter { it.status == "needsInput" || it.status == "failed" }
    val running = sessions.filter { it.status == "running" }
    val recent = sessions.filter { it.status == "idle" }
    val online = connection is HostConnection.State.Ready
    val now = useTicker(running.isNotEmpty())
    val dayLabels = listOf(stringResource(R.string.bucket_today), stringResource(R.string.bucket_yesterday), stringResource(R.string.bucket_week), stringResource(R.string.bucket_older))

    Column(modifier.background(Pi.c.bg)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 12.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clickable(role = Role.Button, onClick = onHosts).padding(horizontal = 6.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Dot(if (online) Pi.c.ok else Pi.c.fg3)
                Spacer(Modifier.width(8.dp))
                Text(hostName.ifEmpty { "pi" }, style = Pi.t.title.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(4.dp))
                PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 14.dp)
            }
            Spacer(Modifier.weight(1f))
            if (canCreate) IconAction(PiIcons.Plus, stringResource(R.string.inbox_new), onNew)
            onMenu?.let { IconAction(PiIcons.More, stringResource(R.string.more), it) }
        }
        ConnectionBanner(connection, onRetry)
        if (!byProject && inbox.projects.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                FilterTab(stringResource(R.string.inbox_all), filter == null) { filter = null }
                for (p in regular) FilterTab(p.name, filter == p.id) { filter = p.id }
                if (temporaryIds.isNotEmpty()) FilterTab(stringResource(R.string.temporary_chats), filter == TEMPORARY) { filter = TEMPORARY }
            }
            Hairline()
        }
        if (sessions.isEmpty() && !byProject) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (!inbox.loaded && online) Spinner(Pi.c.fg3, 18.dp) else Text(stringResource(R.string.inbox_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3))
            }
            return
        }
        LazyColumn(Modifier.fillMaxSize()) {
            if (needs.isNotEmpty()) {
                item("h-needs") { SectionLabel("${stringResource(R.string.inbox_needs)} · ${needs.size}") }
                items(needs, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = true) }
            }
            if (running.isNotEmpty()) {
                item("h-run") { SectionLabel("${stringResource(R.string.inbox_running)} · ${running.size}") }
                items(running, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = true) }
            }
            if (byProject) {
                // One collapsible group per project, idle sessions only (attention items stay on top).
                for (p in regular) {
                    val list = recent.filter { it.projectId == p.id }
                    val closed = collapsed[p.id] == true
                    item("p-${p.id}") {
                        ProjectHeader(p.name, list.size, closed, onToggle = { collapsed[p.id] = !closed }, onNew = if (canCreate && onNewIn != null) ({ onNewIn(p.id) }) else null)
                    }
                    if (!closed) items(list, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = false) }
                }
                // All desktop temporary chats in one group, folded by default.
                val temp = recent.filter { it.projectId in temporaryIds }
                if (temp.isNotEmpty()) {
                    val closed = collapsed[TEMPORARY] ?: true
                    item("p-temp") { ProjectHeader(stringResource(R.string.temporary_chats), temp.size, closed, onToggle = { collapsed[TEMPORARY] = !closed }, onNew = null) }
                    if (!closed) items(temp, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = false) }
                }
            } else {
                val buckets = recent.groupBy { dayBucket(it.updatedAt, now) }.toSortedMap()
                for ((b, list) in buckets) {
                    item("d-$b") { SectionLabel(dayLabels[b]) }
                    items(list, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = filter == null) }
                }
            }
            item("bottom") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun ProjectHeader(name: String, count: Int, closed: Boolean, onToggle: () -> Unit, onNew: (() -> Unit)?) {
    val angle by animateFloatAsState(if (closed) 0f else 90f, label = "group")
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onToggle).padding(start = 18.dp, end = 6.dp).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp, Modifier.rotate(angle))
        Spacer(Modifier.width(8.dp))
        Text(name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.width(6.dp))
        Text("$count", style = Pi.t.meta.copy(color = Pi.c.fg3))
        Spacer(Modifier.weight(1f))
        onNew?.let { IconAction(PiIcons.Plus, stringResource(R.string.inbox_new), it, tint = Pi.c.fg3, size = 16.dp) }
    }
}

@Composable
private fun FilterTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Column(Modifier.clickable(role = Role.Tab, onClick = onClick).padding(top = 10.dp)) {
        Text(label, style = Pi.t.secondary.copy(color = if (selected) Pi.c.fg else Pi.c.fg3))
        Spacer(Modifier.height(9.dp))
        Box(Modifier.height(1.5.dp).width(if (selected) 24.dp else 0.dp).background(Pi.c.fg))
    }
}

@Composable
private fun SessionRow(s: SessionSummary, now: Long, onOpen: (String) -> Unit, showProject: Boolean = true) {
    val temporaryLabel = stringResource(R.string.temporary_chats)
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(s.sessionKey) }.padding(horizontal = 18.dp, vertical = 11.dp)) {
        Box(Modifier.width(14.dp).padding(top = 3.dp), contentAlignment = Alignment.TopCenter) {
            when (s.status) {
                "needsInput" -> PiIcon(PiIcons.Question, Pi.c.warn, 14.dp)
                "failed" -> PiIcon(PiIcons.Alert, Pi.c.bad, 14.dp)
                "running" -> Spinner(Pi.c.blue, 14.dp)
                else -> Unit
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.title, style = Pi.t.bodyMedium.copy(color = if (s.status == "idle") Pi.c.fg2 else Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(10.dp))
                val right = if (s.status == "running" && s.startedAt != null) formatClock(now - s.startedAt!!) else formatAgo(s.updatedAt, now)
                Text(right, style = Pi.t.meta.copy(color = Pi.c.fg3))
            }
            when (s.status) {
                "running" -> {
                    val live = s.live?.takeIf { it.isNotEmpty() }?.let { "${s.liveCategory?.let { c -> verbFor(c) } ?: ""} $it".trim() } ?: "Thinking"
                    ShimmerText(live, Pi.t.secondary)
                }
                "needsInput" -> s.preview?.let { Text("${stringResource(R.string.status_needs)}：$it", style = Pi.t.secondary.copy(color = Pi.c.warn), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                "failed" -> s.preview?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.bad), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                else -> s.preview?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            val project = when {
                !showProject -> ""
                s.projectId.replace('\\', '/').contains("/sandbox-workspaces/") -> temporaryLabel
                else -> s.projectId.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\')
            }
            val counts = s.counts?.let { countsLine(it) }.orEmpty()
            Text(listOf(project, counts).filter { it.isNotEmpty() }.joinToString(" · "), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
