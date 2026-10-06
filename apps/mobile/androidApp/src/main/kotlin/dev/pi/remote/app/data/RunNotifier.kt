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
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.pi.remote.R
import dev.pi.remote.app.MainActivity
import dev.pi.remote.protocol.SessionSummary

/**
 * Run notifications. A finished / failed / waiting session posts a notification that opens it;
 * while runs are still going and the app is in the background, [KeepAliveService] holds the
 * connection (the app otherwise disconnects 30 s after leaving the screen) so the result arrives.
 */
class RunNotifier(private val context: Context) {
    init {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_RUNS, context.getString(R.string.notif_channel_runs), NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CHANNEL_KEEPALIVE, context.getString(R.string.notif_channel_keepalive), NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
    }

    private fun allowed() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun notifySession(s: SessionSummary) = runCatching { post(s) }.onFailure { android.util.Log.w("PiRemote", "notify failed", it) }

    private fun post(s: SessionSummary) {
        if (!allowed()) return
        val text = when (s.status) {
            "needsInput" -> context.getString(R.string.notif_needs, s.preview.orEmpty()).trimEnd('：', ':', ' ')
            "failed" -> context.getString(R.string.notif_failed, s.preview.orEmpty()).trimEnd('：', ':', ' ')
            else -> s.preview?.takeIf { it.isNotBlank() } ?: context.getString(R.string.notif_done)
        }
        val n = NotificationCompat.Builder(context, CHANNEL_RUNS)
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(s.title.ifBlank { "pi" })
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setCategory(if (s.status == "needsInput") NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(openIntent(context, s.sessionKey))
            .build()
        NotificationManagerCompat.from(context).notify(s.sessionKey.hashCode(), n)
    }

    /** Opening a session clears its notification. */
    fun clear(sessionKey: String) = NotificationManagerCompat.from(context).cancel(sessionKey.hashCode())

    fun keepAlive(running: Int) {
        val i = Intent(context, KeepAliveService::class.java)
        if (running > 0) {
            i.putExtra(KeepAliveService.EXTRA_RUNNING, running)
            runCatching { ContextCompat.startForegroundService(context, i) }
        } else {
            context.stopService(i)
        }
    }

    companion object {
        const val CHANNEL_RUNS = "runs"
        const val CHANNEL_KEEPALIVE = "keepalive"
        const val ACTION_OPEN = "dev.pi.remote.OPEN_SESSION"
        const val EXTRA_SESSION = "session"

        fun openIntent(context: Context, sessionKey: String?): PendingIntent {
            val i = Intent(context, MainActivity::class.java).setAction(ACTION_OPEN).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            sessionKey?.let { i.putExtra(EXTRA_SESSION, it) }
            return PendingIntent.getActivity(context, sessionKey?.hashCode() ?: 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}

/** Holds the process (and the gateway connection) while runs finish in the background. */
class KeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val running = intent?.getIntExtra(EXTRA_RUNNING, 1) ?: 1
        val n = NotificationCompat.Builder(this, RunNotifier.CHANNEL_KEEPALIVE)
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(getString(R.string.notif_keepalive, running))
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(RunNotifier.openIntent(this, null))
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(ID, n)
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15 caps dataSync services; give up the background hold gracefully.
        stopSelf()
    }

    companion object {
        const val EXTRA_RUNNING = "running"
        private const val ID = 7301
    }
}
