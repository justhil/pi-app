package dev.pi.remote.net

import dev.pi.remote.protocol.Accepted
import dev.pi.remote.protocol.ReviewDiffParams
import dev.pi.remote.protocol.ReviewDiffResult
import dev.pi.remote.protocol.AbortResult
import dev.pi.remote.protocol.DequeueResult
import dev.pi.remote.protocol.SessionStatsResult
import dev.pi.remote.protocol.BranchesResult
import dev.pi.remote.protocol.Empty
import dev.pi.remote.protocol.ForkResult
import dev.pi.remote.protocol.RewindParams
import dev.pi.remote.protocol.SwitchBranchParams
import dev.pi.remote.protocol.RewindResult
import dev.pi.remote.protocol.CommandListResult
import dev.pi.remote.protocol.FileListParams
import dev.pi.remote.protocol.FileListResult
import dev.pi.remote.protocol.FileSearchParams
import dev.pi.remote.protocol.FileSearchResult
import dev.pi.remote.protocol.CacheWarmingValue
import dev.pi.remote.protocol.CapabilityList
import dev.pi.remote.protocol.CapabilitySetParams
import dev.pi.remote.protocol.CapabilitySetResult
import dev.pi.remote.protocol.CreateParams
import dev.pi.remote.protocol.CreateResult
import dev.pi.remote.protocol.Cursor
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.ModelSetParams
import dev.pi.remote.protocol.ModelSetResult
import dev.pi.remote.protocol.OpenParams
import dev.pi.remote.protocol.OpenResult
import dev.pi.remote.protocol.PageParams
import dev.pi.remote.protocol.PageResult
import dev.pi.remote.protocol.ProjectList
import dev.pi.remote.protocol.SendParams
import dev.pi.remote.protocol.SendResult
import dev.pi.remote.protocol.SessionKeyParams
import dev.pi.remote.protocol.SessionList
import dev.pi.remote.protocol.ThinkingSetParams
import dev.pi.remote.protocol.AttachmentGetParams
import dev.pi.remote.protocol.AttachmentGetResult
import dev.pi.remote.protocol.UploadParams
import dev.pi.remote.protocol.UploadResult
import dev.pi.remote.protocol.ThinkingSetResult
import dev.pi.remote.protocol.ToolDetailParams
import dev.pi.remote.protocol.ToolDetailResult
import dev.pi.remote.protocol.UiCancelParams
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.protocol.WatchListParams

