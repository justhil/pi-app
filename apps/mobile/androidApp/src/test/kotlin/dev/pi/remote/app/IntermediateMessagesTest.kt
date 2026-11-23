package dev.pi.remote.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.pi.remote.app.data.UiPrefs
import dev.pi.remote.app.ui.session.liveActivitySteps
import dev.pi.remote.app.ui.session.settledIntermediateProse
import dev.pi.remote.protocol.ProseStep
import dev.pi.remote.protocol.ThinkingStep
import dev.pi.remote.protocol.ToolStep
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [35])
class IntermediateMessagesTest {
    private val firstTool = tool("tool-1")
    private val firstProse = prose("prose-1", "Stand is ready.")
    private val secondTool = tool("tool-2")
    private val secondProse = prose("prose-2", "The first scenario passed.")
    private val thought = ThinkingStep("thinking-1", "thinking", "Check the remaining scenarios.")
    private val thirdProse = prose("prose-3", "All scenarios passed.")
    private val thirdTool = tool("tool-3")
    private val steps = listOf(firstTool, firstProse, secondTool, secondProse, thought, thirdProse, thirdTool)

    @Test
    fun `default keeps the existing three non-prose live steps`() {
        assertEquals(listOf(secondTool, thought, thirdTool), liveActivitySteps(steps, showIntermediateMessages = false))
    }

    @Test
    fun `preference is saved per device and defaults to off`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("ui", Context.MODE_PRIVATE).edit().clear().commit()

        val first = UiPrefs(context)
        assertEquals(false, first.showIntermediateMessages.value)
        first.setShowIntermediateMessages(true)
        assertEquals(true, UiPrefs(context).showIntermediateMessages.value)
    }

    @Test
    fun `enabled keeps every non-blank prose message in order and recent activity steps`() {
        val withBlank = steps + prose("prose-blank", "   \n ")
        assertEquals(
            listOf(firstProse, secondTool, secondProse, thought, thirdProse, thirdTool),
            liveActivitySteps(withBlank, showIntermediateMessages = true),
        )
    }

    @Test
    fun `settled intermediate prose returns empty when disabled or when no non-blank prose exists`() {
        assertEquals(emptyList<ProseStep>(), settledIntermediateProse(steps, showIntermediateMessages = false))
        assertEquals(emptyList<ProseStep>(), settledIntermediateProse(listOf(firstTool, thought, prose("p-empty", "  ")), showIntermediateMessages = true))
        assertEquals(listOf(firstProse, secondProse, thirdProse), settledIntermediateProse(steps, showIntermediateMessages = true))
    }

    private fun prose(id: String, text: String) = ProseStep(id, "prose", text)

    private fun tool(id: String) = ToolStep(
        id = id,
        kind = "tool",
        toolCallId = "call-$id",
        toolName = "bash",
        category = "run",
        node = dev.pi.remote.protocol.RenderNode(
            template = "bash",
            title = "Run check",
            status = "ok",
            fields = kotlinx.serialization.json.JsonObject(emptyMap()),
            fallbackText = "Run check",
        ),
        status = "ok",
    )
}
