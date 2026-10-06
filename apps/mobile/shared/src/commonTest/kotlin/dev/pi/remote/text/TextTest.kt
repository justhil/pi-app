package dev.pi.remote.text

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class RichTextTest {
    @Test
    fun splitsFencesAndKeepsMarkdownBetween() {
        val text = "修好了：\n\n```ts\nconst a = 1\n```\n\n```pi-ui\n{\"component\":\"chart\",\"props\":{}}\n```\n\n$$\nt_n = 2^n\n$$\n结尾。"
        val s = RichText.segments(text, streaming = false)
        assertEquals(listOf("Markdown", "Code", "PiUi", "Math", "Markdown"), s.map { it::class.simpleName })
        assertEquals("const a = 1", (s[1] as Segment.Code).code)
        assertEquals("ts", (s[1] as Segment.Code).language)
        assertTrue((s[2] as Segment.PiUi).closed)
        assertEquals("t_n = 2^n", (s[3] as Segment.Math).tex)
    }

    @Test
    fun streamingOpenFenceIsNotClosedAndTailIsPlain() {
        val s = RichText.segments("先跑测试。\n\n```pi-ui\n{\"component\":\"chart\",\"props\":{\"x\":[1,", streaming = true)
        val ui = s.last()
        assertIs<Segment.PiUi>(ui)
        assertEquals(false, ui.closed)
        assertIs<RichText.PiUiParse.Incomplete>(RichText.parsePiUi(ui.raw, ui.closed))
        val t = RichText.segments("第一段已经写完了，这是完整的一句话。\n\n第二段还在流式输出中，尚未结束的这一部分会比较长，超过二十八个字符的门槛才会切分", streaming = true)
        assertIs<Segment.Tail>(t.last())
        assertIs<Segment.Markdown>(t.first())
    }

    @Test
    fun streamingSplitMatchesDesktop() {
        assertEquals("" to "short", RichText.splitStreamingMarkdown("short"))
        val (committed, tail) = RichText.splitStreamingMarkdown("para one is done.\n\n" + "x".repeat(40))
        assertEquals("para one is done.\n\n", committed)
        assertEquals(40, tail.length)
    }

    @Test
    fun piUiEnvelope() {
        val ok = RichText.parsePiUi("""{"component":"stat-grid","id":7,"props":{"items":[],},}""", closed = true)
        assertIs<RichText.PiUiParse.Ok>(ok)
        assertEquals("7", ok.id)
        assertIs<RichText.PiUiParse.Invalid>(RichText.parsePiUi("""{"props":{}}""", true))
        assertIs<RichText.PiUiParse.Invalid>(RichText.parsePiUi("""{"component":"x","props":[]}""", true))
        assertIs<RichText.PiUiParse.Invalid>(RichText.parsePiUi("not json", true))
    }
}

class TimelineMathTest {
    @Test
    fun scrubberMatchesDesktopLayout() {
        assertEquals(50f, Scrubber.markY(0, 1, 100f))
        assertEquals(44f, Scrubber.markY(0, 2, 100f))
        assertEquals(56f, Scrubber.markY(1, 2, 100f))
        assertEquals(1, Scrubber.nearestMark(57f, 2, 100f))
        assertEquals(1f, Scrubber.magnify(0f))
        assertEquals(0f, Scrubber.magnify(30f))
        assertEquals(2, Scrubber.activeMark(listOf(null, 10f, 100f), readingLine = 120f))
        assertEquals(1, Scrubber.activeMark(listOf(null, 10f, 300f), readingLine = 120f))
        assertEquals(2, Scrubber.activeMark(listOf(0f, 10f, 300f), 0f, atBottom = true))
    }

    @Test
    fun dividers() {
        val day = 86_400_000L
        assertTrue(TimeDividers.showDivider(null, 1000, 0))
        assertTrue(!TimeDividers.showDivider(0, 29 * 60_000L, 0))
        assertTrue(TimeDividers.showDivider(0, 31 * 60_000L, 0))
        assertTrue(TimeDividers.showDivider(day - 1000, day + 1000, 0))
        assertEquals("1m 32s", formatDuration(92_000))
        assertEquals("0:42", formatClock(42_500))
    }
}

class GanttMathTest {
    @Test
    fun calendarRoundTrip() {
        assertEquals(0, GanttMath.daysFromCivil(1970, 0, 1))
        val d = GanttMath.parseDay("2026-10-05")!!
        assertEquals(GanttMath.DayParts(2026, 9, 5, 1), GanttMath.dayParts(d)) // Monday
        assertEquals(null, GanttMath.parseDay("2026-02-30"))
        assertEquals(d, GanttMath.parseDay("2026/10/5T09:00"))
    }

    @Test
    fun resolvesTasksLikeDesktop() {
        val tasks = GanttMath.resolveTasks(
            listOf(
                GanttMath.TaskInput(id = "a", name = "A", start = "2026-10-01", end = "2026-10-03", progress = 80.0),
                GanttMath.TaskInput(id = "b", name = "B", start = "2026-10-04", duration = 2.0, dependsOn = listOf("a"), group = "G"),
                GanttMath.TaskInput(name = "M", start = "2026-10-09", milestone = true, dependsOn = listOf("B", "nope")),
            ),
        )
        assertEquals(3, tasks[0].end - tasks[0].start)
        assertEquals(0.8, tasks[0].progress)
        assertEquals(listOf("a"), tasks[1].deps)
        assertTrue(tasks[2].milestone)
        assertEquals(tasks[2].start, tasks[2].end)
        assertEquals(listOf("b"), tasks[2].deps)
        assertEquals(setOf("a", "b", "M"), GanttMath.dependencyChain(tasks, "b"))
        val rows = GanttMath.buildRows(tasks, setOf("G"))
        assertEquals(3, rows.size)
        assertIs<GanttMath.Row.Group>(rows[1])
        assertEquals(GanttMath.Scale.Day, GanttMath.pickScale(30))
        val (s, e) = GanttMath.taskExtent(tasks)
        val week = GanttMath.scaleDomain(s, e, GanttMath.Scale.Week)
        assertEquals(1, GanttMath.dayParts(week.first).weekday) // weeks start Monday
        assertTrue(GanttMath.weekendRuns(week).all { it.last - it.first == 1 })
    }
}
