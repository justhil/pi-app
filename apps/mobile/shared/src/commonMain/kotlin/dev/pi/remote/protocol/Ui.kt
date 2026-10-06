package dev.pi.remote.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Mirrors packages/shared/remote/ui.ts (extension UI dialogs forwarded from the desktop). */

@Serializable
data class UiQuestionOption(
    val label: String,
    val description: String? = null,
    val hasPreview: Boolean? = null,
    val preview: String? = null,
)

@Serializable
data class UiQuestion(
    val question: String,
    val header: String? = null,
    val multiSelect: Boolean? = null,
    val options: List<UiQuestionOption>,
)

@Serializable(with = UiRequestSerializer::class)
sealed interface UiRequest {
    val id: String
    val sessionKey: String
    val method: String
    val timeout: Long?
}

@Serializable
data class UiSelect(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val title: String,
    val options: List<String>,
) : UiRequest

@Serializable
data class UiConfirm(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val title: String,
    val message: String,
) : UiRequest

@Serializable
data class UiInput(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val title: String,
    val placeholder: String? = null,
) : UiRequest

@Serializable
data class UiEditor(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val title: String,
    val prefill: String? = null,
) : UiRequest

@Serializable
data class UiNotify(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val message: String,
    val notifyType: String? = null,
) : UiRequest

@Serializable
data class UiAskQuestions(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val kind: String,
    val questions: List<UiQuestion>,
    val toolCallId: String? = null,
) : UiRequest

@Serializable
data class UiImageReview(
    override val id: String,
    override val sessionKey: String,
    override val timeout: Long? = null,
    override val method: String,
    val kind: String,
    val image: String,
    val title: String,
    val question: String,
    val context: String? = null,
    val options: List<String>,
    val allowFeedback: Boolean,
) : UiRequest

object UiRequestSerializer : JsonContentPolymorphicSerializer<UiRequest>(UiRequest::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out UiRequest> {
        val o = element.jsonObject
        return when (o["method"]?.jsonPrimitive?.content) {
            "select" -> UiSelect.serializer()
            "confirm" -> UiConfirm.serializer()
            "input" -> UiInput.serializer()
            "editor" -> UiEditor.serializer()
            "notify" -> UiNotify.serializer()
            "custom" -> when (o["kind"]?.jsonPrimitive?.content) {
                "ask_user_question" -> UiAskQuestions.serializer()
                "image_review" -> UiImageReview.serializer()
                else -> error("unknown custom ui kind")
            }
            else -> error("unknown ui method")
        }
    }
}

/** Same shape the desktop sends to `extension.respondUI`. */
@Serializable
data class UiResponse(
    val id: String,
    val value: String? = null,
    val confirmed: Boolean? = null,
    val cancelled: Boolean? = null,
    val result: JsonElement? = null,
)

@Serializable
data class UiDismiss(val id: String, val sessionKey: String, val by: String)
