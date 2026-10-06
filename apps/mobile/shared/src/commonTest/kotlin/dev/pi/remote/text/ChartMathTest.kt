package dev.pi.remote.text

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Same cases as the desktop's ui-blocks/__tests__/math.test.ts ("chart math"). */
class ChartMathTest {
    @Test fun roundsExtentsToReadableTicks() {
        assertEquals(ChartMath.NiceScale(0.0, 100.0, listOf(0.0, 20.0, 40.0, 60.0, 80.0, 100.0)), ChartMath.niceScale(0.0, 97.0))
        assertEquals(listOf(-4.0, -2.0, 0.0, 2.0, 4.0, 6.0, 8.0), ChartMath.niceScale(-3.0, 7.0, 5).ticks)
        assertTrue(ChartMath.niceScale(5.0, 5.0).ticks.size > 1)
        assertEquals(listOf(0.1, 0.15, 0.2, 0.25, 0.3, 0.35), ChartMath.niceScale(0.1, 0.35, 5).ticks)
    }

    @Test fun stacksPositiveAndNegativeApart() {
        assertEquals(
            listOf(listOf(0.0 to 1.0, 0.0 to -2.0, null), listOf(1.0 to 4.0, -2.0 to -3.0, 0.0 to 4.0)),
            ChartMath.stackSeries(listOf(listOf(1.0, -2.0, null), listOf(3.0, -1.0, 4.0))),
        )
        assertEquals(-3.0 to 4.0, ChartMath.seriesExtent(listOf(listOf(1.0, -2.0), listOf(3.0, -1.0)), true, true))
        assertEquals(5.0 to 7.0, ChartMath.seriesExtent(listOf(listOf(5.0, 7.0)), false, false))
        assertEquals(0.0 to 7.0, ChartMath.seriesExtent(listOf(listOf(5.0, 7.0)), false, true))
    }

    @Test fun thinsLabels() {
        assertEquals(3, ChartMath.labelStep(List(30) { "Label $it" }, 900.0))
        assertEquals(1, ChartMath.labelStep(listOf("a", "b"), 900.0))
    }
}
