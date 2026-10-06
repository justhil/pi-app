package dev.pi.remote.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Mirrors packages/shared/remote/{frames,methods,events}.ts. */

const val PROTOCOL_VERSION = 1

val RemoteJson: Json = Json {
    ignoreUnknownKeys = true // newer desktops may add fields; never crash on them
    explicitNulls = false
    encodeDefaults = false
}

/** Decrypted envelope. `p` stays raw JSON until the caller knows the method. */
@Serializable
data class Frame(
    val v: Int,
    val k: String,
    val id: String? = null,
    val m: String? = null,
    val p: JsonElement? = null,
    val ok: Boolean? = null,
    val err: RpcError? = null,
)

@Serializable
data class RpcError(val code: String, val message: String, val retryable: Boolean)

@Serializable class Empty

@Serializable data class AppInfo(val name: String, val version: String, val platform: String)
@Serializable data class ClientCaps(val templates: List<String>, val piUi: List<String>, val uiKinds: List<String>)
@Serializable data class HelloParams(val app: AppInfo, val caps: ClientCaps)
@Serializable data class AssetInfo(val name: String, val sha256: String, val size: Long)

@Serializable
data class HelloResult(
    val hostId: String,
    val hostName: String,
    val version: String,
    val epoch: String,
    val deviceId: String,
    val role: String,
    val features: List<String>,
    val assets: List<AssetInfo>,
    val endpoints: List<String> = emptyList(),
)

@Serializable data class ProjectList(val projects: List<ProjectInfo>)
@Serializable data class WatchListParams(val projectId: String? = null)
@Serializable data class SessionList(val sessions: List<SessionSummary>)
@Serializable data class SessionKeyParams(val sessionKey: String)
@Serializable data class OpenParams(val sessionKey: String, val cursor: Cursor? = null)

@Serializable
data class OpenResult(
    val sessionKey: String,
    val title: String,
    val epoch: String,
    val seq: Long,
    val kind: String,
    val resync: String? = null,
    val turns: List<Turn>? = null,
    val hasOlder: Boolean? = null,
    val patches: List<TurnPatch>? = null,
    val state: SessionState,
    val pendingUi: List<UiRequest>,
)

@Serializable data class PageParams(val sessionKey: String, val before: String, val limit: Int)
@Serializable data class PageResult(val turns: List<Turn>, val hasOlder: Boolean)
@Serializable data class ToolDetailParams(val sessionKey: String, val toolCallId: String)
@Serializable data class ToolDetailResult(val node: RenderNode, val output: String? = null)
@Serializable data class SendParams(val sessionKey: String, val text: String, val mode: String, val clientMessageId: String)
@Serializable data class SendResult(val accepted: Boolean, val duplicate: Boolean? = null)
@Serializable data class AbortResult(val aborted: Boolean)
@Serializable data class CreateParams(val projectId: String, val capabilities: List<String>? = null)
@Serializable data class CreateResult(val sessionKey: String)
@Serializable data class ModelInfo(val id: String, val name: String? = null, val provider: String? = null, val group: String? = null)

@Serializable
data class ModelListResult(
    val models: List<ModelInfo>,
    val current: String? = null,
    val thinking: String? = null,
    val availableThinking: List<String>,
)

@Serializable data class ModelSetParams(val sessionKey: String, val modelId: String)
@Serializable data class ModelSetResult(val model: String)
@Serializable data class UploadParams(val name: String, val mime: String, val data: String)
@Serializable data class UploadResult(val path: String, val name: String, val size: Long)
@Serializable data class AttachmentGetParams(val path: String)
@Serializable data class AttachmentGetResult(val mime: String, val data: String)
@Serializable data class ThinkingSetParams(val sessionKey: String, val level: String)
@Serializable data class ThinkingSetResult(val level: String)

@Serializable
data class CapabilityRow(
    val id: String,
    val available: Boolean,
    val reason: String? = null,
    val promptTokens: Int,
    val tools: Int,
    val enabled: Boolean,
)

@Serializable data class CapabilityList(val capabilities: List<CapabilityRow>)
@Serializable data class CapabilitySetParams(val sessionKey: String, val id: String, val on: Boolean)
@Serializable data class CapabilitySetResult(val enabled: List<String>)
@Serializable data class CacheWarmingValue(val mode: String)
@Serializable data class UiCancelParams(val id: String)
@Serializable data class Accepted(val accepted: Boolean)

@Serializable data class SessionsUpdate(val sessions: List<SessionSummary>, val removed: List<String>? = null)
@Serializable data class TurnPatchEvent(val sessionKey: String, val patches: List<TurnPatch>)
@Serializable data class SettingsChanged(val key: String, val sessionKey: String? = null)
@Serializable data class HostNotice(val level: String, val text: String)

/** Method name → (params, result) serializers; also drives the fixture round-trip tests. */
object RemoteMethods {
    val table: Map<String, Pair<KSerializer<*>, KSerializer<*>>> = mapOf(
        "host.hello" to (HelloParams.serializer() to HelloResult.serializer()),
        "project.list" to (Empty.serializer() to ProjectList.serializer()),
        "session.watchList" to (WatchListParams.serializer() to SessionList.serializer()),
        "session.unwatchList" to (Empty.serializer() to Empty.serializer()),
        "session.open" to (OpenParams.serializer() to OpenResult.serializer()),
        "session.close" to (SessionKeyParams.serializer() to Empty.serializer()),
        "turn.page" to (PageParams.serializer() to PageResult.serializer()),
        "turn.toolDetail" to (ToolDetailParams.serializer() to ToolDetailResult.serializer()),
        "turn.send" to (SendParams.serializer() to SendResult.serializer()),
        "turn.abort" to (SessionKeyParams.serializer() to AbortResult.serializer()),
        "session.create" to (CreateParams.serializer() to CreateResult.serializer()),
        "model.list" to (SessionKeyParams.serializer() to ModelListResult.serializer()),
        "model.set" to (ModelSetParams.serializer() to ModelSetResult.serializer()),
        "attachment.upload" to (UploadParams.serializer() to UploadResult.serializer()),
        "attachment.get" to (AttachmentGetParams.serializer() to AttachmentGetResult.serializer()),
        "thinking.set" to (ThinkingSetParams.serializer() to ThinkingSetResult.serializer()),
        "capability.list" to (SessionKeyParams.serializer() to CapabilityList.serializer()),
        "capability.set" to (CapabilitySetParams.serializer() to CapabilitySetResult.serializer()),
        "settings.cacheWarming.get" to (Empty.serializer() to CacheWarmingValue.serializer()),
        "settings.cacheWarming.set" to (CacheWarmingValue.serializer() to CacheWarmingValue.serializer()),
        "ui.respond" to (UiResponse.serializer() to Accepted.serializer()),
        "ui.cancel" to (UiCancelParams.serializer() to Accepted.serializer()),
    )

    val events: Map<String, KSerializer<*>> = mapOf(
        "sessions.update" to SessionsUpdate.serializer(),
        "turn.patch" to TurnPatchEvent.serializer(),
        "ui.request" to UiRequest.serializer(),
        "ui.dismiss" to UiDismiss.serializer(),
        "settings.changed" to SettingsChanged.serializer(),
        "host.notice" to HostNotice.serializer(),
    )
}
