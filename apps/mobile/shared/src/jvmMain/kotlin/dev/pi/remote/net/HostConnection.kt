package dev.pi.remote.net

import dev.pi.remote.crypto.ClientHandshake
import dev.pi.remote.crypto.HandshakeException
import dev.pi.remote.crypto.Hs2Payload
import dev.pi.remote.crypto.KeyPair
import dev.pi.remote.crypto.SecureChannel
import dev.pi.remote.protocol.Frame
import dev.pi.remote.protocol.HelloParams
import dev.pi.remote.protocol.HelloResult
import dev.pi.remote.protocol.PROTOCOL_VERSION
import dev.pi.remote.protocol.RemoteJson
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.websocket.Frame as WsFrame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import io.ktor.websocket.readText
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * One phone ↔ desktop link. Tries each LAN endpoint in order, runs the encrypted handshake,
 * then serves RPCs and events until the socket drops; reconnects with exponential backoff
 * (1, 2, 4 … 30 s) unless the host refused us (revoked / unpaired / bad token).
 * In-flight calls fail on disconnect and are never re-sent (the UI decides).
 */
class HostConnection(
    private val scope: CoroutineScope,
    endpoints: List<String>,
    private val hostPub: ByteArray,
    private val identity: KeyPair,
    private val deviceName: String,
    private val platform: String,
    private val hello: HelloParams,
    pairToken: String? = null,
    private val onPaired: (Hs2Payload) -> Unit = {},
    private val client: HttpClient = defaultHttpClient(),
    private val pingIntervalMs: Long = 15_000,
) {
    sealed interface State {
        data object Idle : State
        data class Connecting(val endpoint: String, val attempt: Int) : State
        data class Ready(val endpoint: String, val identity: Hs2Payload, val hello: HelloResult) : State
        data class Backoff(val attempt: Int, val retryAtMs: Long, val lastError: String?) : State
        /** Host refused this device; reconnecting would not help. */
        data class Refused(val code: String) : State
    }

    data class Event(val method: String, val payload: JsonElement)

    class CallException(val code: String, message: String, val retryable: Boolean) : Exception(message)
    class ConnectionLost : Exception("connection lost")

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state
    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 256)
    val events: SharedFlow<Event> = _events

    private var endpoints = endpoints
    private var pairToken = pairToken
    private var loop: Job? = null
    private val kicks = Channel<Unit>(Channel.CONFLATED)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Frame>>()
    private val ids = AtomicLong()
    private val sendLock = Mutex()
    @Volatile private var sender: (suspend (ByteArray) -> Unit)? = null
    @Volatile private var channel: SecureChannel? = null

    val isReady: Boolean get() = _state.value is State.Ready

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch { runLoop() }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        failPending()
        _state.value = State.Idle
    }

    /** Skip the backoff wait (app came to the foreground, network changed, user tapped retry). */
    fun kick() {
        kicks.trySend(Unit)
        if (loop?.isActive != true && _state.value !is State.Refused) start()
    }

    private suspend fun runLoop() {
        var attempt = 0
        while (true) {
            var lastError: String? = null
            for (ep in probeOrder(endpoints.toList())) {
                _state.value = State.Connecting(ep, attempt)
                try {
                    session(ep)
                    attempt = 0
                    lastError = null
                    break
                } catch (e: CancellationException) {
                    throw e
                } catch (e: HandshakeException) {
                    if (e.code != "bad") {
                        _state.value = State.Refused(e.code)
                        return
                    }
                    lastError = e.code
                } catch (e: Exception) {
                    lastError = e.message ?: e::class.simpleName
                } finally {
                    failPending()
                }
            }
            attempt++
            val waitMs = 1000L * min(30, 1 shl min(attempt - 1, 5))
            _state.value = State.Backoff(attempt, System.currentTimeMillis() + waitMs, lastError)
            select {
                kicks.onReceive { }
                onTimeout(waitMs) { }
            }
        }
    }

    /** Adopt the host's current endpoint list (from `host.hello`), keeping [first] in front. */
    fun updateEndpoints(list: List<String>) {
        if (list.isNotEmpty()) endpoints = list.distinct()
    }

    /**
     * TCP-probe every endpoint at once and try the reachable ones first, fastest first. Stale
     * DHCP addresses or adapters the phone cannot route to would otherwise each cost a full
     * connect timeout before the right address is tried.
     */
    private suspend fun probeOrder(list: List<String>): List<String> {
        if (list.size < 2) return list
        val reachable = java.util.concurrent.ConcurrentLinkedQueue<String>()
        coroutineScope {
            for (ep in list) launch(Dispatchers.IO) {
                val uri = runCatching { java.net.URI(ep) }.getOrNull() ?: return@launch
                val port = if (uri.port > 0) uri.port else 80
                runCatching {
                    java.net.Socket().use { it.connect(java.net.InetSocketAddress(uri.host, port), PROBE_TIMEOUT_MS) }
                    reachable += ep
                }
            }
        }
        val ok = reachable.toList()
        return ok + list.filter { it !in ok }
    }

    private suspend fun session(endpoint: String) {
        val url = endpoint.trimEnd('/') + "/ws"
        client.webSocket(url) {
            val hs = ClientHandshake(hostPub, identity)
            send(WsFrame.Text(hs.hs1(deviceName, platform, pairToken)))
            val reply = withTimeout(10_000) {
                when (val f = incoming.receive()) {
                    is WsFrame.Text -> f.readText()
                    else -> throw HandshakeException("bad")
                }
            }
            val (identityPayload, keys) = hs.finish(reply)
            if (pairToken != null) {
                pairToken = null
                onPaired(identityPayload)
            }
            val ch = SecureChannel.forClient(keys)
            channel = ch
            sender = { bytes -> send(WsFrame.Binary(true, bytes)) }
            val lastPong = AtomicLong(System.currentTimeMillis())

            val reader = launch {
                for (f in incoming) {
                    if (f !is WsFrame.Binary) continue
                    val text = try {
                        ch.decrypt(f.readBytes())
                    } catch (e: Exception) {
                        close()
                        return@launch
                    }
                    val frame = try {
                        RemoteJson.decodeFromString(Frame.serializer(), text)
                    } catch (e: Exception) {
                        continue
                    }
                    when (frame.k) {
                        "res" -> frame.id?.let { pending.remove(it)?.complete(frame) }
                        "pong" -> lastPong.set(System.currentTimeMillis())
                        "evt" -> if (frame.m != null && frame.p != null) _events.emit(Event(frame.m, frame.p))
                    }
                }
            }
            val heartbeat = launch {
                while (true) {
                    delay(pingIntervalMs)
                    if (System.currentTimeMillis() - lastPong.get() > pingIntervalMs * 2 + 1000) {
                        close()
                        return@launch
                    }
                    rawSend(Frame(v = PROTOCOL_VERSION, k = "ping", id = "p${ids.incrementAndGet()}"))
                }
            }
            try {
                val helloResult = typedCall("host.hello", HelloParams.serializer(), hello, HelloResult.serializer(), 15_000)
                _state.value = State.Ready(endpoint, identityPayload, helloResult)
                // Prefer the endpoint that worked next time.
                endpoints = listOf(endpoint) + endpoints.filter { it != endpoint }
                reader.join()
            } finally {
                heartbeat.cancel()
                reader.cancel()
                sender = null
                channel = null
            }
        }
    }

    private suspend fun rawSend(frame: Frame) {
        val ch = channel ?: throw ConnectionLost()
        val s = sender ?: throw ConnectionLost()
        sendLock.withLock { s(ch.encrypt(RemoteJson.encodeToString(Frame.serializer(), frame))) }
    }

    private fun failPending() {
        val all = pending.values.toList()
        pending.clear()
        for (d in all) d.completeExceptionally(ConnectionLost())
    }

    suspend fun call(method: String, params: JsonElement, timeoutMs: Long = 30_000): JsonElement {
        val id = "c${ids.incrementAndGet()}"
        val d = CompletableDeferred<Frame>()
        pending[id] = d
        try {
            rawSend(Frame(v = PROTOCOL_VERSION, k = "req", id = id, m = method, p = params))
            val res = withTimeout(timeoutMs) { d.await() }
            if (res.ok == true) return res.p ?: JsonObject(emptyMap())
            val err = res.err
            throw CallException(err?.code ?: "internal", err?.message ?: "error", err?.retryable ?: false)
        } finally {
            pending.remove(id)
        }
    }

    suspend fun <P, R> typedCall(method: String, ps: KSerializer<P>, params: P, rs: KSerializer<R>, timeoutMs: Long = 30_000): R =
        RemoteJson.decodeFromJsonElement(rs, call(method, RemoteJson.encodeToJsonElement(ps, params), timeoutMs))

    companion object {
        private const val PROBE_TIMEOUT_MS = 1500

        fun defaultHttpClient(): HttpClient = HttpClient(OkHttp) {
            install(WebSockets)
            engine {
                config {
                    connectTimeout(4, TimeUnit.SECONDS)
                    readTimeout(0, TimeUnit.SECONDS)
                    pingInterval(0, TimeUnit.SECONDS)
                }
            }
        }
    }
}
