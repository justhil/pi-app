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

@Serializable data class ProjectList(val projects: List<ProjectInfo>, val allowAllProjects: Boolean? = null)
@Serializable data class HostBrowseParams(val path: String? = null, val dotfiles: Boolean? = null)
@Serializable data class HostDirEntry(val name: String, val path: String, val git: Boolean? = null)
@Serializable
data class HostBrowseResult(
    val path: String,
    val parent: String?,
    val roots: List<String>,
    val entries: List<HostDirEntry>,
    val truncated: Boolean,
)
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
@Serializable data class PurgeSend(val enabled: Boolean, val personaId: String? = null, val mode: String? = null)
@Serializable data class SendParams(val sessionKey: String, val text: String, val mode: String, val clientMessageId: String, val agentPurge: PurgeSend? = null)
@Serializable data class SendResult(val accepted: Boolean, val duplicate: Boolean? = null)
@Serializable data class AbortResult(val aborted: Boolean, val restored: List<String>? = null)
@Serializable data class DequeueParams(val sessionKey: String, val index: Int? = null)
@Serializable data class DequeueResult(val restored: List<String>)
@Serializable data class RoleTokens(val role: String, val tokens: Long)
@Serializable data class ContextStats(val tokens: Long, val window: Long? = null, val messages: Int, val breakdown: List<RoleTokens>)
@Serializable data class SessionUsage(val input: Long, val output: Long, val cacheRead: Long, val cacheWrite: Long, val cost: Double, val calls: Int)
@Serializable data class SessionStatsResult(val context: ContextStats? = null, val usage: SessionUsage? = null)
@Serializable data class RewindParams(val sessionKey: String, val anchor: String)
@Serializable data class RewindResult(val editorText: String? = null)
@Serializable data class BranchInfo(val leafId: String, val title: String, val turns: Int, val current: Boolean, val updatedAt: Long? = null, val divergedAt: String? = null, val reply: String? = null)
@Serializable data class BranchesResult(val branches: List<BranchInfo>)
@Serializable data class SwitchBranchParams(val sessionKey: String, val leafId: String)
@Serializable data class ForkResult(val sessionKey: String, val editorText: String? = null)
@Serializable data class CommandInfo(val name: String, val description: String? = null, val category: String)
@Serializable data class CommandListResult(val commands: List<CommandInfo>)
@Serializable data class FileEntry(val name: String, val path: String, val dir: Boolean, val size: Long? = null, val mtime: Long? = null)
@Serializable data class DiffLine(val k: String, val o: Int? = null, val n: Int? = null, val s: String)
@Serializable data class DiffFile(val path: String, val add: Int, val del: Int, val status: String)
@Serializable data class DiffFileLines(val path: String, val lines: List<DiffLine>, val truncated: Boolean)
@Serializable data class ReviewDiffParams(val sessionKey: String, val scope: String, val turnId: String? = null, val path: String? = null)
@Serializable data class ReviewDiffResult(val isRepo: Boolean, val branch: String? = null, val files: List<DiffFile>, val file: DiffFileLines? = null, val message: String? = null)
@Serializable data class FileListParams(val sessionKey: String, val path: String, val dotfiles: Boolean? = null)
@Serializable data class FileListResult(val entries: List<FileEntry>, val truncated: Boolean)
@Serializable data class FileSearchParams(val sessionKey: String, val query: String)
@Serializable data class FileSearchResult(val entries: List<FileEntry>)
@Serializable data class FileReadParams(val sessionKey: String, val path: String)
@Serializable
data class FileReadResult(
    val path: String,
    val content: String,
    val size: Long,
    val truncated: Boolean,
    val binary: Boolean? = null,
)

@Serializable data class UsageSummaryParams(val days: Int? = null)
@Serializable
data class UsageModelRow(
    val model: String,
    val calls: Int,
    val input: Long,
    val output: Long,
    val cacheRead: Long,
    val cost: Double,
)
@Serializable
data class UsageDayRow(
    val day: String,
    val calls: Int,
    val tokens: Long,
    val cost: Double,
)
@Serializable
data class UsageSummaryResult(
    val days: Int,
    val calls: Int,
    val sessions: Int,
    val input: Long,
    val output: Long,
    val cacheRead: Long,
    val cacheWrite: Long,
    val cost: Double,
    val cacheHitRate: Double? = null,
    val avgTtftMs: Long? = null,
    val genTps: Double? = null,
    val byModel: List<UsageModelRow>,
    val byDay: List<UsageDayRow>,
)
@Serializable data class CreateParams(val projectId: String, val capabilities: List<String>? = null)
@Serializable data class CreateResult(val sessionKey: String)
@Serializable data class RenameParams(val sessionKey: String, val title: String)
@Serializable data class RenameResult(val title: String)
@Serializable data class DeleteResult(val deleted: Boolean)
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
    val coreTools: Int? = null,
    val enabled: Boolean,
)

