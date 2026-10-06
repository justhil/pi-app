package dev.pi.remote.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * Mirrors packages/shared/remote/timeline.ts. Field names match the wire exactly; optional
 * fields default to null and are omitted when encoding (explicitNulls = false). Golden
 * fixtures in packages/shared/remote/fixtures keep both sides honest.
 */

@Serializable
data class ActivityCounts(
    val read: Int,
    val edit: Int,
    val write: Int,
    val run: Int,
    val search: Int,
    val think: Int,
    val other: Int,
) {
    val tools: Int get() = read + edit + write + run + search + other

    companion object {
        val Empty = ActivityCounts(0, 0, 0, 0, 0, 0, 0)
    }
}

@Serializable
data class RenderNode(
    val template: String,
    val title: String,
    val icon: String? = null,
    val status: String,
    val fields: JsonObject,
    val preview: String? = null,
    val detail: Boolean? = null,
    val fallbackText: String,
)

@Serializable(with = StepSerializer::class)
sealed interface Step {
    val id: String
    val kind: String
}

@Serializable
data class ThinkingStep(
    override val id: String,
    override val kind: String,
    val text: String,
    val ms: Long? = null,
) : Step

@Serializable
data class ToolStep(
    override val id: String,
    override val kind: String,
    val toolCallId: String,
    val toolName: String,
    val category: String,
    val node: RenderNode,
    val status: String,
    val ms: Long? = null,
) : Step

@Serializable
data class ProseStep(
    override val id: String,
    override val kind: String,
    val text: String,
) : Step

object StepSerializer : JsonContentPolymorphicSerializer<Step>(Step::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out Step> =
        when (element.jsonObject["kind"]?.jsonPrimitive?.content) {
            "thinking" -> ThinkingStep.serializer()
            "tool" -> ToolStep.serializer()
            "prose" -> ProseStep.serializer()
            else -> error("unknown step kind")
        }
}

@Serializable
data class FileStat(val path: String, val add: Int, val del: Int)

@Serializable
data class TurnUser(val text: String, val images: Int? = null)

@Serializable
data class TurnActivity(
    val counts: ActivityCounts,
    val failed: Int,
    val thinkingMs: Long? = null,
    val live: String? = null,
)

@Serializable
data class TurnMeta(val model: String? = null, val thinking: String? = null)

@Serializable
data class TurnError(val kind: String, val text: String)

@Serializable
data class Turn(
    val id: String,
    val anchor: String,
    val status: String,
    val startedAt: Long? = null,
    val durationMs: Long? = null,
    val user: TurnUser,
    val activity: TurnActivity,
    val steps: List<Step>,
    val answer: String,
    val files: List<FileStat>,
    val meta: TurnMeta? = null,
    val error: TurnError? = null,
) {
    val running: Boolean get() = status == "running"
}

@Serializable
data class PromptQueue(val steering: List<String>, val followUp: List<String>)

@Serializable
data class SessionState(
    val running: Boolean,
    val model: String? = null,
    val thinking: String? = null,
    val availableThinking: List<String>? = null,
    val queue: PromptQueue? = null,
    /** The session's todo list; null once cleared. */
    val todo: TodoState? = null,
)

@Serializable
data class TodoItem(val id: String, val text: String, val status: String, val priority: String? = null)

@Serializable
data class TodoState(val title: String, val items: List<TodoItem>)

@Serializable(with = TurnPatchSerializer::class)
sealed interface TurnPatch {
    val op: String
    val seq: Long
}

@Serializable
data class TurnUpsert(override val op: String, override val seq: Long, val turn: Turn) : TurnPatch

@Serializable
data class StepUpsert(
    override val op: String,
    override val seq: Long,
    val turnId: String,
    val step: Step,
    val counts: ActivityCounts,
    val failed: Int,
    val live: String? = null,
) : TurnPatch

@Serializable
data class TextAppend(
    override val op: String,
    override val seq: Long,
    /** Coalesced appends cover `seq..seqTo`. */
    val seqTo: Long? = null,
    val turnId: String,
    val ref: String,
    val delta: String,
) : TurnPatch

@Serializable
data class TurnPromote(override val op: String, override val seq: Long, val turnId: String, val step: ProseStep) : TurnPatch

@Serializable
data class TurnSettle(
    override val op: String,
    override val seq: Long,
    val turnId: String,
    val status: String,
    val durationMs: Long? = null,
    val files: List<FileStat>,
    val error: TurnError? = null,
) : TurnPatch

@Serializable
data class SessionStatePatch(override val op: String, override val seq: Long, val state: SessionState) : TurnPatch

object TurnPatchSerializer : JsonContentPolymorphicSerializer<TurnPatch>(TurnPatch::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out TurnPatch> =
        when (element.jsonObject["op"]?.jsonPrimitive?.content) {
            "turn.upsert" -> TurnUpsert.serializer()
            "step.upsert" -> StepUpsert.serializer()
            "text.append" -> TextAppend.serializer()
            "turn.promote" -> TurnPromote.serializer()
            "turn.settle" -> TurnSettle.serializer()
            "session.state" -> SessionStatePatch.serializer()
            else -> error("unknown patch op")
        }
}

@Serializable
data class SessionSummary(
    val sessionKey: String,
    val projectId: String,
    val title: String,
    val status: String,
    val updatedAt: Long,
    val preview: String? = null,
    val live: String? = null,
    val liveCategory: String? = null,
    val startedAt: Long? = null,
    val counts: ActivityCounts? = null,
    val filesChanged: Int? = null,
)

@Serializable
data class Cursor(val epoch: String, val seq: Long)

@Serializable
data class ProjectInfo(val id: String, val name: String, val temporary: Boolean = false)
