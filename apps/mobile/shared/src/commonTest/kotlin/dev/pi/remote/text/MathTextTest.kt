package dev.pi.remote.text

import dev.pi.remote.text.MathText.Piece
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MathTextTest {
    private fun maths(md: String) = MathText.inlinePieces(md).filterIsInstance<Piece.Math>().map { it.tex }

    @Test fun inlineDollarMath() {
        assertEquals(listOf("t_n = \\min(30, 2^n)", "x"), maths("重连退避 \$t_n = \\min(30, 2^n)\$ 秒，\$x\$ 也是"))
    }

    @Test fun moneyIsNotMath() {
        assertEquals(emptyList(), maths("成本 \$13.43/task，比之前的 \$3.97 高"))
        assertEquals(emptyList(), maths("价格 \$5 到 \$10"))
    }

    @Test fun cjkInsideDollarsIsNotMath() {
        assertEquals(emptyList(), maths("\$这不是公式\$"))
        assertEquals(listOf("\\text{速度} = v"), maths("\$\\text{速度} = v\$"))
    }

    @Test fun inlineCodeIsUntouched() {
        assertEquals(emptyList(), maths("用 `\$x\$` 表示"))
    }

    @Test fun inlineDoubleDollar() {
        assertEquals(listOf("a^2+b^2"), maths("勾股 \$\$a^2+b^2\$\$ 定理"))
    }

    @Test fun parenAndBracketDelimiters() {
        assertEquals("令 \$x^2\$ 为", MathText.convertDelimiters("令 \\(x^2\\) 为"))
        assertEquals("\$\$\n\\int_0^1 f\n\$\$", MathText.convertDelimiters("\\[\n\\int_0^1 f\n\\]"))
        assertEquals("\$\$\nE=mc^2\n\$\$", MathText.convertDelimiters("\\[E=mc^2\\]"))
        assertEquals("参考 \\[1\\] 文献", MathText.convertDelimiters("参考 \\[1\\] 文献"))
        assertEquals("\$\$\nE=mc^2\n\$\$", MathText.convertDelimiters("\$\$E=mc^2\$\$"))
    }

    @Test fun fencesAreNotConverted() {
        val src = "```\n\\(x\\)\n```"
        assertEquals(src, MathText.convertDelimiters(src))
    }

    @Test fun segmentsFindDisplayMath() {
        val segs = RichText.segments("看：\n\\[\na+b\n\\]\n完", streaming = false)
        assertTrue(segs.any { it is Segment.Math && it.tex == "a+b" && it.closed })
        val latex = RichText.segments("```latex\n\\frac12\n```", streaming = false)
        assertTrue(latex.single() is Segment.Math)
    }

    @Test fun macros() {
        assertEquals("x \\in \\mathbb{R}, \\RRx", MathText.expandMacros("x \\in \\RR, \\RRx"))
    }
}
