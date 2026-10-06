package dev.pi.remote.sync

import dev.pi.remote.protocol.Cursor
import dev.pi.remote.protocol.OpenResult
import dev.pi.remote.protocol.ProseStep
import dev.pi.remote.protocol.SessionState
import dev.pi.remote.protocol.SessionStatePatch
import dev.pi.remote.protocol.Step
import dev.pi.remote.protocol.StepUpsert
import dev.pi.remote.protocol.TextAppend
import dev.pi.remote.protocol.ThinkingStep
import dev.pi.remote.protocol.ToolStep
import dev.pi.remote.protocol.Turn
import dev.pi.remote.protocol.TurnPatch
import dev.pi.remote.protocol.TurnPromote
import dev.pi.remote.protocol.TurnSettle
import dev.pi.remote.protocol.TurnUpsert
import dev.pi.remote.protocol.UiRequest

/**
 * Client copy of one session's timeline. Pure and immutable: every apply returns a new
 * snapshot, so Compose can diff turns by identity. The gateway did all derivation; this only
 * places patches by id and guards ordering by `seq`.
 */
data class SessionTimeline(
    val sessionKey: String,
    val title: String = "",
    val epoch: String = "",
    val seq: Long = 0,
    val turns: List<Turn> = emptyList(),
    val hasOlder: Boolean = false,
    val state: SessionState = SessionState(running = false),
    val pendingUi: List<UiRequest> = emptyList(),
) {
    val cursor: Cursor? get() = if (epoch.isEmpty()) null else Cursor(epoch, seq)
}

sealed interface ApplyResult {
    data class Applied(val timeline: SessionTimeline) : ApplyResult

    /** Patches skipped a sequence number: reopen with the cursor to resync. */
    data class Gap(val timeline: SessionTimeline, val expected: Long, val got: Long) : ApplyResult
}

object TurnStore {
    fun fromOpen(prev: SessionTimeline?, r: OpenResult): SessionTimeline {
        if (r.kind == "replay" && prev != null && prev.epoch == r.epoch) {
            val replayed = applyAll(prev, r.patches.orEmpty())
            val t = when (replayed) {
                is ApplyResult.Applied -> replayed.timeline
                is ApplyResult.Gap -> replayed.timeline
            }
            return t.copy(title = r.title.ifEmpty { t.title }, seq = maxOf(t.seq, r.seq), state = r.state, pendingUi = r.pendingUi)
        }
        return SessionTimeline(
            sessionKey = r.sessionKey,
            title = r.title,
            epoch = r.epoch,
            seq = r.seq,
            turns = r.turns.orEmpty(),
            hasOlder = r.hasOlder ?: false,
            state = r.state,
            pendingUi = r.pendingUi,
        )
    }

    /** Older page from `turn.page`, prepended. */
    fun prependOlder(t: SessionTimeline, older: List<Turn>, hasOlder: Boolean): SessionTimeline {
        val known = t.turns.mapTo(HashSet()) { it.anchor }
        return t.copy(turns = older.filter { it.anchor !in known } + t.turns, hasOlder = hasOlder)
    }

    fun applyAll(start: SessionTimeline, patches: List<TurnPatch>): ApplyResult {
        var t = start
        for (p in patches) {
            val last = (p as? TextAppend)?.seqTo ?: p.seq
            if (last <= t.seq) continue // already applied (replay overlap)
            if (p.seq != t.seq + 1) return ApplyResult.Gap(t, t.seq + 1, p.seq)
            t = apply(t, p).copy(seq = last)
        }
        return ApplyResult.Applied(t)
    }

    private fun mapTurn(t: SessionTimeline, id: String, f: (Turn) -> Turn): SessionTimeline {
        val i = t.turns.indexOfFirst { it.id == id }
        if (i < 0) return t
        return t.copy(turns = t.turns.toMutableList().also { it[i] = f(it[i]) })
    }

    private fun upsertStep(turn: Turn, step: Step): Turn {
        val i = turn.steps.indexOfFirst { it.id == step.id }
        val steps = if (i < 0) turn.steps + step else turn.steps.toMutableList().also { it[i] = step }
        return turn.copy(steps = steps)
    }

    fun apply(t: SessionTimeline, p: TurnPatch): SessionTimeline = when (p) {
        is TurnUpsert -> {
            val byId = t.turns.indexOfFirst { it.id == p.turn.id }
            val byAnchor = if (byId >= 0) byId else t.turns.indexOfFirst { it.anchor == p.turn.anchor }
            if (byAnchor >= 0) t.copy(turns = t.turns.toMutableList().also { it[byAnchor] = p.turn }) else t.copy(turns = t.turns + p.turn)
        }
        is StepUpsert -> mapTurn(t, p.turnId) { turn ->
            upsertStep(turn, p.step).copy(activity = turn.activity.copy(counts = p.counts, failed = p.failed, live = p.live))
        }
        is TextAppend -> mapTurn(t, p.turnId) { turn ->
            if (p.ref == "answer") {
                turn.copy(answer = turn.answer + p.delta)
            } else {
                turn.copy(steps = turn.steps.map { s ->
                    when {
                        s.id != p.ref -> s
                        s is ThinkingStep -> s.copy(text = s.text + p.delta)
                        s is ProseStep -> s.copy(text = s.text + p.delta)
                        else -> s
                    }
                })
            }
        }
        is TurnPromote -> mapTurn(t, p.turnId) { turn -> upsertStep(turn.copy(answer = ""), p.step) }
        is TurnSettle -> mapTurn(t, p.turnId) { turn ->
            val steps = if (p.status == "running") turn.steps else turn.steps.map { s ->
                if (s is ToolStep && s.status == "running") s.copy(status = "error", node = s.node.copy(status = "error")) else s
            }
            turn.copy(status = p.status, durationMs = p.durationMs ?: turn.durationMs, files = p.files, error = p.error, steps = steps, activity = turn.activity.copy(live = null))
        }
        is SessionStatePatch -> t.copy(state = p.state)
        else -> t
    }

    fun addUi(t: SessionTimeline, req: UiRequest): SessionTimeline =
        if (req.method == "notify" || t.pendingUi.any { it.id == req.id }) t else t.copy(pendingUi = t.pendingUi + req)

    fun removeUi(t: SessionTimeline, id: String): SessionTimeline = t.copy(pendingUi = t.pendingUi.filterNot { it.id == id })
}
