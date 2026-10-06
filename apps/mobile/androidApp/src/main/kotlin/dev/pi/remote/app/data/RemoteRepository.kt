package dev.pi.remote.app.data

import dev.pi.remote.crypto.Hs2Payload
import dev.pi.remote.net.HostConnection
import dev.pi.remote.net.RemoteApi
import dev.pi.remote.protocol.AppInfo
import dev.pi.remote.protocol.Base64Url
import dev.pi.remote.protocol.CapabilityRow
import dev.pi.remote.protocol.ClientCaps
import dev.pi.remote.protocol.HelloParams
import dev.pi.remote.protocol.HelloResult
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.PairOffer
import dev.pi.remote.protocol.ProjectInfo
import dev.pi.remote.protocol.RemoteJson
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.protocol.SessionsUpdate
import dev.pi.remote.protocol.SettingsChanged
import dev.pi.remote.protocol.ToolDetailResult
import dev.pi.remote.protocol.TurnPatchEvent
import dev.pi.remote.protocol.UiDismiss
import dev.pi.remote.protocol.UiRequest
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.sync.ApplyResult
import dev.pi.remote.sync.SessionTimeline
import dev.pi.remote.sync.TurnStore
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Templates / components / dialog kinds this build renders natively (sent in host.hello). */
val CLIENT_CAPS = ClientCaps(
    templates = listOf("bash", "read", "edit", "write", "search", "default", "list", "kv", "media", "tree"),
    piUi = listOf("stat-grid", "chart", "data-table", "card-grid", "diff", "quiz", "decision-tree", "gantt"),
    uiKinds = listOf("select", "confirm", "input", "editor", "notify", "ask_user_question", "image_review"),
)

data class InboxState(
    val sessions: List<SessionSummary> = emptyList(),
    val projects: List<ProjectInfo> = emptyList(),
    val loaded: Boolean = false,
)

sealed interface SendOutcome {
    data object Sent : SendOutcome
    /** The socket dropped before the answer: the message may or may not have arrived. */
    data object Unknown : SendOutcome
    data class Failed(val message: String) : SendOutcome
}

/**
 * App-wide remote state for the active host: one [HostConnection], the inbox, and the
 * timeline of the open session. Survives screen changes; connects only while the app is in
 * the foreground (30 s grace after backgrounding).
 */
