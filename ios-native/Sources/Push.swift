import SwiftUI
import UserNotifications
import BackgroundTasks

// İlk açılışta bildirim izni ister + APNs token alır (video hazır olunca push için)
final class AppDelegate: NSObject, UIApplicationDelegate {
    static let refreshId = "com.nickdegs.kisisel.refresh"   // BGTaskSchedulerPermittedIdentifiers ile aynı

    // Periyodik arka plan yenileme talebi ("Arka Plan Uygulama Yenileme" açıkken iOS uygun anda uyandırır).
    static func scheduleRefresh() {
        let req = BGAppRefreshTaskRequest(identifier: refreshId)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)   // en erken 15 dk sonra
        try? BGTaskScheduler.shared.submit(req)                        // zaten planlıysa sessizce geçer
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Konumla arka plan açılışında (uygulama kapalıyken hareketle uyandırma) takibi hemen dirilt.
        // Tracker.shared.init zaten 'active' ise startUpdatingLocation + significant-change'i sürdürür.
        _ = Tracker.shared
        PhoneWatchLink.shared.activate()   // Apple Watch'a kimlik/cihaz bilgisi köprüsü
        // BG refresh: iOS periyodik uyanışında takibi dirilt + bir sonrakini planla ("asla durmasın" emniyeti).
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshId, using: nil) { task in
            Tracker.shared.revive()
            Self.scheduleRefresh()
            task.setTaskCompleted(success: true)
        }
        Self.scheduleRefresh()
        // Arka plana her geçişte yeniden planla (talep tazelenir) + takip diri kalsın.
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                               object: nil, queue: .main) { _ in
            Tracker.shared.revive()
            Self.scheduleRefresh()
        }
        UNUserNotificationCenter.current().delegate = NotifDelegate.shared
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted { DispatchQueue.main.async { application.registerForRemoteNotifications() } }
        }
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "nd_apns")
        NotificationCenter.default.post(name: .ndApns, object: token)
    }
    // SUNUCU BEKÇİSİ (v6): sunucu beklemedeki cihazda büyük yer değiştirme görürse SESSİZ push atar —
    // app arka planda dürtülür, hareket işlemcisine bakar, araçtaysak takip uyanır (kullanıcı hiçbir şey görmez).
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Tracker.shared.pokeWake()
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { completionHandler(.newData) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}
}

final class NotifDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotifDelegate()
    // uygulama açıkken de bildirim göster
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }
}

extension Notification.Name { static let ndApns = Notification.Name("nd_apns") }
