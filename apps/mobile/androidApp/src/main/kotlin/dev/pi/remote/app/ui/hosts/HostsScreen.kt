package dev.pi.remote.app.ui.hosts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import androidx.activity.compose.rememberLauncherForActivityResult
import dev.pi.remote.R
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.data.SavedHost
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.PrimaryButton
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.PairLinkException
import dev.pi.remote.protocol.Pairing
import kotlinx.coroutines.launch

@Composable
private fun pairErrorText(code: String): String = when (code) {
    "pair_expired" -> stringResource(R.string.pair_err_pair_expired)
    "pair_used" -> stringResource(R.string.pair_err_pair_used)
    "revoked" -> stringResource(R.string.pair_err_revoked)
    "unpaired" -> stringResource(R.string.pair_err_unpaired)
    "invalid" -> stringResource(R.string.pair_err_invalid)
    else -> stringResource(R.string.pair_err_unreachable)
}

/** Pairing: scan or paste a `pidesk://pair#…` link; list saved computers. */
@Composable
fun HostsScreen(repo: RemoteRepository, incomingLink: String?, onLinkConsumed: () -> Unit, onOpenHost: () -> Unit) {
    val hosts by repo.hosts.collectAsState()
    val active by repo.active.collectAsState()
    val connection by repo.connection.collectAsState()
    val scope = rememberCoroutineScope()
    var pairing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pasteOpen by remember { mutableStateOf(false) }
    var addressesOf by remember { mutableStateOf<String?>(null) }
    val scanPrompt = stringResource(R.string.hosts_scan_prompt)

    fun pairWith(text: String) {
        val offer = try {
            Pairing.decodeLink(text)
        } catch (e: PairLinkException) {
            error = "invalid"
            return
        } ?: run {
            error = "invalid"
            return
        }
        pairing = true
        error = null
        scope.launch {
            repo.pair(offer).onSuccess { onOpenHost() }.onFailure { error = it.message ?: "unreachable" }
            pairing = false
        }
    }

    LaunchedEffect(incomingLink) {
        if (incomingLink != null) {
            onLinkConsumed()
            pairWith(incomingLink)
        }
    }

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result -> result.contents?.let(::pairWith) }

    Column(Modifier.fillMaxSize().background(Pi.c.bg).verticalScroll(rememberScrollState()).padding(bottom = 20.dp)) {
        Row(Modifier.height(56.dp).padding(horizontal = 22.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("pi", style = Pi.t.title.copy(color = Pi.c.fg))
            Spacer(Modifier.width(6.dp))
            Text("Remote", style = Pi.t.title.copy(color = Pi.c.fg3, fontWeight = null))
        }
        Column(Modifier.padding(start = 22.dp, end = 22.dp, top = 48.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.hosts_title), style = Pi.t.heading.copy(color = Pi.c.fg))
            Text(stringResource(R.string.hosts_desc), style = Pi.t.body.copy(color = Pi.c.fg2, fontSize = Pi.t.secondary.fontSize.times(1.1f)))
        }
        Column(Modifier.padding(start = 22.dp, end = 22.dp, top = 28.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            PrimaryButton(
                stringResource(R.string.hosts_scan),
                onClick = {
                    scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt(scanPrompt).setBeepEnabled(false).setOrientationLocked(true))
                },
                icon = PiIcons.Scan,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                enabled = !pairing,
            )
            QuietButton(stringResource(R.string.hosts_paste), onClick = { pasteOpen = !pasteOpen }, modifier = Modifier.align(Alignment.CenterHorizontally), enabled = !pairing)
            if (pasteOpen) PasteField(onSubmit = ::pairWith)
            if (pairing) {
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Spinner()
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.hosts_pairing), style = Pi.t.secondary.copy(color = Pi.c.fg2))
                }
            }
            error?.let { Text(pairErrorText(it), style = Pi.t.secondary.copy(color = Pi.c.bad), modifier = Modifier.padding(top = 6.dp)) }
        }
        if (hosts.isNotEmpty()) {
            Text(stringResource(R.string.hosts_saved), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 22.dp, top = 40.dp, bottom = 6.dp))
            Hairline()
            for (h in hosts) {
                HostRow(h, online = h.hostId == active?.hostId && connection is HostConnection.State.Ready, onClick = {
                    repo.select(h.hostId)
                    onOpenHost()
                }, onForget = { repo.forget(h.hostId) }, addressesOpen = addressesOf == h.hostId, onAddresses = {
                    addressesOf = if (addressesOf == h.hostId) null else h.hostId
                })
                if (addressesOf == h.hostId) AddressEditor(h, onChange = { repo.setManualEndpoints(h.hostId, it) })
                Hairline()
            }
        }
        Spacer(Modifier.height(32.dp))
        Row(Modifier.padding(horizontal = 22.dp), verticalAlignment = Alignment.Top) {
            PiIcon(PiIcons.Lock, Pi.c.fg3, 13.dp, Modifier.padding(top = 2.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.hosts_footer), style = Pi.t.meta.copy(color = Pi.c.fg3))
        }
    }
}

