package dev.pi.remote.app

import dev.pi.remote.app.data.SavedHost
import dev.pi.remote.app.ui.hosts.manualEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ManualEndpointTest {
    @Test fun acceptsOverlayAndLanAddresses() {
        assertEquals("ws://100.101.1.2:47900", manualEndpoint(" 100.101.1.2:47900 "))
        assertEquals("ws://pc.tail1234.ts.net:47900", manualEndpoint("ws://pc.tail1234.ts.net:47900/"))
        assertEquals("ws://192.168.1.5:47900", manualEndpoint("192.168.1.5:47900"))
    }

    @Test fun rejectsPublicHostsAndMissingPort() {
        assertNull(manualEndpoint("8.8.8.8:47900"))
        assertNull(manualEndpoint("example.com:47900"))
        assertNull(manualEndpoint("100.101.1.2"))
        assertNull(manualEndpoint(""))
    }

    @Test fun manualAddressesAreProbedAfterKnownOnes() {
        val h = SavedHost("h", "pc", "k", listOf("ws://192.168.1.5:1", "ws://10.0.0.2:1"), "d", "operator", manualEndpoints = listOf("ws://100.101.1.2:1", "ws://10.0.0.2:1"))
        assertEquals(listOf("ws://192.168.1.5:1", "ws://10.0.0.2:1", "ws://100.101.1.2:1"), h.allEndpoints)
    }
}
