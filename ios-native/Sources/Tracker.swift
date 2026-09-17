import CoreLocation
import CoreMotion
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
    @Published var recvCount = 0            // TEŞHİS: iOS'tan alınan konum sayısı (filtre öncesi)
    @Published var preciseOff = false       // TEŞHİS: "Tam Konum" kapalı (reducedAccuracy) — nokta ~km hatalı gelir
    @Published var authAlways = true        // TEŞHİS: konum izni "Her Zaman" mı
    @Published var lastError: String?       // TEŞHİS: son gönderim/konum hatası
    private var lastAcc: Double = -1        // son fix doğruluğu (telemetri)
    private var lastDebug: Date = .distantPast
    // BEKLEME MODU (pil + durum çubuğu oku): hareketsizlikte tam GPS kapatılır -> mavi ok KAYBOLUR;
    // significant-location hareketi yakalayınca otomatik tam moda dönülür (sürüş kaçmaz).
    @Published var idleMode = false
    private var idleAnchor: CLLocation?     // beklemeye girilen konum (çıkış eşiği için)
    private var idleSpeedHits = 0           // ardışık araç-hızı fix sayacı (tek sahte doppler uyandırmasın)
    private var idleExitAt: Date?           // beklemeden son çıkış anı (sahte uyanma sigortası için)
    private var progAnchor: CLLocation?     // NET YER DEĞİŞTİRME çapası — hareketin asıl ölçütü (v4)
    private var lastMovementAt = Date()
    private let idleAfter: TimeInterval = 2 * 60   // 2 dk araç-hareketi yoksa -> bekleme (ok söner)
    // SADECE ARAÇ eşikleri (Barış 07-09: uygulama araç odaklı — yürüyüş OTOMATİK takip AÇMAZ,
    // yürüyüş kaydı MANUEL "Gezi kaydı başlat" ile yapılır; ev içi yürüyüş/GPS titremesi asla uyandırmaz).
    // v4 (07-10): v3'ün acc≤50 kapısı CEPTEKİ telefonda SÜRÜŞÜ öldürdü (moto'da doğruluk tipik 50-80m;
    // hareket sayılmadı -> sürüş ORTASINDA beklemeye düştü, 50dk veri gitti). Yeni ölçüt:
    //  • NET YER DEĞİŞTİRME: çapadan uzaklık - iki fix'in belirsizliği > progDist => hareket (evde
    //    ışınlanma belirsizlik düşümüyle elenir; sürüşte yer değiştirme sürekli birikir, acc 150'ye kadar OK)
    //  • DOPPLER hızı yalnızca speedAccuracy 0..3 m/s ise güvenilir (ev içi sahte hızların speedAccuracy'si kötü)
    private let moveSpeed: Double = 4.2       // ≈15 km/h — minimum bisiklet/motor temposu (doppler, speedAcc kapılı)
    private let progDist: Double = 120        // çapadan NET ilerleme (belirsizlik düşülmüş) = gerçek hareket
    private let progPace: Double = 2.5        // m/s — dilim temposu: yürüyüş (~1.4) ikonu tutmaz, araç tutar
    private let accCap: Double = 150          // hareket değerlendirmesine giren max yatay doğruluk
    private let idleExitSpeed: Double = 3.6   // ≈13 km/h — bekleme çıkışı bisiklet/motor hızı
    private let idleExitDist: Double = 300    // çapadan NET yer değiştirme tabanı (sahte uyanma başına katlanır)
    private var wakeFails = 0                 // teyitsiz uyanma sayısı — eşiği katlar, gerçek hareket sıfırlar

    // --- CORE MOTION (v6, BİRİNCİL sinyal): hareket işlemcisi cepte bile araç/bisiklet/yürüyüş
    // ayrımını GPS'siz ve İKONSUZ bilir; geçmişi 7 gün sistemce kayıtlıdır (app kapalıyken bile).
    // Uyanma + bekleme kararlarını artık bu verir; GPS sezgileri yalnızca izin yoksa yedek.
    private let motionMgr = CMMotionActivityManager()
    private var motionLive = false
    private var lastMotionQuery = Date.distantPast
    private var motionUsable: Bool {
        CMMotionActivityManager.isActivityAvailable() &&
        CMMotionActivityManager.authorizationStatus() != .denied &&
        CMMotionActivityManager.authorizationStatus() != .restricted
    }
    private func startMotionLive() {
        guard motionUsable, !motionLive else { return }
        motionLive = true
        motionMgr.startActivityUpdates(to: .main) { [weak self] a in
            guard let self, let a else { return }
            if (a.automotive || a.cycling) && a.confidence != .low {
                self.lastMovementAt = Date(); self.wakeFails = 0   // araçtayız: bekleme sayacı hep taze
            }
        }
    }
    private func stopMotionLive() {
        guard motionLive else { return }
        motionLive = false
        motionMgr.stopActivityUpdates()
    }
    // Son 10 dakikada araç/bisiklet hareketi var mı? (işlemci geçmişinden — app uyurken de kayıtlı)
    private func vehicleRecently(_ done: @escaping (Bool) -> Void) {
        guard motionUsable else { done(false); return }
        motionMgr.queryActivityStarting(from: Date().addingTimeInterval(-600), to: Date(), to: .main) { acts, _ in
            done((acts ?? []).contains { ($0.automotive || $0.cycling) && $0.confidence != .low })
        }
    }
    // Beklemedeyken araç kontrolü — SLC fix'i, BGTask ve sunucunun sessiz push'u tetikler (30 sn'de bir).
    private func tryMotionWake() {
        guard active, idleMode, motionUsable,
              Date().timeIntervalSince(lastMotionQuery) > 30 else { return }
        lastMotionQuery = Date()
        vehicleRecently { [weak self] vehicle in
            guard let self, vehicle, self.active, self.idleMode else { return }
            self.idleSpeedHits = 0; self.idleExitAt = Date(); self.wakeFails = 0
            self.beginUpdates()
        }
    }
    // Sunucu bekçisinin sessiz push'u: "cihaz yer değiştirmiş görünüyor, araçtaysan uyan".
    func pokeWake() { tryMotionWake() }
    // 1.8 CANLI TAKİP: arkadaş izlemeye başlayınca sunucu live:1 sessiz push atar ->
    // hareket şartı ARANMADAN konum akışı başlar (izleyen taze veri görsün). 8 dk sonra
    // v6'nın normal boşta-kapanma mantığı devralır (hareket yoksa kendiliğinden söner).
    func liveWake() { beginUpdates() }
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
        // Cebe koyunca ok hemen sönsün: arka plana geçişte son 90 sn'de GERÇEK hareket yoksa beklemeye al.
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            guard let self, self.active, !self.recording, !self.idleMode else { return }
            if Date().timeIntervalSince(self.lastMovementAt) > 60 { self.enterIdle() }   // cebe koyunca ok hemen sönsün
        }
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
        DispatchQueue.main.async { self.idleMode = false }
        idleAnchor = nil; progAnchor = nil; lastMovementAt = Date()
        startMotionLive()   // v6: araçta olduğumuz sürece bekleme sayacını hareket işlemcisi tazeler
        startHeartbeat()
    }

    // BEKLEME: tam GPS + diri-oturum kapat (mavi ok kaybolur); significant-change açık kalır (hareketle uyanır).
    private func enterIdle() {
        DispatchQueue.main.async { self.idleMode = true }
        idleAnchor = lastLoc
        idleSpeedHits = 0; progAnchor = nil
        stopMotionLive()
        mgr.stopUpdatingLocation()
        if #available(iOS 17.0, *) { (bgSession as? CLBackgroundActivitySession)?.invalidate(); bgSession = nil }
        // significantLocationChanges AÇIK kalıyor — hareket edince didUpdateLocations tetiklenir.
    }

    private func maybeEnterIdle() {
        guard active, !recording, !idleMode else { return }
        // SAHTE UYANMA SİGORTASI: beklemeden yeni çıkıldıysa (ilk 3 dk) ve araç hareketi teyit
        // gelmediyse 75 sn'de geri beklemeye dön — yanlış alarm okunu uzun süre yakmasın.
        let fresh = idleExitAt.map { Date().timeIntervalSince($0) < 180 } ?? false
        let limit: TimeInterval = fresh ? 75 : idleAfter
        if Date().timeIntervalSince(lastMovementAt) > limit {
            if fresh { wakeFails = min(wakeFails + 1, 3) }   // teyitsiz uyanma: sonraki uyanma eşiği katlanır
            enterIdle()
        }
    }

    // 15 sn HEARTBEAT: hareket az olsa/iOS arka planda seyreltse bile son konumu en geç 15 sn'de
    // bir Traccar'a yollar -> iz boşluksuz/yoğun, "ışınlanma" olmaz, anlık takip + en kaliteli video.
    private func startHeartbeat() {
        DispatchQueue.main.async {
            self.heartbeat?.invalidate()
            let iv = self.hbInterval
            self.heartbeat = Timer.scheduledTimer(withTimeInterval: iv, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.maybeDebugReport()   // telemetri konumdan BAĞIMSIZ aksın (konum hiç gelmiyorsa da görelim)
                self.syncDiag(self.mgr)
                self.maybeEnterIdle()     // hareketsizlikte beklemeye geç (mavi ok kaybolsun)
                guard !self.idleMode else { return }
                guard let loc = self.lastLoc, loc.timestamp.timeIntervalSinceNow > -(iv*2) else { return }
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

    // BGTask/arka plan uyanışında takibi dirilt: açıksa CLLocationManager'ı yeniden kur (idempotent).
    // v6: BEKLEMEDEYSEK tam uyandırma YOK (ikon boşuna yanmasın) — yalnız araçtaysak uyan.
    func revive() {
        guard active, deviceId != nil else { return }
        if idleMode { tryMotionWake() } else { beginUpdates() }
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
        syncDiag(m)
        if (active || recording), st == .authorizedAlways || st == .authorizedWhenInUse, deviceId != nil {
            beginUpdates()
        }
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        DispatchQueue.main.async { self.lastError = "konum: " + error.localizedDescription }
    }

    // TEŞHİS: izin + Tam Konum durumunu yayınla (UI uyarı gösterir; asıl "hiç nokta gitmiyor" vakası
    // Tam Konum kapalıyken doğruluğun ~km'ye düşüp TÜM noktaların filtrelenmesiydi).
    private func syncDiag(_ m: CLLocationManager) {
        let po = m.accuracyAuthorization == .reducedAccuracy
        let aa = m.authorizationStatus == .authorizedAlways
        DispatchQueue.main.async { self.preciseOff = po; self.authAlways = aa }
        // Tam Konum kapalıysa geçici tam doğruluk iste (iOS kullanıcıya sorar)
        if po { m.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "TrackRide") }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let loc = locs.last else { return }
        DispatchQueue.main.async { self.recvCount += 1 }
        lastAcc = loc.horizontalAccuracy
        syncDiag(m)
        maybeDebugReport()
        // ARAÇ HAREKETİ v4 — iki bağımsız GÜVENİLİR sinyal (cepte/kaskta acc 50-80m'yi de kapsar):
        //  (a) DOPPLER hızı: speedAccuracy 0..3 m/s ise gerçek (ev içi sahte hızın speedAccuracy'si kötü/-1)
        //  (b) NET YER DEĞİŞTİRME: prog çapasından uzaklık - iki fix'in belirsizliği > progDist
        //      (evde ışınlanma belirsizlik düşümüyle ~0'a iner; sürüşte sürekli birikir)
        // Yürüyüş hızı hareket SAYILMAZ -> yürüyüşte takip otomatik AÇILMAZ (manuel gezi kaydı kullanılır).
        let okFix = loc.horizontalAccuracy > 0 && loc.horizontalAccuracy <= accCap
        let trustedSpeed = (loc.speedAccuracy >= 0 && loc.speedAccuracy <= 3) ? loc.speed : -1
        var progressed = false
        if okFix {
            if let a = progAnchor, a.horizontalAccuracy > 0 {
                let net = loc.distance(from: a) - loc.horizontalAccuracy - a.horizontalAccuracy
                if net > progDist {
                    // ARAÇ TEMPOSU şartı (v5): 120 m'lik dilim ≥2.5 m/s katedilmişse hareket say —
                    // yürüyüş (~1.4 m/s) ikonu YAKMAZ, ağır trafikteki araç (≥9 km/h) yakar.
                    let dt = loc.timestamp.timeIntervalSince(a.timestamp)
                    if dt > 0 && net / dt > progPace { progressed = true }
                    progAnchor = loc
                }
            } else { progAnchor = loc }
        }
        let moving = trustedSpeed > moveSpeed || progressed
        if moving { lastMovementAt = Date(); wakeFails = 0 }   // gerçek hareket teyidi sahte-uyanma sayacını sıfırlar
        // BEKLEMEDEYSEK (v5): yalnızca ARAÇ başlangıcında tam moda dön —
        // (1) ARDIŞIK 2 fix'te güvenilir araç hızı VEYA (2) çapadan NET yer değiştirme.
        // v5 düzeltmesi (2026-07-11 cepte-sürüş-hiç-başlamadı vakası): doğruluk TAVANI YOK
        // (belirsizlik düşümü kendini ölçekler — kaba fix daha çok yol ister) ve ORTALAMA HIZ ŞARTI YOK
        // (çapa saatler önceye ait olabilir; mesafe/8saat hiçbir zaman 2.2 m/s tutmaz, sürüş hiç uyanamıyordu).
        // Yanlış uyanmalar 75 sn sigortasıyla geri kapanır + her sahte uyanma eşiği katlar (300/600/1200/2400 m).
        if idleMode {
            tryMotionWake()   // v6 BİRİNCİL: hareket işlemcisi "araçta" diyorsa uyan (asenkron, ikonsuz sorgu)
            if trustedSpeed > idleExitSpeed { idleSpeedHits += 1 } else if trustedSpeed >= 0 { idleSpeedHits = 0 }
            var vehicleStart = idleSpeedHits >= 2
            if !vehicleStart, let a = idleAnchor,
               loc.horizontalAccuracy > 0, a.horizontalAccuracy > 0 {
                if let w = idleExitAt, Date().timeIntervalSince(w) > 2 * 3600 { wakeFails = 0 }   // eski sayaç bayatlar
                let need = idleExitDist * pow(2, Double(min(wakeFails, 3)))
                let net = loc.distance(from: a) - loc.horizontalAccuracy - a.horizontalAccuracy
                vehicleStart = net > need
            }
            if vehicleStart { idleSpeedHits = 0; idleExitAt = Date(); progAnchor = loc; beginUpdates() }
            else { return }                      // ev içi kıpırdanma / yürüyüş: beklemede kal (ok kapalı)
        }
        // GPS gürültü / ışınlanma filtresi (kötü sinyali minimuma indir).
        // 50→100 m gevşetildi: şehir içi/moto kaskında 50-80 m fix'ler atılıyordu; 100 m video için hâlâ makul.
        guard loc.horizontalAccuracy > 0, loc.horizontalAccuracy <= 100 else { return }  // doğruluk kötü = at
        guard loc.timestamp.timeIntervalSinceNow > -15 else { return }                    // bayat fix = at
        lastLoc = loc
        sendLoc(loc, force: false)
        maybeEnterIdle()
    }

    // TEŞHİS TELEMETRİSİ: ~60 sn'de bir sunucuya durum raporu — Barış'ın telefonundaki sorunu
    // sunucudan görebilmek için (izin, tam-konum, alınan/gönderilen sayaç, son doğruluk, hata).
    private func maybeDebugReport() {
        guard Date().timeIntervalSince(lastDebug) > 60 else { return }
        lastDebug = Date()
        let tokenStr = UserDefaults.standard.string(forKey: "nd_token") ?? ""
        guard !tokenStr.isEmpty, let url = URL(string: "https://kisisel-api.nickdegs.com/api/trackdebug") else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 15
        req.setValue("Bearer " + tokenStr, forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(cihazKimligi(), forHTTPHeaderField: "X-Device-Id")   // tek-cihaz zorlaması (Store ile aynı değer)
        let body: [String: Any] = [
            "auth": mgr.authorizationStatus.rawValue, "precise": !preciseOff,
            "recv": recvCount, "sent": sentCount, "acc": Int(lastAcc),
            "err": lastError ?? "", "active": active, "recording": recording, "idle": idleMode]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
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
        // 1.8 CANLI TAKİP: batarya + şarj durumu (arkadaş panelinde 🔋 gösterilir)
        UIDevice.current.isBatteryMonitoringEnabled = true
        let bl = UIDevice.current.batteryLevel
        if bl >= 0 { comps.queryItems?.append(.init(name: "batt", value: String(Int(bl * 100)))) }
        if UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full {
            comps.queryItems?.append(.init(name: "charge", value: "true"))
        }
        guard let url = comps.url else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 20
        // Arka plana geçerken gönderim yarıda kalmasın: kısa bir background-task koruması.
        var bgTask = UIBackgroundTaskIdentifier.invalid
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "nd-gps-send") {
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
        }
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                DispatchQueue.main.async { self?.lastSentAt = Date(); self?.sentCount += 1; self?.lastError = nil }
            } else if let err {
                DispatchQueue.main.async { self?.lastError = "gönderim: " + err.localizedDescription }
            } else if let http = resp as? HTTPURLResponse {
                DispatchQueue.main.async { self?.lastError = "gönderim: HTTP \(http.statusCode)" }
            }
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
        }.resume()
    }
}