@Serializable data class CapabilityList(val capabilities: List<CapabilityRow>)
@Serializable data class CapabilitySetParams(val sessionKey: String, val id: String, val on: Boolean)
@Serializable data class CapabilitySetResult(val enabled: List<String>)
@Serializable data class PurgeGetParams(val sessionKey: String? = null)
@Serializable
data class PurgeSetParams(
    val sessionKey: String,
    val enabled: Boolean,
    val personaId: String? = null,
    val mode: String? = null,
)
@Serializable data class PurgePersona(val id: String, val name: String, val description: String? = null)
@Serializable data class PurgeSessionState(val locked: String, val personaId: String? = null, val personaName: String? = null, val mode: String? = null)
@Serializable
data class PurgeStateResult(
    val defaultPersonaId: String,
    val defaultMode: String,
    val personas: List<PurgePersona>,
    val session: PurgeSessionState? = null,
)
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
        "host.browseDir" to (HostBrowseParams.serializer() to HostBrowseResult.serializer()),
        "session.watchList" to (WatchListParams.serializer() to SessionList.serializer()),
        "session.unwatchList" to (Empty.serializer() to Empty.serializer()),
        "session.open" to (OpenParams.serializer() to OpenResult.serializer()),
        "session.close" to (SessionKeyParams.serializer() to Empty.serializer()),
        "turn.page" to (PageParams.serializer() to PageResult.serializer()),
        "turn.toolDetail" to (ToolDetailParams.serializer() to ToolDetailResult.serializer()),
        "turn.send" to (SendParams.serializer() to SendResult.serializer()),
        "turn.abort" to (SessionKeyParams.serializer() to AbortResult.serializer()),
        "file.list" to (FileListParams.serializer() to FileListResult.serializer()),
        "review.diff" to (ReviewDiffParams.serializer() to ReviewDiffResult.serializer()),
        "file.search" to (FileSearchParams.serializer() to FileSearchResult.serializer()),
        "file.read" to (FileReadParams.serializer() to FileReadResult.serializer()),
        "usage.summary" to (UsageSummaryParams.serializer() to UsageSummaryResult.serializer()),
        "session.stats" to (SessionKeyParams.serializer() to SessionStatsResult.serializer()),
        "command.list" to (SessionKeyParams.serializer() to CommandListResult.serializer()),
        "turn.rewind" to (RewindParams.serializer() to RewindResult.serializer()),
        "session.branches" to (SessionKeyParams.serializer() to BranchesResult.serializer()),
        "session.switchBranch" to (SwitchBranchParams.serializer() to Empty.serializer()),
        "session.fork" to (RewindParams.serializer() to ForkResult.serializer()),
        "turn.dequeue" to (DequeueParams.serializer() to DequeueResult.serializer()),
        "session.create" to (CreateParams.serializer() to CreateResult.serializer()),
        "session.rename" to (RenameParams.serializer() to RenameResult.serializer()),
        "session.delete" to (SessionKeyParams.serializer() to DeleteResult.serializer()),
        "model.list" to (SessionKeyParams.serializer() to ModelListResult.serializer()),
        "model.set" to (ModelSetParams.serializer() to ModelSetResult.serializer()),
        "attachment.upload" to (UploadParams.serializer() to UploadResult.serializer()),
        "attachment.get" to (AttachmentGetParams.serializer() to AttachmentGetResult.serializer()),
        "thinking.set" to (ThinkingSetParams.serializer() to ThinkingSetResult.serializer()),
        "capability.list" to (SessionKeyParams.serializer() to CapabilityList.serializer()),
        "capability.set" to (CapabilitySetParams.serializer() to CapabilitySetResult.serializer()),
        "purge.get" to (PurgeGetParams.serializer() to PurgeStateResult.serializer()),
        "purge.set" to (PurgeSetParams.serializer() to PurgeStateResult.serializer()),
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
