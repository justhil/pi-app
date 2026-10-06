package dev.pi.remote.app.ui.session

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.ui.platform.LocalDensity
import androidx.activity.compose.BackHandler
import dev.pi.remote.protocol.ContextStats
import dev.pi.remote.protocol.ReviewDiffResult
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
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.data.SendOutcome
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Banner
import dev.pi.remote.app.ui.ConnectionBanner
import dev.pi.remote.app.ui.Dot
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.TopBar
import dev.pi.remote.app.ui.rich.MermaidSource
import dev.pi.remote.app.ui.useTicker
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.CapabilityRow
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.ToolStep
import dev.pi.remote.protocol.Turn
import dev.pi.remote.protocol.UiNotify
import dev.pi.remote.protocol.UiRequest
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.sync.SessionTimeline
import dev.pi.remote.text.TimeDividers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@Composable
fun SessionScreen(repo: RemoteRepository, sessionKey: String, onBack: () -> Unit, onOpenSession: (String) -> Unit = {}) {
    val timelines by repo.timelines.collectAsState()
    val connection by repo.connection.collectAsState()
    val inbox by repo.inbox.collectAsState()
    val settingsVersion by repo.settingsVersion.collectAsState()
    val pendingSends by repo.pendingSends.collectAsState()
    val scope = rememberCoroutineScope()
    val timeline = timelines[sessionKey]
    val summary = inbox.sessions.firstOrNull { it.sessionKey == sessionKey }
    var draft by remember(sessionKey) { mutableStateOf(TextFieldValue("")) }
    var notice by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<String?>(null) }
    var caps by remember { mutableStateOf<List<CapabilityRow>>(emptyList()) }
    var cache by remember { mutableStateOf<String?>(null) }
    var models by remember { mutableStateOf<ModelListResult?>(null) }
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
            if (s.text.isNotBlank()) draft = TextFieldValue(listOf(draft.text, s.text).filter { it.isNotBlank() }.joinToString("\n"))
            addAll(s.uris)
        }
    }
    val ready = connection is HostConnection.State.Ready
    val stopFailed = stringResource(R.string.stop_failed)
    val rewindFailed = stringResource(R.string.msg_rewind_failed, "%s")
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
        draft = TextFieldValue(merged, androidx.compose.ui.text.TextRange(merged.length))
    }
    val maybeLost = stringResource(R.string.maybe_not_sent)

    LaunchedEffect(sessionKey, ready) { repo.openSession(sessionKey) }
    LaunchedEffect(sessionKey, ready, settingsVersion) {
        if (ready) {
            caps = repo.capabilities(sessionKey)
            cache = repo.cacheWarming()
        }
    }
    var commands by remember(sessionKey) { mutableStateOf(repo.cachedCommands(sessionKey)) }
    var commandSheet by remember { mutableStateOf(false) }
    var filePicker by remember { mutableStateOf(false) }
    var stats by remember(sessionKey) { mutableStateOf<ContextStats?>(null) }
    var changes by remember(sessionKey) { mutableStateOf<ReviewDiffResult?>(null) }
    var review by remember { mutableStateOf<ReviewTarget?>(null) }
    val reviewComments = remember(sessionKey) { androidx.compose.runtime.mutableStateListOf<LineComment>() }
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
            draft = stripSlash(draft)
            runBuiltin(item.name)
        } else draft = insertSlash(draft, item.name)
    }
    androidx.compose.runtime.DisposableEffect(sessionKey) { onDispose { repo.closeSession(sessionKey) } }

    SessionContent(
        title = timeline?.title?.ifEmpty { null } ?: summary?.title.orEmpty(),
        project = summary?.projectId?.trimEnd('/', '\\')?.substringAfterLast('/')?.substringAfterLast('\\').orEmpty(),
        timeline = timeline,
        connection = connection,
        canWrite = repo.canWrite,
        draft = draft,
        onDraft = { draft = it },
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
                draft = TextFieldValue("")
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
                    draft = TextFieldValue("")
                    attachments.clear()
                    when (val r = repo.send(sessionKey, text, mode)) {
                        SendOutcome.Sent -> notice = null
                        SendOutcome.Unknown -> notice = maybeLost
                        is SendOutcome.Failed -> {
                            notice = r.message
                            draft = TextFieldValue(typed)
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
        statsLoading = statsLoading,
        onPanelOpened = {
            statsLoading = true
            scope.launch {
                repo.contextStats(sessionKey)?.let { stats = it }
                statsLoading = false
            }
            scope.launch { repo.reviewDiff(sessionKey, "git").onSuccess { changes = it } }
        },
        changes = changes,
        onReview = { review = it },
        onRewind = { anchor ->
            scope.launch {
                repo.rewind(sessionKey, anchor)
                    .onSuccess { text ->
                        val body = PromptAttachments.split(text).first
                        if (body.isNotBlank()) draft = TextFieldValue(body, androidx.compose.ui.text.TextRange(body.length))
                        notice = null
                    }
                    .onFailure { notice = rewindFailed.replace("%s", it.message ?: "") }
            }
        },
        onDequeue = { scope.launch { repo.dequeue(sessionKey)?.let(::restore) } },
        onModel = {
            sheet = "model"
            scope.launch { models = repo.models(sessionKey) }
        },
        onThinkingSheet = {
            sheet = "thinking"
            scope.launch { models = repo.models(sessionKey) }
        },
        onTools = { sheet = "tools" },
        onAnswer = { resp -> scope.launch { repo.respondUi(sessionKey, resp) } },
        onSkip = { id -> scope.launch { repo.cancelUi(sessionKey, id) } },
        onDefer = { id -> deferred = deferred + id },
        loadDetail = { step -> repo.toolDetail(sessionKey, step.toolCallId)?.output },
    )

    review?.let { target ->
        ReviewScreen(
            target = target,
            canComment = repo.canWrite,
            comments = reviewComments,
            load = { sc, turn, path -> repo.reviewDiff(sessionKey, sc, turn, path) },
            onInsert = { text ->
                val base = draft.text.trimEnd()
                val merged = if (base.isEmpty()) text else "$base\n\n$text"
                draft = TextFieldValue(merged, androidx.compose.ui.text.TextRange(merged.length))
            },
            onDismiss = { review = null },
        )
    }

    if (filePicker) {
        FilePicker(
            projectName = summary?.projectId?.trimEnd('/', '\\')?.substringAfterLast('/')?.substringAfterLast('\\').orEmpty(),
            load = { path -> repo.listFiles(sessionKey, path) },
            search = { q -> repo.searchFiles(sessionKey, q) },
            onInsert = { paths -> draft = insertMentions(draft, paths) },
            onDismiss = { filePicker = false },
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
                caps = caps.map { if (it.id == id) it.copy(enabled = on) else it }
                scope.launch { repo.setCapability(sessionKey, id, on) }
            },
            onCache = { mode ->
                cache = mode
                scope.launch { repo.setCacheWarming(mode) }
            },
            onDismiss = { sheet = null },
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
    slashItems: List<SlashItem> = emptyList(),
    onSlashPick: (SlashItem) -> Unit = {},
    onCommands: () -> Unit = {},
    onFiles: () -> Unit = {},
    onRewind: (String) -> Unit = {},
    projectPath: String = "",
    stats: ContextStats? = null,
    statsLoading: Boolean = false,
    onPanelOpened: () -> Unit = {},
    changes: ReviewDiffResult? = null,
    onReview: (ReviewTarget) -> Unit = {},
    onModel: () -> Unit,
    onThinkingSheet: () -> Unit = {},
    onTools: () -> Unit,
    onAnswer: (UiResponse) -> Unit,
    onSkip: (String) -> Unit,
    onDefer: (String) -> Unit,
    loadDetail: suspend (ToolStep) -> String?,
    listState: LazyListState = rememberLazyListState(),
    initialExpanded: Set<String> = emptySet(),
) {
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
        scope.launch { panel.animateTo(target, spring(dampingRatio = 0.92f, stiffness = 420f), initialVelocity = -velocity / panelPx) }
    }
    val dragState = rememberDraggableState { delta -> scope.launch { panel.snapTo((panel.value - delta / panelPx).coerceIn(0f, 1f)) } }
    LaunchedEffect(panel) {
        snapshotFlow { panel.value > 0.5f }.distinctUntilChanged().collect { if (it) onPanelOpened() }
    }
    BackHandler(enabled = panel.targetValue > 0f || panel.value > 0f) { settlePanel(1000f) }
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
                    Text(listOf(project, text).filter { it.isNotEmpty() }.joinToString(" · "), style = Pi.t.meta.copy(color = Pi.c.fg3))
                }
            },
            onBack = onBack,
            backLabel = stringResource(R.string.back),
        ) { IconAction(PiIcons.More, stringResource(R.string.panel_title), { settlePanel(-1000f) }) }
        ConnectionBanner(connection, onRetry)
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
                    TurnItem(t, expanded[t.id] == true, divider, if (t.running) now else 0L, mermaid, callbacks)
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

            if (!atBottom && turns.isNotEmpty()) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 14.dp).size(36.dp).clip(CircleShape).background(Pi.c.bg).border(1.dp, Pi.c.line, CircleShape)
                        .clickable(role = Role.Button) { scope.launch { listState.animateScrollToItem(0) } },
                    contentAlignment = Alignment.Center,
                ) { PiIcon(PiIcons.ArrowDown, Pi.c.fg2, 16.dp, contentDescription = stringResource(R.string.jump_latest)) }
            }
        }

        if (question == null) state?.todo?.let { TodoTray(timeline?.sessionKey ?: "", it) }
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
        facts = sessionFacts(title, projectPath.ifEmpty { project }, statusText, statusColor, timeline, toolsOn),
        stats = stats,
        statsLoading = statsLoading,
        onClose = { settlePanel(1000f) },
        changes = changes,
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
            )
        } ?: run { acting = null }
    }
    viewing?.let { (id, part) ->
        turns.firstOrNull { it.id == id }?.let { t -> MessageViewer(t, part, mermaid, onDismiss = { viewing = null }) } ?: run { viewing = null }
    }

    detail?.let { (steps, start) -> StepDetailSheet(steps, start, loadDetail, onDismiss = { detail = null }) }
}