@Composable
private fun PasteField(onSubmit: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val shape = RoundedCornerShape(12.dp)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(shape).background(Pi.c.surface).padding(horizontal = 14.dp, vertical = 12.dp)) {
            if (text.isEmpty()) Text(stringResource(R.string.hosts_paste_hint), style = Pi.t.secondary.copy(color = Pi.c.fg3, fontFamily = FontFamily.Monospace))
            BasicTextField(text, { text = it }, textStyle = Pi.t.secondary.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace), cursorBrush = SolidColor(Pi.c.fg), modifier = Modifier.fillMaxWidth())
        }
        QuietButton(stringResource(R.string.hosts_paste_confirm), onClick = { onSubmit(text) }, enabled = text.isNotBlank(), color = Pi.c.fg, modifier = Modifier.align(Alignment.End))
    }
}

@Composable
private fun HostRow(h: SavedHost, online: Boolean, onClick: () -> Unit, onForget: () -> Unit, addressesOpen: Boolean, onAddresses: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 22.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        PiIcon(PiIcons.Monitor, Pi.c.fg3, 18.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(h.hostName, style = Pi.t.body.copy(color = if (online) Pi.c.fg else Pi.c.fg2))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (online) Box(Modifier.size(6.dp).clip(CircleShape).background(Pi.c.ok)) else Box(Modifier.size(6.dp).clip(CircleShape).border(1.5.dp, Pi.c.fg3, CircleShape))
                Spacer(Modifier.width(6.dp))
                val host = h.endpoints.firstOrNull()?.removePrefix("ws://").orEmpty()
                Text(
                    if (online) "$host · ${stringResource(R.string.hosts_connected)}" else stringResource(R.string.hosts_last_online, formatAgo(h.lastConnectedAt)),
                    style = Pi.t.meta.copy(color = Pi.c.fg3),
                )
            }
        }
        QuietButton(stringResource(R.string.hosts_addresses), onClick = onAddresses, color = if (addressesOpen) Pi.c.fg else Pi.c.fg3)
        QuietButton(stringResource(R.string.hosts_forget), onClick = onForget, color = Pi.c.fg3)
        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 16.dp)
    }
}

/** `host:port` typed by the user → `ws://host:port`, or null when it is not a private / overlay address. */
internal fun manualEndpoint(text: String): String? {
    val t = text.trim().removePrefix("ws://").removeSuffix("/")
    if (t.isEmpty()) return null
    val ep = "ws://$t"
    return ep.takeIf { Pairing.isAllowedEndpoint(it) }
}

/** The host's known addresses, plus the user's own (overlay VPN) ones, which can be added and removed. */
@Composable
private fun AddressEditor(h: SavedHost, onChange: (List<String>) -> Unit) {
    var text by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.fillMaxWidth().padding(start = 52.dp, end = 22.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.hosts_addresses_desc), style = Pi.t.meta.copy(color = Pi.c.fg3))
        for (ep in h.endpoints.filter { it !in h.manualEndpoints }) AddressLine(ep, stringResource(R.string.hosts_address_auto), null)
        for (ep in h.manualEndpoints) AddressLine(ep, stringResource(R.string.hosts_address_mine)) { onChange(h.manualEndpoints - ep) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).heightIn(min = 40.dp).clip(shape).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (text.isEmpty()) Text(stringResource(R.string.hosts_address_hint), style = Pi.t.secondary.copy(color = Pi.c.fg3, fontFamily = FontFamily.Monospace))
                BasicTextField(text, { text = it; invalid = false }, singleLine = true, textStyle = Pi.t.secondary.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace), cursorBrush = SolidColor(Pi.c.fg), modifier = Modifier.fillMaxWidth())
            }
            QuietButton(stringResource(R.string.hosts_address_add), enabled = text.isNotBlank(), color = Pi.c.fg, onClick = {
                val ep = manualEndpoint(text)
                if (ep == null) invalid = true else {
                    onChange(h.manualEndpoints + ep)
                    text = ""
                }
            })
        }
        if (invalid) Text(stringResource(R.string.hosts_address_invalid), style = Pi.t.meta.copy(color = Pi.c.bad))
    }
}

@Composable
private fun AddressLine(ep: String, label: String, onRemove: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(ep.removePrefix("ws://"), style = Pi.t.secondary.copy(color = Pi.c.fg2, fontFamily = FontFamily.Monospace), modifier = Modifier.weight(1f))
        Text(label, style = Pi.t.meta.copy(color = Pi.c.fg3))
        if (onRemove != null) QuietButton(stringResource(R.string.hosts_forget), onClick = onRemove, color = Pi.c.fg3)
    }
}
