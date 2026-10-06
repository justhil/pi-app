package dev.pi.remote.app

import android.content.Context
import android.os.Build
import dev.pi.remote.app.data.AttachmentStore
import dev.pi.remote.app.data.HostStore
import dev.pi.remote.app.data.KeyVault
import dev.pi.remote.app.data.KeystoreKeyWrapper
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.data.TimelineCache
import dev.pi.remote.app.data.UiPrefs
import dev.pi.remote.app.data.RunNotifier
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Hand-written dependency graph (no DI framework: keeps the APK small and startup fast). */
class AppGraph(context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val repository = RemoteRepository(
        scope = scope,
        hostStore = HostStore(File(context.filesDir, "hosts")),
        keyVault = KeyVault(File(context.noBackupFilesDir, "keys"), KeystoreKeyWrapper()),
        cache = TimelineCache(File(context.cacheDir, "timeline")),
        assetDir = File(context.filesDir, "assets"),
        deviceName = (Build.MODEL ?: "Android").take(60),
        platform = "android-${Build.VERSION.SDK_INT}",
        appVersion = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "0",
    )
    val prefs = UiPrefs(context.applicationContext)
    val notifier = RunNotifier(context.applicationContext).also { repository.notifier = it }
    val images = AttachmentStore(context.applicationContext, File(context.cacheDir, "attachments")) { path -> repository.downloadAttachment(path) }
        .also { repository.attachmentStore = it }
}
