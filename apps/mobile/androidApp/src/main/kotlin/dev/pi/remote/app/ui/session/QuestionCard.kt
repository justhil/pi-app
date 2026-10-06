package dev.pi.remote.app.ui.session

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.PrimaryButton
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.protocol.UiAskQuestions
import dev.pi.remote.protocol.UiConfirm
import dev.pi.remote.protocol.UiEditor
import dev.pi.remote.protocol.UiImageReview
import dev.pi.remote.protocol.UiInput
import dev.pi.remote.protocol.UiRequest
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.protocol.UiSelect
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val IMAGE_CHOICES = listOf("approve", "revise", "reject", "cancel")

/**
 * Docked card that replaces the composer while pi waits for an answer. Answers use the exact
 * payloads the desktop dialogs send (extension-ui-host.tsx), so the worker cannot tell them apart.
 */
@Composable
fun QuestionCard(req: UiRequest, enabled: Boolean, onAnswer: (UiResponse) -> Unit, onSkip: () -> Unit, onDesktop: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp)).background(Pi.c.bg)
            .border(1.dp, Pi.c.line, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
            .heightIn(max = 520.dp).verticalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            PiIcon(PiIcons.Question, Pi.c.fg3, 13.dp)
            Spacer(Modifier.width(7.dp))
            Text(stringResource(R.string.question_title), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
        }
        when (req) {
            is UiSelect -> SelectBody(req.title, req.options, enabled) { onAnswer(UiResponse(req.id, value = it)) }
            is UiConfirm -> ConfirmBody(req, enabled) { onAnswer(UiResponse(req.id, confirmed = it)) }
            is UiInput -> TextBody(req.title, req.placeholder, "", multiline = false, enabled) { onAnswer(UiResponse(req.id, value = it)) }
            is UiEditor -> TextBody(req.title, null, req.prefill.orEmpty(), multiline = true, enabled) { onAnswer(UiResponse(req.id, value = it)) }
            is UiAskQuestions -> AskBody(req, enabled, onAnswer)
            is UiImageReview -> ImageReviewBody(req, enabled, onAnswer)
            else -> Text(stringResource(R.string.question_unsupported), style = Pi.t.body.copy(color = Pi.c.fg2), modifier = Modifier.padding(horizontal = 6.dp))
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            QuietButton(stringResource(R.string.question_desktop), onDesktop, icon = PiIcons.Monitor, color = Pi.c.fg3)
            Spacer(Modifier.weight(1f))
            QuietButton(stringResource(R.string.question_skip), onSkip, enabled = enabled)
        }
    }
}

@Composable
private fun Prompt(text: String) = Text(text, style = Pi.t.body.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 6.dp))

@Composable
private fun OptionRow(label: String, description: String?, selected: Boolean, multi: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (selected) Pi.c.surface else Pi.c.bg)
            .clickable(role = if (multi) Role.Checkbox else Role.RadioButton, onClick = onClick).padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.Top,
    ) {
        val shape = if (multi) RoundedCornerShape(4.dp) else CircleShape
        Box(
            Modifier.padding(top = 2.dp).size(16.dp).clip(shape).then(
                if (selected) Modifier.background(Pi.c.fg) else Modifier.border(1.5.dp, Pi.c.fg3, shape),
            ),
            contentAlignment = Alignment.Center,
        ) {
            if (selected && multi) PiIcon(PiIcons.Check, Pi.c.bg, 11.dp)
            else if (selected) Box(Modifier.size(6.dp).clip(CircleShape).background(Pi.c.bg))
        }
        Spacer(Modifier.width(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = Pi.t.body.copy(color = Pi.c.fg))
            description?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.fg3)) }
        }
    }
}

