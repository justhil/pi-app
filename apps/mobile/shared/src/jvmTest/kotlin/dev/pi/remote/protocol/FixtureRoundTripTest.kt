package dev.pi.remote.protocol

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Cross-language contract: every golden message written by the TypeScript protocol tests
 * (packages/shared/remote/fixtures/messages) must decode into the Kotlin models and encode back
 * to the same JSON. A renamed or retyped field on either side fails here.
 */
class FixtureRoundTripTest {
    private val dir = File(System.getProperty("pi.remote.fixtures") ?: "../../../packages/shared/remote/fixtures", "messages")

    private fun normalize(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.filterValues { it !is JsonNull }.mapValues { normalize(it.value) }.toSortedMap())
        is JsonArray -> JsonArray(e.map(::normalize))
        else -> e
    }

    private fun serializerFor(schema: String): KSerializer<*> {
        val (name, kind) = schema.split('/')
        return when (kind) {
            "event" -> RemoteMethods.events[name] ?: fail("no Kotlin event for $name")
            "params" -> RemoteMethods.table[name]?.first ?: fail("no Kotlin method $name")
            "result" -> RemoteMethods.table[name]?.second ?: fail("no Kotlin method $name")
            else -> fail("bad schema $schema")
        }
    }

    @Suppress("UNCHECKED_CAST")
    @Test
    fun everyFixtureRoundTrips() {
        val files = dir.listFiles { f -> f.extension == "json" }?.sortedBy { it.name }.orEmpty()
        assertTrue(files.size > 40, "fixtures missing in $dir")
        for (file in files) {
            val root = RemoteJson.parseToJsonElement(file.readText()).jsonObject
            val schema = root["schema"]!!.jsonPrimitive.content
            val value = root["value"]!!
            val ser = serializerFor(schema) as KSerializer<Any>
            val decoded = try {
                RemoteJson.decodeFromJsonElement(ser, value)
            } catch (e: Exception) {
                fail("${file.name}: decode failed: ${e.message}")
            }
            val encoded = RemoteJson.encodeToJsonElement(ser, decoded)
            assertEquals(normalize(value), normalize(encoded), "${file.name} did not round-trip")
        }
    }

    @Test
    fun everyMethodAndEventHasAFixture() {
        val schemas = dir.listFiles()!!.map { RemoteJson.parseToJsonElement(it.readText()).jsonObject["schema"]!!.jsonPrimitive.content }.toSet()
        for (m in RemoteMethods.table.keys) {
            assertTrue("$m/params" in schemas && "$m/result" in schemas, "no fixture for $m")
        }
        for (e in RemoteMethods.events.keys) assertTrue("$e/event" in schemas, "no fixture for $e")
    }

    @Test
    fun pairLinksRoundTripAndRejectPublicHosts() {
        val offer = PairOffer(1, "h_1", "桌面", Base64Url.encode(ByteArray(32) { 7 }), listOf("ws://192.168.1.23:47900", "ws://8.8.8.8:47900"), "pt_abcdefghijklmnop", 1L)
        val back = Pairing.decodeLink(Pairing.encodeLink(offer))!!
        assertEquals(listOf("ws://192.168.1.23:47900"), back.endpoints)
        assertEquals(null, Pairing.decodeLink("https://example.com"))
        for (h in listOf("10.0.0.5", "172.31.0.1", "100.101.1.1", "fd12:3456::1", "[fe80::1]", "pc.tail1234.ts.net", "my-box.tail-ab.ts.net.")) assertTrue(Pairing.isPrivateHost(h), h)
        for (h in listOf("8.8.8.8", "172.32.0.1", "example.com", "2001:db8::1", "ts.net", "evil.ts.net.example.com", "-x.ts.net")) assertTrue(!Pairing.isPrivateHost(h), h)
        for (n in 0..7) {
            val bytes = ByteArray(n) { (it * 37).toByte() }
            assertTrue(bytes.contentEquals(Base64Url.decode(Base64Url.encode(bytes))))
        }
    }
}
