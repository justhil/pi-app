package dev.pi.remote.app.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.ui.hosts.HostsScreen
import dev.pi.remote.app.ui.inbox.InboxScreen
import dev.pi.remote.app.ui.session.SessionScreen

@Composable
fun PiRemoteNav(repo: RemoteRepository, incomingLink: String?, onLinkConsumed: () -> Unit, incomingSession: String? = null, onSessionConsumed: () -> Unit = {}) {
    val nav = rememberNavController()
    val active by repo.active.collectAsState()
    val start = remember { if (active == null) "hosts" else "inbox" }

    LaunchedEffect(incomingSession) {
        val key = incomingSession ?: return@LaunchedEffect
        if (repo.active.value != null) {
            nav.navigate("session/${Uri.encode(key)}") { popUpTo("inbox") { inclusive = false }; launchSingleTop = true }
        }
        onSessionConsumed()
    }
    LaunchedEffect(incomingLink) {
        if (incomingLink != null && nav.currentDestination?.route != "hosts") nav.navigate("hosts")
    }

    Box(Modifier.fillMaxSize().background(Pi.c.bg).safeDrawingPadding()) {
        // Navigation's default is a 700ms crossfade, which reads as lag; use a short native-feeling slide.
        NavHost(
            nav, startDestination = start,
            enterTransition = { slideInHorizontally(tween(220)) { it / 5 } + fadeIn(tween(160)) },
            exitTransition = { fadeOut(tween(120)) },
            popEnterTransition = { fadeIn(tween(160)) },
            popExitTransition = { slideOutHorizontally(tween(200)) { it / 5 } + fadeOut(tween(140)) },
        ) {
            composable("hosts") {
                HostsScreen(
                    repo = repo,
                    incomingLink = incomingLink,
                    onLinkConsumed = onLinkConsumed,
                    onOpenHost = { nav.navigate("inbox") { popUpTo("hosts") { inclusive = true } } },
                )
            }
            composable("inbox") {
                InboxScreen(
                    repo = repo,
                    onOpen = { key -> nav.navigate("session/${Uri.encode(key)}") },
                    onHosts = { nav.navigate("hosts") },
                )
            }
            composable("session/{key}") { entry ->
                val key = Uri.decode(entry.arguments?.getString("key").orEmpty())
                SessionScreen(repo = repo, sessionKey = key, onBack = { nav.popBackStack() })
            }
        }
    }
}