class RemoteRepository(
    private val scope: CoroutineScope,
    private val hostStore: HostStore,
    private val keyVault: KeyVault,
    private val cache: TimelineCache,
    private val assetDir: File,
    private val deviceName: String,
    private val platform: String,
    private val appVersion: String,
) {
    private val _hosts = MutableStateFlow(hostStore.hosts)
    val hosts: StateFlow<List<SavedHost>> = _hosts
    private val _active = MutableStateFlow(hostStore.hosts.firstOrNull { it.hostId == hostStore.activeHostId })
    val active: StateFlow<SavedHost?> = _active
    private val _connection = MutableStateFlow<HostConnection.State>(HostConnection.State.Idle)
    val connection: StateFlow<HostConnection.State> = _connection
    private val _inbox = MutableStateFlow(InboxState())
    val inbox: StateFlow<InboxState> = _inbox
    private val _timelines = MutableStateFlow<Map<String, SessionTimeline>>(emptyMap())
    val timelines: StateFlow<Map<String, SessionTimeline>> = _timelines
    private val _pendingSends = MutableStateFlow<Map<String, String>>(emptyMap())
    /** Text sent from this phone that the host has not echoed back as a turn yet (shown as a ghost bubble). */
    val pendingSends: StateFlow<Map<String, String>> = _pendingSends
    private val _settingsVersion = MutableStateFlow(0)
    val settingsVersion: StateFlow<Int> = _settingsVersion
    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val notices: SharedFlow<String> = _notices

    private var conn: HostConnection? = null
    private var api: RemoteApi? = null
    private var jobs = mutableListOf<Job>()
    private var openKey: String? = null
    private var stopJob: Job? = null
    private var hello: HelloResult? = null
    private var foreground = false

    private val helloParams get() = HelloParams(AppInfo("pi-remote", appVersion, platform), CLIENT_CAPS)

    init {
        _active.value?.let { h -> _inbox.value = InboxState(sessions = cache.loadInbox(h.hostId)) }
    }

    // ── Hosts / pairing ──

    /** Pair with a scanned/pasted offer. Resolves once the host accepted and answered hello. */
    suspend fun pair(offer: PairOffer): Result<SavedHost> {
        disconnect()
        var saved: SavedHost? = null
        val c = HostConnection(
            scope, offer.endpoints, Base64Url.decode(offer.hostPub), keyVault.identity(), deviceName, platform, helloParams, offer.pairToken,
            onPaired = { p: Hs2Payload ->
                saved = SavedHost(p.hostId, p.hostName, offer.hostPub, offer.endpoints, p.deviceId, p.role, System.currentTimeMillis()).also {
                    hostStore.upsert(it)
                    _hosts.value = hostStore.hosts
                }
            },
        )
        c.start()
        val end = withTimeoutOrNull(20_000) { c.state.first { it is HostConnection.State.Ready || it is HostConnection.State.Refused } }
        c.stop()
        return when {
            end is HostConnection.State.Ready && saved != null -> {
                select(saved!!.hostId)
                Result.success(saved!!)
            }
            end is HostConnection.State.Refused -> Result.failure(IllegalStateException(end.code))
            else -> Result.failure(IllegalStateException("unreachable"))
        }
    }

    fun select(hostId: String) {
        val host = hostStore.hosts.firstOrNull { it.hostId == hostId } ?: return
        hostStore.setActive(hostId)
        if (_active.value?.hostId != hostId) {
            disconnect()
            _timelines.value = emptyMap()
            _inbox.value = InboxState(sessions = cache.loadInbox(hostId))
        }
        _active.value = host
        if (foreground) connect()
    }

    fun forget(hostId: String) {
        if (_active.value?.hostId == hostId) {
            disconnect()
            _active.value = null
            _inbox.value = InboxState()
            _timelines.value = emptyMap()
        }
        hostStore.remove(hostId)
        cache.clearHost(hostId)
        _hosts.value = hostStore.hosts
    }

    // ── Lifecycle ──

    fun onForeground() {
        foreground = true
        openKey?.let { notifier?.clear(it) }
        updateKeepAlive()
        stopJob?.cancel()
        stopJob = null
        val c = conn
        if (c == null) connect() else c.kick()
    }

    fun onBackground() {
        foreground = false
        scheduleDisconnect()
        updateKeepAlive()
    }

    fun retry() {
        conn?.kick() ?: connect()
    }

    private fun connect() {
        val host = _active.value ?: return
        if (conn != null) return
        val c = HostConnection(scope, host.endpoints, Base64Url.decode(host.hostPub), keyVault.identity(), deviceName, platform, helloParams)
        conn = c
        api = RemoteApi(c)
        jobs += scope.launch { c.state.collect { s -> _connection.value = s; if (s is HostConnection.State.Ready) onReady(s) } }
        jobs += scope.launch { c.events.collect(::onEvent) }
        c.start()
    }

    private fun disconnect() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        conn?.stop()
        conn = null
        api = null
        _connection.value = HostConnection.State.Idle
    }

    private suspend fun onReady(s: HostConnection.State.Ready) {
        hello = s.hello
        _active.value?.let { h ->
            // Remember what worked (first) plus the host's current addresses, so the next start
            // connects at once and a DHCP change does not need a new QR scan.
            val endpoints = (listOf(s.endpoint) + s.hello.endpoints + h.endpoints).distinct().take(8)
            conn?.updateEndpoints(endpoints)
            val updated = h.copy(hostName = s.hello.hostName, role = s.hello.role, endpoints = endpoints, lastConnectedAt = System.currentTimeMillis())
            hostStore.upsert(updated)
            _active.value = updated
            _hosts.value = hostStore.hosts
        }
        val a = api ?: return
        runCatching {
            val projects = a.projects()
            val sessions = a.watchList()
            _inbox.value = InboxState(sessions, projects, loaded = true)
            persistInbox()
        }.onFailure { _notices.tryEmit(it.message ?: "list failed") }
        openKey?.let { reopen(it) }
    }

    private fun persistInbox() {
        val host = _active.value ?: return
        val sessions = _inbox.value.sessions
        scope.launch(Dispatchers.IO) { cache.saveInbox(host.hostId, sessions) }
    }

    private fun onEvent(e: HostConnection.Event) {
        when (e.method) {
            "sessions.update" -> {
                val u = RemoteJson.decodeFromJsonElement(SessionsUpdate.serializer(), e.payload)
                val before = _inbox.value.sessions.associateBy { it.sessionKey }
                _inbox.update { inbox ->
                    val byKey = inbox.sessions.associateBy { it.sessionKey }.toMutableMap()
                    u.sessions.forEach { byKey[it.sessionKey] = it }
                    u.removed?.forEach { byKey.remove(it) }
                    inbox.copy(sessions = byKey.values.sortedByDescending { it.updatedAt })
                }
                persistInbox()
                noticeTransitions(before, u.sessions)
            }
            "turn.patch" -> {
                val evt = RemoteJson.decodeFromJsonElement(TurnPatchEvent.serializer(), e.payload)
                val current = _timelines.value[evt.sessionKey] ?: return
                when (val r = TurnStore.applyAll(current, evt.patches)) {
                    is ApplyResult.Applied -> putTimeline(r.timeline)
                    is ApplyResult.Gap -> {
                        putTimeline(r.timeline)
                        scope.launch { reopen(evt.sessionKey) }
                    }
                }
            }
            "ui.request" -> {
                val req = RemoteJson.decodeFromJsonElement(UiRequest.serializer(), e.payload)
                _timelines.value[req.sessionKey]?.let { putTimeline(TurnStore.addUi(it, req)) }
            }
            "ui.dismiss" -> {
                val d = RemoteJson.decodeFromJsonElement(UiDismiss.serializer(), e.payload)
                _timelines.value[d.sessionKey]?.let { putTimeline(TurnStore.removeUi(it, d.id)) }
            }
            "settings.changed" -> {
                RemoteJson.decodeFromJsonElement(SettingsChanged.serializer(), e.payload)
                _settingsVersion.update { it + 1 }
            }
            "host.notice" -> _notices.tryEmit(e.payload.toString())
        }
    }

    private fun putTimeline(t: SessionTimeline) {
        _timelines.update { it + (t.sessionKey to t) }
        val pending = _pendingSends.value[t.sessionKey] ?: return
        if (t.turns.takeLast(2).any { it.user.text.trim() == pending }) _pendingSends.update { it - t.sessionKey }
    }

    private var saveJob: Job? = null
    private fun persistTimeline(key: String) {
        val host = _active.value ?: return
        saveJob?.cancel()
        saveJob = scope.launch(Dispatchers.IO) {
            delay(1500)
            _timelines.value[key]?.let { cache.saveTimeline(host.hostId, it) }
        }
    }

    // ── Sessions ──

    /** Show cache immediately, then sync (replay from cursor when possible). */
    suspend fun openSession(key: String) {
        openKey = key
        // The session screen stays composed in the background and re-opens on reconnects;
        // only an actual look at it (foreground) should clear its notification.
        if (foreground) notifier?.clear(key)
        val host = _active.value
        if (_timelines.value[key] == null && host != null) {
            withContext(Dispatchers.IO) { cache.loadTimeline(host.hostId, key) }?.let { putTimeline(it) }
        }
        reopen(key)
    }

    private suspend fun reopen(key: String) {
        val a = api ?: return
        if (conn?.isReady != true) return
        val prev = _timelines.value[key]
        val cursor = prev?.cursor?.takeIf { it.epoch == hello?.epoch }
        runCatching { a.open(key, cursor) }
            .onSuccess { r ->
                putTimeline(TurnStore.fromOpen(prev?.takeIf { r.kind == "replay" }, r))
                persistTimeline(key)
            }
            .onFailure { _notices.tryEmit(it.message ?: "open failed") }
    }

    fun closeSession(key: String) {
        if (openKey == key) openKey = null
        persistTimeline(key)
        val a = api ?: return
        scope.launch { runCatching { a.close(key) } }
    }

    suspend fun loadOlder(key: String) {
        val a = api ?: return
        val t = _timelines.value[key] ?: return
        val first = t.turns.firstOrNull() ?: return
        runCatching { a.page(key, first.anchor) }.onSuccess { r ->
            _timelines.value[key]?.let { putTimeline(TurnStore.prependOlder(it, r.turns, r.hasOlder)) }
        }
    }

    suspend fun send(key: String, text: String, mode: String): SendOutcome {
        val a = api ?: return SendOutcome.Failed("offline")
        if (mode == "prompt") _pendingSends.update { it + (key to text.trim()) }
        return try {
            a.send(key, text, mode, "m_${UUID.randomUUID()}")
            SendOutcome.Sent
        } catch (e: HostConnection.ConnectionLost) {
            SendOutcome.Unknown
        } catch (e: Exception) {
            _pendingSends.update { it - key }
            SendOutcome.Failed(e.message ?: "send failed")
        }
    }

    /** Queued texts the host pulled back, or null when the stop did not reach it. */
    suspend fun abort(key: String): List<String>? = runCatching { api?.abort(key)?.let { it.restored.orEmpty() } }.getOrNull()

    suspend fun dequeue(key: String): List<String>? = runCatching { api?.dequeue(key)?.restored }.getOrNull()

    suspend fun respondUi(key: String, response: UiResponse): Boolean {
        val ok = runCatching { api?.respondUi(response) ?: false }.getOrDefault(false)
        _timelines.value[key]?.let { putTimeline(TurnStore.removeUi(it, response.id)) }
        return ok
    }

    suspend fun cancelUi(key: String, id: String) {
        runCatching { api?.cancelUi(id) }
        _timelines.value[key]?.let { putTimeline(TurnStore.removeUi(it, id)) }
    }

    suspend fun models(key: String): ModelListResult? = runCatching { api?.models(key) }.getOrNull()
    suspend fun setModel(key: String, id: String) = runCatching { api?.setModel(key, id) }
    private val _pendingShare = MutableStateFlow<SharedContent?>(null)
    /** Shared from another app; the next opened session takes it into its composer. */
    val pendingShare: StateFlow<SharedContent?> = _pendingShare
    fun share(content: SharedContent) { _pendingShare.value = content }
    fun takeShare(): SharedContent? = _pendingShare.value.also { _pendingShare.value = null }

    /** Set by [dev.pi.remote.app.AppGraph]: run notifications and the background keep-alive. */
    var notifier: RunNotifier? = null
    private var keptAlive = false

    /** Notify on running → done/failed and on a new question, unless the user is looking at it. */
    private fun noticeTransitions(before: Map<String, SessionSummary>, after: List<SessionSummary>) {
        val n = notifier ?: return
        for (s in after) {
            val was = before[s.sessionKey]?.status ?: continue
            val settled = was == "running" && s.status != "running"
            val asks = s.status == "needsInput" && was != "needsInput"
            if ((settled || asks) && !(foreground && openKey == s.sessionKey)) n.notifySession(s)
        }
        updateKeepAlive()
    }

    /** In the background, stay connected while something is still running; drop 30 s after the last run ends. */
    private fun updateKeepAlive() {
        val running = _inbox.value.sessions.count { it.status == "running" }
        val want = !foreground && running > 0
        if (want) {
            stopJob?.cancel()
            stopJob = null
            notifier?.keepAlive(running)
            keptAlive = true
        } else if (keptAlive) {
            notifier?.keepAlive(0)
            keptAlive = false
            if (!foreground) scheduleDisconnect()
        }
    }

    private fun scheduleDisconnect() {
        stopJob?.cancel()
        stopJob = scope.launch {
            delay(30_000)
            disconnect()
        }
    }

    /** Set by [dev.pi.remote.app.AppGraph]; receives our own uploads so they show without a download. */
    var attachmentStore: AttachmentStore? = null

    /** Uploads one prepared attachment; returns the host path the prompt should reference. */
    suspend fun upload(prepared: PreparedAttachment): Result<String> = runCatching {
        val a = api ?: error("offline")
        val data = withContext(Dispatchers.Default) { android.util.Base64.encodeToString(prepared.bytes, android.util.Base64.NO_WRAP) }
        a.upload(prepared.name, prepared.mime, data).path.also { path -> attachmentStore?.put(path, prepared.bytes) }
    }

    suspend fun downloadAttachment(path: String): ByteArray? {
        val a = api ?: return null
        val r = a.attachment(path)
        return withContext(Dispatchers.Default) { android.util.Base64.decode(r.data, android.util.Base64.NO_WRAP) }
    }
    suspend fun setThinking(key: String, level: String) = runCatching { api?.setThinking(key, level) }
    suspend fun capabilities(key: String): List<CapabilityRow> = runCatching { api?.capabilities(key) }.getOrNull().orEmpty()
    suspend fun setCapability(key: String, id: String, on: Boolean) = runCatching { api?.setCapability(key, id, on) }
    suspend fun cacheWarming(): String? = runCatching { api?.cacheWarming() }.getOrNull()
    suspend fun setCacheWarming(mode: String) = runCatching { api?.setCacheWarming(mode) }
    suspend fun toolDetail(key: String, toolCallId: String): ToolDetailResult? = runCatching { api?.toolDetail(key, toolCallId) }.getOrNull()
    suspend fun createSession(projectId: String, caps: List<String>?): String? = runCatching { api?.create(projectId, caps)?.sessionKey }.getOrNull()

    val canWrite: Boolean get() = (hello?.role ?: _active.value?.role) == "operator"

    /** mermaid.min.js served by the desktop, verified against the hash from the encrypted hello. */
    suspend fun mermaidScript(): File? = withContext(Dispatchers.IO) {
        val info = hello?.assets?.firstOrNull { it.name == "mermaid.min.js" } ?: return@withContext null
        val file = File(assetDir, "${info.sha256}.js")
        if (file.exists()) return@withContext file
        val endpoint = (conn?.state?.value as? HostConnection.State.Ready)?.endpoint ?: return@withContext null
        val u = URI(endpoint)
        runCatching {
            val bytes = URI("http", null, u.host, u.port, "/assets/mermaid.min.js", null, null).toURL().openStream().use { it.readBytes() }
            val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            if (sha != info.sha256) return@runCatching null
            assetDir.mkdirs()
            file.writeBytes(bytes)
            file
        }.getOrNull()
    }
}
