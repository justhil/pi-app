package dev.pi.remote.app.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Design tokens from the approved prototype (research/prototype): zinc neutrals, one semantic
 * blue, hairlines instead of shadows. Quiet and compact: regular weight everywhere except
 * session titles (Medium).
 */
@Immutable
data class Tokens(
    val bg: Color,
    val surface: Color,
    val code: Color,
    val card: Color,
    val fg: Color,
    val fg2: Color,
    val fg3: Color,
    val line: Color,
    val blue: Color,
    val ok: Color,
    val bad: Color,
    val warn: Color,
    val s1: Color,
    val s2: Color,
    val addBg: Color,
    val delBg: Color,
    val scrim: Color,
    val kw: Color,
    val str: Color,
    val fn: Color,
    val com: Color,
    val dark: Boolean,
)

val LightTokens = Tokens(
    bg = Color(0xFFFFFFFF), surface = Color(0xFFF4F4F5), code = Color(0xFFF6F6F7), card = Color(0xFFFAFAFA),
    fg = Color(0xFF09090B), fg2 = Color(0xFF52525B), fg3 = Color(0xFF71717A), line = Color(0xFFE7E7EA),
    blue = Color(0xFF165DFF), ok = Color(0xFF12813A), bad = Color(0xFFD4302F), warn = Color(0xFFB25600),
    s1 = Color(0xFF2F6BF0), s2 = Color(0xFFD9650B), addBg = Color(0x1712813A), delBg = Color(0x14D4302F), scrim = Color(0x5209090B),
    kw = Color(0xFF6F42C1), str = Color(0xFF0B6A72), fn = Color(0xFF1D4FD8), com = Color(0xFF7A7A83), dark = false,
)

val DarkTokens = Tokens(
    bg = Color(0xFF1F1F1F), surface = Color(0xFF2B2B2B), code = Color(0xFF262626), card = Color(0xFF242424),
    fg = Color(0xFFD9D9D9), fg2 = Color(0xFFABABAB), fg3 = Color(0xFF929292), line = Color(0xFF303030),
    blue = Color(0xFF4DAAFC), ok = Color(0xFF3FB950), bad = Color(0xFFF85149), warn = Color(0xFFD29922),
    s1 = Color(0xFF5B9DFF), s2 = Color(0xFFF0913A), addBg = Color(0x213FB950), delBg = Color(0x1FF85149), scrim = Color(0x80000000),
    kw = Color(0xFFC39BFF), str = Color(0xFF5EC4C4), fn = Color(0xFF79B8FF), com = Color(0xFF8B8B8B), dark = true,
)

@Immutable
data class TypeScale(
    val body: TextStyle,
    val bodyMedium: TextStyle,
    val secondary: TextStyle,
    val meta: TextStyle,
    val small: TextStyle,
    val title: TextStyle,
    val heading: TextStyle,
    val mono: TextStyle,
    val monoSmall: TextStyle,
)

private fun typeScale() = TypeScale(
    body = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium),
    secondary = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    meta = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    small = TextStyle(fontSize = 11.5.sp, lineHeight = 15.sp),
    title = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    heading = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Medium),
    mono = TextStyle(fontSize = 13.sp, lineHeight = 20.sp, fontFamily = FontFamily.Monospace),
    monoSmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp, fontFamily = FontFamily.Monospace),
)

val LocalTokens = staticCompositionLocalOf { LightTokens }
val LocalType = staticCompositionLocalOf { typeScale() }

object Pi {
    val c: Tokens @Composable get() = LocalTokens.current
    val t: TypeScale @Composable get() = LocalType.current
}

@Composable
fun PiTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val tokens = if (dark) DarkTokens else LightTokens
    val scheme = if (dark) {
        darkColorScheme(primary = tokens.fg, onPrimary = tokens.bg, background = tokens.bg, onBackground = tokens.fg, surface = tokens.bg, onSurface = tokens.fg, surfaceVariant = tokens.surface, outline = tokens.line, error = tokens.bad)
    } else {
        lightColorScheme(primary = tokens.fg, onPrimary = tokens.bg, background = tokens.bg, onBackground = tokens.fg, surface = tokens.bg, onSurface = tokens.fg, surfaceVariant = tokens.surface, outline = tokens.line, error = tokens.bad)
    }
    CompositionLocalProvider(LocalTokens provides tokens, LocalType provides typeScale()) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
