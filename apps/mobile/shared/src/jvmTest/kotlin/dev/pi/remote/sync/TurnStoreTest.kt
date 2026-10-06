package dev.pi.remote.sync

import dev.pi.remote.protocol.OpenResult
import dev.pi.remote.protocol.ProseStep
import dev.pi.remote.protocol.RemoteJson
import dev.pi.remote.protocol.ThinkingStep
import dev.pi.remote.protocol.ToolStep
import dev.pi.remote.protocol.TurnPatchEvent
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.json.jsonObject

/** Drives the store with the gateway's golden messages (session.open result + a patch stream). */
class TurnStoreTest {
    private val dir = File(System.getProperty("pi.remote.fixtures") ?: "../../../packages/shared/remote/fixtures", "messages")
    private fun value(name: String) = RemoteJson.parseToJsonElement(File(dir, "$name.json").readText()).jsonObject["value"]!!

    private val open = RemoteJson.decodeFromJsonElement(OpenResult.serializer(), value("method.session.open.result"))
    private val patches = RemoteJson.decodeFromJsonElement(TurnPatchEvent.serializer(), value("event.turn.patch.0")).patches

    @Test
    fun snapshotThenLivePatchesBuildTheTurn() {
        val base = TurnStore.fromOpen(null, open).copy(seq = 0, turns = open.turns!!.take(1))
        val r = TurnStore.applyAll(base, patches)
        assertIs<ApplyResult.Applied>(r)
        val t = r.timeline
        assertEquals(7, t.seq)
        val live = t.turns.last()
        assertEquals("live:turn-88", live.id)
        assertEquals("failed", live.status)
        assertEquals("", live.answer, "promoted answer moves into a prose step")
        assertTrue(live.steps.any { it is ProseStep && it.text == "全部通过。" })
        assertTrue(live.steps.any { it is ThinkingStep && it.text == "lint passed" })
        assertEquals("error", (live.steps.first { it is ToolStep } as ToolStep).status, "running tools end as errors on a failed settle")
        assertEquals(listOf("更新 CHANGELOG"), t.state.queue!!.followUp)
        assertEquals(null, live.activity.live)
    }

    @Test
    fun duplicatesAreSkippedAndGapsReported() {
        val base = TurnStore.fromOpen(null, open).copy(seq = 0, turns = emptyList())
        val once = (TurnStore.applyAll(base, patches.take(3)) as ApplyResult.Applied).timeline
        val again = (TurnStore.applyAll(once, patches.take(3)) as ApplyResult.Applied).timeline
        assertEquals(once, again)
        assertEquals(4, once.seq, "the coalesced append (seq 3..4) advances the cursor to 4")
        val gap = TurnStore.applyAll(once, patches.drop(4))
        assertIs<ApplyResult.Gap>(gap)
        assertEquals(5, gap.expected)
        assertEquals(6, gap.got)
    }

    @Test
    fun upsertReplacesTurnWithSameAnchor() {
        val base = TurnStore.fromOpen(null, open)
        val historical = base.turns.first()
        val live = historical.copy(id = "live:9", status = "running")
        val next = TurnStore.apply(base, dev.pi.remote.protocol.TurnUpsert("turn.upsert", base.seq + 1, live))
        assertEquals(base.turns.size, next.turns.size)
        assertEquals("live:9", next.turns.first().id)
    }

    @Test
    fun olderPagesPrependWithoutDuplicates() {
        val base = TurnStore.fromOpen(null, open)
        val older = listOf(base.turns.first().copy(id = "old", anchor = "e-old"), base.turns.first())
        val merged = TurnStore.prependOlder(base, older, hasOlder = false)
        assertEquals(base.turns.size + 1, merged.turns.size)
        assertEquals("e-old", merged.turns.first().anchor)
        assertEquals(false, merged.hasOlder)
    }

    @Test
    fun pendingUiIgnoresNotifyAndDuplicates() {
        var t = TurnStore.fromOpen(null, open)
        val first = t.pendingUi.first()
        t = TurnStore.addUi(t, first)
        assertEquals(1, t.pendingUi.size)
        t = TurnStore.removeUi(t, first.id)
        assertTrue(t.pendingUi.isEmpty())
    }
}
