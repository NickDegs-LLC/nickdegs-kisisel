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
            GpsKuyruk.shared.bosalt()   // 🔴 revive()'dan ÖNCE: revive() `guard active` ile erken dönüyor
            Tracker.shared.revive()
            Self.scheduleRefresh()
            task.setTaskCompleted(success: true)
        }
        Self.scheduleRefresh()
        // Arka plana her geçişte yeniden planla (talep tazelenir) + takip diri kalsın.
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                               object: nil, queue: .main) { _ in
            GpsKuyruk.shared.bosalt()
            Tracker.shared.revive()
            Self.scheduleRefresh()
        }
        UNUserNotificationCenter.current().delegate = NotifDelegate.shared
        // 🔴 FİKS 05.09: kayıt SADECE `granted` iken yapılıyordu. Ama SESSİZ push
        // (content-available) alert iznine İHTİYAÇ DUYMAZ — bildirim iznini reddeden kullanıcıda
        // telsiz uyandırması, canlı takip, nabız-peek ve oto-takip re-arm'ının TAMAMI ölüyordu.
        // Kayıt artık koşulsuz; izin yalnız GÖRÜNÜR bildirimi etkiler.
        // 16.09 ÇEKİM KURALI (Barış): mağaza ekran görüntülerinde bildirim izni penceresi ASLA
        // görünmemeli — App Store red sebebi. DEMO (çekim/simülatör) modunda izin HİÇ istenmez
        // ve uzak bildirim kaydı yapılmaz. GERÇEK kullanıcıda davranış AYNEN eskisi gibi kalır.
        if !AppEnv.demo {
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
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
        // 22.09: sessiz push çevrimdışıyken APNs'te SAKLANIR, ağ dönünce teslim edilir -> sunucunun
        // uyandırma bekçisi bedava "bağlantı geldi" tetiğine dönüşür: birikmiş kuyruk hemen boşalsın.
        GpsKuyruk.shared.bosalt()
        // 18.09: "ptt" sessiz push dalı kaldırıldı (telsiz çıktı). Eski sunucudan gelirse yok sayılır.
        if (userInfo["live"] as? Int) == 1 { Tracker.shared.liveWake() }   // 1.8: canlı izleme
        else if (userInfo["hrpeek"] as? Int) == 1 { PhoneWatchLink.shared.startHRPeek() }  // anlık nabız: saati kısa ölçüme uyandır
        else { Tracker.shared.pokeWake() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { completionHandler(.newData) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}
}

final class NotifDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotifDelegate()
    // uygulama açıkken de bildirim göster — İSTİSNA: sesli mesaj ("voice:") bildirimi.
    // App açıkken telsiz klibi zaten sessiz push'la otomatik çalınıyor; bir de banner göstermek
    // çift bildirim oluyordu -> foreground'da "voice:" banner'ı bastırılır (app kapalıyken normal gelir).
    // 11.11.2026 ÇÖKME FİKSİ (Barış: "bildirime basınca crash"): iki metot `async` sürümdeydi. Bu sürümde
    // sistem tamamlama işini ana iş parçacığı DIŞINDA bitirebiliyor ve uygulama bildirime dokunulunca
    // çöküyordu. Klasik tamamlama-bloklu sürüm + her şey ana iş parçacığında = her iOS sürümünde güvenli.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let route = notification.request.content.userInfo["route"] as? String
        let secenek: UNNotificationPresentationOptions = (route?.hasPrefix("voice:") == true) ? [] : [.banner, .sound, .badge]
        if Thread.isMainThread { completionHandler(secenek) } else { DispatchQueue.main.async { completionHandler(secenek) } }
    }
    // BİLDİRİME DOKUNULUNCA: payload'daki "route"a göre ilgili yere yönlendir (route yoksa uygulama yalnız açılır).
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let route = response.notification.request.content.userInfo["route"] as? String
        DispatchQueue.main.async {
            if let route, !route.isEmpty {
                NotificationCenter.default.post(name: .ndDeepLink, object: route)
            }
            completionHandler()
        }
    }
}

extension Notification.Name {
    static let ndApns = Notification.Name("nd_apns")
    static let ndDeepLink = Notification.Name("nd_deeplink")   // bildirim dokunma -> ilgili ekran
}
