package dev.pi.remote.crypto

import dev.pi.remote.protocol.Base64Url
import dev.pi.remote.protocol.RemoteJson
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.zip.Deflater
import java.util.zip.Inflater
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.math.ec.rfc7748.X25519

/**
 * Client side of packages/shared/remote/crypto.ts: X25519 + HKDF-SHA256 + ChaCha20-Poly1305 with
 * the same Noise-IK-shaped handshake and counter-nonce transport. Byte-for-byte compatible with
 * the Node implementation (see crypto-vectors.json).
 */

private val SALT = "pi-remote/v1".encodeToByteArray()
private const val DEFLATE_THRESHOLD = 1024
private const val MAX_PLAINTEXT = 16 * 1024 * 1024
private val random = SecureRandom()

class HandshakeException(val code: String) : Exception(code)

class KeyPair(val pub: ByteArray, val priv: ByteArray) {
    companion object {
        fun generate(): KeyPair {
            val priv = ByteArray(32).also(random::nextBytes)
            return fromPrivate(priv)
        }

        fun fromPrivate(priv: ByteArray): KeyPair {
            require(priv.size == 32) { "x25519 private key must be 32 bytes" }
            val pub = ByteArray(32)
            X25519.scalarMultBase(priv, 0, pub, 0)
            return KeyPair(pub, priv.copyOf())
        }
    }
}

class SessionKeys(val c2s: ByteArray, val s2c: ByteArray)

object RemoteCrypto {
    fun dh(priv: ByteArray, pub: ByteArray): ByteArray {
        if (pub.size != 32) throw HandshakeException("bad")
        val out = ByteArray(32)
        if (!X25519.calculateAgreement(priv, 0, pub, 0, out, 0)) throw HandshakeException("bad")
        return out
    }

    fun hkdf(ikm: ByteArray, info: String, length: Int): ByteArray {
        val gen = HKDFBytesGenerator(SHA256Digest())
        gen.init(HKDFParameters(ikm, SALT, info.encodeToByteArray()))
        return ByteArray(length).also { gen.generateBytes(it, 0, length) }
    }

    fun nonce(counter: Long): ByteArray {
        val n = ByteArray(12)
        var c = counter
        for (i in 0 until 8) {
            n[i] = (c and 0xff).toByte()
            c = c ushr 8
        }
        return n
    }

    private fun aead(encrypt: Boolean, key: ByteArray, nonce: ByteArray, input: ByteArray, aad: ByteArray): ByteArray {
        val cipher = ChaCha20Poly1305()
        cipher.init(encrypt, AEADParameters(KeyParameter(key), 128, nonce, aad))
        val out = ByteArray(cipher.getOutputSize(input.size))
        val n = cipher.processBytes(input, 0, input.size, out, 0)
        val total = n + cipher.doFinal(out, n) // throws InvalidCipherTextException on a bad tag
        return if (total == out.size) out else out.copyOf(total)
    }

    fun seal(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: ByteArray) = aead(true, key, nonce, plaintext, aad)
    fun open(key: ByteArray, nonce: ByteArray, sealed: ByteArray, aad: ByteArray) = aead(false, key, nonce, sealed, aad)
}

@Serializable data class Hs1(val t: String, val v: Int, val e: String, val ct: String)
@Serializable data class Hs1Payload(val s: String, val pair: String? = null, val name: String, val platform: String)
@Serializable data class Hs2Payload(val deviceId: String, val hostId: String, val hostName: String, val epoch: String, val role: String)

