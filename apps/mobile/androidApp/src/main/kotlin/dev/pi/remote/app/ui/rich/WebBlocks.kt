package dev.pi.remote.app.ui.rich

import android.annotation.SuppressLint
import android.graphics.Color as AColor
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.BlockCard
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.Segmented
import kotlinx.serialization.json.JsonPrimitive

/**
 * WebView-backed blocks. HTML previews run with JavaScript, network and navigation disabled;
 * KaTeX ships in the APK; mermaid comes from the desktop (hash-checked). The page reports its
 * height through a tiny JS bridge so the block sizes to its content (capped).
 */

private const val MAX_HEIGHT_DP = 480

/**
 * Last measured content height per page. A block scrolled back into view starts at its real height
 * instead of 120dp → measured → jump.
 */
private val measuredHeights = android.util.LruCache<Int, Int>(200)

private class HeightBridge(val onHeight: (Int) -> Unit) {
    @JavascriptInterface
    fun height(px: Int) = onHeight(px)
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SandboxWebView(html: String, js: Boolean, baseUrl: String?, allowFiles: Boolean, maxHeightDp: Int = MAX_HEIGHT_DP, modifier: Modifier = Modifier) {
    if (LocalInspectionMode.current) {
        Box(modifier.fillMaxWidth().height(120.dp).background(Pi.c.surface))
        return
    }
    val pageKey = remember(html) { html.hashCode() }
    var heightPx by remember(pageKey) { mutableIntStateOf(measuredHeights.get(pageKey) ?: 0) }
    val report: (Int) -> Unit = { px -> if (px > 0) { heightPx = px; measuredHeights.put(pageKey, px) } }
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    val h = if (heightPx > 0) minOf(maxHeightDp, (heightPx / density).toInt() + 8) else 120
    AndroidView(
        modifier = modifier.fillMaxWidth().height(h.dp),
        factory = { ctx ->
            WebView(ctx).apply {
                setBackgroundColor(AColor.TRANSPARENT)
                settings.javaScriptEnabled = js
                settings.blockNetworkLoads = true
                settings.allowFileAccess = allowFiles
                settings.allowContentAccess = false
                settings.domStorageEnabled = false
                settings.setGeolocationEnabled(false)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                    override fun onPageFinished(view: WebView, url: String?) {
                        if (!js) report((view.contentHeight * view.resources.displayMetrics.density).toInt())
                    }
                }
                if (js) addJavascriptInterface(HeightBridge { px -> post { report(px) } }, "PiHost")
            }
        },
        // `update` re-runs on every recomposition (each height report causes one): load only when
        // the page changes, otherwise the block reloads in a loop and the list stutters.
        update = { view ->
            if (view.tag != pageKey) {
                view.tag = pageKey
                view.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
            }
        },
        onRelease = { it.destroy() },
    )
}

private fun page(body: String, dark: Boolean, head: String = "", js: Boolean = false): String = """
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;color:${if (dark) "#d9d9d9" else "#09090b"};font-family:system-ui,sans-serif;font-size:14px;overflow-x:auto}</style>
$head</head><body>$body
${if (js) "<script>function r(){PiHost.height(Math.ceil(document.documentElement.scrollHeight*devicePixelRatio))}window.addEventListener('load',function(){setTimeout(r,50)});new ResizeObserver(r).observe(document.body)</script>" else ""}
</body></html>
""".trimIndent()

