package dev.pi.remote.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import dev.pi.remote.R
import dev.pi.remote.protocol.ActivityCounts
import dev.pi.remote.text.formatDuration
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** "2 分钟", "3 小时", "昨天", "10月3日" — inbox / host list ages. */
@Composable
fun formatAgo(ms: Long, now: Long = System.currentTimeMillis()): String {
    if (ms <= 0) return "—"
    val d = now - ms
    val cal = Calendar.getInstance().apply { timeInMillis = now }
    val then = Calendar.getInstance().apply { timeInMillis = ms }
    return when {
        d < 60_000 -> stringResource(R.string.ago_now)
        d < 3_600_000 -> stringResource(R.string.ago_min, (d / 60_000).toInt())
        d < 86_400_000 && cal.get(Calendar.DAY_OF_YEAR) == then.get(Calendar.DAY_OF_YEAR) -> stringResource(R.string.ago_hour, (d / 3_600_000).toInt())
        d < 2 * 86_400_000 -> stringResource(R.string.ago_yesterday)
        else -> SimpleDateFormat(if (Locale.getDefault().language == "zh") "M月d日" else "MMM d", Locale.getDefault()).format(Date(ms))
    }
}

@Composable
fun verbFor(category: String): String = when (category) {
    "read" -> stringResource(R.string.verb_read)
    "edit" -> stringResource(R.string.verb_edit)
    "write" -> stringResource(R.string.verb_write)
    "run" -> stringResource(R.string.verb_run)
    "search" -> stringResource(R.string.verb_search)
    else -> stringResource(R.string.verb_other)
}

/** "读 5 · 改 3 · 运行 2" (zero categories hidden, thinking not counted as work). */
@Composable
fun countsLine(c: ActivityCounts): String {
    val parts = listOf("read" to c.read, "search" to c.search, "edit" to c.edit, "write" to c.write, "run" to c.run, "other" to c.other)
        .filter { it.second > 0 }
        .map { (k, n) -> "${verbFor(k)} $n" }
    return parts.joinToString(" · ")
}

@Composable
fun workedLine(durationMs: Long?, c: ActivityCounts): String {
    val head = durationMs?.let { stringResource(R.string.act_worked, formatDuration(it)) } ?: stringResource(R.string.act_working)
    val counts = countsLine(c)
    return if (counts.isEmpty()) head else "$head · $counts"
}

fun clockOf(ms: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))

@Composable
fun dividerLabel(ms: Long, now: Long = System.currentTimeMillis()): String {
    val day = 86_400_000L
    val off = java.util.TimeZone.getDefault().getOffset(now).toLong()
    val today = Math.floorDiv(now + off, day)
    val that = Math.floorDiv(ms + off, day)
    return when (that) {
        today -> stringResource(R.string.divider_today, clockOf(ms))
        today - 1 -> stringResource(R.string.divider_yesterday, clockOf(ms))
        else -> SimpleDateFormat(if (Locale.getDefault().language == "zh") "M月d日 HH:mm" else "MMM d HH:mm", Locale.getDefault()).format(Date(ms))
    }
}
