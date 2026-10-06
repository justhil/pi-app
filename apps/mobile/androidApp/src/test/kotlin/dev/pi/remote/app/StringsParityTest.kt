package dev.pi.remote.app

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/** English (default) and Chinese resources carry the same keys and the same format arguments. */
class StringsParityTest {
    private val res = listOf(File("src/main/res"), File("androidApp/src/main/res")).first { it.isDirectory }
    /** Brand names: not translated. */
    private val untranslated = setOf("app_name")

    private fun strings(dir: String): Map<String, String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(res, "$dir/strings.xml"))
        val nodes = doc.documentElement.childNodes
        return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }
            .filter { it.tagName == "string" || it.tagName == "plurals" }
            .associate { it.getAttribute("name") to it.textContent }
    }

    private fun args(s: String) = Regex("%(\\d+\\$)?[sdf]").findAll(s).map { it.value }.toSortedSet()

    @Test
    fun sameKeysAndArguments() {
        val en = strings("values") - untranslated
        val zh = strings("values-zh") - untranslated
        assertEquals("keys only in values/", emptySet<String>(), en.keys - zh.keys)
        assertEquals("keys only in values-zh/", emptySet<String>(), zh.keys - en.keys)
        for ((k, v) in en) assertEquals("format arguments of $k", args(v), args(zh.getValue(k)))
    }
}
