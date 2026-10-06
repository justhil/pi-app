package dev.pi.remote.protocol

import kotlinx.serialization.Serializable

/** Mirrors packages/shared/remote/pairing.ts. */

const val PAIR_LINK_PREFIX = "pidesk://pair#"

@Serializable
data class PairOffer(
    val v: Int,
    val hostId: String,
    val hostName: String,
    val hostPub: String,
    val endpoints: List<String>,
    val pairToken: String,
    val exp: Long,
)

class PairLinkException(message: String) : Exception(message)

object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    private val lookup = IntArray(128) { -1 }.also { t -> ALPHABET.forEachIndexed { i, c -> t[c.code] = i } }

    fun encode(bytes: ByteArray): String {
        val sb = StringBuilder((bytes.size * 4 + 2) / 3)
        var i = 0
        while (i + 2 < bytes.size) {
            val n = (bytes[i].toInt() and 0xff shl 16) or (bytes[i + 1].toInt() and 0xff shl 8) or (bytes[i + 2].toInt() and 0xff)
            sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63]).append(ALPHABET[n shr 6 and 63]).append(ALPHABET[n and 63])
            i += 3
        }
        val rest = bytes.size - i
        if (rest == 1) {
            val n = bytes[i].toInt() and 0xff shl 16
            sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63])
        } else if (rest == 2) {
            val n = (bytes[i].toInt() and 0xff shl 16) or (bytes[i + 1].toInt() and 0xff shl 8)
            sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63]).append(ALPHABET[n shr 6 and 63])
        }
        return sb.toString()
    }

    fun decode(text: String): ByteArray {
        val s = text.trimEnd('=').replace('+', '-').replace('/', '_')
        val out = ArrayList<Byte>(s.length * 3 / 4)
        var buf = 0
        var bits = 0
        for (c in s) {
            val v = if (c.code < 128) lookup[c.code] else -1
            if (v < 0) throw PairLinkException("invalid base64url")
            buf = buf shl 6 or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.add((buf shr bits and 0xff).toByte())
            }
        }
        return out.toByteArray()
    }
}

object Pairing {
    /** Null when the text is not a pair link; throws [PairLinkException] when it is one but invalid. */
    fun decodeLink(text: String): PairOffer? {
        val trimmed = text.trim()
        if (!trimmed.startsWith(PAIR_LINK_PREFIX)) return null
        val json = Base64Url.decode(trimmed.removePrefix(PAIR_LINK_PREFIX)).decodeToString(throwOnInvalidSequence = true)
        val offer = try {
            RemoteJson.decodeFromString(PairOffer.serializer(), json)
        } catch (e: Exception) {
            throw PairLinkException("malformed pair offer")
        }
        if (offer.v != 1) throw PairLinkException("unsupported pair link version")
        if (offer.pairToken.length < 16 || offer.endpoints.isEmpty()) throw PairLinkException("incomplete pair offer")
        val allowed = offer.endpoints.filter(::isAllowedEndpoint)
        if (allowed.isEmpty()) throw PairLinkException("no private-network endpoint")
        return offer.copy(endpoints = allowed)
    }

    fun encodeLink(offer: PairOffer): String =
        PAIR_LINK_PREFIX + Base64Url.encode(RemoteJson.encodeToString(PairOffer.serializer(), offer).encodeToByteArray())

    private fun ipv4(host: String): List<Int>? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        val nums = parts.map { p -> if (p.isEmpty() || p.length > 3 || !p.all(Char::isDigit)) return null else p.toInt() }
        return if (nums.all { it in 0..255 }) nums else null
    }

    /** Tailscale MagicDNS names (`pc.tail1234.ts.net`), mirrored from `pairing.ts`. */
    private val tailnetName = Regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\\.ts\\.net\\.?$")

    /** RFC 1918, CGNAT (overlay VPNs), loopback, link-local, IPv6 ULA / link-local, MagicDNS names. */
    fun isPrivateHost(host: String): Boolean {
        val h = host.removePrefix("[").removeSuffix("]").lowercase()
        if (tailnetName.matches(h)) return true
        ipv4(h)?.let { (a, b) ->
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 100 && b in 64..127) || (a == 169 && b == 254)
        }
        if (!h.contains(':')) return false
        return h == "::1" || Regex("^f[cd][0-9a-f]{2}:").containsMatchIn(h) || Regex("^fe[89ab][0-9a-f]:").containsMatchIn(h)
    }

    /** `ws://host:port` with a private host. */
    fun isAllowedEndpoint(endpoint: String): Boolean {
        val m = Regex("^ws://(\\[[^\\]]+]|[^:/]+):(\\d{1,5})/?$").matchEntire(endpoint) ?: return false
        val port = m.groupValues[2].toInt()
        return port in 1..65535 && isPrivateHost(m.groupValues[1])
    }
}
