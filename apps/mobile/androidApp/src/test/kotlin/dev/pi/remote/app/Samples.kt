package dev.pi.remote.app

import dev.pi.remote.protocol.ActivityCounts
import dev.pi.remote.protocol.FileStat
import dev.pi.remote.protocol.ProjectInfo
import dev.pi.remote.protocol.ProseStep
import dev.pi.remote.protocol.PromptQueue
import dev.pi.remote.protocol.RenderNode
import dev.pi.remote.protocol.SessionState
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.protocol.ThinkingStep
import dev.pi.remote.protocol.ToolStep
import dev.pi.remote.protocol.Turn
import dev.pi.remote.protocol.TurnActivity
import dev.pi.remote.protocol.TurnMeta
import dev.pi.remote.protocol.TurnUser
import dev.pi.remote.protocol.UiAskQuestions
import dev.pi.remote.protocol.UiQuestion
import dev.pi.remote.protocol.UiQuestionOption
import dev.pi.remote.sync.SessionTimeline
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Prototype content (research/prototype) as client models, for screenshots. */
object Samples {
    val NOW = System.currentTimeMillis()
    private const val KEY = "/work/pi-app/.pi/sessions/login.jsonl"

    private fun fields(vararg p: Pair<String, Any>) = JsonObject(p.associate { (k, v) -> k to (if (v is Number) JsonPrimitive(v) else JsonPrimitive(v.toString())) })

    private fun tool(id: String, cat: String, name: String, title: String, status: String = "ok", preview: String? = null, vararg f: Pair<String, Any>) =
        ToolStep(id, "tool", "call-$id", name, cat, RenderNode(if (cat == "run") "bash" else if (cat == "search") "search" else cat.takeIf { it in setOf("read", "edit", "write") } ?: "default", title, null, status, fields(*f), preview, null, "$name $title"), status)

    private fun counts(read: Int = 0, edit: Int = 0, write: Int = 0, run: Int = 0, search: Int = 0, think: Int = 0) = ActivityCounts(read, edit, write, run, search, think, 0)

    val turn1 = Turn(
        id = "t1", anchor = "e1", status = "done", startedAt = NOW - 50 * 60_000, durationMs = 92_000,
        user = TurnUser("登录页偶尔会报 401，帮我查一下原因"),
        activity = TurnActivity(counts(read = 6, search = 2, think = 1), 0, 6000),
        steps = listOf(
            ThinkingStep("t1:s1", "thinking", "look at auth", 6000),
            tool("t1:s2", "search", "grep", "refreshToken", preview = "src/auth/refresh.ts:12\nsrc/auth/login.ts:40", f = arrayOf("pattern" to "refreshToken", "kind" to "grep")),
            tool("t1:s3", "read", "read", "src/auth/refresh.ts", f = arrayOf("path" to "src/auth/refresh.ts")),
            tool("t1:s4", "read", "read", "src/auth/login.ts", f = arrayOf("path" to "src/auth/login.ts")),
        ),
        answer = "原因是**并发刷新**：页面同时发出多个请求时，每个请求都会各自调用 `refreshSession`，第一次刷新成功后旧的 refresh token 立即失效，后面几次就会拿到 401。\n\n- 刷新没有做单飞（single-flight）合并\n- 定时刷新卡在过期瞬间，没留余量",
        files = emptyList(),
        meta = TurnMeta("anthropic/sonnet-5", "high"),
    )

    private val diff = "@@ -38,9 +40,18 @@ export async function refreshSession\n export async function refreshSession(client: AuthClient) {\n-  const res = await client.post('/auth/refresh')\n-  if (res.status === 401) throw new AuthExpiredError()\n-  return res.data as Session\n+  // 并发请求共享同一次刷新，避免旧 token 被重复使用\n+  if (inflight) return inflight\n+  inflight = client\n+    .post('/auth/refresh')\n+    .finally(() => { inflight = null })\n+  return inflight\n }"

    val turn2 = Turn(
        id = "t2", anchor = "e2", status = "done", startedAt = NOW - 47 * 60_000, durationMs = 134_000,
        user = TurnUser("按这个方案修，顺便补个测试"),
        activity = TurnActivity(counts(read = 3, edit = 2, write = 1, run = 2, think = 1), 0, 11_000),
        steps = listOf(
            ThinkingStep("t2:s1", "thinking", "single flight", 11_000),
            tool("t2:s2", "edit", "edit", "src/auth/refresh.ts", preview = diff, f = arrayOf("path" to "src/auth/refresh.ts", "add" to 16, "del" to 4)),
            tool("t2:s3", "edit", "edit", "src/auth/login.ts", f = arrayOf("path" to "src/auth/login.ts", "add" to 32, "del" to 11)),
            tool("t2:s4", "write", "write", "test/auth/refresh.test.ts", f = arrayOf("path" to "test/auth/refresh.test.ts", "add" to 72)),
            tool("t2:s5", "run", "bash", "npm test -- auth", preview = " ✓ test/auth/refresh.test.ts (3 tests)\n Test Files  1 passed (1)", f = arrayOf("command" to "npm test -- auth", "exitCode" to 0)).copy(ms = 3100),
            tool("t2:s6", "run", "bash", "npm run typecheck", f = arrayOf("command" to "npm run typecheck", "exitCode" to 0)).copy(ms = 11_800),
        ),
        answer = "修好了。刷新改成单飞：并发请求共享同一次刷新，定时刷新提前 30 秒触发。新增 3 个测试覆盖并发和过期边界，全部通过。",
        files = listOf(FileStat("src/auth/refresh.ts", 16, 4), FileStat("src/auth/login.ts", 32, 11), FileStat("test/auth/refresh.test.ts", 72, 0)),
        meta = TurnMeta("anthropic/sonnet-5", "high"),
    )

