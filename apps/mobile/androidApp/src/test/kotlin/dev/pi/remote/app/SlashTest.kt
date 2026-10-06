package dev.pi.remote.app

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import dev.pi.remote.app.ui.session.SlashItem
import dev.pi.remote.app.ui.session.filterSlash
import dev.pi.remote.app.ui.session.insertSlash
import dev.pi.remote.app.ui.session.slashToken
import dev.pi.remote.app.ui.session.stripSlash
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SlashTest {
    private fun v(s: String) = TextFieldValue(s, TextRange(s.length))

    @Test fun tokenOnlyAtLineStart() {
        assertEquals(0 until 4, slashToken(v("/rev")))
        assertEquals(6 until 9, slashToken(v("hello\n/sk")))
        assertNull(slashToken(v("see a/b")))
        assertNull(slashToken(v("/review now")))
        assertNull(slashToken(v("x /re")))
    }

    @Test fun insertReplacesTokenOrPrefixes() {
        assertEquals("/review ", insertSlash(v("/rev"), "/review").text)
        assertEquals("/skill:pdf fill this", insertSlash(v("fill this"), "/skill:pdf").text)
        val r = insertSlash(v(""), "/todos")
        assertEquals("/todos ", r.text)
        assertEquals(TextRange(7), r.selection)
        assertEquals("", stripSlash(v("/mod")).text)
    }

    @Test fun filterRanksNameBeforeDescription() {
        val items = listOf(
            SlashItem("/review", "look at diff", "prompt"),
            SlashItem("/skill:pdf", "Read PDF forms", "skill"),
            SlashItem("/todos", "pdf exports", "extension"),
        )
        assertEquals(listOf("/skill:pdf", "/todos"), filterSlash(items, "pdf").map { it.name })
        assertEquals(listOf("/review"), filterSlash(items, "/rev").map { it.name })
        assertEquals(3, filterSlash(items, "").size)
    }
}
