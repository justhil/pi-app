package dev.pi.remote.text

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Ports of the desktop timeline helpers: scrubber marks (timeline-scrubber-model.ts) and time dividers. */
object Scrubber {
    /** Preferred distance between marks; they sit as a compact group in the middle of the rail. */
    const val MARK_GAP = 12f

    private fun layoutGap(n: Int, h: Float, pad: Float): Float = if (n <= 1) 0f else min(MARK_GAP, (h - pad * 2) / (n - 1))

    fun markY(i: Int, n: Int, h: Float, pad: Float = 6f): Float {
        val gap = layoutGap(n, h, pad)
        return h / 2 - ((n - 1) * gap) / 2 + i * gap
    }

    fun nearestMark(y: Float, n: Int, h: Float, pad: Float = 6f): Int {
        if (n <= 0) return -1
        if (n == 1) return 0
        val gap = layoutGap(n, h, pad)
        val top = h / 2 - ((n - 1) * gap) / 2
        return ((y - top) / gap).roundToInt().coerceIn(0, n - 1)
    }

    /** Dock-like magnification 0..1 for a mark `dy` px from the finger. */
    fun magnify(dy: Float, radius: Float = 22f): Float {
        val d = abs(dy)
        if (d >= radius) return 0f
        val c = cos((d / radius) * (PI / 2)).toFloat()
        return c * c
    }

    /**
     * Which turn the reader is at: at the bottom → last; at the top → first; otherwise the last
     * user message whose top is above the reading line. `tops` holds viewport-relative tops, or
     * null for turns outside the rendered window (always above everything rendered).
     */
    fun activeMark(tops: List<Float?>, readingLine: Float, atTop: Boolean = false, atBottom: Boolean = false): Int {
        if (tops.isEmpty()) return 0
        if (atBottom) return tops.size - 1
        if (atTop && tops[0] != null) return 0
        var active = 0
        for (i in tops.indices) {
            val t = tops[i]
            if (t == null || t <= readingLine) active = i
        }
        return active
    }
}

object TimeDividers {
    const val GAP_MS = 30 * 60_000L

    /** A divider goes above a turn at session start, on a new local day, or after 30 min of silence. */
    fun showDivider(prevStartedAt: Long?, startedAt: Long?, utcOffsetMs: Long): Boolean {
        if (startedAt == null) return false
        if (prevStartedAt == null) return true
        if (dayOf(prevStartedAt, utcOffsetMs) != dayOf(startedAt, utcOffsetMs)) return true
        return startedAt - prevStartedAt > GAP_MS
    }

    fun dayOf(ms: Long, utcOffsetMs: Long): Long = Math.floorDiv(ms + utcOffsetMs, 86_400_000L)
}

private object Math {
    fun floorDiv(a: Long, b: Long): Long {
        val q = a / b
        return if ((a % b != 0L) && ((a < 0) != (b < 0))) q - 1 else q
    }
}

/** "1m 32s", "48s", "2h 05m": compact durations used in activity rows and turn footers. */
fun formatDuration(ms: Long): String {
    val s = max(0L, ms / 1000)
    return when {
        s < 60 -> "${s}s"
        s < 3600 -> "${s / 60}m ${(s % 60).toString().padStart(2, '0')}s"
        else -> "${s / 3600}h ${((s % 3600) / 60).toString().padStart(2, '0')}m"
    }
}

/** "0:42", "12:05": live elapsed time. */
fun formatClock(ms: Long): String {
    val s = max(0L, ms / 1000)
    return if (s < 3600) "${s / 60}:${(s % 60).toString().padStart(2, '0')}" else "${s / 3600}:${((s % 3600) / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}"
}
