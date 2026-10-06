package dev.pi.remote.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.util.LruCache
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt

/** Where a viewable image comes from: a host attachment path, or a local uri still in the composer. */
sealed interface ImageSource {
    data class Remote(val path: String) : ImageSource
    data class Local(val uri: Uri) : ImageSource
}

/** Image access for the timeline; null in previews and screenshot tests (chips are shown instead). */
interface AttachmentImages {
    suspend fun thumb(src: ImageSource): ImageBitmap?
    suspend fun full(src: ImageSource): ImageBitmap?
    /** A local file with the original bytes (for sharing). */
    suspend fun file(src: ImageSource): File?
}

val LocalAttachmentImages = staticCompositionLocalOf<AttachmentImages?> { null }

/**
 * Disk cache of attachment bytes by host path (own uploads are stored right after upload, other
 * images are fetched once with `attachment.get`) plus an in-memory thumbnail cache.
 */
class AttachmentStore(
    private val context: Context,
    private val root: File,
    private val fetch: suspend (String) -> ByteArray?,
) : AttachmentImages {
    private val thumbs = LruCache<String, ImageBitmap>(120)
    private val locks = HashMap<String, Mutex>()

    private fun fileFor(path: String): File {
        val h = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(root, h)
    }

    private fun lockFor(key: String): Mutex = synchronized(locks) { locks.getOrPut(key) { Mutex() } }

    /** Keep the bytes we just uploaded so our own photos never round-trip to the host. */
    fun put(path: String, bytes: ByteArray) {
        runCatching {
            root.mkdirs()
            fileFor(path).writeBytes(bytes)
        }
    }

    override suspend fun file(src: ImageSource): File? = when (src) {
        is ImageSource.Local -> null
        is ImageSource.Remote -> lockFor(src.path).withLock {
            val f = fileFor(src.path)
            if (f.exists()) return@withLock f
            val bytes = runCatching { fetch(src.path) }.getOrNull() ?: return@withLock null
            withContext(Dispatchers.IO) {
                root.mkdirs()
                f.writeBytes(bytes)
                prune()
            }
            f
        }
    }

    override suspend fun thumb(src: ImageSource): ImageBitmap? {
        val key = keyOf(src)
        thumbs.get(key)?.let { return it }
        return decode(src, 320)?.also { thumbs.put(key, it) }
    }

    override suspend fun full(src: ImageSource): ImageBitmap? = decode(src, 4096)

    private fun keyOf(src: ImageSource) = when (src) {
        is ImageSource.Remote -> "r:${src.path}"
        is ImageSource.Local -> "l:${src.uri}"
    }

    private suspend fun decode(src: ImageSource, maxEdge: Int): ImageBitmap? {
        val source = when (src) {
            is ImageSource.Local -> ImageDecoder.createSource(context.contentResolver, src.uri)
            is ImageSource.Remote -> ImageDecoder.createSource(file(src) ?: return null)
        }
        return withContext(Dispatchers.IO) {
            runCatching {
                ImageDecoder.decodeBitmap(source) { d, info, _ ->
                    val scale = maxEdge.toFloat() / max(info.size.width, info.size.height)
                    if (scale < 1f) d.setTargetSize((info.size.width * scale).roundToInt().coerceAtLeast(1), (info.size.height * scale).roundToInt().coerceAtLeast(1))
                    d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }.let { if (it.config == Bitmap.Config.HARDWARE) it.copy(Bitmap.Config.ARGB_8888, false) else it }.asImageBitmap()
            }.getOrNull()
        }
    }

    /** Cap the disk cache at ~200 MB, oldest first. */
    private fun prune() {
        val files = root.listFiles()?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (f in files) {
            if (total <= 200L * 1024 * 1024) break
            total -= f.length()
            f.delete()
        }
    }
}
