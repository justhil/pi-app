package dev.pi.remote.app.ui.session

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.ui.platform.LocalDensity
import androidx.activity.compose.BackHandler
import dev.pi.remote.protocol.ContextStats
import dev.pi.remote.protocol.ReviewDiffResult
import dev.pi.remote.protocol.SessionUsage
import dev.pi.remote.app.data.SharedContent
import dev.pi.remote.protocol.BranchInfo
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import dev.pi.remote.app.data.Attachment
import dev.pi.remote.app.data.AttachmentPrep
import dev.pi.remote.app.data.AttachmentTooLarge
import dev.pi.remote.app.data.PreparedAttachment
import dev.pi.remote.app.data.PromptAttachments
import kotlinx.coroutines.flow.first
import dev.pi.remote.app.ui.rich.MarkdownCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.LocalUiPrefs
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.data.SendOutcome
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import dev.pi.remote.app.data.OutboxEntry
import dev.pi.remote.app.ui.Banner
import dev.pi.remote.app.ui.ConnectionBanner
import dev.pi.remote.app.ui.Dot
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.TopBar
import dev.pi.remote.app.ui.reducedMotion
import dev.pi.remote.app.ui.rich.FileTarget
import dev.pi.remote.app.ui.rich.LocalFileOpen
import dev.pi.remote.app.ui.rich.MermaidSource
import dev.pi.remote.app.ui.rich.parseFileTarget
import dev.pi.remote.app.ui.useTicker
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.CapabilityRow
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.PurgeSend
import dev.pi.remote.protocol.PurgeStateResult
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.protocol.ToolStep
import dev.pi.remote.protocol.Turn
import dev.pi.remote.protocol.UiNotify
import dev.pi.remote.protocol.UiRequest
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.sync.SessionTimeline
import dev.pi.remote.text.TimeDividers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** [block] until it returns non-null, up to 3 tries 1.2 s apart. */
private suspend fun <T> retrying(block: suspend () -> T?): T? {
    repeat(3) { i ->
        block()?.let { return it }
        if (i < 2) kotlinx.coroutines.delay(1200)
    }
    return null
}