    val turn3 = Turn(
        id = "live:3", anchor = "e3", status = "running", startedAt = NOW - 42_000,
        user = TurnUser("再跑一遍完整的 typecheck 和 lint"),
        activity = TurnActivity(counts(read = 1, run = 2), 0, live = "live:3:s3"),
        steps = listOf(
            tool("live:3:s1", "run", "bash", "npm run typecheck", f = arrayOf("command" to "npm run typecheck", "exitCode" to 0)).copy(ms = 11_800),
            tool("live:3:s2", "read", "read", "eslint.config.mjs", f = arrayOf("path" to "eslint.config.mjs")),
            tool("live:3:s3", "run", "bash", "npm run lint", status = "running", f = arrayOf("command" to "npm run lint")),
        ),
        answer = "",
        files = emptyList(),
    )

    val timeline = SessionTimeline(
        sessionKey = KEY, title = "修复登录页 token 刷新", epoch = "e", seq = 10, turns = listOf(turn1, turn2, turn3), hasOlder = false,
        state = SessionState(true, "anthropic/sonnet-5", "high", listOf("off", "low", "medium", "high"), PromptQueue(emptyList(), listOf("跑完后顺便更新 CHANGELOG"))),
    )

    val question = UiAskQuestions(
        id = "q1", sessionKey = KEY, method = "custom", kind = "ask_user_question",
        questions = listOf(
            UiQuestion(
                "renderer 里旧的 timeline-display-items 导出要一起删掉吗？", null, false,
                listOf(UiQuestionOption("删除，统一从 shared 导入", "改 4 处 import，旧文件只留测试迁移记录"), UiQuestionOption("保留一个版本的兼容导出", "标记 deprecated，下个版本再删")),
            ),
        ),
    )

    val paused = timeline.copy(
        title = "迁移 timeline 纯函数到 shared",
        turns = listOf(turn3.copy(id = "p1", status = "running", user = TurnUser("把 renderer 里不依赖 React 的 timeline 函数挪到 packages/shared，测试一起搬"))),
        pendingUi = listOf(question),
    )

    val projects = listOf(ProjectInfo("/work/pi-app", "pi-app"), ProjectInfo("/work/codex-asr", "codex-asr"), ProjectInfo("/work/blog", "blog"))

    val inbox = listOf(
        SessionSummary("/s/1", "/work/pi-app", "迁移 timeline 纯函数到 shared", "needsInput", NOW - 2 * 60_000, preview = "是否删除 renderer 里旧的导出？"),
        SessionSummary("/s/2", "/work/pi-app", "e2e 截图对比回归", "failed", NOW - 14 * 60_000, preview = "失败：npm run test:e2e 退出码 1"),
        SessionSummary("/s/3", "/work/pi-app", "修复登录页 token 刷新", "running", NOW, live = "npm run lint", liveCategory = "run", startedAt = NOW - 42_000, counts = counts(read = 4, edit = 3, run = 3)),
        SessionSummary("/s/4", "/work/codex-asr", "ASR 流式分段调研", "running", NOW, live = "src/stream/vad.rs", liveCategory = "read", startedAt = NOW - 378_000, counts = counts(read = 23, search = 6)),
        SessionSummary("/s/5", "/work/pi-app", "CI 构建情况回顾", "idle", NOW - 38 * 60_000, preview = "失败率降到 3.2%，但中位耗时涨到 6.7 分钟。", counts = counts(run = 3, read = 2)),
        SessionSummary("/s/6", "/work/pi-app", "手机连接设置页草图", "idle", NOW - 70 * 60_000, preview = "草图放在下面，可以直接预览。配对一共三步。"),
        SessionSummary("/s/7", "/work/blog", "博客：本地优先的同步策略", "idle", NOW - 3 * 86_400_000L, preview = "草稿已写到第三节，等你补充性能数据。"),
    )