/** Typed facade over [HostConnection] — one function per gateway method. */
class RemoteApi(private val c: HostConnection) {
    suspend fun projects() = c.typedCall("project.list", Empty.serializer(), Empty(), ProjectList.serializer()).projects
    suspend fun watchList(projectId: String? = null) = c.typedCall("session.watchList", WatchListParams.serializer(), WatchListParams(projectId), SessionList.serializer()).sessions
    suspend fun open(sessionKey: String, cursor: Cursor?) = c.typedCall("session.open", OpenParams.serializer(), OpenParams(sessionKey, cursor), OpenResult.serializer())
    suspend fun close(sessionKey: String) = c.typedCall("session.close", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), Empty.serializer())
    suspend fun page(sessionKey: String, before: String, limit: Int = 20) = c.typedCall("turn.page", PageParams.serializer(), PageParams(sessionKey, before, limit), PageResult.serializer())
    suspend fun toolDetail(sessionKey: String, toolCallId: String) = c.typedCall("turn.toolDetail", ToolDetailParams.serializer(), ToolDetailParams(sessionKey, toolCallId), ToolDetailResult.serializer())
    suspend fun send(sessionKey: String, text: String, mode: String, clientMessageId: String) =
        c.typedCall("turn.send", SendParams.serializer(), SendParams(sessionKey, text, mode, clientMessageId), SendResult.serializer())
    suspend fun abort(sessionKey: String) = c.typedCall("turn.abort", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), AbortResult.serializer())
    suspend fun commands(sessionKey: String) = c.typedCall("command.list", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), CommandListResult.serializer()).commands
    suspend fun listFiles(sessionKey: String, path: String, dotfiles: Boolean = false) =
        c.typedCall("file.list", FileListParams.serializer(), FileListParams(sessionKey, path, dotfiles.takeIf { it }), FileListResult.serializer())
    suspend fun searchFiles(sessionKey: String, query: String) =
        c.typedCall("file.search", FileSearchParams.serializer(), FileSearchParams(sessionKey, query), FileSearchResult.serializer()).entries
    suspend fun branches(sessionKey: String) = c.typedCall("session.branches", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), BranchesResult.serializer()).branches
    suspend fun switchBranch(sessionKey: String, leafId: String) = c.typedCall("session.switchBranch", SwitchBranchParams.serializer(), SwitchBranchParams(sessionKey, leafId), Empty.serializer())
    suspend fun fork(sessionKey: String, anchor: String) = c.typedCall("session.fork", RewindParams.serializer(), RewindParams(sessionKey, anchor), ForkResult.serializer())
    suspend fun rewind(sessionKey: String, anchor: String) = c.typedCall("turn.rewind", RewindParams.serializer(), RewindParams(sessionKey, anchor), RewindResult.serializer())
    suspend fun reviewDiff(sessionKey: String, scope: String, turnId: String? = null, path: String? = null) =
        c.typedCall("review.diff", ReviewDiffParams.serializer(), ReviewDiffParams(sessionKey, scope, turnId, path), ReviewDiffResult.serializer())
    suspend fun stats(sessionKey: String) = c.typedCall("session.stats", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), SessionStatsResult.serializer())
    suspend fun dequeue(sessionKey: String) = c.typedCall("turn.dequeue", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), DequeueResult.serializer())
    suspend fun create(projectId: String, capabilities: List<String>? = null) = c.typedCall("session.create", CreateParams.serializer(), CreateParams(projectId, capabilities), CreateResult.serializer())
    suspend fun models(sessionKey: String) = c.typedCall("model.list", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), ModelListResult.serializer())
    suspend fun setModel(sessionKey: String, modelId: String) = c.typedCall("model.set", ModelSetParams.serializer(), ModelSetParams(sessionKey, modelId), ModelSetResult.serializer())
    /** Uploads can be several MB: give them a longer timeout than ordinary calls. */
    suspend fun upload(name: String, mime: String, base64: String) =
        c.typedCall("attachment.upload", UploadParams.serializer(), UploadParams(name, mime, base64), UploadResult.serializer(), timeoutMs = 60_000)
    suspend fun attachment(path: String) =
        c.typedCall("attachment.get", AttachmentGetParams.serializer(), AttachmentGetParams(path), AttachmentGetResult.serializer(), timeoutMs = 60_000)
    suspend fun setThinking(sessionKey: String, level: String) = c.typedCall("thinking.set", ThinkingSetParams.serializer(), ThinkingSetParams(sessionKey, level), ThinkingSetResult.serializer())
    suspend fun capabilities(sessionKey: String) = c.typedCall("capability.list", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), CapabilityList.serializer()).capabilities
    suspend fun setCapability(sessionKey: String, id: String, on: Boolean) = c.typedCall("capability.set", CapabilitySetParams.serializer(), CapabilitySetParams(sessionKey, id, on), CapabilitySetResult.serializer())
    suspend fun cacheWarming() = c.typedCall("settings.cacheWarming.get", Empty.serializer(), Empty(), CacheWarmingValue.serializer()).mode
    suspend fun setCacheWarming(mode: String) = c.typedCall("settings.cacheWarming.set", CacheWarmingValue.serializer(), CacheWarmingValue(mode), CacheWarmingValue.serializer()).mode
    suspend fun respondUi(response: UiResponse) = c.typedCall("ui.respond", UiResponse.serializer(), response, Accepted.serializer()).accepted
    suspend fun cancelUi(id: String) = c.typedCall("ui.cancel", UiCancelParams.serializer(), UiCancelParams(id), Accepted.serializer()).accepted
}
