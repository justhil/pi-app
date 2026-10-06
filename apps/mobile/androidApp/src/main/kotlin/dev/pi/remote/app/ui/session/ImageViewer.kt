package dev.pi.remote.app.ui.session

import android.content.Intent
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import dev.pi.remote.R
import dev.pi.remote.app.data.ImageSource
import dev.pi.remote.app.data.LocalAttachmentImages
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.IconAction
import kotlinx.coroutines.launch

private const val MAX_ZOOM = 5f

/** Full-screen images: swipe between them, pinch or double-tap to zoom, pan while zoomed, share. */
@Composable
fun ImageViewer(images: List<ImageSource>, start: Int, onDismiss: () -> Unit) {
    val loader = LocalAttachmentImages.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pager = rememberPagerState(initialPage = start.coerceIn(0, (images.size - 1).coerceAtLeast(0))) { images.size }
    var zoomed by remember { mutableStateOf(false) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, beyondViewportPageCount = 1, key = { images[it].toString() }) { page ->
                val src = images[page]
                val bitmap by produceState<ImageBitmap?>(null, src) { value = loader?.full(src) }
                ZoomableImage(bitmap, onZoomed = { if (page == pager.currentPage) zoomed = it }, onTap = onDismiss)
            }
            // Scrim keeps the white controls readable over light or zoomed-in images.
            Row(Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.4f)).systemBarsPadding().heightIn(min = 52.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconAction(PiIcons.X, stringResource(R.string.close), onDismiss, tint = Color.White)
                Text(
                    if (images.size > 1) "${pager.currentPage + 1} / ${images.size}" else "",
                    style = Pi.t.secondary.copy(color = Color.White.copy(alpha = 0.8f)),
                    modifier = Modifier.weight(1f).padding(start = 6.dp),
                )
                IconAction(PiIcons.Share, stringResource(R.string.msg_share), {
                    scope.launch {
                        val uri = when (val src = images[pager.currentPage]) {
                            is ImageSource.Local -> src.uri
                            is ImageSource.Remote -> loader?.file(src)?.let { FileProvider.getUriForFile(context, "${context.packageName}.files", it) }
                        } ?: return@launch
                        val send = Intent(Intent.ACTION_SEND).setType("image/*").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        context.startActivity(Intent.createChooser(send, null))
                    }
                }, tint = Color.White)
            }
        }
    }
}

@Composable
private fun ZoomableImage(bitmap: ImageBitmap?, onZoomed: (Boolean) -> Unit, onTap: () -> Unit) {
    val scale = remember { Animatable(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(scale.value > 1.01f) { onZoomed(scale.value > 1.01f) }

    fun clamp(o: Offset, s: Float): Offset {
        val maxX = (size.width * (s - 1)) / 2
        val maxY = (size.height * (s - 1)) / 2
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    Box(
        Modifier.fillMaxSize()
            .onSizeChanged { size = it }
            .pointerInput(bitmap) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { at ->
                        scope.launch {
                            if (scale.value > 1.01f) {
                                offset = Offset.Zero
                                scale.animateTo(1f)
                            } else {
                                val target = 2.5f
                                val center = Offset(size.width / 2f, size.height / 2f)
                                offset = clamp((center - at) * (target - 1), target)
                                scale.animateTo(target)
                            }
                        }
                    },
                )
            }
            .pointerInput(bitmap) {
                // Pinch anywhere; pan only while zoomed so a plain swipe still pages.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val zoom = event.calculateZoom()
                        val pan = event.calculatePan()
                        val multi = event.changes.count { it.pressed } > 1
                        if (multi || scale.value > 1.01f) {
                            val s = (scale.value * zoom).coerceIn(1f, MAX_ZOOM)
                            scope.launch { scale.snapTo(s) }
                            offset = clamp(offset + pan, s)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                    if (scale.value < 1.01f) offset = Offset.Zero
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap, null, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                    translationX = offset.x
                    translationY = offset.y
                },
            )
        } else {
            Text("…", style = Pi.t.body.copy(color = Color.White.copy(alpha = 0.6f)))
        }
    }
}
