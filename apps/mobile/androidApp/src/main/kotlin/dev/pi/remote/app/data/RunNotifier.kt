package dev.pi.remote.app.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.pi.remote.R
import dev.pi.remote.app.MainActivity
import dev.pi.remote.app.widget.PiRemoteWidget
import dev.pi.remote.protocol.SessionSummary
import java.util.Objects

data class ActiveRunDigest(
    val hostId: String?,
    val runningCount: Int,
    val needsCount: Int,
    val sessionKey: String?,
    val title: String,
    val detail: String,
    val phase: String,
    val startedAt: Long,
)

/**
 * Run notifications, live ongoing background card (Android 16 Promoted Ongoing capable),
 * and home-screen widget refresh trigger.
 */
class RunNotifier(private val context: Context) {
    init {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_RUNS, context.getString(R.string.notif_channel_runs), NotificationManager.IMPORTANCE_DEFAULT),
        )
        // IMPORTANCE_LOW stays silent while remaining visible in the shade and eligible for Android 16 Promoted Ongoing chips.
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ACTIVITY, context.getString(R.string.notif_channel_keepalive), NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
    }

    private fun allowed() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun notifySession(hostId: String?, s: SessionSummary) =
        runCatching { post(hostId, s) }.onFailure { android.util.Log.w("PiRemote", "notify failed", it) }

    private fun post(hostId: String?, s: SessionSummary) {
        if (!allowed()) return
        val text = when (s.status) {
            "needsInput" -> context.getString(R.string.notif_needs, s.preview.orEmpty()).trimEnd('：', ':', ' ')
            "failed" -> context.getString(R.string.notif_failed, s.preview.orEmpty()).trimEnd('：', ':', ' ')
            else -> s.preview?.takeIf { it.isNotBlank() } ?: context.getString(R.string.notif_done)
        }
        val pi = openIntent(context, hostId, s.sessionKey)
        val n = NotificationCompat.Builder(context, CHANNEL_RUNS)
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(s.title.ifBlank { "pi" })
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setCategory(if (s.status == "needsInput") NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(pi)
            .addAction(0, context.getString(R.string.notif_open_session), pi)
            .build()
        NotificationManagerCompat.from(context).notify(Objects.hash(hostId, s.sessionKey), n)
    }

    /** Opening a session clears its notification. */
    fun clear(sessionKey: String) {
        val nm = NotificationManagerCompat.from(context)
        nm.cancel(sessionKey.hashCode())
        val activeHost = HostStore(java.io.File(context.filesDir, "hosts")).activeHostId
        nm.cancel(Objects.hash(activeHost, sessionKey))
    }

    fun keepAlive(digest: ActiveRunDigest?) {
        val i = Intent(context, KeepAliveService::class.java)
        if (digest != null && digest.runningCount > 0) {
            i.putExtra(KeepAliveService.EXTRA_RUNNING, digest.runningCount)
            i.putExtra(KeepAliveService.EXTRA_NEEDS, digest.needsCount)
            i.putExtra(KeepAliveService.EXTRA_HOST, digest.hostId)
            i.putExtra(KeepAliveService.EXTRA_SESSION, digest.sessionKey)
            i.putExtra(KeepAliveService.EXTRA_TITLE, digest.title)
            i.putExtra(KeepAliveService.EXTRA_DETAIL, digest.detail)
            i.putExtra(KeepAliveService.EXTRA_PHASE, digest.phase)
            i.putExtra(KeepAliveService.EXTRA_STARTED_AT, digest.startedAt)
            runCatching { ContextCompat.startForegroundService(context, i) }
        } else {
            context.stopService(i)
        }
    }

    fun refreshWidgets() {
        runCatching { PiRemoteWidget.refreshAll(context) }
    }

    companion object {
        const val CHANNEL_RUNS = "runs"
        const val CHANNEL_ACTIVITY = "agent_activity"
        const val ACTION_OPEN = "dev.pi.remote.OPEN_SESSION"
        const val EXTRA_HOST = "host"
        const val EXTRA_SESSION = "session"

        fun openIntent(context: Context, hostId: String?, sessionKey: String?): PendingIntent {
            val i = Intent(context, MainActivity::class.java)
                .setAction(ACTION_OPEN)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            hostId?.let { i.putExtra(EXTRA_HOST, it) }
            sessionKey?.let { i.putExtra(EXTRA_SESSION, it) }
            val reqCode = Objects.hash(hostId.orEmpty(), sessionKey.orEmpty())
            return PendingIntent.getActivity(context, reqCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}

/** Holds the process while runs finish in the background and renders a live ongoing activity card. */
class KeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val running = intent?.getIntExtra(EXTRA_RUNNING, 1) ?: 1
        val needs = intent?.getIntExtra(EXTRA_NEEDS, 0) ?: 0
        val hostId = intent?.getStringExtra(EXTRA_HOST)
        val sessionKey = intent?.getStringExtra(EXTRA_SESSION)
        val rawTitle = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() }
        val detail = intent?.getStringExtra(EXTRA_DETAIL)?.takeIf { it.isNotBlank() }
        val phase = intent?.getStringExtra(EXTRA_PHASE) ?: "running"
        val startedAt = intent?.getLongExtra(EXTRA_STARTED_AT, 0L) ?: 0L

        val title = when {
            rawTitle != null && running > 1 -> "$rawTitle (+${running - 1})"
            rawTitle != null -> rawTitle
            else -> getString(R.string.notif_keepalive, running)
        }
        val body = when {
            needs > 0 && detail != null -> getString(R.string.notif_needs, detail)
            detail != null -> detail
            else -> getString(R.string.notif_keepalive, running)
        }
        val pi = RunNotifier.openIntent(this, hostId, sessionKey)
        val extras = Bundle().apply {
            // Android 16+ (API 36) Live Update / Promoted Ongoing status-bar chip request.
            putBoolean("android.requestPromotedOngoing", true)
        }
        val builder = NotificationCompat.Builder(this, RunNotifier.CHANNEL_ACTIVITY)
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .addExtras(extras)
            .setContentIntent(pi)
        if (sessionKey != null) {
            builder.addAction(0, getString(R.string.notif_open_session), pi)
        }
        if (startedAt > 0L && phase == "running") {
            builder.setWhen(startedAt).setUsesChronometer(true).setShowWhen(true)
        }
        if (Build.VERSION.SDK_INT >= 36) {
            val chip = getString(if (needs > 0) R.string.status_needs else R.string.status_running)
            runCatching {
                NotificationCompat.Builder::class.java.getMethod("setShortCriticalText", CharSequence::class.java)
                    .invoke(builder, chip.take(12))
            }
        }
        val n = builder.build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(ID, n)
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15+ caps dataSync services; give up the background hold gracefully.
        stopSelf()
    }

    companion object {
        const val EXTRA_RUNNING = "running"
        const val EXTRA_NEEDS = "needs"
        const val EXTRA_HOST = "host"
        const val EXTRA_SESSION = "session"
        const val EXTRA_TITLE = "title"
        const val EXTRA_DETAIL = "detail"
        const val EXTRA_PHASE = "phase"
        const val EXTRA_STARTED_AT = "startedAt"
        private const val ID = 7301
    }
}