    val stats = """{"component":"stat-grid","id":"k","props":{"items":[{"label":"构建次数","value":"1,284","delta":"+6.1%"},{"label":"失败率","value":"3.2","unit":"%","delta":"-0.3pt","trend":"up","history":[4.4,4.1,3.9,4,3.5,3.2]},{"label":"中位耗时","value":"6m 41s","delta":"+12%","trend":"down","history":[5.8,6,6.3,6.1,6.6,6.7]},{"label":"缓存命中","value":"87","unit":"%","delta":"+4pt","history":[79,80,82,83,85,87]}]}}"""
    val chart = """{"component":"chart","id":"c","props":{"title":"构建耗时与失败率（周）","type":"bar","x":["W36","W37","W38","W39","W40","W41"],"series":[{"name":"中位耗时 (min)","data":[5.8,6,6.3,6.1,6.6,6.7]},{"name":"失败率","type":"line","axis":"right","data":[4.4,4.1,3.9,4,3.5,3.2]}],"rightUnit":"%"}}"""
    val table = """{"component":"data-table","id":"t","props":{"title":"最慢的 job","columns":[{"key":"job","label":"job"},{"key":"dur","label":"中位耗时 (s)","type":"number"},{"key":"fail","label":"失败率 (%)","type":"number"}],"rows":[{"job":"e2e:playwright","dur":252,"fail":6.1},{"job":"build:win","dur":228,"fail":2.4},{"job":"test:unit","dur":115,"fail":0.9},{"job":"typecheck","dur":81,"fail":0},{"job":"lint","dur":47,"fail":0.3}]}}"""
    val gantt = """{"component":"gantt","id":"g","props":{"title":"手机端 MVP 排期","today":"2026-10-05","tasks":[{"id":"plan","name":"方案与原型","start":"2026-10-01","end":"2026-10-07","progress":0.8},{"id":"schema","name":"schema","group":"协议","start":"2026-10-06","end":"2026-10-09","dependsOn":"plan"},{"id":"codegen","name":"Kotlin codegen","group":"协议","start":"2026-10-09","end":"2026-10-10","dependsOn":"schema"},{"id":"proj","name":"投影器","group":"网关","start":"2026-10-10","end":"2026-10-16","dependsOn":"schema"},{"id":"pair","name":"配对与加密","group":"网关","start":"2026-10-10","end":"2026-10-15","dependsOn":"schema"},{"id":"tl","name":"timeline","group":"Android","start":"2026-10-15","end":"2026-10-23","dependsOn":["proj","pair"]},{"id":"rich","name":"pi-ui 与富内容","group":"Android","start":"2026-10-21","end":"2026-10-27","dependsOn":"tl"},{"id":"beta","name":"内测","start":"2026-10-29","milestone":true,"dependsOn":"rich"}]}}"""
    val quiz = """{"component":"quiz","id":"q","props":{"title":"小测","questions":[{"question":"单飞刷新解决的是什么问题？","options":["并发请求重复刷新","token 太短","网络抖动"],"answer":0,"explanation":"多个请求共享同一次刷新。"}]}}"""
    val decision = """{"component":"decision-tree","id":"d","props":{"title":"连不上电脑？","nodes":[{"id":"a","text":"手机和电脑在同一个 Wi‑Fi 吗？","options":[{"label":"是","next":"b"},{"label":"不是","next":"c"}]},{"id":"b","text":"检查防火墙是否放行 pi Desktop"},{"id":"c","text":"连到同一个网络后重试"}]}}"""
    val cards = """{"component":"card-grid","id":"cg","props":{"title":"参考项目","items":[{"title":"Paseo","summary":"daemon 优先的移动端 agent 客户端","tag":"架构","source":"github.com"},{"title":"Orca","summary":"Electron 内置 runtime RPC，局域网 + 中继","tag":"架构"},{"title":"NekoCode","summary":"主进程 lan-service，一次性配对码","tag":"配对"}]}}"""
    val diffBlock = """{"component":"diff","id":"df","props":{"title":"refresh.ts","before":"const res = await client.post()\nreturn res","after":"if (inflight) return inflight\ninflight = client.post()\nreturn inflight"}}"""

    val rich = "构建更稳了，但变慢了：\n\n```pi-ui\n$stats\n```\n\n```pi-ui\n$chart\n```\n\n- W40 起 e2e 加了截图对比，单次多跑约 40 秒。\n\n```pi-ui\n$table\n```\n\n```pi-ui\n{\"component\":\"heatmap\",\"props\":{}}\n```\n"
    val markdown = "### 配对流程\n\n1. 扫码拿到主机公钥和一次性配对码\n2. Noise IK 握手\n3. 签发设备凭据\n\n| 凭据 | 有效期 | 存放 |\n|---|---|---|\n| 配对码 | 5 分钟 | 二维码 |\n| 设备密钥 | 直到解绑 | Keystore |\n\n重连退避 \$t_n = \\min(30, 2^n)\$ 秒。\n\n```kotlin\nfun backoff(attempt: Int): Duration =\n    minOf(30, 1 shl attempt).seconds\n// 回到前台：跳过等待\nlifecycle.onResume { reconnector.kick() }\n```\n\n> 局域网之外的连接放到中继阶段。\n\n- [x] 二维码\n- [ ] 项目白名单\n"
}
