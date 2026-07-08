import CoreLocation
import UIKit

// Move Log'un kendi GPS göndericisi: arka planda konumu Traccar'a yollar (ayrı OsmAnd app gerekmez).
final class Tracker: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = Tracker()          // tek örnek: AppDelegate de arka plan açılışında erişir
    private let mgr = CLLocationManager()
    @Published var active = UserDefaults.standard.bool(forKey: "nd_tracking")
    @Published var recording = false        // manuel gezi kaydı sürüyor mu
    @Published var rideType = "moto"        // manuel gezi tipi
    @Published var rideStart: Date?         // manuel gezi başlangıcı
    @Published var lastSentAt: Date?        // TEŞHİS: en son Traccar'a başarıyla nokta gönderilen an (UI gösterir)
    @Published var sentCount = 0            // TEŞHİS: bu oturumda gönderilen nokta sayısı
    private var deviceId: String?
    private var ingestURL: String?
    private var lastSent: CLLocation?       // ışınlanma filtresi için son gönderilen konum
    private var lastLoc: CLLocation?        // en son geçerli konum (heartbeat için)
    private var heartbeat: Timer?           // hassasiyete göre N sn'de bir zorunlu gönderim (boşluk olmasın)
    private var hbInterval: TimeInterval = 15   // heartbeat aralığı (hassasiyete göre ayarlanır)
    private var bgSession: Any?             // iOS17+ CLBackgroundActivitySession: app'i arka planda DİRİ tutar
                                            // (yoksa iOS runloop'u askıya alıp "belli süre sonra kapanıyor")

    // ALGILAMA HASSASİYETİ -> (distanceFilter metre, heartbeat sn). Free=basit; premium 3'ünden seçer.
    static func sensParams(_ s: String) -> (Double, TimeInterval) {
        switch s {
        case "hassas":  return (5, 5)     // en hassas: 5 sn'de bir, en yoğun iz
        case "dengeli": return (12, 15)   // dengeli: ~15 sn, iyi algılama + makul pil
        default:        return (30, 45)   // basit: ~45 sn, performanslı/pil dostu, daha kaba algılama
        }
    }
    // Etkin hassasiyet: free HER ZAMAN basit; premium seçimini (default dengeli) kullanır.
    func currentSensitivity() -> String {
        let prem = UserDefaults.standard.bool(forKey: "nd_premium")
        let stored = UserDefaults.standard.string(forKey: "nd_sensitivity") ?? "dengeli"
        return prem ? stored : "basit"
    }
    // Ayarlardan değişince canlı uygula (premium).
    func applySensitivity(_ s: String) {
        UserDefaults.standard.set(s, forKey: "nd_sensitivity")
        let (df, hb) = Tracker.sensParams(currentSensitivity())
        mgr.distanceFilter = df; hbInterval = hb
        if heartbeat != nil { startHeartbeat() }   // çalışıyorsa yeni aralıkla yeniden kur
    }

    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        // Konum aralığı ALGILAMA HASSASİYETİNE göre (Hassas/Dengeli/Basit). Free=basit, premium seçer.
        let (df, hb) = Tracker.sensParams(currentSensitivity())
        mgr.distanceFilter = df; hbInterval = hb
        // Sadece Info.plist UIBackgroundModes=location içeriyorsa aç (yoksa çökmesin)
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if modes.contains("location") { mgr.allowsBackgroundLocationUpdates = true }
        mgr.pausesLocationUpdatesAutomatically = false
        mgr.activityType = .automotiveNavigation
        mgr.showsBackgroundLocationIndicator = true
        // kalıcı cihaz bilgisini geri yükle
        deviceId = UserDefaults.standard.string(forKey: "nd_dev")
        ingestURL = UserDefaults.standard.string(forKey: "nd_ingest")
        // Takip daha önce açıksa (relaunch / arka plandan konumla uyandırma) hemen sürdür.
        // Bug fix: eskiden start() yalnızca toggle'a elle dokununca çağrılırdı; app yeniden
        // açılınca 'active' true görünür ama GPS basmazdı -> otomatik algılama hiç tetiklenmezdi.
        if active, deviceId != nil { beginUpdates() }
    }

    // CLLocationManager'ı fiilen başlatan tek nokta (hem canlı hem significant-change).
    private func beginUpdates() {
        let st = mgr.authorizationStatus
        if st == .notDetermined || st == .authorizedWhenInUse { mgr.requestAlwaysAuthorization() }
        // allowsBackgroundLocationUpdates yalnızca Info.plist'te UIBackgroundModes=location varsa açılabilir (yoksa crash).
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if modes.contains("location") {
            mgr.allowsBackgroundLocationUpdates = true
            mgr.pausesLocationUpdatesAutomatically = false
        }
        mgr.startUpdatingLocation()
        mgr.startMonitoringSignificantLocationChanges()   // app kapansa/force-quit sonrası hareketle uyanır
        // ASIL DÜZELTME: arka planda app'i diri tut. Bu olmadan iOS bir süre sonra runloop'u askıya
        // alıyor -> heartbeat Timer'ı duruyor -> "belli süre sonra takip kapanıyor". CLBackgroundActivitySession
        // mavi konum göstergesini sürdürerek app'i arka planda çalışır tutar (iOS 17+). Yalnızca izin varken kur.
        if #available(iOS 17.0, *), st == .authorizedAlways || st == .authorizedWhenInUse {
            if bgSession == nil { bgSession = CLBackgroundActivitySession() }
        }
        startHeartbeat()
    }

    // 15 sn HEARTBEAT: hareket az olsa/iOS arka planda seyreltse bile son konumu en geç 15 sn'de
    // bir Traccar'a yollar -> iz boşluksuz/yoğun, "ışınlanma" olmaz, anlık takip + en kaliteli video.
    private func startHeartbeat() {
        DispatchQueue.main.async {
            self.heartbeat?.invalidate()
            let iv = self.hbInterval
            self.heartbeat = Timer.scheduledTimer(withTimeInterval: iv, repeats: true) { [weak self] _ in
                guard let self, let loc = self.lastLoc, loc.timestamp.timeIntervalSinceNow > -(iv*2) else { return }
                self.sendLoc(loc, force: true)
            }
        }
    }

    private func persist(deviceId: String, url: String) {
        self.deviceId = deviceId; self.ingestURL = url
        UserDefaults.standard.set(deviceId, forKey: "nd_dev")
        UserDefaults.standard.set(url, forKey: "nd_ingest")
    }

    func start(deviceId: String, url: String) {
        persist(deviceId: deviceId, url: url)
        beginUpdates()
        set(true)
    }

    func stop() {
        mgr.stopUpdatingLocation()
        mgr.stopMonitoringSignificantLocationChanges()
        heartbeat?.invalidate(); heartbeat = nil
        if #available(iOS 17.0, *) { (bgSession as? CLBackgroundActivitySession)?.invalidate(); bgSession = nil }
        set(false)
    }

    // --- Manuel gezi kaydı (tip seçilebilir + sonradan değiştirilebilir) ---
    func startRide(type: String, deviceId: String, url: String) {
        persist(deviceId: deviceId, url: url)
        beginUpdates()
        DispatchQueue.main.async { self.rideType = type; self.rideStart = Date(); self.recording = true }
    }

    func endRide() -> (from: Double, to: Double, type: String)? {
        guard let s = rideStart else { return nil }
        let r = (s.timeIntervalSince1970, Date().timeIntervalSince1970, rideType)
        if !active {                                   // oto-takip kapalıysa GPS'i tamamen durdur
            mgr.stopUpdatingLocation()
            mgr.stopMonitoringSignificantLocationChanges()
            if #available(iOS 17.0, *) { (bgSession as? CLBackgroundActivitySession)?.invalidate(); bgSession = nil }
        }
        DispatchQueue.main.async { self.recording = false; self.rideStart = nil }
        return r
    }

    private func set(_ v: Bool) {
        DispatchQueue.main.async { self.active = v }
        UserDefaults.standard.set(v, forKey: "nd_tracking")
    }

    // İzin sonradan "Her Zaman"/"Kullanırken"e dönerse (kullanıcı Ayarlar'dan verdi) takibi yeniden kur.
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        let st = m.authorizationStatus
        if (active || recording), st == .authorizedAlways || st == .authorizedWhenInUse, deviceId != nil {
            beginUpdates()
        }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let loc = locs.last else { return }
        // GPS gürültü / ışınlanma filtresi (kötü sinyali minimuma indir)
        guard loc.horizontalAccuracy > 0, loc.horizontalAccuracy <= 50 else { return }   // doğruluk kötü = at
        guard loc.timestamp.timeIntervalSinceNow > -15 else { return }                    // bayat fix = at
        lastLoc = loc
        sendLoc(loc, force: false)
    }

    // Konumu Traccar'a gönder. force=false: ışınlanma filtresi uygula (mesafe-tabanlı normal akış).
    // force=true: 15 sn heartbeat (duruyor olsa bile düzenli nokta -> boşluk yok).
    private func sendLoc(_ loc: CLLocation, force: Bool) {
        guard let id = deviceId, let base = ingestURL, var comps = URLComponents(string: base) else { return }
        if !force, let prev = lastSent {
            let d = loc.distance(from: prev)
            let dt = loc.timestamp.timeIntervalSince(prev.timestamp)
            if dt > 0, d / dt > 70 { return }        // >252 km/h imkânsız = ışınlanma, at
        }
        lastSent = loc
        comps.queryItems = [
            .init(name: "id", value: id),
            .init(name: "lat", value: String(loc.coordinate.latitude)),
            .init(name: "lon", value: String(loc.coordinate.longitude)),
            .init(name: "timestamp", value: String(Int(loc.timestamp.timeIntervalSince1970))),
            .init(name: "speed", value: String(max(0, loc.speed) * 1.94384)),  // m/s -> knot
            .init(name: "altitude", value: String(loc.altitude)),
            .init(name: "accuracy", value: String(loc.horizontalAccuracy)),
            .init(name: "bearing", value: String(max(0, loc.course))),
        ]
        guard let url = comps.url else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 20
        // Arka plana geçerken gönderim yarıda kalmasın: kısa bir background-task koruması.
        var bgTask = UIBackgroundTaskIdentifier.invalid
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "nd-gps-send") {
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
        }
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                DispatchQueue.main.async { self?.lastSentAt = Date(); self?.sentCount += 1 }
            }
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
        }.resume()
    }
}
