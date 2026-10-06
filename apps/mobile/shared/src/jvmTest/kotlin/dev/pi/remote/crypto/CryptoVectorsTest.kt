package dev.pi.remote.crypto

import dev.pi.remote.protocol.Base64Url
import dev.pi.remote.protocol.RemoteJson
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Deterministic vectors produced by the Node implementation (packages/shared/remote/fixtures). */
class CryptoVectorsTest {
    private val v: JsonObject = RemoteJson.parseToJsonElement(
        File(System.getProperty("pi.remote.fixtures") ?: "../../../packages/shared/remote/fixtures", "crypto-vectors.json").readText(),
    ).jsonObject

    private fun b(key: String) = Base64Url.decode(v[key]!!.jsonPrimitive.content)
    private fun json(e: JsonElement) = RemoteJson.encodeToString(JsonElement.serializer(), e)

    @Test
    fun publicKeysMatchNode() {
        assertTrue(KeyPair.fromPrivate(b("hostStaticPriv")).pub.contentEquals(b("hostStaticPub")))
        assertTrue(KeyPair.fromPrivate(b("clientStaticPriv")).pub.contentEquals(b("clientStaticPub")))
    }

    @Test
    fun handshakeProducesIdenticalHs1AndKeys() {
        val client = KeyPair.fromPrivate(b("clientStaticPriv"))
        val eph = KeyPair.fromPrivate(b("clientEphemeralPriv"))
        val hs = ClientHandshake(b("hostStaticPub"), client, eph)
        val p = v["hs1Payload"]!!.jsonObject
        val hs1 = hs.hs1(p["name"]!!.jsonPrimitive.content, p["platform"]!!.jsonPrimitive.content, p["pair"]!!.jsonPrimitive.content)
        assertEquals(json(v["hs1"]!!), hs1, "hs1 must be byte-identical to Node's")

        val (payload, keys) = hs.finish(json(v["hs2"]!!))
        assertEquals("d_77aa", payload.deviceId)
        assertEquals("operator", payload.role)
        val k = v["keys"]!!.jsonObject
        assertEquals(k["c2s"]!!.jsonPrimitive.content, Base64Url.encode(keys.c2s))
        assertEquals(k["s2c"]!!.jsonPrimitive.content, Base64Url.encode(keys.s2c))
    }

    @Test
    fun channelInteroperatesWithNodeFrames() {
        val k = v["keys"]!!.jsonObject
        val keys = SessionKeys(Base64Url.decode(k["c2s"]!!.jsonPrimitive.content), Base64Url.decode(k["s2c"]!!.jsonPrimitive.content))
        val frames = v["c2sFrames"]!!.jsonArray.map { it.jsonObject }
        // Our client encryption of a non-deflated frame is byte-identical to Node's.
        val client = SecureChannel.forClient(keys)
        assertEquals(frames[0]["frame"]!!.jsonPrimitive.content, Base64Url.encode(client.encrypt(json(frames[0]["plaintext"]!!))))
        // As the host side, we decrypt Node's frames, including the deflated one.
        val host = SecureChannel.forHost(keys)
        for (f in frames) {
            assertEquals(RemoteJson.parseToJsonElement(json(f["plaintext"]!!)), RemoteJson.parseToJsonElement(host.decrypt(Base64Url.decode(f["frame"]!!.jsonPrimitive.content))))
        }
        // And decrypt the host → client frame.
        val s2c = v["s2cFrames"]!!.jsonArray[0].jsonObject
        val c = SecureChannel.forClient(keys)
        assertEquals(RemoteJson.parseToJsonElement(json(s2c["plaintext"]!!)), RemoteJson.parseToJsonElement(c.decrypt(Base64Url.decode(s2c["frame"]!!.jsonPrimitive.content))))
    }

    @Test
    fun tamperingAndReplayFail() {
        val keys = SessionKeys(ByteArray(32) { 1 }, ByteArray(32) { 2 })
        val a = SecureChannel.forClient(keys)
        val b = SecureChannel.forHost(keys)
        val f1 = a.encrypt("""{"n":1}""")
        val f2 = a.encrypt("{\"big\":\"" + "x".repeat(5000) + "\"}")
        assertEquals(1, f2[0].toInt())
        assertFailsWith<Exception> { SecureChannel.forHost(keys).decrypt(f2) } // out of order
        assertEquals("""{"n":1}""", b.decrypt(f1))
        assertFailsWith<Exception> { b.decrypt(f1) } // replay
        assertTrue(b.decrypt(f2).contains("xxxx"))
        val bad = f1.copyOf().also { it[5] = (it[5].toInt() xor 1).toByte() }
        assertFailsWith<Exception> { SecureChannel.forHost(keys).decrypt(bad) }
    }

    @Test
    fun hostErrorsSurfaceTheirCode() {
        val hs = ClientHandshake(KeyPair.generate().pub, KeyPair.generate())
        val e = assertFailsWith<HandshakeException> { hs.finish("""{"t":"hs_err","code":"revoked"}""") }
        assertEquals("revoked", e.code)
        assertFailsWith<HandshakeException> { RemoteCrypto.dh(KeyPair.generate().priv, ByteArray(32)) }
    }
}
