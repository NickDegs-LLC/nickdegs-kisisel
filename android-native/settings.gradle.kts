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
        maven { url = uri("https://jitpack.io") }   // LiveKit transitive: com.github.davidliu:audioswitch
    }
}
rootProject.name = "MoveLog"
include(":app")
include(":wear")   // Wear OS (Samsung Galaxy Watch / Wear OS 3+) — bilekten rota kaydı + nabız
