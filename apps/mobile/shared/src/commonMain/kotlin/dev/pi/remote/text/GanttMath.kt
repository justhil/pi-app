package dev.pi.remote.text

/**
 * Port of src/renderer/src/features/ui-blocks/components/gantt-math.ts. Days are integer
 * UTC day numbers (days since 1970-01-01); task ends are exclusive.
 */
object GanttMath {
    enum class Scale { Day, Week, Month }

    data class TaskInput(
        val id: String? = null,
        val name: String,
        val start: String,
        val end: String? = null,
        val duration: Double? = null,
        val progress: Double? = null,
        val group: String? = null,
        val dependsOn: List<String> = emptyList(),
        val milestone: Boolean = false,
    )

    data class Task(
        val key: String,
        val index: Int,
        val name: String,
        val group: String?,
        val start: Int,
        val end: Int,
        val milestone: Boolean,
        val progress: Double?,
        val deps: List<String>,
    )

    data class DayParts(val year: Int, val month: Int, val date: Int, val weekday: Int)

    // Howard Hinnant's civil-from-days / days-from-civil (proleptic Gregorian), month 0-based here.
    fun daysFromCivil(year: Int, month0: Int, day: Int): Int {
        var y = year
        val m = month0 + 1
        y -= if (m <= 2) 1 else 0
        val era = (if (y >= 0) y else y - 399) / 400
        val yoe = y - era * 400
        val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + day - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    fun dayParts(day: Int): DayParts {
        val z = day + 719468
        val era = (if (z >= 0) z else z - 146096) / 146097
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = doy - (153 * mp + 2) / 5 + 1
        val m = mp + (if (mp < 10) 3 else -9)
        val y = yoe + era * 400 + (if (m <= 2) 1 else 0)
        val weekday = ((day % 7) + 7 + 4) % 7 // 1970-01-01 was a Thursday (4)
        return DayParts(y, m - 1, d, weekday)
    }

    private val dayPattern = Regex("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})")

    fun parseDay(value: String?): Int? {
        val m = dayPattern.find(value?.trim() ?: return null) ?: return null
        val (y, mo, d) = m.destructured
        val year = y.toInt()
        val month = mo.toInt() - 1
        val date = d.toInt()
        if (month !in 0..11 || date < 1) return null
        val day = daysFromCivil(year, month, date)
        val parts = dayParts(day)
        return if (parts.month == month && parts.date == date) day else null
    }

    fun resolveTasks(tasks: List<TaskInput>): List<Task> {
        val used = HashSet<String>()
        val lookup = HashMap<String, String>()
        val base = tasks.mapIndexed { index, t ->
            var key = (t.id ?: t.name).trim().ifEmpty { "task-$index" }
            if (key in used) key = "$key#$index"
            used += key
            if (t.id != null && t.id !in lookup) lookup[t.id] = key
            if (t.name !in lookup) lookup[t.name] = key
            val start = parseDay(t.start) ?: 0
            val endDay = t.end?.let(::parseDay)
            var end = when {
                endDay != null -> endDay + 1
                t.duration != null && t.duration.isFinite() -> start + maxOf(0, kotlin.math.round(t.duration).toInt())
                else -> if (t.milestone) start else start + 1
            }
            val milestone = t.milestone || end == start
            if (milestone) end = start else if (end < start) end = start + 1
            val progress = t.progress?.takeIf { it.isFinite() }?.let { (if (it > 1) it / 100 else it).coerceIn(0.0, 1.0) }
            Triple(Task(key, index, t.name, t.group?.trim()?.ifEmpty { null }, start, end, milestone, progress, emptyList()), t, key)
        }
        return base.map { (task, raw, key) ->
            task.copy(deps = raw.dependsOn.mapNotNull { lookup[it.trim()] }.filter { it != key }.distinct())
        }
    }

    fun taskExtent(tasks: List<Task>): Pair<Int, Int> {
        if (tasks.isEmpty()) return 0 to 1
        val min = tasks.minOf { it.start }
        val max = tasks.maxOf { if (it.milestone) it.start + 1 else it.end }
        return min to maxOf(max, min + 1)
    }

    fun pickScale(spanDays: Int): Scale = when {
        spanDays <= 35 -> Scale.Day
        spanDays <= 200 -> Scale.Week
        else -> Scale.Month
    }

    private fun monthStart(year: Int, month: Int): Int {
        val y = year + Math.floorDivInt(month, 12)
        val m = ((month % 12) + 12) % 12
        return daysFromCivil(y, m, 1)
    }

    fun scaleDomain(min: Int, max: Int, scale: Scale): Pair<Int, Int> = when (scale) {
        Scale.Day -> (min - 1) to (max + 1)
        Scale.Week -> {
            val start = min - (dayParts(min).weekday + 6) % 7
            val offset = (dayParts(max).weekday + 6) % 7
            val end = if (offset == 0) max else max + 7 - offset
            start to maxOf(end, start + 7)
        }
        Scale.Month -> {
            val first = dayParts(min)
            val last = dayParts(max - 1)
            monthStart(first.year, first.month) to monthStart(last.year, last.month + 1)
        }
    }

    data class Cell(val start: Int, val end: Int, val label: String, val weekend: Boolean = false)

    fun bottomTier(domain: Pair<Int, Int>, scale: Scale): List<Cell> {
        val out = ArrayList<Cell>()
        when (scale) {
            Scale.Day -> for (d in domain.first until domain.second) {
                val p = dayParts(d)
                out += Cell(d, d + 1, p.date.toString(), p.weekday == 0 || p.weekday == 6)
            }
            Scale.Week -> {
                var d = domain.first
                while (d < domain.second) {
                    val p = dayParts(d)
                    out += Cell(d, minOf(domain.second, d + 7), "${p.month + 1}/${p.date}")
                    d += 7
                }
            }
            Scale.Month -> {
                var p = dayParts(domain.first)
                var cursor = domain.first
                var year = p.year
                var month = p.month
                while (cursor < domain.second) {
                    val next = minOf(domain.second, monthStart(year, month + 1))
                    out += Cell(cursor, next, "${month + 1}")
                    cursor = next
                    month++
                    if (month > 11) {
                        month = 0
                        year++
                    }
                }
            }
        }
        return out
    }

    fun weekendRuns(domain: Pair<Int, Int>): List<IntRange> {
        val runs = ArrayList<IntRange>()
        for (d in domain.first until domain.second) {
            val w = dayParts(d).weekday
            if (w != 0 && w != 6) continue
            val last = runs.lastOrNull()
            if (last != null && last.last + 1 == d) runs[runs.size - 1] = last.first..d else runs += d..d
        }
        return runs
    }

    sealed interface Row {
        data class Group(val name: String, val start: Int, val end: Int, val progress: Double?, val count: Int, val collapsed: Boolean) : Row
        data class TaskRow(val task: Task, val grouped: Boolean) : Row
    }

    fun buildRows(tasks: List<Task>, collapsed: Set<String>): List<Row> {
        val members = tasks.filter { it.group != null }.groupBy { it.group!! }
        val rows = ArrayList<Row>()
        val emitted = HashSet<String>()
        for (task in tasks) {
            val g = task.group
            if (g == null) {
                rows += Row.TaskRow(task, false)
                continue
            }
            if (!emitted.add(g)) continue
            val list = members.getValue(g)
            var weighted = 0.0
            var weight = 0.0
            for (m in list) {
                val p = m.progress ?: continue
                val span = maxOf(1, m.end - m.start).toDouble()
                weighted += p * span
                weight += span
            }
            val isCollapsed = g in collapsed
            rows += Row.Group(g, list.minOf { it.start }, list.maxOf { if (it.milestone) it.start else it.end }, if (weight > 0) weighted / weight else null, list.size, isCollapsed)
            if (!isCollapsed) list.forEach { rows += Row.TaskRow(it, true) }
        }
        return rows
    }

    fun dependencyChain(tasks: List<Task>, key: String): Set<String> {
        val byKey = tasks.associateBy { it.key }
        val dependents = HashMap<String, MutableList<String>>()
        for (t in tasks) for (d in t.deps) dependents.getOrPut(d) { mutableListOf() } += t.key
        val chain = linkedSetOf(key)
        fun walk(start: String, next: (String) -> List<String>) {
            val queue = ArrayDeque(listOf(start))
            while (queue.isNotEmpty()) {
                val at = queue.removeLast()
                for (n in next(at)) if (chain.add(n)) queue.addLast(n)
            }
        }
        walk(key) { byKey[it]?.deps.orEmpty() }
        walk(key) { dependents[it].orEmpty() }
        return chain
    }

    private object Math {
        fun floorDivInt(a: Int, b: Int): Int {
            val q = a / b
            return if (a % b != 0 && ((a < 0) != (b < 0))) q - 1 else q
        }
    }
}
