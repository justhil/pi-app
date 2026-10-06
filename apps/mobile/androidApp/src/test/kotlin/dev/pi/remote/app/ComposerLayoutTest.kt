package dev.pi.remote.app

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import dev.pi.remote.R
import dev.pi.remote.app.data.InboxState
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiTheme
import dev.pi.remote.app.ui.inbox.InboxContent
import dev.pi.remote.app.ui.session.Composer
import dev.pi.remote.crypto.Hs2Payload
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.HelloResult
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Long labels on a narrow phone: the trailing controls stay on screen. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "zh-w360dp-h740dp-xxhdpi")
class ComposerLayoutTest {
    @get:Rule val compose = createComposeRule()
    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test fun longModelKeepsSendAndStop() {
        compose.setContent {
            PiTheme(dark = false) {
                Box(Modifier.fillMaxSize().background(Pi.c.bg), contentAlignment = Alignment.BottomCenter) {
                    Composer(
                        text = TextFieldValue("hi"), onText = {}, running = true, enabled = true,
                        modelLabel = "gemini-3.8-flash-high-preview-experimental-0925", thinkingLabel = "Extra high",
                        toolsOn = 12, queue = null, onSend = {}, onStop = {}, onModel = {}, onTools = {},
                    )
                }
            }
        }
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/08-composer-long-model.png")
        val width = compose.onRoot().getBoundsInRoot().right
        for (desc in listOf(R.string.send_steer, R.string.stop)) {
            val b = compose.onNodeWithContentDescription(ctx.getString(desc)).getBoundsInRoot()
            assertTrue("${ctx.getString(desc)} ends at ${b.right}, screen is $width", b.right <= width && b.right - b.left >= 36.dp)
        }
        // The model name keeps room to read (it ellipsizes rather than vanishing).
        val model = compose.onNodeWithText("gemini", substring = true).getBoundsInRoot()
        assertTrue("model is ${model.right - model.left} wide", model.right - model.left >= 56.dp)
    }

    @Test fun longHostNameKeepsActions() {
        val ready = HostConnection.State.Ready(
            "ws://192.168.1.23:47900",
            Hs2Payload("d", "h", "h", "e", "operator"),
            HelloResult("h", "h", "0.7.3", "e", "d", "operator", emptyList(), emptyList()),
        )
        compose.setContent {
            PiTheme(dark = false) {
                InboxContent("justhil-workstation-with-a-very-long-hostname.local", ready, InboxState(Samples.inbox, Samples.projects, true), canCreate = true, onOpen = {}, onHosts = {}, onRetry = {}, onNew = {}, onMenu = {})
            }
        }
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/08-inbox-long-host.png")
        val width = compose.onRoot().getBoundsInRoot().right
        val more = compose.onNodeWithContentDescription(ctx.getString(R.string.more)).getBoundsInRoot()
        assertTrue("more ends at ${more.right}, screen is $width", more.right <= width)
    }
}