@Composable
fun SessionScreen(
    repo: RemoteRepository,
    sessionKey: String,
    onBack: () -> Unit,
    onOpenSession: (String) -> Unit = {},
    onPushSession: (String) -> Unit = onOpenSession,
) {
    val timelines by repo.timelines.collectAsState()
    val connection by repo.connection.collectAsState()
    val inbox by repo.inbox.collectAsState()
    val settingsVersion by repo.settingsVersion.collectAsState()
    val pendingSends by repo.pendingSends.collectAsState()
    val allOutbox by repo.outbox.collectAsState()
    val scope = rememberCoroutineScope()
    val timeline = timelines[sessionKey]
    val summary = inbox.sessions.firstOrNull { it.sessionKey == sessionKey }
    val hostMeta by repo.hostMeta.collectAsState()
    var draft by remember(sessionKey) {
        val initial = repo.draftOf(sessionKey)
        mutableStateOf(TextFieldValue(initial, androidx.compose.ui.text.TextRange(initial.length)))
    }
    fun updateDraft(next: TextFieldValue) {
        draft = next
        repo.saveDraft(sessionKey, next.text)
    }
    var notice by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<String?>(null) }
    var caps by remember(sessionKey) { mutableStateOf(hostMeta.capabilitiesBySession[sessionKey].orEmpty()) }
    var cache by remember(sessionKey) { mutableStateOf(hostMeta.cacheWarming) }
    var models by remember(sessionKey) { mutableStateOf(hostMeta.models) }
    var purge by remember(sessionKey) { mutableStateOf(hostMeta.purge) }
    var purgeEnabled by rememberSaveable(sessionKey) { mutableStateOf(false) }
    var purgePersonaId by rememberSaveable(sessionKey) { mutableStateOf(hostMeta.purge?.defaultPersonaId.orEmpty()) }
    var purgeMode by rememberSaveable(sessionKey) { mutableStateOf(hostMeta.purge?.defaultMode ?: "replace") }
    var deferred by remember { mutableStateOf(setOf<String>()) }
    val context = LocalContext.current
    val attachments = remember(sessionKey) { mutableStateListOf<Attachment>() }
    val prepared = remember(sessionKey) { HashMap<String, PreparedAttachment>() }
    var attachSheet by remember { mutableStateOf(false) }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    val tooLarge = stringResource(R.string.attach_too_large, "%s")
    val cameraDenied = stringResource(R.string.camera_denied)
    val attachPending = stringResource(R.string.attach_pending)

    fun update(id: String, f: (Attachment) -> Attachment) {
        val i = attachments.indexOfFirst { it.id == id }
        if (i >= 0) attachments[i] = f(attachments[i])
    }
    fun upload(id: String, uri: Uri) {
        update(id) { it.copy(status = Attachment.Status.Uploading, error = null) }
        scope.launch {
            val prep = prepared[id] ?: runCatching { withContext(Dispatchers.IO) { AttachmentPrep.prepare(context, uri) } }
                .onSuccess { prepared[id] = it }
                .getOrElse { e ->
                    update(id) { it.copy(status = Attachment.Status.Failed, error = if (e is AttachmentTooLarge) tooLarge.replace("%s", e.name) else e.message) }
                    return@launch
                }
            update(id) { it.copy(name = prep.name, thumb = it.thumb ?: prep.thumb) }
            repo.upload(prep)
                .onSuccess { path -> update(id) { it.copy(status = Attachment.Status.Ready, path = path) } }
                .onFailure { e -> update(id) { it.copy(status = Attachment.Status.Failed, error = e.message) } }
        }
    }
    fun addAll(uris: List<Uri>) {
        for (uri in uris) {
            val a = Attachment(uri = uri, name = AttachmentPrep.displayName(context, uri), isImage = AttachmentPrep.mimeOf(context, uri, "").startsWith("image/"))
            attachments += a
            if (a.isImage) scope.launch { withContext(Dispatchers.IO) { AttachmentPrep.quickThumb(context, uri) }?.let { t -> update(a.id) { it.copy(thumb = it.thumb ?: t) } } }
            upload(a.id, uri)
        }
    }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri?.let(Uri::parse)
        cameraUri = null
        if (ok && uri != null) addAll(listOf(uri))
    }
    fun launchCamera() {
        val uri = AttachmentPrep.newCameraUri(context)
        cameraUri = uri.toString()
        takePicture.launch(uri)
    }
    // The manifest declares CAMERA (for QR scanning), so ACTION_IMAGE_CAPTURE requires it granted.
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else notice = cameraDenied
    }
    val pickPhotos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(9)) { addAll(it) }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { addAll(it) }
    val prefs = dev.pi.remote.app.data.LocalUiPrefs.current
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    /** First send: ask for notifications so a finished run can reach the user in the background. */
    fun askNotificationsOnce() {
        if (android.os.Build.VERSION.SDK_INT < 33 || prefs == null || prefs.askedNotifications) return
        prefs.askedNotifications = true
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    // Content shared from another app lands in the first session opened afterwards.
    LaunchedEffect(sessionKey) {
        repo.takeShare()?.let { s ->
            if (s.text.isNotBlank()) updateDraft(TextFieldValue(listOf(draft.text, s.text).filter { it.isNotBlank() }.joinToString("\n")))
            addAll(s.uris)
        }
    }
    val ready = connection is HostConnection.State.Ready
    val stopFailed = stringResource(R.string.stop_failed)
    val rewindFailed = stringResource(R.string.msg_rewind_failed, "%s")
    val forkFailed = stringResource(R.string.msg_fork_failed, "%s")
    val switchFailed = stringResource(R.string.branches_switch_failed, "%s")
    var stopping by remember(sessionKey) { mutableStateOf(false) }
    val runningNow = timeline?.state?.running == true || timeline?.turns?.lastOrNull()?.running == true
    LaunchedEffect(runningNow, stopping) {
        if (!runningNow) stopping = false
        else if (stopping) {
            // The host settles within a moment; never leave the stop button spinning.
            kotlinx.coroutines.delay(8_000)
            stopping = false
        }
    }
    /** Queued texts come back to the composer ahead of whatever is typed (desktop / TUI behaviour). */
    fun restore(texts: List<String>) {
        if (texts.isEmpty()) return
        val merged = (texts + draft.text.trim()).filter { it.isNotBlank() }.joinToString("\n")
        updateDraft(TextFieldValue(merged, androidx.compose.ui.text.TextRange(merged.length)))
    }
    val maybeLost = stringResource(R.string.maybe_not_sent)

    LaunchedEffect(sessionKey, ready) { repo.openSession(sessionKey) }
    LaunchedEffect(sessionKey, ready, settingsVersion) {
        if (ready) {
            caps = repo.capabilities(sessionKey)
            cache = repo.cacheWarming()
            repo.purgeState(sessionKey)?.let { p ->
                purge = p
                val sess = p.session
                if (sess?.locked == "on") {
                    purgeEnabled = true
                    sess.personaId?.takeIf { it.isNotEmpty() }?.let { purgePersonaId = it }
                    sess.mode?.takeIf { it.isNotEmpty() }?.let { purgeMode = it }
                } else if (sess?.locked == "off") {
                    purgeEnabled = false
                }
                if (purgePersonaId.isEmpty() || p.personas.none { it.id == purgePersonaId }) purgePersonaId = p.defaultPersonaId
                if (purgeMode.isEmpty()) purgeMode = p.defaultMode
            }
            repo.models(sessionKey)?.let { models = it }
        }
    }
    var commands by remember(sessionKey) { mutableStateOf(repo.cachedCommands(sessionKey)) }
    var commandSheet by remember { mutableStateOf(false) }
    var filePicker by remember { mutableStateOf(false) }
    var previewTarget by remember { mutableStateOf<FileTarget?>(null) }
    var subagentSheet by remember { mutableStateOf(false) }
    var usageSheet by remember { mutableStateOf(false) }
    var stats by remember(sessionKey) { mutableStateOf<ContextStats?>(null) }
    var usage by remember(sessionKey) { mutableStateOf<SessionUsage?>(null) }
    var changes by remember(sessionKey) { mutableStateOf<ReviewDiffResult?>(null) }
    var review by remember { mutableStateOf<ReviewTarget?>(null) }
    val reviewComments = remember(sessionKey) { androidx.compose.runtime.mutableStateListOf<LineComment>() }
    var branches by remember(sessionKey) { mutableStateOf<List<BranchInfo>?>(null) }
    var branchesFailed by remember(sessionKey) { mutableStateOf(false) }
    var branchSheet by remember { mutableStateOf(false) }
    fun loadBranches() {
        branchesFailed = false
        scope.launch { repo.branches(sessionKey).onSuccess { branches = it }.onFailure { branchesFailed = true } }
    }
    var statsLoading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    LaunchedEffect(sessionKey, ready) { if (ready) repo.commands(sessionKey)?.let { commands = it } }
    LaunchedEffect(commandSheet) { if (commandSheet && ready) repo.commands(sessionKey, maxAgeMs = 3_000)?.let { commands = it } }
    val builtinDesc = builtinSlashDesc()
    val slash = remember(commands, builtinDesc) { commands?.let { slashItems(it, builtinDesc) } }
    fun runBuiltin(name: String) {
        when (name) {
            "/model" -> { sheet = "model"; scope.launch { models = repo.models(sessionKey) } }
            "/thinking" -> { sheet = "thinking"; scope.launch { models = repo.models(sessionKey) } }
            "/tools" -> sheet = "tools"
            "/persona" -> { sheet = "purge"; scope.launch { repo.purgeState(sessionKey)?.let { purge = it } } }
            "/new" -> {
                val project = summary?.projectId
                if (project != null && !creating) {
                    creating = true
                    scope.launch {
                        val key = repo.createSession(project, null)
                        creating = false
                        if (key != null) onOpenSession(key)
                    }
                }
            }
        }
    }
    fun pickSlash(item: SlashItem) {
        if (item.category == "builtin") {
            updateDraft(stripSlash(draft))
            runBuiltin(item.name)
        } else updateDraft(insertSlash(draft, item.name))
    }
    androidx.compose.runtime.DisposableEffect(sessionKey) { onDispose { repo.closeSession(sessionKey) } }

    val hasPurgeSupport = purge?.personas?.isNotEmpty() == true
    val selectedPersona = purge?.personas?.firstOrNull { it.id == purgePersonaId } ?: purge?.personas?.firstOrNull { it.id == purge?.defaultPersonaId } ?: purge?.personas?.firstOrNull()
    val draftModeLabel = purgeModeLabel(purgeMode)
    val draftPurgeSummary = selectedPersona?.let { "${it.name} · $draftModeLabel" }
    val lockedPersonaSummary = if (purgeEnabled && selectedPersona != null) {
        "${selectedPersona.name} · $draftModeLabel"
    } else if (purge?.session?.locked == "on") {
        val name = purge?.session?.personaName ?: purge?.session?.personaId.orEmpty()
        val m = purgeModeLabel(purge?.session?.mode)
        if (name.isNotBlank()) "$name · $m" else null
    } else null

    fun applyPurge(enabled: Boolean, personaId: String? = selectedPersona?.id, mode: String = purgeMode) {
        purgeEnabled = enabled
        if (!personaId.isNullOrEmpty()) purgePersonaId = personaId
        purgeMode = mode
        scope.launch {
            repo.setPurge(sessionKey, enabled, personaId, mode)?.let { purge = it }
        }
    }
    val activeSessions = remember(inbox.sessions, sessionKey) {
        inbox.sessions.filter { it.sessionKey != sessionKey && it.status != "idle" && it.parentSessionKey == null }
    }
    val parentSummary = remember(inbox.sessions, summary?.parentSessionKey) {
        val pk = summary?.parentSessionKey ?: return@remember null
        inbox.sessions.firstOrNull { it.sessionKey == pk }
    }
    val childSessions = remember(inbox.sessions, sessionKey) {
        inbox.sessions.filter { it.parentSessionKey == sessionKey }.sortedByDescending { it.updatedAt }
    }
    val sessionOutbox = remember(allOutbox, sessionKey) {
        allOutbox.filter { it.sessionKey == sessionKey }
    }
    val projectRoot = summary?.projectId.orEmpty()
    val parentUriHandler = LocalUriHandler.current
    val sessionUriHandler = remember(parentUriHandler, projectRoot) {
        object : UriHandler {
            override fun openUri(uri: String) {
                val ft = parseFileTarget(uri, projectRoot)
                if (ft != null) previewTarget = ft else parentUriHandler.openUri(uri)
            }
        }
    }
    val commitPromptText = stringResource(R.string.review_commit_prompt)

    CompositionLocalProvider(
        LocalFileOpen provides { ft ->
            val norm = parseFileTarget(ft.path, projectRoot)
            previewTarget = if (norm != null) norm.copy(lineStart = ft.lineStart, lineEnd = ft.lineEnd) else ft
        },
        LocalUriHandler provides sessionUriHandler,
    ) {
    SessionContent(
        title = timeline?.title?.ifEmpty { null } ?: summary?.title?.ifEmpty { null } ?: stringResource(R.string.session_untitled),
        project = summary?.projectId?.trimEnd('/', '\\')?.substringAfterLast('/')?.substringAfterLast('\\').orEmpty(),
        timeline = timeline,
        connection = connection,
        canWrite = repo.canWrite,
        draft = draft,
        onDraft = ::updateDraft,
        notice = notice,
        toolsOn = caps.count { it.enabled },
        deferredUi = deferred,
        pendingText = pendingSends[sessionKey],
        attachments = attachments,
        onAttach = { attachSheet = true },
        onRemoveAttachment = { id ->
            attachments.removeAll { it.id == id }
            prepared.remove(id)
        },
        onRetryAttachment = { id -> attachments.firstOrNull { it.id == id }?.let { upload(it.id, it.uri) } },
        onReceiveUris = { addAll(it) },
        mermaid = remember(repo) { MermaidSource { repo.mermaidScript() } },
        onBack = onBack,
        onRetry = repo::retry,
        onLoadOlder = { scope.launch { repo.loadOlder(sessionKey) } },
        onSend = { mode ->
            val typed = draft.text.trim()
            if (typed in BUILTIN_SLASH && attachments.isEmpty()) {
                updateDraft(TextFieldValue(""))
                runBuiltin(typed)
            } else if (typed.isNotEmpty() || attachments.isNotEmpty()) {
                askNotificationsOnce()
                scope.launch {
                    // Uploads started when each file was added; wait only for the ones still in flight.
                    snapshotFlow { attachments.none { it.status == Attachment.Status.Uploading } }.first { it }
                    if (attachments.any { it.status == Attachment.Status.Failed }) {
                        notice = attachPending
                        return@launch
                    }
                    val sent = attachments.toList()
                    val text = PromptAttachments.compose(typed, sent.mapNotNull { it.path })
                    if (text.isEmpty()) return@launch
                    val purgePayload = if (mode == "prompt" && hasPurgeSupport) {
                        PurgeSend(enabled = purgeEnabled, personaId = selectedPersona?.id, mode = purgeMode)
                    } else null
                    updateDraft(TextFieldValue(""))
                    attachments.clear()
                    when (val r = repo.send(sessionKey, text, mode, purgePayload)) {
                        SendOutcome.Sent -> {
                            notice = null
                            if (purgePayload != null) repo.purgeState(sessionKey)?.let { purge = it }
                        }
                        SendOutcome.Queued -> notice = null
                        SendOutcome.Unknown -> notice = maybeLost
                        is SendOutcome.Failed -> {
                            notice = r.message
                            updateDraft(TextFieldValue(typed))
                            attachments.addAll(sent)
                        }
                    }
                }
            }
        },
        stopping = stopping,
        onStop = {
            if (!stopping) {
                stopping = true
                scope.launch {
                    val restored = repo.abort(sessionKey)
                    if (restored == null) {
                        stopping = false
                        notice = stopFailed
                    } else restore(restored)
                }
            }
        },
        slashItems = slash.orEmpty(),
        onSlashPick = ::pickSlash,
        onCommands = { commandSheet = true },
        onFiles = { filePicker = true },
        projectPath = summary?.projectId.orEmpty(),
        stats = stats,
        usage = usage,
        statsLoading = statsLoading,
        onPanelOpened = {
            statsLoading = true
            scope.launch {
                // Opened right after launch or a reconnect: wait for the session to be reachable first.
                withTimeoutOrNull(10_000) { repo.connection.first { it is HostConnection.State.Ready } }
                // The first calls after a (re)connect can race the session's own open: retry briefly.
                launch { retrying { repo.reviewDiff(sessionKey, "git").getOrNull() }?.let { changes = it } }
                launch { retrying { repo.branches(sessionKey).getOrNull() }?.let { branches = it; branchesFailed = false } }
                retrying { repo.sessionStats(sessionKey)?.takeIf { it.context != null } }?.let { r ->
                    r.context?.let { stats = it }
                    usage = r.usage
                }
                statsLoading = false
            }
        },
        branchCount = branches?.size,
        onBranches = {
            branchSheet = true
            loadBranches()
        },
        onFork = { anchor ->
            scope.launch {
                repo.fork(sessionKey, anchor)
                    .onSuccess { r ->
                        val body = PromptAttachments.split(r.editorText.orEmpty()).first
                        if (body.isNotBlank()) repo.share(SharedContent(body, emptyList()))
                        onOpenSession(r.sessionKey)
                    }
                    .onFailure { notice = forkFailed.replace("%s", it.message ?: "") }
            }
        },
        changes = changes,
        onReview = { review = it },
        onRewind = { anchor ->
            scope.launch {
                repo.rewind(sessionKey, anchor)
                    .onSuccess { text ->
                        val body = PromptAttachments.split(text).first
                        if (body.isNotBlank()) updateDraft(TextFieldValue(body, androidx.compose.ui.text.TextRange(body.length)))
                        notice = null
                    }
                    .onFailure { notice = rewindFailed.replace("%s", it.message ?: "") }
            }
        },
        onDequeue = { scope.launch { repo.dequeue(sessionKey)?.let(::restore) } },
        onEditQueued = { idx -> scope.launch { repo.dequeue(sessionKey, idx)?.let(::restore) } },
        onRemoveQueued = { idx -> scope.launch { repo.dequeue(sessionKey, idx) } },
        outbox = sessionOutbox,
        onEditOutbox = { id ->
            repo.removeOutbox(id)?.let { entry ->
                val body = PromptAttachments.split(entry.text).first
                restore(listOf(body))
            }
        },
        onCancelOutbox = { id -> repo.removeOutbox(id) },
        onModel = {
            sheet = "model"
            scope.launch { models = repo.models(sessionKey) }
        },
        onThinkingSheet = {
            sheet = "thinking"
            scope.launch { models = repo.models(sessionKey) }
        },
        onTools = { sheet = "tools" },
        purgeDraft = purgeEnabled,
        purgeLabel = draftPurgeSummary,
        onTogglePurge = if (hasPurgeSupport) ({ applyPurge(!purgeEnabled) }) else null,
        onOpenPurge = if (hasPurgeSupport) ({ sheet = "purge"; scope.launch { repo.purgeState(sessionKey)?.let { purge = it } } }) else null,
        lockedPersona = lockedPersonaSummary,
        activeSessions = activeSessions,
        onSwitchSession = onOpenSession,
        parentSummary = parentSummary,
        onOpenParent = parentSummary?.let { p -> ({ onOpenSession(p.sessionKey) }) },
        childSessions = childSessions,
        onOpenSubagents = if (childSessions.isNotEmpty()) ({ subagentSheet = true }) else null,
        onOpenUsage = { usageSheet = true },
        onAnswer = { resp -> scope.launch { repo.respondUi(sessionKey, resp) } },
        onSkip = { id -> scope.launch { repo.cancelUi(sessionKey, id) } },
        onDefer = { id -> deferred = deferred + id },
        loadDetail = { step -> repo.toolDetail(sessionKey, step.toolCallId)?.output },
    )
    }

    if (branchSheet) {
        BranchSheet(
            branches = branches,
            failed = branchesFailed,
            canSwitch = repo.canWrite,
            running = timeline?.state?.running == true || timeline?.turns?.lastOrNull()?.running == true,
            onSwitch = { leaf ->
                scope.launch {
                    repo.switchBranch(sessionKey, leaf)
                        .onSuccess { notice = null; branches = null; loadBranches() }
                        .onFailure { notice = switchFailed.replace("%s", it.message ?: "") }
                }
            },
            onDismiss = { branchSheet = false },
        )
    }

    review?.let { target ->
        ReviewScreen(
            target = target,
            canComment = repo.canWrite,
            comments = reviewComments,
            load = { sc, turn, path -> repo.reviewDiff(sessionKey, sc, turn, path) },
            onInsert = { text ->
                val base = draft.text.trimEnd()
                val merged = if (base.isEmpty()) text else "$base\n\n$text"
                updateDraft(TextFieldValue(merged, androidx.compose.ui.text.TextRange(merged.length)))
            },
            onDismiss = { review = null },
            onGenerateCommit = if (repo.canWrite) ({
                scope.launch {
                    val mode = if (runningNow) "followUp" else "prompt"
                    repo.send(sessionKey, commitPromptText, mode)
                }
            }) else null,
        )
    }

    previewTarget?.let { target ->
        FilePreviewScreen(
            target = target,
            canWrite = repo.canWrite,
            load = { path -> repo.readFile(sessionKey, path) },
            onInsert = { text ->
                val base = draft.text.trimEnd()
                val sep = if (base.isEmpty()) "" else if (text.startsWith("@")) " " else "\n\n"
                val merged = "$base$sep$text"
                updateDraft(TextFieldValue(merged, androidx.compose.ui.text.TextRange(merged.length)))
            },
            onDismiss = { previewTarget = null },
        )
    }

    if (filePicker) {
        FilePicker(
            projectName = summary?.projectId?.trimEnd('/', '\\')?.substringAfterLast('/')?.substringAfterLast('\\').orEmpty(),
            load = { path -> repo.listFiles(sessionKey, path) },
            search = { q -> repo.searchFiles(sessionKey, q) },
            onInsert = { paths -> updateDraft(insertMentions(draft, paths)) },
            onDismiss = { filePicker = false },
            onPreview = { path -> previewTarget = FileTarget(path) },
        )
    }

    if (subagentSheet && childSessions.isNotEmpty()) {
        PiSheet(onDismiss = { subagentSheet = false }) {
            Column(Modifier.padding(bottom = 18.dp)) {
                Text(stringResource(R.string.subagents_count, childSessions.size), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
                Hairline()
                for (c in childSessions) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) {
                            subagentSheet = false
                            onPushSession(c.sessionKey)
                        }.padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        when (c.status) {
                            "needsInput" -> PiIcon(PiIcons.Question, Pi.c.warn, 14.dp)
                            "failed" -> PiIcon(PiIcons.Alert, Pi.c.bad, 14.dp)
                            "running" -> Spinner(Pi.c.blue, 14.dp)
                            else -> Dot(Pi.c.fg3, 6.dp)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.title.ifEmpty { stringResource(R.string.session_untitled) }, style = Pi.t.body.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val sub = (if (c.status == "running") c.live else c.preview)?.takeIf { it.isNotBlank() }
                            if (sub != null) Text(sub, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 14.dp)
                    }
                }
            }
        }
    }

    if (usageSheet) {
        UsageSheet(
            load = { days -> repo.usageSummary(days) },
            cached30d = hostMeta.usage30d,
            onDismiss = { usageSheet = false },
        )
    }

    if (commandSheet) {
        CommandSheet(slash, onPick = { item ->
            commandSheet = false
            pickSlash(item)
        }, onDismiss = { commandSheet = false })
    }

    if (attachSheet) {
        AttachSheet(
            onCamera = {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera()
                else cameraPermission.launch(Manifest.permission.CAMERA)
            },
            onPhotos = { pickPhotos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            onFiles = { pickFiles.launch(arrayOf("*/*")) },
            onDismiss = { attachSheet = false },
        )
    }

    when (sheet) {
        "tools" -> ToolsSheet(
            caps, cache, repo.canWrite,
            onCapability = { id, on ->
                caps = caps.map {
                    when {
                        it.id == id -> it.copy(enabled = on)
                        on && id == "browser" && it.id == "chrome" -> it.copy(enabled = false)
                        on && id == "chrome" && it.id == "browser" -> it.copy(enabled = false)
                        else -> it
                    }
                }
                scope.launch { repo.setCapability(sessionKey, id, on) }
            },
            onCache = { mode ->
                cache = mode
                scope.launch { repo.setCacheWarming(mode) }
            },
            onDismiss = { sheet = null },
            purgeSummary = if (purgeEnabled) draftPurgeSummary else null,
            onOpenPurge = if (hasPurgeSupport) ({ sheet = "purge" }) else null,
        )
        "purge" -> PurgeSheet(
            state = purge,
            draftEnabled = purgeEnabled,
            draftPersonaId = selectedPersona?.id.orEmpty(),
            draftMode = purgeMode,
            canWrite = repo.canWrite,
            onToggle = { on -> applyPurge(on) },
            onSelectPersona = { id ->
                applyPurge(true, id, purgeMode)
                sheet = null
            },
            onSelectMode = { mode -> applyPurge(purgeEnabled, selectedPersona?.id, mode) },
            onDismiss = { sheet = null },
            midSession = !timeline?.turns.isNullOrEmpty() || runningNow,
        )
        "model" -> ModelSheet(
            models, repo.canWrite,
            onModel = { id ->
                models = models?.copy(current = id)
                scope.launch { repo.setModel(sessionKey, id) }
            },
            onDismiss = { sheet = null },
        )
        "thinking" -> ThinkingSheet(
            models?.thinking ?: timeline?.state?.thinking, models?.availableThinking.orEmpty(), repo.canWrite,
            onCommit = { level ->
                models = models?.copy(thinking = level)
                scope.launch { repo.setThinking(sessionKey, level) }
            },
            onDismiss = { sheet = null },
        )
    }
}

