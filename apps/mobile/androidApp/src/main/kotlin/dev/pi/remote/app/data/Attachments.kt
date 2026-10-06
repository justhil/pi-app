package dev.pi.remote.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

/** One composer attachment. Uploads start as soon as it is added, so sending rarely waits. */
data class Attachment(
    val id: String = UUID.randomUUID().toString(),
    val uri: Uri,
    val name: String,
    val isImage: Boolean,
    val thumb: ImageBitmap? = null,
    val status: Status = Status.Uploading,
    /** Host path once uploaded; this is what the prompt references. */
    val path: String? = null,
    val error: String? = null,
) {
    enum class Status { Uploading, Ready, Failed }
}

class AttachmentTooLarge(val name: String) : Exception("too large")

/** The bytes that go over the wire for one attachment. */
class PreparedAttachment(val name: String, val mime: String, val bytes: ByteArray, val thumb: ImageBitmap?)

object AttachmentPrep {
    const val MAX_BYTES = 10 * 1024 * 1024
    private const val MAX_EDGE = 2048
    private const val THUMB_EDGE = 160

    /** A FileProvider uri for the camera to write a new photo into. */
    fun newCameraUri(context: Context): Uri {
        val dir = File(context.cacheDir, "camera").apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 3600_000L }?.forEach { it.delete() }
        val file = File(dir, "IMG_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.jpg")
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    fun displayName(context: Context, uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() }?.let { return it }
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "file"
    }

    fun mimeOf(context: Context, uri: Uri, name: String): String =
        context.contentResolver.getType(uri)
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"

    fun isStillImage(mime: String) = mime.startsWith("image/") && mime != "image/gif" && mime != "image/svg+xml"

    /**
     * Photos are decoded with EXIF orientation applied, downscaled to 2048px on the long edge and
     * re-encoded as JPEG (a 12MP camera shot goes from ~4MB to ~500KB). Other files go as-is.
     * Runs on a background dispatcher.
     */
    fun prepare(context: Context, uri: Uri): PreparedAttachment {
        val name = displayName(context, uri)
        val mime = mimeOf(context, uri, name)
        if (isStillImage(mime)) {
            runCatching { decode(context, uri, MAX_EDGE) }.getOrNull()?.let { bmp ->
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
                val thumb = thumbnail(bmp)
                bmp.recycle()
                return PreparedAttachment(name.substringBeforeLast('.', name) + ".jpg", "image/jpeg", out.toByteArray(), thumb)
            }
        }
        val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
            val buf = ByteArrayOutputStream()
            val chunk = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(chunk)
                if (n < 0) break
                buf.write(chunk, 0, n)
                if (buf.size() > MAX_BYTES) throw AttachmentTooLarge(name)
            }
            buf.toByteArray()
        } ?: error("cannot read $name")
        val thumb = if (mime.startsWith("image/")) runCatching { decode(context, uri, THUMB_EDGE).asImageBitmap() }.getOrNull() else null
        return PreparedAttachment(name, mime, bytes, thumb)
    }

    /** Thumbnail only, for showing the chip before the upload work finishes. */
    fun quickThumb(context: Context, uri: Uri): ImageBitmap? = runCatching { decode(context, uri, THUMB_EDGE).asImageBitmap() }.getOrNull()

    private fun decode(context: Context, uri: Uri, maxEdge: Int): Bitmap =
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val w = info.size.width
            val h = info.size.height
            val scale = maxEdge.toFloat() / max(w, h)
            if (scale < 1f) decoder.setTargetSize((w * scale).roundToInt().coerceAtLeast(1), (h * scale).roundToInt().coerceAtLeast(1))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }

    private fun thumbnail(bmp: Bitmap): ImageBitmap {
        val scale = THUMB_EDGE.toFloat() / max(bmp.width, bmp.height)
        if (scale >= 1f) return bmp.copy(Bitmap.Config.ARGB_8888, false).asImageBitmap()
        return Bitmap.createScaledBitmap(bmp, (bmp.width * scale).roundToInt().coerceAtLeast(1), (bmp.height * scale).roundToInt().coerceAtLeast(1), true).asImageBitmap()
    }
}

/** Content shared into the app from another app's share sheet, waiting for a session. */
data class SharedContent(val text: String, val uris: List<Uri>)

object ShareIntake {
    /**
     * Copy shared streams into our cache right away: the sender's uri grant only lives as long as
     * the receiving activity, and the user may pick a session much later.
     */
    fun read(context: Context, intent: android.content.Intent): SharedContent? {
        if (intent.action != android.content.Intent.ACTION_SEND && intent.action != android.content.Intent.ACTION_SEND_MULTIPLE) return null
        val text = listOfNotNull(intent.getStringExtra(android.content.Intent.EXTRA_SUBJECT), intent.getCharSequenceExtra(android.content.Intent.EXTRA_TEXT)?.toString())
            .filter { it.isNotBlank() }.distinct().joinToString("\n")
        @Suppress("DEPRECATION")
        val streams: List<Uri> = if (intent.action == android.content.Intent.ACTION_SEND_MULTIPLE) {
            intent.getParcelableArrayListExtra<Uri>(android.content.Intent.EXTRA_STREAM).orEmpty()
        } else {
            listOfNotNull(intent.getParcelableExtra(android.content.Intent.EXTRA_STREAM))
        }
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 3600_000L }?.forEach { it.delete() }
        val copied = streams.take(9).mapNotNull { uri ->
            runCatching {
                val name = AttachmentPrep.displayName(context, uri).replace(Regex("[\\\\/]"), "_")
                val out = File(dir, "${UUID.randomUUID().toString().take(8)}-$name")
                context.contentResolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } } ?: return@runCatching null
                FileProvider.getUriForFile(context, "${context.packageName}.files", out)
            }.getOrNull()
        }
        return if (text.isBlank() && copied.isEmpty()) null else SharedContent(text, copied)
    }
}

/**
 * Attachment references inside a prompt: host paths under the desktop's clipboard-image dir
 * (`pi-clipboard-…`), from this phone or pasted on the desktop. Used to show them as chips.
 */
object PromptAttachments {
    private val pathRe = Regex("""(?:"[^"\n]*pi-clipboard-[^"\n]*"|\S*pi-clipboard-\S+)""")
    private val imageExt = setOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif")

    data class Ref(val name: String, val isImage: Boolean, val path: String = "")

    fun split(text: String): Pair<String, List<Ref>> {
        if (!text.contains("pi-clipboard-")) return text to emptyList()
        val refs = pathRe.findAll(text).map { m ->
            val base = m.value.trim('"').substringAfterLast('/').substringAfterLast('\\').removePrefix("pi-clipboard-")
            // Phone uploads: "<8 hex>-<original name>"; desktop pastes: "<uuid>.<ext>".
            val desktopPaste = Regex("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.").containsMatchIn(base)
            val name = if (desktopPaste) "image.${base.substringAfterLast('.')}" else Regex("^[0-9a-f]{8}-(.+)$").find(base)?.groupValues?.get(1) ?: base
            Ref(name, name.substringAfterLast('.', "").lowercase() in imageExt, m.value.trim('"'))
        }.toList()
        return pathRe.replace(text, "").replace(Regex("[ \\t]+\n"), "\n").trim() to refs
    }

    fun compose(text: String, paths: List<String>): String {
        val refs = paths.joinToString(" ") { if (it.any(Char::isWhitespace)) "\"$it\"" else it }
        return listOf(text.trim(), refs).filter { it.isNotEmpty() }.joinToString("\n")
    }
}
