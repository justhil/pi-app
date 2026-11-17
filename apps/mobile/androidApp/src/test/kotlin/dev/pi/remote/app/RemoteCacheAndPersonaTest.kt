package dev.pi.remote.app

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.input.TextFieldValue
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.pi.remote.R
import dev.pi.remote.app.data.OutboxEntry
import dev.pi.remote.app.data.TimelineCache
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiTheme
import dev.pi.remote.app.ui.rich.parseFileTarget
import dev.pi.remote.app.ui.session.Composer
import dev.pi.remote.app.ui.session.PurgeSheet
import dev.pi.remote.protocol.ProjectInfo
import dev.pi.remote.protocol.PurgePersona
import dev.pi.remote.protocol.PurgeSessionState
import dev.pi.remote.protocol.PurgeStateResult
import dev.pi.remote.protocol.SessionState
import dev.pi.remote.sync.SessionTimeline
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], qualifiers = "zh-w360dp-h740dp-xxhdpi")
class RemoteCacheAndPersonaTest {
    @get:Rule val compose = createComposeRule()
    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun cachePersistsMetaDraftsUnreadAndEvictsOldTimelines() {
        val dir = Files.createTempDirectory("pi-remote-cache-test").toFile()
        try {
            val cache = TimelineCache(dir)
            val hostId = "h_test"
            cache.updateMeta(hostId) {
                it.copy(
                    projects = listOf(ProjectInfo("/work/pi-app", "pi-app", branch = "main")),
                    allowAllProjects = true,
                    purge = PurgeStateResult("konata", "replace", listOf(PurgePersona("konata", "泉此方"))),
                    unreadSessions = setOf("/s/1"),
                    drafts = mapOf("/s/1" to "半截草稿"),
                )
            }
            val loaded = cache.loadMeta(hostId)
            assertTrue(loaded.allowAllProjects)
            assertEquals("main", loaded.projects.single().branch)
            assertEquals(setOf("/s/1"), loaded.unreadSessions)
            assertEquals("半截草稿", loaded.drafts["/s/1"])

            for (i in 1..(TimelineCache.MAX_CACHED_TIMELINES + 5)) {
                val tl = SessionTimeline("/s/$i", "Title $i", "e1", i.toLong(), emptyList(), false, SessionState(false))
                cache.saveTimeline(hostId, tl)
            }
            assertTrue(cache.totalBytes() > 0L)

            cache.removeTimeline(hostId, "/s/45")
            assertNull(cache.loadTimeline(hostId, "/s/45"))

            // Clearing cached content drops timelines & project snapshots while preserving unsent drafts & outbox.
            cache.updateMeta(hostId) {
                it.copy(outbox = listOf(OutboxEntry("m_offline_1", "/s/1", "离线补发测试", "prompt", null, 100L)))
            }
            cache.clearCachedContent()
            assertNull(cache.loadTimeline(hostId, "/s/44"))
            val afterClear = cache.loadMeta(hostId)
            assertTrue(afterClear.projects.isEmpty())
            assertEquals("半截草稿", afterClear.drafts["/s/1"])
            assertEquals("离线补发测试", afterClear.outbox.single().text)
            assertEquals(setOf("/s/1"), afterClear.unreadSessions)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun parsesWorkspaceFileTargetsAndRejectsUrls() {
        val colon = parseFileTarget("src/main/remote/rpc.ts:142:8")
        assertEquals("src/main/remote/rpc.ts", colon?.path)
        assertEquals(142, colon?.lineStart)

        val hashRange = parseFileTarget("`apps/mobile/MainActivity.kt#L10-L25`")
        assertEquals("apps/mobile/MainActivity.kt", hashRange?.path)
        assertEquals(10, hashRange?.lineStart)
        assertEquals(25, hashRange?.lineEnd)
        assertEquals("@apps/mobile/MainActivity.kt#L10-L25", hashRange?.mentionRef())

        val absInRoot = parseFileTarget("D:/workspace/pi-app/packages/shared/remote/methods.ts:44", "D:\\workspace\\pi-app")
        assertEquals("packages/shared/remote/methods.ts", absInRoot?.path)
        assertEquals(44, absInRoot?.lineStart)

        assertNull(parseFileTarget("https://github.com/pingdotgg/t3code/blob/main/README.md"))
        assertNull(parseFileTarget("../etc/passwd"))
        assertNull(parseFileTarget("--flag=value"))
    }

    @Test
    fun should_open_persona_picker_when_tapping_persona_pill_and_switch_in_locked_session() {
        var active = true
        var openedSheet = false
        var pickedPersona: String? = null
        compose.setContent {
            PiTheme(dark = false) {
                Box(Modifier.fillMaxSize().background(Pi.c.bg)) {
                    Composer(
                        text = TextFieldValue(""),
                        onText = {},
                        running = false,
                        enabled = true,
                        modelLabel = "sonnet-5",
                        thinkingLabel = "High",
                        toolsOn = 1,
                        queue = null,
                        onSend = {},
                        onStop = {},
                        onModel = {},
                        onTools = {},
                        purgeDraft = active,
                        purgeLabel = "大肥鱼 · 换身份",
                        onTogglePurge = { active = !active },
                        onOpenPurge = { openedSheet = true },
                    )
                }
            }
        }
        // Tapping the active persona label should open the persona switcher instead of silently turning it off.
        compose.onNodeWithText("大肥鱼 · 换身份").performClick()
        assertTrue("Expected persona sheet to open when tapping active persona pill", openedSheet)
        assertTrue("Expected persona to remain active when opening switcher", active)
    }

    @Test
    fun should_allow_selecting_another_persona_in_purge_sheet_even_after_first_turn() {
        var pickedPersona: String? = null
        val state = PurgeStateResult(
            defaultPersonaId = "dafeiyu",
            defaultMode = "replace",
            personas = listOf(
                PurgePersona("dafeiyu", "大肥鱼"),
                PurgePersona("xiaomajiang", "小码酱"),
            ),
            session = PurgeSessionState(locked = "on", personaId = "dafeiyu", personaName = "大肥鱼", mode = "replace"),
        )
        compose.setContent {
            PiTheme(dark = false) {
                PurgeSheet(
                    state = state,
                    draftEnabled = true,
                    draftPersonaId = "dafeiyu",
                    draftMode = "replace",
                    canWrite = true,
                    onToggle = {},
                    onSelectPersona = { pickedPersona = it },
                    onSelectMode = {},
                    onDismiss = {},
                )
            }
        }
        compose.onNodeWithText("小码酱").performClick()
        assertEquals("xiaomajiang", pickedPersona)
    }
}