/** Stateless session screen (screenshot tests drive it directly). */
@Composable
fun SessionContent(
    title: String,
    project: String,
    timeline: SessionTimeline?,
    connection: HostConnection.State,
    canWrite: Boolean,
    draft: TextFieldValue,
    onDraft: (TextFieldValue) -> Unit,
    notice: String?,
    toolsOn: Int,
    deferredUi: Set<String>,
    pendingText: String? = null,
    attachments: List<Attachment> = emptyList(),
    onAttach: () -> Unit = {},
    onRemoveAttachment: (String) -> Unit = {},
    onRetryAttachment: (String) -> Unit = {},
    onReceiveUris: (List<Uri>) -> Unit = {},
    mermaid: MermaidSource?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onLoadOlder: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    stopping: Boolean = false,
    onDequeue: () -> Unit = {},
    onEditQueued: ((Int) -> Unit)? = null,
    onRemoveQueued: ((Int) -> Unit)? = null,
    outbox: List<OutboxEntry> = emptyList(),
    onEditOutbox: ((String) -> Unit)? = null,
    onCancelOutbox: ((String) -> Unit)? = null,
    slashItems: List<SlashItem> = emptyList(),
    onSlashPick: (SlashItem) -> Unit = {},
    onCommands: () -> Unit = {},
    onFiles: () -> Unit = {},
    onRewind: (String) -> Unit = {},
    projectPath: String = "",
    stats: ContextStats? = null,
    usage: SessionUsage? = null,
    statsLoading: Boolean = false,
    onPanelOpened: () -> Unit = {},
    changes: ReviewDiffResult? = null,
    onReview: (ReviewTarget) -> Unit = {},
    branchCount: Int? = null,
    onBranches: () -> Unit = {},
    onFork: (String) -> Unit = {},
    onModel: () -> Unit,
    onThinkingSheet: () -> Unit = {},
    onTools: () -> Unit,
    onAnswer: (UiResponse) -> Unit,
    onSkip: (String) -> Unit,
    onDefer: (String) -> Unit,
    loadDetail: suspend (ToolStep) -> String?,
    listState: LazyListState = rememberLazyListState(),
    initialExpanded: Set<String> = emptySet(),
    purgeDraft: Boolean = false,
    purgeLabel: String? = null,
    onTogglePurge: (() -> Unit)? = null,
    onOpenPurge: (() -> Unit)? = null,
    lockedPersona: String? = null,
    activeSessions: List<SessionSummary> = emptyList(),
    onSwitchSession: ((String) -> Unit)? = null,
    parentSummary: SessionSummary? = null,
    onOpenParent: (() -> Unit)? = null,
    childSessions: List<SessionSummary> = emptyList(),
    onOpenSubagents: (() -> Unit)? = null,
    onOpenUsage: (() -> Unit)? = null,
) {
    val showIntermediateMessages = LocalUiPrefs.current?.showIntermediateMessages?.collectAsState()?.value ?: false
    val turns = timeline?.turns.orEmpty()
    val state = timeline?.state
    val running = state?.running == true || turns.lastOrNull()?.running == true
    val expanded = remember { mutableStateMapOf<String, Boolean>().apply { initialExpanded.forEach { put(it, true) } } }
    val now = useTicker(running)
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<Pair<List<ToolStep>, Int>?>(null) }
    var viewing by remember { mutableStateOf<Pair<String, MessagePart>?>(null) }
    var acting by remember { mutableStateOf<Pair<String, MessagePart>?>(null) }
    val question: UiRequest? = timeline?.pendingUi?.firstOrNull { it !is UiNotify && it.id !in deferredUi }
    val offset = remember { java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()).toLong() }
    val reviewNow by androidx.compose.runtime.rememberUpdatedState(onReview)
    // One instance for the screen's lifetime: a fresh object per recomposition would defeat skipping on every turn.
    val callbacks = remember {
        TurnCallbacks(
            onToggle = { id -> expanded[id] = expanded[id] != true },
            onStep = { turn, step ->
                val tools = turn.steps.filterIsInstance<ToolStep>()
                detail = tools to tools.indexOfFirst { it.id == step.id }
            },
            // A file under the answer opens this turn's change to it (review, comment).
            onFile = { turn, path -> reviewNow(ReviewTarget("turn", turn.id, path)) },
            onOpen = { turn, part -> viewing = turn.id to part },
            onActions = { turn, part -> acting = turn.id to part },
        )
    }
    // Parse settled markdown off the main thread so items entering the viewport render from cache.
    LaunchedEffect(turns) {
        withContext(Dispatchers.Default) { for (t in turns) if (!t.running) MarkdownCache.prewarm(t.answer) }
    }

    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 40 } }
    LaunchedEffect(listState, timeline?.hasOlder) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }.distinctUntilChanged().collect { last ->
            if (last != null && timeline?.hasOlder == true && last >= turns.size) onLoadOlder()
        }
    }

    val density = LocalDensity.current
    val still = reducedMotion()
    val panel = remember { Animatable(0f) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val panelWidth = minOf(maxWidth * 0.86f, 340.dp)
    val panelPx = with(density) { panelWidth.toPx() }
    fun settlePanel(velocity: Float) {
        val target = when {
            velocity < -700f -> 1f
            velocity > 700f -> 0f
            else -> if (panel.value > 0.5f) 1f else 0f
        }
        scope.launch {
            if (still) panel.snapTo(target)
            else panel.animateTo(
                target,
                spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 500f),
                initialVelocity = (-velocity / panelPx).coerceIn(-8f, 8f),
            )
        }
    }
    val dragState = rememberDraggableState { delta -> scope.launch { panel.snapTo((panel.value - delta / panelPx).coerceIn(0f, 1f)) } }
    LaunchedEffect(panel) {
        snapshotFlow { panel.value > 0.5f }.distinctUntilChanged().collect { if (it) onPanelOpened() }
    }
    BackHandler(enabled = panel.targetValue > 0f || panel.value > 0f) { settlePanel(1000f) }
    var todoOpen by rememberSaveable(timeline?.sessionKey) { mutableStateOf(false) }
    BackHandler(enabled = todoOpen) { todoOpen = false }
    // Swipe left anywhere (not from the edges: those are system back) pulls the panel in; right closes it.
    Column(Modifier.fillMaxSize().background(Pi.c.bg).imePadding().draggable(dragState, Orientation.Horizontal, onDragStopped = { v -> settlePanel(v) })) {
        TopBar(
            title = title,
            subtitle = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val (color, text) = when {
                        question != null -> Pi.c.warn to stringResource(R.string.status_needs)
                        running -> Pi.c.blue to stringResource(R.string.status_running)
                        else -> Pi.c.fg3 to stringResource(R.string.status_idle)
                    }
                    Dot(color, 6.dp)
                    Spacer(Modifier.width(6.dp))
                    val personaShort = lockedPersona?.substringBefore(" · ")?.takeIf { it.isNotBlank() }
                    Text(listOfNotNull(project.takeIf { it.isNotEmpty() }, personaShort, text).joinToString(" · "), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            onBack = onBack,
            backLabel = stringResource(R.string.back),
        ) { IconAction(PiIcons.More, stringResource(R.string.panel_title), { settlePanel(-1000f) }) }
        ConnectionBanner(connection, onRetry)
        if (parentSummary != null && onOpenParent != null) {
            Row(
                Modifier.fillMaxWidth().background(Pi.c.surface).clickable(role = Role.Button, onClick = onOpenParent).padding(horizontal = 16.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.ChevronLeft, Pi.c.fg3, 13.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    stringResource(R.string.subagent_parent_bar, parentSummary.title.ifEmpty { stringResource(R.string.session_untitled) }),
                    style = Pi.t.meta.copy(color = Pi.c.fg2),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Hairline()
        }
        if (childSessions.isNotEmpty() && onOpenSubagents != null) {
            val childRunning = childSessions.count { it.status == "running" }
            Row(
                Modifier.fillMaxWidth().background(Pi.c.surface).clickable(role = Role.Button, onClick = onOpenSubagents).padding(horizontal = 16.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (childRunning > 0) Spinner(Pi.c.blue, 12.dp) else PiIcon(PiIcons.Branch, Pi.c.fg3, 13.dp)
                Spacer(Modifier.width(8.dp))
                Text(
                    if (childRunning > 0) stringResource(R.string.subagents_running, childSessions.size, childRunning)
                    else stringResource(R.string.subagents_count, childSessions.size),
                    style = Pi.t.meta.copy(color = if (childRunning > 0) Pi.c.fg else Pi.c.fg2),
                    modifier = Modifier.weight(1f),
                )
                PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 13.dp)
            }
            Hairline()
        }
        notice?.let { Banner(it) }
        if (!canWrite) Banner(stringResource(R.string.readonly))

        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(28.dp)) {
                item("pad-bottom") { Spacer(Modifier.height(4.dp)) }
                pendingText?.let { text -> item("pending-send", contentType = "pending") { PendingBubble(text) } }
                val reversed = turns.asReversed()
                itemsIndexed(reversed, key = { _, t -> t.id }, contentType = { _, t -> if (t.running) "live" else "turn" }) { ri, t ->
                    val i = turns.size - 1 - ri
                    val prev = turns.getOrNull(i - 1)
                    val divider = t.startedAt?.takeIf { TimeDividers.showDivider(prev?.startedAt, it, offset) }
                    // Only the running turn reads the ticking clock; settled turns keep skipping.
                    TurnItem(t, expanded[t.id] == true, divider, if (t.running) now else 0L, mermaid, callbacks, showIntermediateMessages)
                }
                if (timeline?.hasOlder == true) {
                    item("older") {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QuietButton(stringResource(R.string.older), onLoadOlder, color = Pi.c.fg3) }
                    }
                }
                item("pad-top") { Spacer(Modifier.height(12.dp)) }
            }

            val marks = remember(turns) {
                turns.mapIndexedNotNull { i, t -> t.user.text.takeIf { it.isNotBlank() }?.let { ScrubMark(i, it.replace(Regex("\\s+"), " ").take(80), t.startedAt) } }
            }
            val active by remember(marks) {
                derivedStateOf {
                    val bottomTurn = turns.size - 1 - (listState.firstVisibleItemIndex - 1).coerceAtLeast(0)
                    marks.indexOfLast { it.turnIndex <= bottomTurn }.coerceAtLeast(0)
                }
            }
            ScrubberRail(marks, active, onJump = { turnIndex ->
                // Instant while dragging: the list follows the finger mark by mark.
                scope.launch { listState.scrollToItem(turns.size - turnIndex) }
            }, modifier = Modifier.align(Alignment.CenterEnd).padding(vertical = 12.dp))

            if (question == null) state?.todo?.let { TodoList(it, todoOpen, Modifier.align(Alignment.BottomCenter)) }

            if (!atBottom && turns.isNotEmpty() && !todoOpen) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 14.dp).size(36.dp).clip(CircleShape).background(Pi.c.bg).border(1.dp, Pi.c.line, CircleShape)
                        .clickable(role = Role.Button) { scope.launch { listState.animateScrollToItem(0) } },
                    contentAlignment = Alignment.Center,
                ) { PiIcon(PiIcons.ArrowDown, Pi.c.fg2, 16.dp, contentDescription = stringResource(R.string.jump_latest)) }
            }
        }

        if (question == null) state?.todo?.let { TodoTray(it, todoOpen) { todoOpen = !todoOpen } }
        if (question != null) {
            QuestionCard(question, enabled = canWrite && connection is HostConnection.State.Ready, onAnswer = onAnswer, onSkip = { onSkip(question.id) }, onDesktop = { onDefer(question.id) })
        } else {
            Composer(
                text = draft,
                onText = onDraft,
                running = running,
                enabled = canWrite && connection is HostConnection.State.Ready,
                editable = canWrite,
                modelLabel = state?.model?.substringAfter('/')?.ifEmpty { null } ?: stringResource(R.string.model),
                thinkingLabel = thinkingLabel(state?.thinking),
                onThinking = onThinkingSheet,
                toolsOn = toolsOn,
                queue = state?.queue,
                onSend = onSend,
                onStop = onStop,
                stopping = stopping,
                onDequeue = onDequeue,
                slashItems = slashItems,
                onSlashPick = onSlashPick,
                onCommands = onCommands,
                onFiles = onFiles,
                onModel = onModel,
                onTools = onTools,
                attachments = attachments,
                onAttach = onAttach,
                onRemoveAttachment = onRemoveAttachment,
                onRetryAttachment = onRetryAttachment,
                onReceiveUris = onReceiveUris,
                purgeDraft = purgeDraft,
                purgeLabel = purgeLabel,
                onTogglePurge = onTogglePurge,
                onOpenPurge = onOpenPurge,
                onEditQueued = onEditQueued,
                onRemoveQueued = onRemoveQueued,
                outbox = outbox,
                onEditOutbox = onEditOutbox,
                onCancelOutbox = onCancelOutbox,
                canQueueOffline = !running,
            )
        }
    }


    val (statusColor, statusText) = when {
        question != null -> Pi.c.warn to stringResource(R.string.status_needs)
        running -> Pi.c.blue to stringResource(R.string.status_running)
        else -> Pi.c.fg3 to stringResource(R.string.status_idle)
    }
    SessionPanel(
        progress = { panel.value },
        width = panelWidth,
        facts = sessionFacts(title, projectPath.ifEmpty { project }, statusText, statusColor, timeline, toolsOn, lockedPersona),
        stats = stats,
        usage = usage,
        onOpenUsage = onOpenUsage,
        statsLoading = statsLoading,
        onClose = { settlePanel(1000f) },
        changes = changes,
        branchCount = branchCount,
        activeSessions = activeSessions,
        onSwitchSession = onSwitchSession,
        onBranches = {
            settlePanel(1000f)
            onBranches()
        },
        onChanges = {
            settlePanel(1000f)
            onReview(ReviewTarget("git", turns.lastOrNull()?.id))
        },
        modifier = Modifier.draggable(dragState, Orientation.Horizontal, onDragStopped = { v -> settlePanel(v) }),
    )
    }

    acting?.let { (id, part) ->
        turns.firstOrNull { it.id == id }?.let { t ->
            MessageActionsSheet(
                t, part, canEdit = canWrite,
                onFullscreen = {
                    acting = null
                    viewing = id to part
                },
                onEdit = { text -> onDraft(TextFieldValue(PromptAttachments.split(text).first).let { it.copy(selection = androidx.compose.ui.text.TextRange(it.text.length)) }) },
                onDismiss = { acting = null },
                // Saved turns only, and never under a running agent.
                rewindLater = turns.indexOf(t).takeIf { canWrite && !running && !t.anchor.startsWith("live:") }?.let { turns.size - 1 - it },
                onRewind = { onRewind(t.anchor) },
                onFork = if (part == MessagePart.User && canWrite && !running && !t.anchor.startsWith("live:")) ({ onFork(t.anchor) }) else null,
            )
        } ?: run { acting = null }
    }
    viewing?.let { (id, part) ->
        turns.firstOrNull { it.id == id }?.let { t -> MessageViewer(t, part, mermaid, onDismiss = { viewing = null }) } ?: run { viewing = null }
    }

    detail?.let { (steps, start) -> StepDetailSheet(steps, start, loadDetail, onDismiss = { detail = null }) }
}