@Composable
private fun InputBox(value: String, onChange: (String) -> Unit, placeholder: String, multiline: Boolean) {
    Box(Modifier.fillMaxWidth().heightIn(min = if (multiline) 96.dp else 44.dp).clip(RoundedCornerShape(12.dp)).background(Pi.c.surface).padding(horizontal = 14.dp, vertical = 11.dp)) {
        if (value.isEmpty()) Text(placeholder, style = Pi.t.body.copy(color = Pi.c.fg3))
        BasicTextField(value, onChange, textStyle = Pi.t.body.copy(color = Pi.c.fg), cursorBrush = SolidColor(Pi.c.fg), singleLine = !multiline, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun SubmitRow(enabled: Boolean, onSubmit: () -> Unit) {
    Row(Modifier.fillMaxWidth()) {
        Spacer(Modifier.weight(1f))
        PrimaryButton(stringResource(R.string.question_submit), onSubmit, enabled = enabled)
    }
}

@Composable
private fun SelectBody(title: String, options: List<String>, enabled: Boolean, onPick: (String) -> Unit) {
    var picked by remember { mutableStateOf<String?>(null) }
    Prompt(title)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) { options.forEach { o -> OptionRow(o, null, picked == o, false) { picked = o } } }
    SubmitRow(enabled && picked != null) { picked?.let(onPick) }
}

@Composable
private fun ConfirmBody(req: UiConfirm, enabled: Boolean, onDecide: (Boolean) -> Unit) {
    Prompt(req.title)
    Text(req.message, style = Pi.t.secondary.copy(color = Pi.c.fg2), modifier = Modifier.padding(horizontal = 6.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        QuietButton(stringResource(R.string.confirm_no), { onDecide(false) }, enabled = enabled)
        Spacer(Modifier.width(6.dp))
        PrimaryButton(stringResource(R.string.confirm_yes), { onDecide(true) }, enabled = enabled)
    }
}

@Composable
private fun TextBody(title: String, placeholder: String?, initial: String, multiline: Boolean, enabled: Boolean, onSubmit: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    Prompt(title)
    InputBox(text, { text = it }, placeholder ?: stringResource(R.string.question_input_hint), multiline)
    SubmitRow(enabled && (multiline || text.isNotBlank())) { onSubmit(text) }
}

/** One question's in-progress answer (desktop `QuestionDraft`). */
private data class Draft(val selected: List<String> = emptyList(), val custom: String = "", val useCustom: Boolean = false) {
    val answered get() = if (useCustom) custom.isNotBlank() else selected.isNotEmpty()
}

/** Drafts survive "answer on desktop / later": the card unmounts and comes back (desktop `saveDrafts`). */
private object QuestionDrafts {
    private val map = LinkedHashMap<String, List<Draft>>()
    fun load(id: String, n: Int): List<Draft> = List(n) { map[id]?.getOrNull(it) ?: Draft() }
    fun save(id: String, d: List<Draft>) {
        map.remove(id)
        map[id] = d
        if (map.size > 20) map.remove(map.keys.first())
    }
    fun clear(id: String) = map.remove(id)
}

private const val AUTO_ADVANCE_MS = 240L

/**
 * Multi-page questionnaire, same behaviour as the desktop's questionnaire-dialog: step tabs with
 * answered marks (tap to jump), opens on the first unanswered question, single-choice answers
 * advance on their own, submit sends you to anything still open, drafts outlive "later". Swipe
 * sideways to change question.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AskBody(req: UiAskQuestions, enabled: Boolean, onAnswer: (UiResponse) -> Unit) {
    val qs = req.questions
    var drafts by remember(req.id) { mutableStateOf(QuestionDrafts.load(req.id, qs.size)) }
    var tab by remember(req.id) { mutableStateOf(drafts.indexOfFirst { !it.answered }.coerceAtLeast(0)) }
    var forward by remember { mutableStateOf(true) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    var advance by remember { mutableStateOf<Job?>(null) }
    val many = qs.size > 1
    val unansweredText = stringResource(R.string.question_unanswered)

    fun goTo(i: Int) {
        advance?.cancel()
        if (i == tab || i !in qs.indices) return
        forward = i > tab
        tab = i
        notice = null
    }
    fun update(d: Draft) {
        drafts = drafts.toMutableList().also { it[tab] = d }
        QuestionDrafts.save(req.id, drafts)
        notice = null
    }
    fun submit() {
        advance?.cancel()
        val open = drafts.indices.filter { !drafts[it].answered }
        if (open.isNotEmpty()) {
            if (open[0] != tab) goTo(open[0])
            notice = unansweredText.format(open.size)
            return
        }
        QuestionDrafts.clear(req.id)
        val answers = JsonArray(qs.mapIndexed { i, q ->
            val d = drafts[i]
            buildJsonObject {
                put("questionIndex", i)
                put("question", q.question)
                when {
                    d.useCustom && d.custom.isNotBlank() -> {
                        put("kind", "custom")
                        put("answer", d.custom.trim())
                    }
                    q.multiSelect == true -> {
                        put("kind", "multi")
                        put("answer", JsonNull)
                        // Keep the extension's option order, not the tap order.
                        put("selected", JsonArray(q.options.map { it.label }.filter { it in d.selected }.map { JsonPrimitive(it) }))
                    }
                    else -> {
                        put("kind", "option")
                        d.selected.firstOrNull()?.let { put("answer", it) } ?: put("answer", JsonNull)
                    }
                }
            }
        })
        onAnswer(UiResponse(req.id, result = buildJsonObject { put("cancelled", false); put("answers", answers) }))
    }

    if (many) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                qs.forEachIndexed { i, q ->
                    val current = i == tab
                    val answered = drafts[i].answered
                    Column(
                        Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Tab) { goTo(i) }.padding(horizontal = 8.dp, vertical = 6.dp).widthIn(max = 140.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (answered) {
                                PiIcon(PiIcons.Check, if (current) Pi.c.fg else Pi.c.fg3, 11.dp)
                                Spacer(Modifier.width(3.dp))
                            }
                            Text(
                                q.header?.takeIf { it.isNotBlank() } ?: "${i + 1}",
                                style = Pi.t.meta.copy(color = if (current) Pi.c.fg else if (answered) Pi.c.fg2 else Pi.c.fg3),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Box(Modifier.padding(top = 4.dp).fillMaxWidth().height(1.5.dp).background(if (current) Pi.c.fg else Color.Transparent))
                    }
                }
            }
            Text("${tab + 1} / ${qs.size}", style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(start = 6.dp, end = 6.dp))
        }
    }

    AnimatedContent(
        targetState = tab,
        transitionSpec = {
            val dir = if (forward) 1 else -1
            (slideInHorizontally(tween(200)) { it / 6 * dir } + fadeIn(tween(160))) togetherWith fadeOut(tween(100))
        },
        label = "question",
        modifier = Modifier.pointerInput(qs.size) {
            var dx = 0f
            detectHorizontalDragGestures(onDragStart = { dx = 0f }, onDragEnd = {
                if (dx < -60.dp.toPx()) goTo(tab + 1) else if (dx > 60.dp.toPx()) goTo(tab - 1)
            }) { _, d -> dx += d }
        },
    ) { i ->
        val q = qs[i]
        val d = drafts[i]
        val multi = q.multiSelect == true
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!many) q.header?.takeIf { it.isNotBlank() }?.let { Text(it, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 6.dp)) }
            Prompt(q.question)
            if (multi) Text(stringResource(R.string.question_multi_hint), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 6.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (o in q.options) {
                    OptionRow(o.label, o.description, o.label in d.selected && !d.useCustom, multi) {
                        val next = if (multi) {
                            d.copy(selected = if (o.label in d.selected) d.selected - o.label else d.selected + o.label, useCustom = false)
                        } else {
                            d.copy(selected = listOf(o.label), useCustom = false)
                        }
                        update(next)
                        if (!multi && i < qs.lastIndex) {
                            advance?.cancel()
                            advance = scope.launch {
                                delay(AUTO_ADVANCE_MS)
                                goTo(i + 1)
                            }
                        }
                    }
                }
                OptionRow(stringResource(R.string.question_other), stringResource(R.string.question_other_desc), d.useCustom, false) {
                    update(d.copy(useCustom = true, selected = if (multi) emptyList() else d.selected))
                }
            }
            if (d.useCustom) InputBox(d.custom, { update(d.copy(custom = it, useCustom = true)) }, stringResource(R.string.question_input_hint), false)
            // Option previews (desktop shows them beside the list; here below it).
            val preview = q.options.firstOrNull { it.label == d.selected.firstOrNull() && !it.preview.isNullOrEmpty() }?.preview
            if (!multi && preview != null) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(10.dp)) {
                    Text(stringResource(R.string.question_preview), style = Pi.t.small.copy(color = Pi.c.fg3))
                    Spacer(Modifier.height(4.dp))
                    Text(preview, style = Pi.t.monoSmall.copy(color = Pi.c.fg), modifier = Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState()))
                }
            }
        }
    }

    notice?.let { Text(it, style = Pi.t.meta.copy(color = Pi.c.warn), textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp)) }
    val last = tab == qs.lastIndex
    Row(Modifier.fillMaxWidth()) {
        if (tab > 0) QuietButton(stringResource(R.string.detail_prev), { goTo(tab - 1) })
        Spacer(Modifier.weight(1f))
        PrimaryButton(if (last) stringResource(R.string.question_submit) else stringResource(R.string.detail_next), { if (last) submit() else goTo(tab + 1) }, enabled = enabled)
    }
}

@Composable
private fun ImageReviewBody(req: UiImageReview, enabled: Boolean, onAnswer: (UiResponse) -> Unit) {
    var picked by remember { mutableStateOf<Int?>(null) }
    var feedback by remember { mutableStateOf("") }
    val bitmap = remember(req.image) {
        runCatching {
            val b64 = req.image.substringAfter("base64,", req.image)
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }
    Prompt(req.title)
    bitmap?.let { Image(it, contentDescription = req.title, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp).clip(RoundedCornerShape(10.dp))) }
    Text(req.question, style = Pi.t.secondary.copy(color = Pi.c.fg2), modifier = Modifier.padding(horizontal = 6.dp))
    req.context?.let { Text(it, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 6.dp)) }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) { req.options.forEachIndexed { i, o -> OptionRow(o, null, picked == i, false) { picked = i } } }
    if (req.allowFeedback) InputBox(feedback, { feedback = it }, stringResource(R.string.question_feedback), multiline = false)
    SubmitRow(enabled && picked != null) {
        val i = picked ?: return@SubmitRow
        onAnswer(UiResponse(req.id, result = buildJsonObject {
            put("choice", IMAGE_CHOICES.getOrElse(i) { "approve" })
            put("label", req.options[i])
            if (req.allowFeedback && feedback.isNotBlank()) put("feedback", feedback)
        }))
    }
}
