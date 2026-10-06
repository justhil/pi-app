package dev.pi.remote.app.theme

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The handful of Lucide icons the app uses (same set as the desktop), built from their SVG path
 * data so the APK does not carry material-icons-extended. 24-unit viewport, stroke icons.
 */
object PiIcons {
    private val cache = HashMap<String, ImageVector>()

    private fun icon(name: String, stroke: Float = 1.75f, fill: Boolean = false, vararg paths: String): ImageVector = cache.getOrPut(name) {
        val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (p in paths) {
            b.addPath(
                pathData = PathParser().parsePathString(p).toNodes(),
                fill = if (fill) SolidColor(Color.Black) else null,
                stroke = if (fill) null else SolidColor(Color.Black),
                strokeLineWidth = stroke,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        b.build()
    }

    private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r},$cy a$r,$r 0 1,0 ${r * 2},0 a$r,$r 0 1,0 ${-r * 2},0"

    val ChevronLeft get() = icon("chevron-left", paths = arrayOf("m15 18-6-6 6-6"))
    val ChevronRight get() = icon("chevron-right", paths = arrayOf("m9 18 6-6-6-6"))
    val ChevronDown get() = icon("chevron-down", paths = arrayOf("m6 9 6 6 6-6"))
    val Plus get() = icon("plus", paths = arrayOf("M5 12h14", "M12 5v14"))
    val More get() = icon("more", paths = arrayOf(circle(12f, 12f, 1f), circle(19f, 12f, 1f), circle(5f, 12f, 1f)))
    val ArrowUp get() = icon("arrow-up", 2f, paths = arrayOf("m5 12 7-7 7 7", "M12 19V5"))
    val ArrowDown get() = icon("arrow-down", paths = arrayOf("M12 5v14", "m19 12-7 7-7-7"))
    val Stop get() = icon("stop", fill = true, paths = arrayOf("M7.5 5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9A2.5 2.5 0 0 1 7.5 5z"))
    val Check get() = icon("check", 2f, paths = arrayOf("M20 6 9 17l-5-5"))
    val Loader get() = icon("loader", 2f, paths = arrayOf("M21 12a9 9 0 1 1-6.219-8.56"))
    val File get() = icon("file", paths = arrayOf("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"))
    val Terminal get() = icon("terminal", paths = arrayOf("m4 17 6-6-6-6", "M12 19h8"))
    val Pencil get() = icon("pencil", paths = arrayOf("M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"))
    val Search get() = icon("search", paths = arrayOf(circle(11f, 11f, 8f), "m21 21-4.3-4.3"))
    val Eye get() = icon("eye", paths = arrayOf("M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z", circle(12f, 12f, 3f)))
    val Bulb get() = icon("bulb", paths = arrayOf("M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"))
    val Question get() = icon("question", paths = arrayOf("M7.9 20A9 9 0 1 0 4 16.1L2 22Z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"))
    val Alert get() = icon("alert", paths = arrayOf(circle(12f, 12f, 10f), "M12 8v4", "M12 16h.01"))
    val Monitor get() = icon("monitor", paths = arrayOf("M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4"))
    val Queue get() = icon("queue", paths = arrayOf("m15 10 5 5-5 5", "M4 4v7a4 4 0 0 0 4 4h12"))
    val Slash get() = icon("slash", paths = arrayOf("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9.5 16 14.5 8"))
    val At get() = icon("at", paths = arrayOf(circle(12f, 12f, 4f), "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"))
    val Folder get() = icon("folder", paths = arrayOf("M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"))
    val Undo get() = icon("undo", paths = arrayOf("M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"))
    // Lucide git-branch
    val Branch get() = icon("git-branch", paths = arrayOf("M6 3v12", circle(18f, 6f, 3f), circle(6f, 18f, 3f), "M18 9a9 9 0 0 1-9 9"))
    // Lucide git-fork
    val Fork get() = icon("git-fork", paths = arrayOf(circle(12f, 18f, 3f), circle(6f, 6f, 3f), circle(18f, 6f, 3f), "M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9", "M12 12v3"))
    val Copy get() = icon("copy", paths = arrayOf("M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"))
    val Camera get() = icon("camera", paths = arrayOf("M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z", circle(12f, 13f, 3f)))
    val Image get() = icon("image", paths = arrayOf("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", circle(9f, 9f, 2f), "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"))
    val Paperclip get() = icon("paperclip", paths = arrayOf("m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"))
    val Share get() = icon("share", paths = arrayOf("M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "m16 6-4-4-4 4", "M12 2v13"))
    val TextSelect get() = icon("text-select", paths = arrayOf("M5 3a2 2 0 0 0-2 2", "M19 3a2 2 0 0 1 2 2", "M21 19a2 2 0 0 1-2 2", "M5 21a2 2 0 0 1-2-2", "M9 3h1", "M9 21h1", "M14 3h1", "M14 21h1", "M3 9v1", "M21 9v1", "M3 14v1", "M21 14v1", "M7 8h8", "M7 12h10", "M7 16h6"))
    val Lock get() = icon("lock", paths = arrayOf("M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4"))
    val Scan get() = icon("scan", paths = arrayOf("M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M7 12h10"))
    val Sparkles get() = icon("sparkles", paths = arrayOf("M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"))
    val Flame get() = icon("flame", paths = arrayOf("M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"))
    val Pause get() = icon("pause", paths = arrayOf("M7 5h3v14H7z", "M14 5h3v14h-3z"))
    val Expand get() = icon("expand", paths = arrayOf("M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"))
    val Wifi get() = icon("wifi", paths = arrayOf("M12 20h.01", "M2 8.82a15 15 0 0 1 20 0", "M5 12.859a10 10 0 0 1 14 0", "M8.5 16.429a5 5 0 0 1 7 0"))
    val X get() = icon("x", paths = arrayOf("M18 6 6 18", "m6 6 12 12"))
}

@Composable
fun PiIcon(icon: ImageVector, tint: Color, size: Dp = 16.dp, modifier: Modifier = Modifier, contentDescription: String? = null) {
    Icon(icon, contentDescription = contentDescription, tint = tint, modifier = modifier.size(size))
}
