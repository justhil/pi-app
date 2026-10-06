package dev.pi.remote.text

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToLong

/** Port of the desktop's `ui-blocks/components/chart-math.ts`: same ticks, extents, stacking, label thinning. */
object ChartMath {
    data class NiceScale(val min: Double, val max: Double, val ticks: List<Double>)

    private fun niceStep(raw: Double): Double {
        val exponent = floor(log10(raw))
        val base = 10.0.pow(exponent)
        val f = raw / base
        val nice = when {
            f <= 1 -> 1.0
            f <= 2 -> 2.0
            f <= 2.5 -> 2.5
            f <= 5 -> 5.0
            else -> 10.0
        }
        return nice * base
    }

    /** `toPrecision(12)` equivalent: kill float noise such as 0.30000000000000004. */
    private fun clean(v: Double): Double {
        if (v == 0.0 || !v.isFinite()) return v
        val digits = 12 - ceil(log10(abs(v))).toInt()
        val p = 10.0.pow(digits)
        return if (digits in 0..300) (v * p).roundToLong() / p else v
    }

    /** Round a [min, max] extent out to readable tick values (≈ `count` ticks). */
    fun niceScale(min0: Double, max0: Double, count: Int = 5): NiceScale {
        if (!min0.isFinite() || !max0.isFinite()) return NiceScale(0.0, 1.0, listOf(0.0, 1.0))
        var min = min0
        var max = max0
        if (min == max) {
            val pad = if (abs(min) > 0) abs(min) * 0.5 else 1.0
            min -= pad
            max += pad
        }
        val step = niceStep((max - min) / max(1, count))
        val niceMin = floor(min / step) * step
        val niceMax = ceil(max / step) * step
        val ticks = ArrayList<Double>()
        var v = niceMin
        while (v <= niceMax + step * 1e-9) {
            ticks += if (abs(v) < step * 1e-9) 0.0 else clean(v)
            v += step
        }
        return NiceScale(niceMin, niceMax, ticks)
    }

    /** Extent of a set of series, optionally stacked (positive and negative parts stack apart). */
    fun seriesExtent(series: List<List<Double?>>, stacked: Boolean, includeZero: Boolean): Pair<Double, Double> {
        var min = Double.POSITIVE_INFINITY
        var max = Double.NEGATIVE_INFINITY
        if (stacked) {
            val length = series.maxOfOrNull { it.size } ?: 0
            for (i in 0 until length) {
                var pos = 0.0
                var neg = 0.0
                for (d in series) {
                    val v = d.getOrNull(i) ?: continue
                    if (v >= 0) pos += v else neg += v
                }
                max = max(max, pos)
                min = kotlin.math.min(min, neg)
            }
        } else {
            for (d in series) for (v in d) if (v != null) {
                min = kotlin.math.min(min, v)
                max = max(max, v)
            }
        }
        if (!min.isFinite() || !max.isFinite()) return 0.0 to 1.0
        if (includeZero) {
            min = kotlin.math.min(0.0, min)
            max = max(0.0, max)
        }
        return min to max
    }

    /** [start, end] per value: positives stack upward and negatives downward from zero. */
    fun stackSeries(series: List<List<Double?>>): List<List<Pair<Double, Double>?>> {
        val length = series.maxOfOrNull { it.size } ?: 0
        val pos = DoubleArray(length)
        val neg = DoubleArray(length)
        return series.map { d ->
            List(length) { i ->
                val v = d.getOrNull(i) ?: return@List null
                if (v >= 0) {
                    val s = pos[i]
                    pos[i] += v
                    s to pos[i]
                } else {
                    val s = neg[i]
                    neg[i] += v
                    s to neg[i]
                }
            }
        }
    }

    /** Show every `step`-th category label so labels never collide at the current width. */
    fun labelStep(labels: List<String>, plotWidth: Double, charWidth: Double = 6.5): Int {
        if (labels.isEmpty()) return 1
        val widest = labels.maxOf { max(24.0, it.length * charWidth) }
        val fit = max(1, floor(plotWidth / (widest + 10)).toInt())
        return max(1, ceil(labels.size / fit.toDouble()).toInt())
    }

    fun linear(d0: Double, d1: Double, r0: Double, r1: Double): (Double) -> Double {
        val span = (d1 - d0).takeIf { it != 0.0 } ?: 1.0
        return { v -> r0 + (v - d0) / span * (r1 - r0) }
    }
}
