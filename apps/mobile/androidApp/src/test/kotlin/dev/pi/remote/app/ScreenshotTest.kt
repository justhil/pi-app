package dev.pi.remote.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.graphics.ImageBitmap
import dev.pi.remote.app.data.Attachment
import dev.pi.remote.app.data.InboxState
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiTheme
import dev.pi.remote.app.ui.inbox.InboxContent
import dev.pi.remote.app.ui.piui.PiUiBlock
import dev.pi.remote.app.ui.rich.RichContent
import dev.pi.remote.app.ui.session.SessionContent
import dev.pi.remote.crypto.Hs2Payload
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.HelloResult
import dev.pi.remote.sync.SessionTimeline
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the prototype's screens with sample data. Output: androidApp/build/outputs/roborazzi.
 * Run `./gradlew :androidApp:recordRoborazziDebug` and compare with research/prototype by eye.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "zh-w390dp-h844dp-xxhdpi")
class ScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val ready = HostConnection.State.Ready(
        "ws://192.168.1.23:47900",
        Hs2Payload("d", "h", "justhil-desktop", "e", "operator"),
        HelloResult("h", "justhil-desktop", "0.7.0", "e", "d", "operator", emptyList(), emptyList()),
    )

    private fun shot(name: String, dark: Boolean = false, content: @Composable () -> Unit) {
        compose.setContent { PiTheme(dark = dark) { Box(Modifier.fillMaxSize().background(Pi.c.bg)) { content() } } }
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/$name.png")
    }

    @Composable
    private fun Session(timeline: SessionTimeline, expanded: Set<String> = emptySet(), attachments: List<Attachment> = emptyList(), draft: String = "") = SessionContent(
        title = timeline.title, project = "pi-app", timeline = timeline, connection = ready, canWrite = true,
        draft = TextFieldValue(draft), onDraft = {}, notice = null, toolsOn = 1, deferredUi = emptySet(), attachments = attachments, mermaid = null,
        onBack = {}, onRetry = {}, onLoadOlder = {}, onSend = {}, onStop = {}, onModel = {}, onTools = {}, onAnswer = {}, onSkip = {}, onDefer = {},
        loadDetail = { null }, initialExpanded = expanded,
    )

    @Test fun inbox() = shot("02-inbox") {
        InboxContent("justhil-desktop", ready, InboxState(Samples.inbox, Samples.projects, true), canCreate = true, onOpen = {}, onHosts = {}, onRetry = {}, onNew = {})
    }

    @Test fun inboxDark() = shot("02-inbox-dark", dark = true) {
        InboxContent("justhil-desktop", ready, InboxState(Samples.inbox, Samples.projects, true), canCreate = true, onOpen = {}, onHosts = {}, onRetry = {}, onNew = {})
    }

    @Test fun timeline() = shot("03-timeline") { Session(Samples.timeline) }

    @Test fun timelineExpanded() = shot("03-timeline-expanded") { Session(Samples.timeline.copy(turns = Samples.timeline.turns.take(2), state = Samples.timeline.state.copy(running = false)), setOf("t2")) }

    @Test fun timelineDark() = shot("03-timeline-dark", dark = true) { Session(Samples.timeline) }

    @Test fun attachments() = shot("05-attachments") {
        val photo = ImageBitmap(160, 120).also { androidx.compose.ui.graphics.Canvas(it).drawRect(0f, 0f, 160f, 120f, androidx.compose.ui.graphics.Paint().apply { color = androidx.compose.ui.graphics.Color(0xFF7A9CC6) }) }
        val uri = android.net.Uri.parse("content://x/1")
        val sent = Samples.timeline.turns.first().let { t -> t.copy(user = t.user.copy(text = "看一下这张截图里的报错 /home/me/.config/pi-desktop/clipboard-images/pi-clipboard-3f2a9c1d-IMG_0412.jpg /home/me/.config/pi-desktop/clipboard-images/pi-clipboard-77aa01bc-crash.log")) }
        Session(
            Samples.timeline.copy(turns = listOf(sent), state = Samples.timeline.state.copy(running = false)),
            attachments = listOf(
                Attachment(uri = uri, name = "IMG_0413.jpg", isImage = true, thumb = photo, status = Attachment.Status.Ready, path = "/x"),
                Attachment(uri = uri, name = "IMG_0414.jpg", isImage = true, thumb = photo, status = Attachment.Status.Uploading),
                Attachment(uri = uri, name = "build-output.txt", isImage = false, status = Attachment.Status.Failed, error = "offline"),
            ),
            draft = "再对比一下这几张",
        )
    }

    @Test fun question() = shot("04-question") { Session(Samples.paused) }

    @Test fun piUi() = shot("06-piui") {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            RichContent(Samples.rich, streaming = false)
        }
    }

    @Test fun charts() = shot("06-charts") {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            PiUiBlock(Samples.chart, closed = true)
            PiUiBlock("""{"component":"chart","props":{"title":"净流入（万）","type":"line","x":["1月","2月","3月","4月","5月","6月","7月","8月"],"series":[{"name":"A","data":[3,-2,4,6,-1,5,7,9]},{"name":"B","type":"area","data":[1,2,1.5,3,2.5,4,3.5,5]}]}}""", closed = true)
            PiUiBlock("""{"component":"chart","props":{"title":"各端耗时","type":"horizontal-bar","x":["Android","iOS","Web","Desktop"],"series":[{"name":"冷启动","data":[820,640,410,1200]},{"name":"热启动","data":[210,180,90,300]}],"unit":"ms"}}""", closed = true)
            PiUiBlock("""{"component":"chart","props":{"title":"Token 构成","type":"donut","x":["system","工具","历史","本轮"],"series":[{"name":"tokens","data":[4100,12500,30200,2800]}]}}""", closed = true)
        }
    }

    @Test fun gantt() = shot("06-gantt") {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            PiUiBlock(Samples.gantt, closed = true)
            PiUiBlock(Samples.quiz, closed = true)
        }
    }

    @Test fun moreBlocks() = shot("06-blocks") {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            PiUiBlock(Samples.cards, closed = true)
            PiUiBlock(Samples.decision, closed = true)
            PiUiBlock(Samples.diffBlock, closed = true)
        }
    }

    @Test fun markdown() = shot("07-markdown") {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(18.dp)) { RichContent(Samples.markdown, streaming = false) }
    }
}
