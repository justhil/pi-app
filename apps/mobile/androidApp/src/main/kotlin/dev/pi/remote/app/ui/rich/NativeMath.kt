package dev.pi.remote.app.ui.rich

import android.content.Context
import android.util.LruCache
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import com.agog.mathdisplay.MTFontManager
import com.agog.mathdisplay.parse.MTLineStyle
import com.agog.mathdisplay.parse.MTMathListBuilder
import com.agog.mathdisplay.parse.MTParseError
import com.agog.mathdisplay.parse.MTParseErrors
import com.agog.mathdisplay.render.MTFont
import com.agog.mathdisplay.render.MTMathListDisplay
import com.agog.mathdisplay.render.MTTypesetter
import dev.pi.remote.text.MathText

/**
 * Native TeX typesetting (AndroidMath: iosMath port, Latin Modern Math, drawn on the Canvas), so
 * inline formulas sit in the text flow and display formulas need no WebView. Anything it cannot
 * parse falls back to KaTeX (blocks) or an inline code look (inline). Main thread only.
 */
object NativeMath {
    @Volatile private var ready = false
    private val fonts = HashMap<Int, MTFont>()
    private val laid = LruCache<String, Laid>(400)
    private val unsupported = LruCache<String, Boolean>(400)

    class Laid(val display: MTMathListDisplay, val width: Float, val ascent: Float, val descent: Float)

    fun init(context: Context) {
        // The freetype JNI library is missing under Robolectric/JVM tests: stay disabled there.
        ready = runCatching { MTFontManager.setContext(context.applicationContext) }.isSuccess
    }

    private fun parse(tex: String) = runCatching {
        val err = MTParseError()
        val list = MTMathListBuilder.buildFromString(MathText.expandMacros(tex.trim()), err)
        if (err.errorcode != MTParseErrors.ErrorNone) null else list
    }.getOrNull()

    /** Whether [tex] typesets natively (cached; cheap after the first call). */
    fun supports(tex: String): Boolean {
        if (!ready) return false
        unsupported.get(tex)?.let { return !it }
        val ok = parse(tex) != null && runCatching { layout(tex, 40f, display = false) != null }.getOrDefault(false)
        unsupported.put(tex, !ok)
        return ok
    }

    fun layout(tex: String, sizePx: Float, display: Boolean): Laid? {
        if (!ready) return null
        val key = "${if (display) 'D' else 'T'}${sizePx.toInt()}|$tex"
        laid.get(key)?.let { return it }
        return runCatching {
            val list = parse(tex) ?: return null
            val font = fonts[sizePx.toInt()] ?: (MTFontManager.latinModernFontWithSize(sizePx) ?: return null).also { fonts[sizePx.toInt()] = it }
            val dl = MTTypesetter.createLineForMathList(list, font, if (display) MTLineStyle.KMTLineStyleDisplay else MTLineStyle.KMTLineStyleText)
            Laid(dl, dl.width, dl.ascent, dl.descent)
        }.getOrNull()?.also { laid.put(key, it) }
    }

    /** Draw with the math baseline at [baselineY] from the top of this scope. */
    fun DrawScope.drawMath(l: Laid, color: Color, baselineY: Float, x: Float = 0f) {
        drawIntoCanvas { c ->
            val nc = c.nativeCanvas
            l.display.textColor = color.toArgb()
            l.display.position.x = x
            l.display.position.y = 0f
            nc.save()
            // AndroidMath draws in a y-up space with the baseline at y = position.y.
            nc.translate(0f, baselineY)
            nc.scale(1f, -1f)
            l.display.draw(nc)
            nc.restore()
        }
    }
}

/** Box for an inline formula, aligned so the math baseline meets the text baseline. */
class InlineMathBox(val laid: NativeMath.Laid, val widthPx: Float, val heightPx: Float, val baselinePx: Float)

/**
 * Compose places inline content centred on the line ("TextCenter"); the text centre sits about
 * [centerAboveBaseline] above the baseline, so pad the box symmetrically around that point.
 */
fun inlineMathBox(tex: String, fontPx: Float, centerAboveBaseline: Float = fontPx * 0.32f): InlineMathBox? {
    val l = NativeMath.layout(tex, fontPx, display = false) ?: return null
    val half = maxOf(l.ascent - centerAboveBaseline, l.descent + centerAboveBaseline)
    return InlineMathBox(l, l.width + fontPx * 0.08f, half * 2, half + centerAboveBaseline)
}

@Composable
fun InlineMath(box: InlineMathBox, color: Color) {
    val d = LocalDensity.current
    Canvas(Modifier.size(with(d) { box.widthPx.toDp() }, with(d) { box.heightPx.toDp() })) {
        with(NativeMath) { drawMath(box.laid, color, box.baselinePx, x = box.widthPx * 0.0f) }
    }
}
