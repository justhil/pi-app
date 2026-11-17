package dev.pi.remote.app.ui.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.InboxState
import dev.pi.remote.app.data.LocalUiPrefs
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.data.UiPrefs
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Banner
import dev.pi.remote.app.ui.ConnectionBanner
import dev.pi.remote.app.ui.Dot
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.PrimaryButton
import dev.pi.remote.app.ui.PullRefresh
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.app.ui.ShimmerText
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.countsLine
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.app.ui.session.UsageSheet
import dev.pi.remote.app.ui.useTicker
import dev.pi.remote.app.ui.verbFor
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.HostBrowseResult
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.text.formatClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

private fun formatBytes(bytes: Long): String = when {
    bytes < 1024L -> "${bytes.coerceAtLeast(0)} B"
    bytes < 1024L * 1024L -> "%.0f KB".format(bytes / 1024.0)
    else -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
}

@Composable
fun InboxScreen(repo: RemoteRepository, onOpen: (String) -> Unit, onHosts: () -> Unit) {
    val inbox by repo.inbox.collectAsState()
    val unread by repo.unread.collectAsState()
    val active by repo.active.collectAsState()
    val hostMeta by repo.hostMeta.collectAsState()
    val connection by repo.connection.collectAsState()
    val prefs = LocalUiPrefs.current
    val grouping by (prefs?.grouping ?: remember { MutableStateFlow("status") }).collectAsState()
    val collapsedPrefs by (prefs?.collapsedProjects ?: remember { MutableStateFlow(emptySet()) }).collectAsState()
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var browsingHost by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var usageSheet by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var pendingProject by remember { mutableStateOf<String?>(null) }
    var managing by remember { mutableStateOf<SessionSummary?>(null) }
    var actionNotice by remember { mutableStateOf<String?>(null) }
    val shared by repo.pendingShare.collectAsState()
    val canCreate = repo.canWrite && connection is HostConnection.State.Ready
    val actionFailedFmt = stringResource(R.string.session_action_failed, "%s")

    fun create(projectId: String) {
        if (pendingProject != null) return
        pendingProject = projectId
        prefs?.lastProject = projectId
        scope.launch {
            // Creating starts a pi worker on the desktop (cold start, ~seconds): show progress meanwhile.
            val key = repo.createSession(projectId, null)
            pendingProject = null
            picking = false
            browsingHost = false
            if (key != null) onOpen(key)
        }
    }

    Column {
        if (shared != null) Banner(stringResource(R.string.share_pending), stringResource(R.string.share_discard)) { repo.takeShare() }
        actionNotice?.let { Banner(it, stringResource(R.string.close)) { actionNotice = null } }
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
            unread = unread,
            collapsedIds = collapsedPrefs,
            onToggleCollapse = { id, next -> prefs?.setProjectCollapsed(id, next) },
            onLongPressSession = { managing = it },
            onNewIn = { create(it) },
            onMenu = { menu = true },
            refreshing = refreshing,
            onRefresh = {
                if (!refreshing) scope.launch {
                    refreshing = true
                    val started = System.currentTimeMillis()
                    repo.refreshInbox()
                    // Let the ring turn at least once, so a fast reply does not read as a flicker.
                    delay((600 - (System.currentTimeMillis() - started)).coerceAtLeast(0))
                    refreshing = false
                }
            },
            modifier = Modifier.weight(1f),
        )
    }

    if (picking) {
        NewSessionSheet(
            inbox = inbox,
            lastProject = prefs?.lastProject,
            pendingProject = pendingProject,
            canBrowseHost = inbox.allowAllProjects && canCreate,
            onCreate = ::create,
            onBrowseHost = {
                picking = false
                browsingHost = true
            },
            onDismiss = { picking = false },
        )
    }

    if (browsingHost) {
        HostFolderBrowserSheet(
            pendingProject = pendingProject,
            load = { path -> repo.browseHostDir(path) },
            onCreateIn = ::create,
            onDismiss = { browsingHost = false },
        )
    }

    managing?.let { target ->
        val isUnread = target.sessionKey in unread
        SessionActionsSheet(
            session = target,
            isUnread = isUnread,
            canWrite = repo.canWrite && connection is HostConnection.State.Ready,
            onToggleRead = {
                if (isUnread) repo.markRead(target.sessionKey) else repo.markUnread(target.sessionKey)
                managing = null
            },
            onRename = { nextTitle ->
                scope.launch {
                    repo.renameSession(target.sessionKey, nextTitle)
                        .onSuccess { managing = null }
                        .onFailure { actionNotice = actionFailedFmt.replace("%s", it.message ?: "") }
                }
            },
            onDelete = {
                scope.launch {
                    repo.deleteSession(target.sessionKey)
                        .onSuccess { managing = null }
                        .onFailure { actionNotice = actionFailedFmt.replace("%s", it.message ?: "") }
                }
            },
            onDismiss = { managing = null },
        )
    }

    if (menu && prefs != null) {
        InboxMenu(
            prefs = prefs,
            loadCacheBytes = { repo.cacheSizeBytes() },
            onClearCache = { repo.clearLocalCache() },
            onUsage = { menu = false; usageSheet = true },
            onHosts = { menu = false; onHosts() },
            onDismiss = { menu = false },
        )
    }

    if (usageSheet) {
        UsageSheet(
            load = { days -> repo.usageSummary(days) },
            cached30d = hostMeta.usage30d,
            onDismiss = { usageSheet = false },
        )
    }
}

