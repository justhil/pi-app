package dev.pi.remote.app

import dev.pi.remote.app.ui.session.LineComment
import dev.pi.remote.app.ui.session.formatLineComments
import dev.pi.remote.app.ui.session.lineRangeLabel
import dev.pi.remote.protocol.DiffLine
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewCommentTest {
    @Test fun rangeUsesNewLineNumbersAndOldOnesForRemovals() {
        assertEquals("11", lineRangeLabel(listOf(DiffLine("add", n = 11, s = "x"))))
        assertEquals("11-13", lineRangeLabel(listOf(DiffLine("del", o = 11, s = "a"), DiffLine("add", n = 11, s = "b"), DiffLine("ctx", o = 13, n = 13, s = "c"))))
        assertEquals(null, lineRangeLabel(listOf(DiffLine("add", s = "x"))))
    }

    @Test fun formatsLikeTheDesktopReviewList() {
        val text = formatLineComments(
            listOf(
                LineComment("src/auth.ts", 1, 2, "11-12", listOf("  if (a)", "  b()"), " refresh earlier "),
                LineComment("README.md", 0, 0, "3", listOf("# Title"), "typo"),
                LineComment("a.ts", 0, 0, null, listOf("x"), "why"),
            ),
        )
        assertEquals("- src/auth.ts:11-12: refresh earlier\n  >   if (a)\n  >   b()\n- README.md:3: typo\n  > # Title\n- a.ts: why\n  > x", text)
    }
}
