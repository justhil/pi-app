package dev.pi.remote.app.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.pi.remote.crypto.KeyPair
import dev.pi.remote.protocol.RemoteJson
import dev.pi.remote.protocol.SessionState
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.protocol.Turn
import dev.pi.remote.sync.SessionTimeline
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/** Seals the device's X25519 private key at rest. */
interface KeyWrapper {
    fun wrap(plain: ByteArray): ByteArray
    fun unwrap(sealed: ByteArray): ByteArray
}

/** AES-256-GCM key that never leaves the Android Keystore. */
class KeystoreKeyWrapper(private val alias: String = "pi-remote-identity") : KeyWrapper {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun wrap(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        return c.iv + c.doFinal(plain)
    }

    override fun unwrap(sealed: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
        return c.doFinal(sealed.copyOfRange(12, sealed.size))
    }
}

/** One static identity per install; hosts recognise the phone by its public key. */
class KeyVault(private val dir: File, private val wrapper: KeyWrapper) {
    private val file get() = File(dir, "identity.bin")
    @Volatile private var cached: KeyPair? = null

    @Synchronized
    fun identity(): KeyPair {
        cached?.let { return it }
        val kp = runCatching { KeyPair.fromPrivate(wrapper.unwrap(file.readBytes())) }.getOrNull() ?: KeyPair.generate().also {
            dir.mkdirs()
            file.writeBytes(wrapper.wrap(it.priv))
        }
        cached = kp
        return kp
    }
}

@Serializable
data class SavedHost(
    val hostId: String,
    val hostName: String,
    val hostPub: String,
    val endpoints: List<String>,
    val deviceId: String,
    val role: String,
    val lastConnectedAt: Long = 0,
)

@Serializable
private data class HostFile(val hosts: List<SavedHost> = emptyList(), val activeHostId: String? = null)

class HostStore(private val dir: File) {
    private val file get() = File(dir, "hosts.json")
    private var data: HostFile = runCatching { RemoteJson.decodeFromString(HostFile.serializer(), file.readText()) }.getOrDefault(HostFile())

    val hosts: List<SavedHost> get() = data.hosts
    val activeHostId: String? get() = data.activeHostId

    @Synchronized
    fun upsert(host: SavedHost, makeActive: Boolean = true) {
        data = data.copy(hosts = listOf(host) + data.hosts.filter { it.hostId != host.hostId }, activeHostId = if (makeActive) host.hostId else data.activeHostId)
        save()
    }

    @Synchronized
    fun setActive(hostId: String?) {
        data = data.copy(activeHostId = hostId)
        save()
    }

    @Synchronized
    fun remove(hostId: String) {
        data = data.copy(hosts = data.hosts.filter { it.hostId != hostId }, activeHostId = data.activeHostId.takeIf { it != hostId })
        save()
    }

    private fun save() {
        dir.mkdirs()
        val tmp = File(dir, "hosts.json.tmp")
        tmp.writeText(RemoteJson.encodeToString(HostFile.serializer(), data))
        tmp.renameTo(file)
    }
}

@Serializable
data class CachedTimeline(
    val sessionKey: String,
    val title: String,
    val epoch: String,
    val seq: Long,
    val turns: List<Turn>,
    val hasOlder: Boolean,
    val state: SessionState,
) {
    fun toTimeline() = SessionTimeline(sessionKey, title, epoch, seq, turns, hasOlder, state)

    companion object {
        const val KEEP_TURNS = 50
        fun of(t: SessionTimeline) = CachedTimeline(t.sessionKey, t.title, t.epoch, t.seq, t.turns.takeLast(KEEP_TURNS), t.hasOlder || t.turns.size > KEEP_TURNS, t.state)
    }
}

/** JSON files under cacheDir: shown instantly on launch, then reconciled by the live sync. */
class TimelineCache(private val root: File) {
    private fun hostDir(hostId: String) = File(root, hostId.replace(Regex("[^A-Za-z0-9_-]"), "_"))
    private fun name(key: String): String = MessageDigest.getInstance("SHA-256").digest(key.encodeToByteArray()).joinToString("") { "%02x".format(it) }.take(32)

    fun loadInbox(hostId: String): List<SessionSummary> =
        runCatching { RemoteJson.decodeFromString(ListSerializer(SessionSummary.serializer()), File(hostDir(hostId), "inbox.json").readText()) }.getOrDefault(emptyList())

    fun saveInbox(hostId: String, sessions: List<SessionSummary>) = write(File(hostDir(hostId), "inbox.json"), RemoteJson.encodeToString(ListSerializer(SessionSummary.serializer()), sessions))

    fun loadTimeline(hostId: String, key: String): SessionTimeline? =
        runCatching { RemoteJson.decodeFromString(CachedTimeline.serializer(), File(hostDir(hostId), "turns/${name(key)}.json").readText()).toTimeline() }.getOrNull()

    fun saveTimeline(hostId: String, t: SessionTimeline) = write(File(hostDir(hostId), "turns/${name(t.sessionKey)}.json"), RemoteJson.encodeToString(CachedTimeline.serializer(), CachedTimeline.of(t)))

    fun clearHost(hostId: String) {
        hostDir(hostId).deleteRecursively()
    }

    private fun write(file: File, text: String) {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(text)
        tmp.renameTo(file)
    }
}