@Composable
private fun NewSessionSheet(
    inbox: InboxState,
    lastProject: String?,
    pendingProject: String?,
    canBrowseHost: Boolean,
    onCreate: (String) -> Unit,
    onBrowseHost: () -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val regular = inbox.projects.filter { !it.temporary }.sortedByDescending { it.id == lastProject }
    val shown = if (query.isBlank()) regular else regular.filter {
        it.name.contains(query.trim(), ignoreCase = true) || it.id.contains(query.trim(), ignoreCase = true) || (it.branch?.contains(query.trim(), ignoreCase = true) == true)
    }
    val maxH = (LocalConfiguration.current.screenHeightDp * 0.78f).dp
    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 18.dp).heightIn(max = maxH)) {
            Text(stringResource(R.string.new_session_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            if (regular.size > 8) {
                Row(
                    Modifier.padding(horizontal = 20.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PiIcon(PiIcons.Search, Pi.c.fg3, 14.dp)
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) Text(stringResource(R.string.new_session_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                        BasicTextField(query, { query = it }, textStyle = Pi.t.secondary.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                if (canBrowseHost) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onBrowseHost).padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PiIcon(PiIcons.Folder, Pi.c.blue, 18.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.new_session_browse_host), style = Pi.t.body.copy(color = Pi.c.fg))
                            Text(stringResource(R.string.new_session_browse_desc), style = Pi.t.meta.copy(color = Pi.c.fg3))
                        }
                        PiIcon(PiIcons.ChevronRight, Pi.c.fg3)
                    }
                    Hairline(Modifier.padding(horizontal = 20.dp))
                }
                SectionLabel(stringResource(R.string.new_session_pick))
                for (p in shown) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button) { onCreate(p.id) }.padding(horizontal = 20.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(p.name, style = Pi.t.body.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                p.branch?.takeIf { it.isNotBlank() }?.let { branch ->
                                    Spacer(Modifier.width(8.dp))
                                    Text(branch, style = Pi.t.small.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            Text(p.id, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (pendingProject == p.id) Text(stringResource(R.string.creating), style = Pi.t.meta.copy(color = Pi.c.fg3))
                        else PiIcon(PiIcons.ChevronRight, Pi.c.fg3)
                    }
                }
            }
        }
    }
}

@Composable
private fun HostFolderBrowserSheet(
    pendingProject: String?,
    load: suspend (String?) -> Result<HostBrowseResult>,
    onCreateIn: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var current by remember { mutableStateOf<HostBrowseResult?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val maxH = (LocalConfiguration.current.screenHeightDp * 0.84f).dp

    fun openDir(path: String?) {
        loading = true
        error = null
        scope.launch {
            load(path)
                .onSuccess { current = it }
                .onFailure { error = it.message ?: "failed" }
            loading = false
        }
    }

    LaunchedEffect(Unit) { openDir(null) }

    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 16.dp).heightIn(max = maxH)) {
            Text(stringResource(R.string.host_browse_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            val res = current
            if (res != null && res.roots.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    for (r in res.roots) {
                        val label = r.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifEmpty { r }
                        val selected = res.path.startsWith(r, ignoreCase = true)
                        Box(
                            Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(7.dp))
                                .background(if (selected) Pi.c.surface else androidx.compose.ui.graphics.Color.Transparent)
                                .border(1.dp, Pi.c.line, RoundedCornerShape(7.dp))
                                .clickable(role = Role.Button) { openDir(r) }
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(label, style = Pi.t.monoSmall.copy(color = if (selected) Pi.c.fg else Pi.c.fg3))
                        }
                    }
                }
            }
            if (res != null) {
                Text(res.path, style = Pi.t.monoSmall.copy(color = Pi.c.fg2), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                Hairline(Modifier.padding(top = 4.dp))
            }
            when {
                loading && res == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Spinner(Pi.c.fg3, 16.dp) }
                error != null && res == null -> Text(error.orEmpty(), style = Pi.t.secondary.copy(color = Pi.c.bad), modifier = Modifier.padding(20.dp))
                res != null -> {
                    LazyColumn(Modifier.weight(1f, fill = false)) {
                        res.parent?.let { parent ->
                            item("parent") {
                                Row(
                                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) { openDir(parent) }.padding(horizontal = 20.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    PiIcon(PiIcons.ChevronLeft, Pi.c.fg3, 15.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Text(".. (${stringResource(R.string.host_browse_up)})", style = Pi.t.secondary.copy(color = Pi.c.fg2))
                                }
                            }
                        }
                        if (res.entries.isEmpty()) {
                            item("empty") {
                                Text(stringResource(R.string.files_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp))
                            }
                        } else {
                            items(res.entries, key = { it.path }) { entry ->
                                Row(
                                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) { openDir(entry.path) }.padding(horizontal = 20.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    PiIcon(if (entry.git == true) PiIcons.Branch else PiIcons.Folder, if (entry.git == true) Pi.c.blue else Pi.c.fg3, 15.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Text(entry.name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    if (entry.git == true) {
                                        Spacer(Modifier.width(8.dp))
                                        Text(stringResource(R.string.host_browse_git), style = Pi.t.monoSmall.copy(color = Pi.c.fg3))
                                    }
                                }
                            }
                        }
                    }
                    Hairline(Modifier.padding(bottom = 10.dp))
                    PrimaryButton(
                        text = if (pendingProject == res.path) stringResource(R.string.creating) else stringResource(R.string.host_browse_create_here),
                        onClick = { onCreateIn(res.path) },
                        enabled = pendingProject == null && !loading,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionActionsSheet(
    session: SessionSummary,
    isUnread: Boolean,
    canWrite: Boolean,
    onToggleRead: () -> Unit,
    onRename: (String) -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    var renaming by remember { mutableStateOf(false) }
    var titleText by remember(session.sessionKey) { mutableStateOf(session.title) }
    var confirmDelete by remember { mutableStateOf(false) }
    val running = session.status == "running"

    PiSheet(onDismiss) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                session.title.ifEmpty { stringResource(R.string.session_untitled) },
                style = Pi.t.bodyMedium.copy(color = Pi.c.fg),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(bottom = 6.dp),
            )
            Hairline()
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onToggleRead),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.Eye, Pi.c.fg2, 16.dp)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(if (isUnread) R.string.session_mark_read else R.string.session_mark_unread), style = Pi.t.body.copy(color = Pi.c.fg))
            }
            if (canWrite) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) { renaming = !renaming },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PiIcon(PiIcons.Pencil, Pi.c.fg2, 16.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.session_rename), style = Pi.t.body.copy(color = Pi.c.fg))
                }
                if (renaming) {
                    Row(Modifier.fillMaxWidth().padding(start = 28.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.weight(1f).heightIn(min = 38.dp).clip(RoundedCornerShape(9.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp),
                        ) {
                            if (titleText.isEmpty()) Text(stringResource(R.string.session_rename_hint), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                            BasicTextField(
                                value = titleText,
                                onValueChange = { titleText = it },
                                singleLine = true,
                                textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                                cursorBrush = SolidColor(Pi.c.fg),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Spacer(Modifier.width(6.dp))
                        QuietButton(
                            stringResource(R.string.session_rename_save),
                            onClick = { onRename(titleText.trim()) },
                            enabled = titleText.trim().isNotEmpty(),
                            color = Pi.c.fg,
                        )
                    }
                }
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(enabled = !running, role = Role.Button) {
                        if (!confirmDelete) confirmDelete = true else onDelete()
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PiIcon(PiIcons.Trash, if (running) Pi.c.fg3 else Pi.c.bad, 16.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        stringResource(
                            when {
                                running -> R.string.session_delete_running
                                confirmDelete -> R.string.session_delete_confirm
                                else -> R.string.session_delete
                            },
                        ),
                        style = Pi.t.body.copy(color = if (running) Pi.c.fg3 else Pi.c.bad),
                    )
                }
            }
        }
    }
}

/** Theme, language, inbox grouping and local cache maintenance. */
@Composable
private fun InboxMenu(
    prefs: UiPrefs,
    loadCacheBytes: suspend () -> Long,
    onClearCache: suspend () -> Unit,
    onUsage: () -> Unit,
    onHosts: () -> Unit,
    onDismiss: () -> Unit,
) {
    val theme by prefs.theme.collectAsState()
    val language by prefs.language.collectAsState()
    val activity = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity
    val grouping by prefs.grouping.collectAsState()
    val scope = rememberCoroutineScope()
    var cacheBytes by remember { mutableLongStateOf(0L) }
    var cleared by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { cacheBytes = loadCacheBytes() }

    PiSheet(onDismiss) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.menu_theme), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 6.dp))
            Segmented(listOf("system" to stringResource(R.string.theme_system), "light" to stringResource(R.string.theme_light), "dark" to stringResource(R.string.theme_dark)), theme, prefs::setTheme)
            Text(stringResource(R.string.menu_language), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 10.dp))
            // Language names stay in their own language.
            Segmented(listOf("system" to stringResource(R.string.theme_system), "en" to "English", "zh" to "简体中文"), language, onSelect = { if (prefs.setLanguage(it)) activity?.recreate() })
            Text(stringResource(R.string.menu_grouping), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 10.dp))
            Segmented(listOf("status" to stringResource(R.string.group_status), "project" to stringResource(R.string.group_project)), grouping, prefs::setGrouping)
            Hairline(Modifier.padding(top = 10.dp))
            Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (cleared) stringResource(R.string.menu_cache_cleared) else stringResource(R.string.menu_cache, formatBytes(cacheBytes)),
                    style = Pi.t.secondary.copy(color = Pi.c.fg2),
                    modifier = Modifier.weight(1f),
                )
                QuietButton(
                    stringResource(R.string.menu_cache_clear),
                    enabled = cacheBytes > 0L && !cleared,
                    onClick = {
                        scope.launch {
                            onClearCache()
                            cacheBytes = loadCacheBytes()
                            cleared = true
                        }
                    },
                )
            }
            Hairline()
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onUsage), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.Sparkles, Pi.c.fg2, 16.dp)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.menu_usage), style = Pi.t.body.copy(color = Pi.c.fg))
            }
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onHosts), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.Monitor, Pi.c.fg2, 16.dp)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.inbox_hosts), style = Pi.t.body.copy(color = Pi.c.fg))
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
    refreshing: Boolean = false,
    onRefresh: () -> Unit = {},
    modifier: Modifier = Modifier.fillMaxSize(),
    unread: Set<String> = emptySet(),
    collapsedIds: Set<String>? = null,
    onToggleCollapse: ((String, Boolean) -> Unit)? = null,
    onLongPressSession: ((SessionSummary) -> Unit)? = null,
) {
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val localCollapsed = remember { mutableStateMapOf<String, Boolean>() }
    val expandedParents = remember { mutableStateMapOf<String, Boolean>() }
    fun isClosed(id: String, defaultClosed: Boolean = false): Boolean =
        collapsedIds?.let { id in it } ?: (localCollapsed[id] ?: defaultClosed)
    fun setClosed(id: String, next: Boolean) {
        if (onToggleCollapse != null) onToggleCollapse(id, next) else localCollapsed[id] = next
    }

    BackHandler(enabled = searching) {
        searching = false
        query = ""
    }

    val byProject = grouping == "project" && query.isBlank()
    val temporaryIds = inbox.projects.filter { it.temporary }.map { it.id }.toSet()
    val regular = inbox.projects.filter { !it.temporary }
    val q = query.trim()
    val allByKey = remember(inbox.sessions) { inbox.sessions.associateBy { it.sessionKey } }
    val childrenByParent = remember(inbox.sessions) {
        inbox.sessions
            .filter { it.parentSessionKey != null && it.parentSessionKey in allByKey }
            .groupBy { it.parentSessionKey!! }
    }
    val sessions = inbox.sessions.filter { s ->
        if (q.isEmpty() && s.parentSessionKey != null && s.parentSessionKey in allByKey) return@filter false
        val projectOk = q.isNotBlank() || byProject || filter == null || (if (filter == TEMPORARY) s.projectId in temporaryIds else s.projectId == filter)
        if (!projectOk) return@filter false
        if (q.isEmpty()) return@filter true
        s.title.contains(q, ignoreCase = true) ||
            (s.preview?.contains(q, ignoreCase = true) == true) ||
            s.projectId.substringAfterLast('/').substringAfterLast('\\').contains(q, ignoreCase = true)
    }
    fun effectiveStatus(s: SessionSummary): String {
        if (s.status != "idle") return s.status
        val kids = childrenByParent[s.sessionKey].orEmpty()
        return when {
            kids.any { it.status == "needsInput" } -> "needsInput"
            kids.any { it.status == "failed" } -> "failed"
            kids.any { it.status == "running" } -> "running"
            else -> "idle"
        }
    }
    val needs = sessions.filter { val st = effectiveStatus(it); st == "needsInput" || st == "failed" }
    val running = sessions.filter { effectiveStatus(it) == "running" }
    val recent = sessions.filter { effectiveStatus(it) == "idle" }
    val online = connection is HostConnection.State.Ready
    val now = useTicker(running.isNotEmpty())
    val dayLabels = listOf(stringResource(R.string.bucket_today), stringResource(R.string.bucket_yesterday), stringResource(R.string.bucket_week), stringResource(R.string.bucket_older))

    Column(modifier.background(Pi.c.bg)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 12.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                Row(Modifier.clickable(role = Role.Button, onClick = onHosts).padding(horizontal = 6.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Dot(if (online) Pi.c.ok else Pi.c.fg3)
                    Spacer(Modifier.width(8.dp))
                    Text(hostName.ifEmpty { "pi" }, style = Pi.t.title.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(4.dp))
                    PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 14.dp)
                }
            }
            if (inbox.sessions.isNotEmpty() || searching) {
                IconAction(
                    icon = PiIcons.Search,
                    description = stringResource(R.string.inbox_search),
                    tint = if (searching) Pi.c.fg else Pi.c.fg2,
                    onClick = {
                        searching = !searching
                        if (!searching) query = ""
                    },
                )
            }
            if (canCreate) IconAction(PiIcons.Plus, stringResource(R.string.inbox_new), onNew)
            onMenu?.let { IconAction(PiIcons.More, stringResource(R.string.more), it) }
        }
        AnimatedVisibility(
            visible = searching,
            enter = expandVertically(spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
            exit = shrinkVertically(spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium)) + fadeOut(),
        ) {
            Column {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(start = 12.dp, end = 6.dp, top = 7.dp, bottom = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PiIcon(PiIcons.Search, Pi.c.fg3, 14.dp)
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) Text(stringResource(R.string.inbox_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                        BasicTextField(
                            value = query,
                            onValueChange = { query = it },
                            singleLine = true,
                            textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                            cursorBrush = SolidColor(Pi.c.fg),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (query.isNotEmpty()) {
                        Box(Modifier.size(26.dp).clip(CircleShape).clickable(role = Role.Button) { query = "" }, contentAlignment = Alignment.Center) {
                            PiIcon(PiIcons.X, Pi.c.fg3, 12.dp, contentDescription = stringResource(R.string.close))
                        }
                    }
                }
                Hairline()
            }
        }
        ConnectionBanner(connection, onRetry)
        if (!byProject && q.isEmpty() && inbox.projects.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                FilterTab(stringResource(R.string.inbox_all), filter == null) { filter = null }
                for (p in regular) FilterTab(p.name, filter == p.id) { filter = p.id }
                if (temporaryIds.isNotEmpty()) FilterTab(stringResource(R.string.temporary_chats), filter == TEMPORARY) { filter = TEMPORARY }
            }
            Hairline()
        }
        PullRefresh(refreshing, onRefresh, Modifier.fillMaxSize()) {
            if (sessions.isEmpty() && !byProject) {
                // Scrollable so the empty state can be pulled too.
                LazyColumn(Modifier.fillMaxSize()) {
                    item("empty") {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            if (!inbox.loaded && online && q.isEmpty()) Spinner(Pi.c.fg3, 18.dp)
                            else Text(stringResource(if (q.isNotEmpty()) R.string.inbox_search_empty else R.string.inbox_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                        }
                    }
                }
                return@PullRefresh
            }
            LazyColumn(Modifier.fillMaxSize()) {
                if (needs.isNotEmpty()) {
                    item("h-needs") { SectionLabel("${stringResource(R.string.inbox_needs)} · ${needs.size}") }
                    items(needs, key = { it.sessionKey }) { s ->
                        val kids = if (q.isEmpty()) childrenByParent[s.sessionKey].orEmpty() else emptyList()
                        SessionTreeBlock(s, kids, expandedParents[s.sessionKey] == true, { expandedParents[s.sessionKey] = expandedParents[s.sessionKey] != true }, now, unread, onOpen, onLongPressSession, showProject = true)
                    }
                }
                if (running.isNotEmpty()) {
                    item("h-run") { SectionLabel("${stringResource(R.string.inbox_running)} · ${running.size}") }
                    items(running, key = { it.sessionKey }) { s ->
                        val kids = if (q.isEmpty()) childrenByParent[s.sessionKey].orEmpty() else emptyList()
                        SessionTreeBlock(s, kids, expandedParents[s.sessionKey] == true, { expandedParents[s.sessionKey] = expandedParents[s.sessionKey] != true }, now, unread, onOpen, onLongPressSession, showProject = true)
                    }
                }
                if (byProject) {
                    // One collapsible group per project, idle sessions only (attention items stay on top).
                    for (p in regular) {
                        val list = recent.filter { it.projectId == p.id }
                        val closed = isClosed(p.id)
                        item("p-${p.id}") {
                            ProjectHeader(p.name, list.size, closed, onToggle = { setClosed(p.id, !closed) }, onNew = if (canCreate && onNewIn != null) ({ onNewIn(p.id) }) else null)
                        }
                        if (!closed) items(list, key = { it.sessionKey }) { s ->
                            val kids = if (q.isEmpty()) childrenByParent[s.sessionKey].orEmpty() else emptyList()
                            SessionTreeBlock(s, kids, expandedParents[s.sessionKey] == true, { expandedParents[s.sessionKey] = expandedParents[s.sessionKey] != true }, now, unread, onOpen, onLongPressSession, showProject = false)
                        }
                    }
                    // All desktop temporary chats in one group, folded by default.
                    val temp = recent.filter { it.projectId in temporaryIds }
                    if (temp.isNotEmpty()) {
                        val closed = isClosed(TEMPORARY, defaultClosed = true)
                        item("p-temp") { ProjectHeader(stringResource(R.string.temporary_chats), temp.size, closed, onToggle = { setClosed(TEMPORARY, !closed) }, onNew = null) }
                        if (!closed) items(temp, key = { it.sessionKey }) { s ->
                            val kids = if (q.isEmpty()) childrenByParent[s.sessionKey].orEmpty() else emptyList()
                            SessionTreeBlock(s, kids, expandedParents[s.sessionKey] == true, { expandedParents[s.sessionKey] = expandedParents[s.sessionKey] != true }, now, unread, onOpen, onLongPressSession, showProject = false)
                        }
                    }
                } else {
                    val buckets = recent.groupBy { dayBucket(it.updatedAt, now) }.toSortedMap()
                    for ((b, list) in buckets) {
                        item("d-$b") { SectionLabel(dayLabels[b]) }
                        items(list, key = { it.sessionKey }) { s ->
                            val kids = if (q.isEmpty()) childrenByParent[s.sessionKey].orEmpty() else emptyList()
                            SessionTreeBlock(s, kids, expandedParents[s.sessionKey] == true, { expandedParents[s.sessionKey] = expandedParents[s.sessionKey] != true }, now, unread, onOpen, onLongPressSession, showProject = filter == null || q.isNotEmpty())
                        }
                    }
                }
                item("bottom") { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun ProjectHeader(name: String, count: Int, closed: Boolean, onToggle: () -> Unit, onNew: (() -> Unit)?) {
    val angle by animateFloatAsState(if (closed) 0f else 90f, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium), label = "group")
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
private fun SessionTreeBlock(
    parent: SessionSummary,
    children: List<SessionSummary>,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    now: Long,
    unread: Set<String>,
    onOpen: (String) -> Unit,
    onLongPress: ((SessionSummary) -> Unit)?,
    showProject: Boolean,
) {
    Column {
        SessionRow(parent, now, parent.sessionKey in unread, onOpen, onLongPress, showProject)
        if (children.isNotEmpty()) {
            val childRunning = children.count { it.status == "running" }
            val angle by animateFloatAsState(if (expanded) 90f else 0f, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium), label = "sub")
            Row(
                Modifier.padding(start = 44.dp, end = 18.dp, bottom = 4.dp).clip(RoundedCornerShape(7.dp))
                    .clickable(role = Role.Button, onClick = onToggleExpand).padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 11.dp, Modifier.rotate(angle))
                Spacer(Modifier.width(5.dp))
                Text(
                    if (childRunning > 0) stringResource(R.string.subagents_running, children.size, childRunning)
                    else stringResource(R.string.subagents_count, children.size),
                    style = Pi.t.meta.copy(color = if (childRunning > 0) Pi.c.blue else Pi.c.fg3),
                )
            }
            if (expanded) {
                Column(Modifier.padding(start = 24.dp)) {
                    for (c in children.sortedByDescending { it.updatedAt }) {
                        Row(Modifier.fillMaxWidth()) {
                            Box(Modifier.padding(start = 20.dp).width(1.5.dp).height(52.dp).background(Pi.c.line))
                            Box(Modifier.weight(1f)) {
                                SessionRow(c, now, c.sessionKey in unread, onOpen, onLongPress, showProject = false)
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SessionRow(
    s: SessionSummary,
    now: Long,
    isUnread: Boolean,
    onOpen: (String) -> Unit,
    onLongPress: ((SessionSummary) -> Unit)? = null,
    showProject: Boolean = true,
) {
    val haptic = LocalHapticFeedback.current
    val temporaryLabel = stringResource(R.string.temporary_chats)
    val emphasized = s.status != "idle" || isUnread
    Row(
        Modifier.fillMaxWidth()
            .combinedClickable(
                role = Role.Button,
                onClick = { onOpen(s.sessionKey) },
                onLongClick = onLongPress?.let { cb ->
                    {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        cb(s)
                    }
                },
            )
            .padding(horizontal = 18.dp, vertical = 11.dp),
    ) {
        Box(Modifier.width(14.dp).padding(top = 3.dp), contentAlignment = Alignment.TopCenter) {
            when {
                s.status == "needsInput" -> PiIcon(PiIcons.Question, Pi.c.warn, 14.dp)
                s.status == "failed" -> PiIcon(PiIcons.Alert, Pi.c.bad, 14.dp)
                s.status == "running" -> Spinner(Pi.c.blue, 14.dp)
                isUnread -> Box(Modifier.padding(top = 3.dp)) { Dot(Pi.c.ok, 7.dp) }
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    s.title.ifEmpty { stringResource(R.string.session_untitled) },
                    style = if (emphasized) Pi.t.bodyMedium.copy(color = Pi.c.fg) else Pi.t.body.copy(color = Pi.c.fg2),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
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
