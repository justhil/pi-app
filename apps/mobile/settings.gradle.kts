pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // AndroidMath (MIT, native LaTeX typesetting) is only published on JitPack; nothing else may resolve there.
        maven("https://jitpack.io") { content { includeGroup("com.github.gregcockroft") } }
    }
}

rootProject.name = "pi-remote"
include(":shared", ":androidApp")
