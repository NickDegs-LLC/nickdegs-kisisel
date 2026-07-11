import SwiftUI

// Move Log Apple Watch — bilekten sürüş kaydı: canlı hız/mesafe/süre + NABIZ (HealthKit),
// rota noktaları telefondaki hesapla aynı Traccar cihazına akar (&hr= ile nabız dahil).
@main
struct MoveLogWatchApp: App {
    @StateObject private var link = WatchLink.shared
    @StateObject private var workout = WorkoutManager.shared
    var body: some Scene {
        WindowGroup {
            WatchContentView()
                .environmentObject(link)
                .environmentObject(workout)
        }
    }
}

// Basit TR/EN yerelleştirme (watch hedefi Strings.swift'i paylaşmıyor; v1 iki dil)
func WL(_ tr: String, _ en: String) -> String {
    (Locale.preferredLanguages.first ?? "en").hasPrefix("tr") ? tr : en
}
