package dev.pi.remote.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import dev.pi.remote.R
import dev.pi.remote.app.data.HostStore
import dev.pi.remote.app.data.RunNotifier
import dev.pi.remote.app.data.TimelineCache
import java.io.File

/**
 * Native home-screen widget (zero extra dependency): shows active computer, live/waiting session
 * rows (tap to open that exact session), and 30-day usage/cache-hit summary from local cache.
 */
class PiRemoteWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) render(context, appWidgetManager, id)
    }

    companion object {
        fun refreshAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context) ?: return
            val ids = mgr.getAppWidgetIds(ComponentName(context, PiRemoteWidget::class.java))
            if (ids.isEmpty()) return
            for (id in ids) render(context, mgr, id)
        }

        private fun render(context: Context, mgr: AppWidgetManager, widgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.pi_widget)
            val hostStore = HostStore(File(context.filesDir, "hosts"))
            val host = hostStore.activeHostId?.let { id -> hostStore.hosts.firstOrNull { it.hostId == id } } ?: hostStore.hosts.firstOrNull()
            val cache = TimelineCache(File(context.filesDir, "remote-cache"))

            views.setOnClickPendingIntent(R.id.widget_root, RunNotifier.openIntent(context, host?.hostId, null))

            if (host == null) {
                views.setTextViewText(R.id.widget_host, context.getString(R.string.app_name))
                views.setTextViewText(R.id.widget_badge, context.getString(R.string.widget_unpaired))
                views.setViewVisibility(R.id.widget_row1, View.GONE)
                views.setViewVisibility(R.id.widget_row2, View.GONE)
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.hosts_title))
                views.setTextViewText(R.id.widget_footer, "")
                mgr.updateAppWidget(widgetId, views)
                return
            }

            val inbox = cache.loadInbox(host.hostId).filter { it.parentSessionKey == null }
            val meta = cache.loadMeta(host.hostId)
            val needs = inbox.count { it.status == "needsInput" || it.status == "failed" }
            val running = inbox.count { it.status == "running" }
            views.setTextViewText(R.id.widget_host, host.hostName.ifBlank { "pi" })
            val badge = when {
                needs > 0 -> "${context.getString(R.string.inbox_needs)} · $needs"
                running > 0 -> "${context.getString(R.string.inbox_running)} · $running"
                else -> context.getString(R.string.status_idle)
            }
            views.setTextViewText(R.id.widget_badge, badge)

            val prioritized = inbox.sortedWith(
                compareBy<dev.pi.remote.protocol.SessionSummary> {
                    when (it.status) {
                        "needsInput" -> 0
                        "failed" -> 1
                        "running" -> 2
                        else -> 3
                    }
                }.thenByDescending { it.updatedAt },
            ).take(2)

            if (prioritized.isEmpty()) {
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.inbox_empty))
                views.setViewVisibility(R.id.widget_row1, View.GONE)
                views.setViewVisibility(R.id.widget_row2, View.GONE)
            } else {
                views.setViewVisibility(R.id.widget_empty, View.GONE)
                bindRow(context, views, host.hostId, prioritized.getOrNull(0), R.id.widget_row1, R.id.widget_row1_dot, R.id.widget_row1_title, R.id.widget_row1_sub)
                bindRow(context, views, host.hostId, prioritized.getOrNull(1), R.id.widget_row2, R.id.widget_row2_dot, R.id.widget_row2_title, R.id.widget_row2_sub)
            }

            val u = meta.usage30d
            val footer = if (u != null && u.calls > 0) {
                val hit = u.cacheHitRate?.let { " · ${context.getString(R.string.cache)} ${(it * 100).toInt()}%" }.orEmpty()
                "30d · $${"%.2f".format(u.cost)}$hit · ${u.calls} calls"
            } else {
                context.getString(R.string.widget_tap_open)
            }
            views.setTextViewText(R.id.widget_footer, footer)
            mgr.updateAppWidget(widgetId, views)
        }

        private fun bindRow(
            context: Context,
            views: RemoteViews,
            hostId: String,
            s: dev.pi.remote.protocol.SessionSummary?,
            rowId: Int,
            dotId: Int,
            titleId: Int,
            subId: Int,
        ) {
            if (s == null) {
                views.setViewVisibility(rowId, View.GONE)
                return
            }
            views.setViewVisibility(rowId, View.VISIBLE)
            val dot = when (s.status) {
                "needsInput" -> "●"
                "failed" -> "!"
                "running" -> "◐"
                else -> "·"
            }
            val color = when (s.status) {
                "needsInput" -> 0xFFD97706.toInt()
                "failed" -> 0xFFDC2626.toInt()
                "running" -> 0xFF2563EB.toInt()
                else -> 0xFF737373.toInt()
            }
            views.setTextViewText(dotId, dot)
            views.setTextColor(dotId, color)
            views.setTextViewText(titleId, s.title.ifBlank { context.getString(R.string.session_untitled) })
            val detail = when (s.status) {
                "running" -> s.live?.takeIf { it.isNotBlank() } ?: context.getString(R.string.status_running)
                else -> s.preview?.takeIf { it.isNotBlank() } ?: s.projectId.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\')
            }
            views.setTextViewText(subId, detail)
            views.setOnClickPendingIntent(rowId, RunNotifier.openIntent(context, hostId, s.sessionKey))
        }
    }
}
