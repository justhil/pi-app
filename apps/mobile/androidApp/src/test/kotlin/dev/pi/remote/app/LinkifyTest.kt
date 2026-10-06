package dev.pi.remote.app

import androidx.compose.ui.text.LinkAnnotation
import dev.pi.remote.app.ui.linkify
import org.junit.Assert.assertEquals
import org.junit.Test

class LinkifyTest {
    private fun urls(text: String) = linkify(text).getLinkAnnotations(0, text.length).map { (it.item as LinkAnnotation.Url).url }

    @Test fun findsWebLinksAndTrimsTrailingPunctuation() {
        assertEquals(listOf("https://github.com/getpaseo/paseo", "https://www.example.com/a?b=1"), urls("看 https://github.com/getpaseo/paseo，还有 www.example.com/a?b=1。"))
    }

    @Test fun leavesPathsAndPlainTextAlone() {
        assertEquals(emptyList<String>(), urls("改了 src/auth/refresh.ts 和 README.md"))
    }
}
