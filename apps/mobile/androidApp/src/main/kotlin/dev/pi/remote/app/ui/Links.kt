package dev.pi.remote.app.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import dev.pi.remote.R

/**
 * Links from replies, pi-ui and user messages. Web links open in the browser (or the app that
 * owns the domain), mailto/tel go to the system; anything else (repo paths like `src/a.ts`,
 * anchors, file:// on the desktop) cannot open on the phone, so it is copied with a hint
 * instead of crashing on ActivityNotFoundException like the default handler.
 */
class PiUriHandler(private val context: Context) : UriHandler {
    override fun openUri(uri: String) {
        val trimmed = uri.trim()
        val normalized = if (trimmed.startsWith("www.", ignoreCase = true)) "https://$trimmed" else trimmed
        val scheme = Uri.parse(normalized).scheme?.lowercase()
        if (scheme in setOf("http", "https", "mailto", "tel", "geo", "sms")) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(normalized)).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
                // fall through to copy
            }
        }
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("link", trimmed))
        Toast.makeText(context, context.getString(R.string.link_copied, trimmed.take(80)), Toast.LENGTH_SHORT).show()
    }
}

// Stops at whitespace, quotes and CJK text/full-width punctuation ("见 https://a.b/c，还有…").
private val urlRe = Regex("""(?:https?://|www\.)[^\s<>"'`\u3000-\u9fff\uff00-\uffef]+[^\s<>"'`.,;:!?)\]}\u3000-\u9fff\uff00-\uffef]""", RegexOption.IGNORE_CASE)

/** Plain text with web URLs made tappable (user messages, tool output previews). */
fun linkify(text: String, styles: TextLinkStyles = TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))): AnnotatedString {
    if (!text.contains("http", ignoreCase = true) && !text.contains("www.", ignoreCase = true)) return AnnotatedString(text)
    return buildAnnotatedString {
        var last = 0
        for (m in urlRe.findAll(text)) {
            append(text, last, m.range.first)
            val url = if (m.value.startsWith("www.", ignoreCase = true)) "https://${m.value}" else m.value
            withLink(LinkAnnotation.Url(url, styles)) { append(m.value) }
            last = m.range.last + 1
        }
        append(text, last, text.length)
    }
}