/** One handshake attempt (fresh ephemeral key per connection). */
class ClientHandshake(
    private val hostPub: ByteArray,
    private val clientStatic: KeyPair,
    private val ephemeral: KeyPair = KeyPair.generate(),
) {
    fun hs1(name: String, platform: String, pairToken: String?): String {
        val k1 = RemoteCrypto.hkdf(RemoteCrypto.dh(ephemeral.priv, hostPub), "hs1", 32)
        val payload = RemoteJson.encodeToString(Hs1Payload.serializer(), Hs1Payload(Base64Url.encode(clientStatic.pub), pairToken, name.take(80), platform.take(40)))
        val ct = RemoteCrypto.seal(k1, RemoteCrypto.nonce(0), payload.encodeToByteArray(), ephemeral.pub + hostPub)
        return RemoteJson.encodeToString(Hs1.serializer(), Hs1("hs1", 1, Base64Url.encode(ephemeral.pub), Base64Url.encode(ct)))
    }

    /** Parse the host reply: `hs2` → keys + identity; `hs_err` → [HandshakeException] with its code. */
    fun finish(reply: String): Pair<Hs2Payload, SessionKeys> {
        val obj = RemoteJson.parseToJsonElement(reply) as? kotlinx.serialization.json.JsonObject ?: throw HandshakeException("bad")
        val t = (obj["t"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        if (t == "hs_err") throw HandshakeException((obj["code"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "bad")
        if (t != "hs2") throw HandshakeException("bad")
        val he = Base64Url.decode((obj["e"] as kotlinx.serialization.json.JsonPrimitive).content)
        val ct = Base64Url.decode((obj["ct"] as kotlinx.serialization.json.JsonPrimitive).content)
        val ikm = RemoteCrypto.dh(ephemeral.priv, hostPub) + RemoteCrypto.dh(ephemeral.priv, he) + RemoteCrypto.dh(clientStatic.priv, he) + RemoteCrypto.dh(clientStatic.priv, hostPub)
        val okm = RemoteCrypto.hkdf(ikm, "keys", 96)
        val pt = try {
            RemoteCrypto.open(okm.copyOfRange(64, 96), RemoteCrypto.nonce(0), ct, he)
        } catch (e: Exception) {
            throw HandshakeException("bad")
        }
        val payload = RemoteJson.decodeFromString(Hs2Payload.serializer(), pt.decodeToString())
        return payload to SessionKeys(okm.copyOfRange(0, 32), okm.copyOfRange(32, 64))
    }
}

/**
 * Established channel. Frames are `[flags][ciphertext]` (bit0 = deflate-raw); nonces are
 * per-direction counters, so any dropped, replayed or reordered frame fails to decrypt.
 */
class SecureChannel(private val sendKey: ByteArray, private val recvKey: ByteArray) {
    private var sendCounter = 0L
    private var recvCounter = 0L

    companion object {
        fun forClient(keys: SessionKeys) = SecureChannel(keys.c2s, keys.s2c)
        fun forHost(keys: SessionKeys) = SecureChannel(keys.s2c, keys.c2s)
    }

    @Synchronized
    fun encrypt(json: String): ByteArray {
        var body = json.encodeToByteArray()
        var flags = 0
        if (body.size > DEFLATE_THRESHOLD) {
            body = deflate(body)
            flags = 1
        }
        val header = byteArrayOf(flags.toByte())
        return header + RemoteCrypto.seal(sendKey, RemoteCrypto.nonce(sendCounter++), body, header)
    }

    @Synchronized
    fun decrypt(frame: ByteArray): String {
        require(frame.size >= 17) { "frame too short" }
        val flags = frame[0].toInt() and 0xff
        require(flags and 1.inv() == 0) { "unknown frame flags" }
        var body = RemoteCrypto.open(recvKey, RemoteCrypto.nonce(recvCounter), frame.copyOfRange(1, frame.size), frame.copyOfRange(0, 1))
        recvCounter++
        if (flags and 1 == 1) body = inflate(body)
        return body.decodeToString()
    }

    fun encrypt(element: JsonElement): ByteArray = encrypt(RemoteJson.encodeToString(JsonElement.serializer(), element))

    private fun deflate(input: ByteArray): ByteArray {
        val d = Deflater(Deflater.DEFAULT_COMPRESSION, true)
        d.setInput(input)
        d.finish()
        val out = ByteArrayOutputStream(input.size / 2)
        val buf = ByteArray(8192)
        while (!d.finished()) out.write(buf, 0, d.deflate(buf))
        d.end()
        return out.toByteArray()
    }

    private fun inflate(input: ByteArray): ByteArray {
        val inf = Inflater(true)
        inf.setInput(input)
        val out = ByteArrayOutputStream(input.size * 3)
        val buf = ByteArray(16384)
        try {
            while (!inf.finished()) {
                val n = inf.inflate(buf)
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break
                out.write(buf, 0, n)
                require(out.size() <= MAX_PLAINTEXT) { "frame too large" }
            }
        } finally {
            inf.end()
        }
        return out.toByteArray()
    }
}
