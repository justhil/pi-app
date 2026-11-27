package dev.pi.remote.app.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.protocol.UsageSummaryResult

private fun compactTokens(n: Long): String = when {
    n >= 1_000_000L -> "%.1fM".format(n / 1_000_000.0)
    n >= 1_000L -> "%.1fk".format(n / 1_000.0)
    else -> n.toString()
}

@Composable
fun UsageSheet(
    load: suspend (Int) -> Result<UsageSummaryResult>,
    cached30d: UsageSummaryResult? = null,
    onDismiss: () -> Unit,
) {
    var days by remember { mutableIntStateOf(30) }
    var data by remember { mutableStateOf(cached30d) }
    var loading by remember { mutableStateOf(cached30d == null) }
    var error by remember { mutableStateOf<String?>(null) }
    val maxH = (LocalConfiguration.current.screenHeightDp * 0.82f).dp

    LaunchedEffect(days) {
        loading = true
        error = null
        load(days)
            .onSuccess { data = it }
            .onFailure { error = it.message }
        loading = false
    }

    PiSheet(onDismiss) {
        Column(Modifier.padding(bottom = 18.dp).heightIn(max = maxH).verticalScroll(rememberScrollState())) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.usage_sheet_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.weight(1f))
                if (loading) Spinner(Pi.c.fg3, 14.dp)
            }
            Box(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                Segmented(
                    options = listOf(
                        "7" to stringResource(R.string.usage_range_7d),
                        "30" to stringResource(R.string.usage_range_30d),
                        "0" to stringResource(R.string.usage_range_all),
                    ),
                    selected = days.toString(),
                    onSelect = { days = it.toIntOrNull() ?: 30 },
                    fill = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            val u = data
            when {
                u == null && loading -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Spinner(Pi.c.fg3, 16.dp) }
                u == null -> Text(error ?: stringResource(R.string.panel_context_none), style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
                u.calls == 0 -> Text(stringResource(R.string.usage_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
                else -> {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatCard(stringResource(R.string.panel_cost), "$${"%.2f".format(u.cost)}", "${u.calls} calls · ${u.sessions} chats", Modifier.weight(1f))
                        val hitPct = u.cacheHitRate?.let { "${(it * 100).toInt()}%" } ?: "—"
                        val perf = listOfNotNull(
                            u.avgTtftMs?.let { "${"%.1f".format(it / 1000.0)}s TTFT" },
                            u.genTps?.let { "${it.toInt()} tok/s" },
                        ).joinToString(" · ").ifEmpty { "${compactTokens(u.cacheRead)} cached" }
                        StatCard(stringResource(R.string.usage_cache_hit), hitPct, perf, Modifier.weight(1f))
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatCard(stringResource(R.string.usage_tokens_in), compactTokens(u.input + u.cacheWrite), "cache +${compactTokens(u.cacheRead)}", Modifier.weight(1f))
                        StatCard(stringResource(R.string.usage_tokens_out), compactTokens(u.output), "", Modifier.weight(1f))
                    }

                    if (u.byDay.size > 1) {
                        val bars = u.byDay.takeLast(14)
                        val maxCost = (bars.maxOfOrNull { it.cost } ?: 0.0).coerceAtLeast(0.0001)
                        Text(stringResource(R.string.usage_daily), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 6.dp))
                        Row(
                            Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 20.dp),
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            for (d in bars) {
                                val ratio = (d.cost / maxCost).toFloat().coerceIn(0.06f, 1f)
                                Box(
                                    Modifier.weight(1f).height((48f * ratio).dp).clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp))
                                        .background(if (d == bars.last()) Pi.c.blue else Pi.c.fg3.copy(alpha = 0.35f)),
                                )
                            }
                        }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)) {
                            Text(bars.first().day.takeLast(5), style = Pi.t.small.copy(color = Pi.c.fg3))
                            Spacer(Modifier.weight(1f))
                            Text(bars.last().day.takeLast(5), style = Pi.t.small.copy(color = Pi.c.fg3))
                        }
                    }

                    if (u.byModel.isNotEmpty()) {
                        Hairline(Modifier.padding(horizontal = 20.dp, vertical = 10.dp))
                        Text(stringResource(R.string.usage_by_model), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 20.dp, bottom = 6.dp))
                        for (m in u.byModel.take(8)) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(m.model.substringAfter('/'), style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${m.calls} calls · in ${compactTokens(m.input)} · out ${compactTokens(m.output)}", style = Pi.t.small.copy(color = Pi.c.fg3))
                                }
                                Spacer(Modifier.width(8.dp))
                                Text("$${"%.2f".format(m.cost)}", style = Pi.t.mono.copy(color = Pi.c.fg))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, sub: String, modifier: Modifier = Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(12.dp)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = Pi.t.meta.copy(color = Pi.c.fg3))
        Text(value, style = Pi.t.title.copy(color = Pi.c.fg), maxLines = 1)
        if (sub.isNotEmpty()) Text(sub, style = Pi.t.small.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
