package dev.pi.remote.app.data

import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * App language: `system` | `en` | `zh`. Android 13+ keeps it as the per-app locale (also editable in the
 * system's App languages page); older versions wrap each Context with the chosen locale.
 */
object AppLocale {
    const val PREFS = "ui"
    const val KEY = "language"

    fun tag(language: String): String? = when (language) {
        "en" -> "en"
        "zh" -> "zh-CN"
        else -> null
    }

    fun fromTag(tag: String?): String = when {
        tag.isNullOrEmpty() -> "system"
        tag.startsWith("zh") -> "zh"
        tag.startsWith("en") -> "en"
        else -> "system"
    }

    /** The current choice: the system's per-app locale on 13+, the saved preference before that. */
    fun read(context: Context): String =
        if (Build.VERSION.SDK_INT >= 33) {
            val locales = context.getSystemService(LocaleManager::class.java).applicationLocales
            fromTag(if (locales.isEmpty) null else locales[0].toLanguageTag())
        } else {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "system") ?: "system"
        }

    /** Apply a choice: 13+ recreates the activities itself; older versions need [wrap] + recreate. */
    fun apply(context: Context, language: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, language).apply()
        if (Build.VERSION.SDK_INT >= 33) {
            val tag = tag(language)
            context.getSystemService(LocaleManager::class.java).applicationLocales =
                if (tag == null) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(tag)
        }
    }

    /** Android 12 and older: a Context whose resources (and the default Locale) use the chosen language. */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= 33) return base
        val tag = tag(read(base)) ?: return base
        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocales(LocaleList(locale))
        return base.createConfigurationContext(config)
    }
}
