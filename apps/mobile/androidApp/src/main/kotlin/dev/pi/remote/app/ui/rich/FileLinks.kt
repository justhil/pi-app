package dev.pi.remote.app.ui.rich

import androidx.compose.runtime.compositionLocalOf

/** Workspace-relative (or normalized) file reference parsed from assistant prose, code spans, or links. */
data class FileTarget(
    val path: String,
    val lineStart: Int? = null,
    val lineEnd: Int? = null,
) {
    fun mentionRef(): String {
        val clean = path.replace('\\', '/')
        val suffix = when {
            lineStart != null && lineEnd != null && lineEnd > lineStart -> "#L$lineStart-L$lineEnd"
            lineStart != null -> "#L$lineStart"
            else -> ""
        }
        return if (clean.none { it.isWhitespace() }) "@$clean$suffix" else "@\"$clean\"$suffix"
    }
}

val LocalFileOpen = compositionLocalOf<((FileTarget) -> Unit)?> { null }

private val KNOWN_EXT = setOf(
    "kt", "kts", "java", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx",
    "py", "rs", "go", "c", "cc", "cpp", "h", "hpp", "cs", "swift", "rb", "php", "lua", "zig",
    "sh", "bash", "zsh", "ps1", "bat", "yaml", "yml", "toml", "xml", "html", "htm", "css",
    "scss", "sql", "graphql", "gql", "proto", "gradle", "properties", "txt", "vue", "svelte",
)

private val KNOWN_FILENAMES = setOf("Dockerfile", "Makefile", "AGENTS.md", "CLAUDE.md", "README.md", "Cargo.toml", "package.json")

private val FRAGMENT_LINES = Regex("""^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$""", RegexOption.IGNORE_CASE)
private val COLON_LINES = Regex("""^(.+?):(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?$""")
private val PAREN_LINES = Regex("""^(.+?)\((\d+)(?:,\d+)?(?:-(\d+)(?:,\d+)?)?\)$""")

/**
 * Parse a workspace file reference like `src/main/rpc.ts:142`, `App.kt#L10-L25`, `foo.py(88)`,
 * or `file:///work/repo/src/a.ts#L12`. Returns null for URLs, commands, flags, or non-path tokens.
 */
fun parseFileTarget(rawInput: String, projectRoot: String? = null): FileTarget? {
    var raw = rawInput.trim().removeSurrounding("`").removeSurrounding("\"").removeSurrounding("'")
    if (raw.isEmpty() || raw.length > 400 || raw.any { it.isWhitespace() || it == '\n' }) return null

    val lower = raw.lowercase()
    if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("www.") ||
        lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("pidesk:")
    ) return null

    if (lower.startsWith("file://")) {
        raw = raw.removePrefix("file://").removePrefix("FILE://")
        // Windows file:///D:/foo -> D:/foo
        if (raw.length >= 3 && raw[0] == '/' && raw[2] == ':') raw = raw.substring(1)
    }

    var lineStart: Int? = null
    var lineEnd: Int? = null

    val hashIdx = raw.lastIndexOf('#')
    if (hashIdx > 0) {
        val frag = raw.substring(hashIdx + 1)
        val m = FRAGMENT_LINES.matchEntire(frag) ?: return null
        raw = raw.substring(0, hashIdx)
        lineStart = m.groupValues[1].toIntOrNull()
        lineEnd = m.groupValues[2].takeIf { it.isNotEmpty() }?.toIntOrNull()
    } else {
        // Avoid treating Windows drive `D:/foo` colon at index 1 as a line suffix.
        val colonMatch = COLON_LINES.matchEntire(raw)
        if (colonMatch != null && colonMatch.groupValues[1].length > 2) {
            raw = colonMatch.groupValues[1]
            lineStart = colonMatch.groupValues[2].toIntOrNull()
            lineEnd = colonMatch.groupValues[3].takeIf { it.isNotEmpty() }?.toIntOrNull()
        } else {
            val parenMatch = PAREN_LINES.matchEntire(raw)
            if (parenMatch != null) {
                raw = parenMatch.groupValues[1]
                lineStart = parenMatch.groupValues[2].toIntOrNull()
                lineEnd = parenMatch.groupValues[3].takeIf { it.isNotEmpty() }?.toIntOrNull()
            }
        }
    }

    var normalized = raw.replace('\\', '/').trim().removePrefix("./")
    if (normalized.isEmpty() || normalized.startsWith("-") || normalized.startsWith("@") || normalized.contains("..")) return null

    if (!projectRoot.isNullOrBlank()) {
        val rootNorm = projectRoot.replace('\\', '/').trimEnd('/')
        if (rootNorm.isNotEmpty() && normalized.startsWith("$rootNorm/", ignoreCase = true)) {
            normalized = normalized.substring(rootNorm.length + 1)
        }
    }

    val fileName = normalized.substringAfterLast('/')
    if (fileName.isEmpty()) return null
    val ext = fileName.substringAfterLast('.', "").lowercase()
    val hasValidExt = ext in KNOWN_EXT || fileName in KNOWN_FILENAMES
    if (!hasValidExt) return null

    // Reject domain-like strings (`github.com/foo/bar.git` or `example.ts` with no slash unless known ext/line).
    val firstSeg = normalized.substringBefore('/')
    if (firstSeg.contains('.') && normalized.contains('/') && firstSeg.substringAfterLast('.').lowercase() in setOf("com", "org", "net", "io", "dev", "gg", "ai", "uk")) {
        return null
    }

    val start = lineStart?.takeIf { it > 0 }
    val end = lineEnd?.takeIf { start != null && it >= start }
    return FileTarget(path = normalized, lineStart = start, lineEnd = end)
}