@Composable
fun HtmlCard(code: String) {
    var view by remember { mutableStateOf("preview") }
    var full by remember { mutableStateOf(false) }
    BlockCard {
        Column {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("html", style = Pi.t.meta.copy(color = Pi.c.fg3))
                Box(Modifier.width(8.dp))
                Segmented(listOf("preview" to stringResource(R.string.html_preview), "source" to stringResource(R.string.html_source)), view, { view = it })
                Box(Modifier.weight(1f))
                IconAction(PiIcons.Expand, stringResource(R.string.fullscreen), { full = true }, tint = Pi.c.fg3, size = 15.dp)
            }
            Hairline()
            if (view == "preview") {
                Box(Modifier.background(if (Pi.c.dark) Pi.c.surface else Pi.c.surface).padding(10.dp)) {
                    SandboxWebView(page(code, dark = false), js = false, baseUrl = null, allowFiles = false)
                }
                Hairline()
                Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    PiIcon(PiIcons.Lock, Pi.c.fg3, 12.dp)
                    Box(Modifier.width(6.dp))
                    Text(stringResource(R.string.html_sandbox), style = Pi.t.small.copy(color = Pi.c.fg3))
                }
            } else {
                Box(Modifier.background(Pi.c.code).horizontalScroll(rememberScrollState()).padding(12.dp)) {
                    Text(highlight(code, "html", Pi.c), style = Pi.t.mono.copy(color = Pi.c.fg), softWrap = false)
                }
            }
        }
    }
    if (full) {
        Dialog(onDismissRequest = { full = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(Modifier.fillMaxSize().background(Pi.c.bg)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    IconAction(PiIcons.X, stringResource(R.string.close), { full = false })
                }
                SandboxWebView(page(code, dark = false), js = false, baseUrl = null, allowFiles = false, maxHeightDp = 2000, modifier = Modifier.padding(10.dp))
            }
        }
    }
}

@Composable
fun MathBlock(tex: String) {
    val density = androidx.compose.ui.platform.LocalDensity.current
    val fontPx = with(density) { (Pi.t.body.fontSize * 1.12f).toPx() }
    val laid = remember(tex, fontPx) { NativeMath.layout(tex, fontPx, display = true) }
    if (laid != null) {
        // Native first: no WebView per formula; wide formulas scroll sideways like on the desktop.
        val color = Pi.c.fg
        Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.Canvas(
                Modifier.width(with(density) { laid.width.toDp() }).height(with(density) { (laid.ascent + laid.descent).toDp() }),
            ) { with(NativeMath) { drawMath(laid, color, baselineY = laid.ascent) } }
        }
        return
    }
    KatexBlock(tex)
}

/** KaTeX in a sandboxed WebView: the fallback for TeX AndroidMath does not cover. */
@Composable
private fun KatexBlock(tex: String) {
    val dark = Pi.c.dark
    val head = """<link rel="stylesheet" href="katex/katex.min.css"><script src="katex/katex.min.js"></script><style>.katex{font-size:1.15em}</style>"""
    val body = """<div id="m"></div><script>katex.render(${JsonPrimitive(tex)},document.getElementById('m'),{displayMode:true,throwOnError:false});</script>"""
    Box(Modifier.fillMaxWidth().heightIn(min = 40.dp)) {
        SandboxWebView(page(body, dark, head, js = true), js = true, baseUrl = "file:///android_asset/", allowFiles = true, maxHeightDp = 260)
    }
}

@Composable
fun MermaidBlock(code: String, source: MermaidSource?) {
    var script by remember { mutableStateOf<java.io.File?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(source) {
        script = source?.script()
        if (script == null) failed = true
    }
    BlockCard {
        Column(Modifier.padding(10.dp)) {
            val file = script
            when {
                file != null -> {
                    val dark = Pi.c.dark
                    val body = """<pre class="mermaid">${code.replace("<", "&lt;")}</pre><script src="file://${file.absolutePath}"></script>
<script>mermaid.initialize({startOnLoad:false,theme:'${if (dark) "dark" else "neutral"}',securityLevel:'strict'});mermaid.run().then(function(){setTimeout(function(){PiHost.height(Math.ceil(document.documentElement.scrollHeight*devicePixelRatio))},30)})</script>"""
                    SandboxWebView(page(body, dark, js = true), js = true, baseUrl = "file:///", allowFiles = true)
                }
                failed -> Box(Modifier.horizontalScroll(rememberScrollState())) { Text(code, style = Pi.t.monoSmall.copy(color = Pi.c.fg2), softWrap = false) }
                else -> Text(stringResource(R.string.mermaid_loading), style = Pi.t.secondary.copy(color = Pi.c.fg3))
            }
            Text("mermaid", style = Pi.t.small.copy(color = Pi.c.fg3), modifier = Modifier.align(Alignment.End).padding(top = 4.dp))
        }
    }
}
