package dev.pi.remote.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner

class PiRemoteApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        dev.pi.remote.app.ui.rich.NativeMath.init(this)
        // The first WebView in a process loads the Chromium provider (~100-300ms on the main thread).
        // Pay that while idle at startup instead of when the first formula/HTML block scrolls in.
        android.os.Looper.myQueue().addIdleHandler {
            runCatching { android.webkit.WebView(this).destroy() }
            false
        }
        // Connected only while visible; the repository keeps a 30 s grace after backgrounding.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = graph.repository.onForeground()
            override fun onStop(owner: LifecycleOwner) = graph.repository.onBackground()
        })
    }
}
