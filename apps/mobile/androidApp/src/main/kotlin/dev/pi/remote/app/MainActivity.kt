package dev.pi.remote.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import dev.pi.remote.app.theme.PiTheme
import dev.pi.remote.app.ui.PiRemoteNav
import dev.pi.remote.app.ui.PiUriHandler
import dev.pi.remote.app.data.LocalAttachmentImages
import dev.pi.remote.app.data.LocalUiPrefs
import dev.pi.remote.app.data.ShareIntake
import dev.pi.remote.app.data.RunNotifier
import kotlinx.coroutines.launch
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalUriHandler

class MainActivity : ComponentActivity() {
    /** A `pidesk://pair#…` link opened from the camera app or another QR scanner. */
    private val incomingLink = mutableStateOf<String?>(null)
    /** Session to open from a notification tap. */
    private val incomingSession = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        preferHighestRefreshRate()
        intent?.let(::intake)
        val graph = (application as PiRemoteApp).graph
        val repo = graph.repository
        setContent {
            val uriHandler = remember { PiUriHandler(this) }
            val themeMode by graph.prefs.theme.collectAsState()
            val dark = when (themeMode) {
                "light" -> false
                "dark" -> true
                else -> isSystemInDarkTheme()
            }
            // Status/navigation bar icons follow the app theme, not only the system one.
            LaunchedEffect(dark) {
                val t = android.graphics.Color.TRANSPARENT
                enableEdgeToEdge(
                    statusBarStyle = if (dark) SystemBarStyle.dark(t) else SystemBarStyle.light(t, t),
                    navigationBarStyle = if (dark) SystemBarStyle.dark(t) else SystemBarStyle.light(t, t),
                )
            }
            PiTheme(dark = dark) {
                CompositionLocalProvider(LocalUriHandler provides uriHandler, LocalAttachmentImages provides graph.images, LocalUiPrefs provides graph.prefs) {
                    PiRemoteNav(repo, incomingLink.value, { incomingLink.value = null }, incomingSession.value) { incomingSession.value = null }
                }
            }
        }
    }

    /**
     * Ask for the panel's fastest mode at the current resolution. Many OEM ROMs keep apps at 60Hz
     * unless the window requests a mode explicitly.
     */
    private fun preferHighestRefreshRate() {
        @Suppress("DEPRECATION")
        val display = (if (Build.VERSION.SDK_INT >= 30) display else windowManager.defaultDisplay) ?: return
        val current = display.mode
        val best = display.supportedModes
            .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .maxByOrNull { it.refreshRate } ?: return
        window.attributes = window.attributes.also { it.preferredDisplayModeId = best.modeId }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intake(intent)
    }

    private fun intake(intent: Intent) {
        if (intent.action == RunNotifier.ACTION_OPEN) {
            intent.getStringExtra(RunNotifier.EXTRA_SESSION)?.let { incomingSession.value = it }
            return
        }
        if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
            val graph = (application as PiRemoteApp).graph
            // Copying is quick for typical shares (a few photos); keep it simple and synchronous-ish on IO.
            graph.scope.launch(kotlinx.coroutines.Dispatchers.IO) { ShareIntake.read(applicationContext, intent)?.let(graph.repository::share) }
            return
        }
        intent.dataString?.let { incomingLink.value = it }
    }
}
