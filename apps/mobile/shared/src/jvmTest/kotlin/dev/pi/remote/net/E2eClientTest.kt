package dev.pi.remote.net

import dev.pi.remote.crypto.KeyPair
import dev.pi.remote.protocol.AppInfo
import dev.pi.remote.protocol.Base64Url
import dev.pi.remote.protocol.ClientCaps
import dev.pi.remote.protocol.HelloParams
import dev.pi.remote.protocol.Pairing
import dev.pi.remote.protocol.RemoteJson
import dev.pi.remote.protocol.TurnPatchEvent
import dev.pi.remote.protocol.TurnSettle
import dev.pi.remote.sync.ApplyResult
import dev.pi.remote.sync.TurnStore
import java.io.File
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Real handshake + RPC + streaming against the Node gateway:
 *   PI_REMOTE_PORT=47960 PI_REMOTE_LOOPBACK_ONLY=1 node scripts/remote-dev-host.mjs &
 *   PI_REMOTE_E2E=1 ./gradlew :shared:jvmTest --tests '*E2e*'
 * Skipped unless PI_REMOTE_E2E=1.
 */
class E2eClientTest {
    private val enabled = System.getenv("PI_REMOTE_E2E") == "1"
    private val hello = HelloParams(AppInfo("pi-remote-test", "0.1.0", "jvm"), ClientCaps(listOf("bash", "default"), listOf("chart"), listOf("select")))

    private fun offer() = Pairing.decodeLink(
        RemoteJson.parseToJsonElement(File(System.getenv("PI_REMOTE_PAIR_FILE") ?: System.getProperty("pi.remote.pairFile")).readText()).jsonObject["link"]!!.jsonPrimitive.content,
    )!!

    @Test
    fun pairsStreamsAndResumes() {
        if (!enabled) return
        val offer = offer()
        val endpoint = offer.endpoints.first { it.contains("127.0.0.1") }
        val identity = KeyPair.generate()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            runBlocking {
                withTimeout(60_000) {
                    var paired = false
                    val c1 = HostConnection(scope, listOf(endpoint), Base64Url.decode(offer.hostPub), identity, "jvm-e2e", "jvm", hello, offer.pairToken, onPaired = { paired = true })
                    c1.start()
                    val ready = c1.state.filter { it is HostConnection.State.Ready || it is HostConnection.State.Refused }.first()
                    assertIs<HostConnection.State.Ready>(ready, "state: $ready")
                    assertTrue(paired)
                    val api = RemoteApi(c1)
                    assertTrue(api.projects().isNotEmpty())
                    val sessions = api.watchList()
                    val target = sessions.last()
                    val open = api.open(target.sessionKey, null)
                    var timeline = TurnStore.fromOpen(null, open)
                    val before = timeline.turns.size
                    var mid: dev.pi.remote.sync.SessionTimeline? = null

                    val settled = scope.launch {
                        c1.events.filter { it.method == "turn.patch" }.map { RemoteJson.decodeFromJsonElement(TurnPatchEvent.serializer(), it.payload) }.collect { evt ->
                            val r = TurnStore.applyAll(timeline, evt.patches)
                            assertIs<ApplyResult.Applied>(r, "gap in live stream")
                            timeline = r.timeline
                            if (mid == null && timeline.seq >= 3) mid = timeline
                            if (evt.patches.any { it is TurnSettle }) this@launch.cancel()
                        }
                    }
                    val sent = api.send(target.sessionKey, "jvm e2e: 跑测试", "prompt", "m_${UUID.randomUUID()}")
                    assertTrue(sent.accepted)
                    settled.join()
                    assertEquals(before + 1, timeline.turns.size)
                    val last = timeline.turns.last()
                    assertEquals("done", last.status)
                    assertTrue(last.answer.isNotBlank())
                    val cursorMid = mid!!
                    assertTrue(cursorMid.seq < timeline.seq)
                    c1.stop()

                    // Second connection: device key only (no pairing token), resume from a cursor.
                    val c2 = HostConnection(scope, listOf(endpoint), Base64Url.decode(offer.hostPub), identity, "jvm-e2e", "jvm", hello)
                    c2.start()
                    assertIs<HostConnection.State.Ready>(c2.state.filter { it is HostConnection.State.Ready || it is HostConnection.State.Refused }.first())
                    val resumed = RemoteApi(c2).open(target.sessionKey, cursorMid.cursor)
                    assertEquals("replay", resumed.kind)
                    val rebuilt = TurnStore.fromOpen(cursorMid, resumed)
                    assertEquals(timeline.seq, rebuilt.seq)
                    assertEquals(timeline.turns.last().answer, rebuilt.turns.last().answer)
                    c2.stop()
                }
            }
        } finally {
            scope.cancel()
        }
    }
}
