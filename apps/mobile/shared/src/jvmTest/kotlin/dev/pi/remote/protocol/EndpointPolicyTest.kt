package dev.pi.remote.protocol

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EndpointPolicyTest {
    @Test fun privateEndpointsStayPrivateOnly() {
        assertTrue(Pairing.isAllowedEndpoint("ws://192.168.1.5:47900"))
        assertTrue(Pairing.isAllowedEndpoint("ws://[fe80::1%wlan0]:47900"))
        assertFalse(Pairing.isAllowedEndpoint("ws://203.0.113.7:7000"))
        assertFalse(Pairing.isAllowedEndpoint("ws://pi.example.com:7000"))
    }

    @Test fun publicEndpointsTakeAnyIpOrDnsName() {
        assertTrue(Pairing.isPublicEndpoint("ws://203.0.113.7:7000"))
        assertTrue(Pairing.isPublicEndpoint("ws://pi.example.com:7000/"))
        assertTrue(Pairing.isPublicEndpoint("ws://[2001:db8::1]:7000"))
        assertFalse(Pairing.isPublicEndpoint("ws://pi.example.com"))
        assertFalse(Pairing.isPublicEndpoint("ws://pi.example.com:0"))
        assertFalse(Pairing.isPublicEndpoint("ws://pi.example.com:70000"))
        assertFalse(Pairing.isPublicEndpoint("ws://pi example.com:7000"))
        assertFalse(Pairing.isPublicEndpoint("ws://-pi.example.com:7000"))
        assertFalse(Pairing.isPublicEndpoint("wss://pi.example.com:7000"))
    }

    @Test fun pairLinksStillRejectPublicEndpoints() {
        val offer = PairOffer(1, "h", "pc", "k", listOf("ws://203.0.113.7:7000"), "t".repeat(16), 0)
        val error = runCatching { Pairing.decodeLink(Pairing.encodeLink(offer)) }.exceptionOrNull()
        assertTrue(error is PairLinkException)
    }
}
