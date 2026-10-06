package dev.pi.remote.app

import dev.pi.remote.app.data.PromptAttachments
import org.junit.Assert.assertEquals
import org.junit.Test

class PromptAttachmentsTest {
    @Test fun composeAndSplitRoundTrip() {
        val text = PromptAttachments.compose(" 看看这个 ", listOf("/d/pi-clipboard-3f2a9c1d-IMG 1.jpg", "/d/pi-clipboard-77aa01bc-crash.log"))
        assertEquals("看看这个\n\"/d/pi-clipboard-3f2a9c1d-IMG 1.jpg\" /d/pi-clipboard-77aa01bc-crash.log", text)
        val (body, refs) = PromptAttachments.split(text)
        assertEquals("看看这个", body)
        assertEquals(listOf(PromptAttachments.Ref("IMG 1.jpg", true, "/d/pi-clipboard-3f2a9c1d-IMG 1.jpg"), PromptAttachments.Ref("crash.log", false, "/d/pi-clipboard-77aa01bc-crash.log")), refs)
    }

    @Test fun desktopPasteShowsAsImage() {
        val (body, refs) = PromptAttachments.split("C:\\u\\pi-clipboard-0d9f4c2e-1b2a-4c3d-9e8f-001122334455.png 这是什么")
        assertEquals("这是什么", body)
        assertEquals(listOf(PromptAttachments.Ref("image.png", true, "C:\\u\\pi-clipboard-0d9f4c2e-1b2a-4c3d-9e8f-001122334455.png")), refs)
    }

    @Test fun plainTextUntouched() {
        assertEquals("no refs" to emptyList<PromptAttachments.Ref>(), PromptAttachments.split("no refs"))
    }
}
