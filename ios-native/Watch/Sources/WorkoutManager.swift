import Foundation
import HealthKit
import CoreLocation

// Bilekten sürüş kaydı: HKWorkoutSession (nabız + app'i diri tutar) + CLLocationManager (rota).
// Noktalar telefondaki hesapla AYNI Traccar cihazına OsmAnd protokolüyle gider — &hr= eklenir,
// sunucu tarafı (activity-detect) nabzı TCX'e ve özete işler.
final class WorkoutManager: NSObject, ObservableObject {
    static let shared = WorkoutManager()

    @Published var running = false
    @Published var rideType = "moto"
    @Published var startedAt: Date?
    @Published var endedAt: Date?
    @Published var speedKmh = 0.0
    @Published var distanceKm = 0.0
    @Published var heartRate = 0            // 0 = henüz ölçüm yok
    @Published var sentCount = 0
    @Published var pendingCount = 0         // kuyrukta bekleyen (çevrimdışı) nokta sayısı
    // 🔴 Kuyruğun hata kanalı EKRANA çıkar. Eskiden geri bildirimde `_` ile atılıyordu: uç kalıcı
    // 403 dönse bile kullanıcı yalnız büyüyen bir sayı görür, "gönderiliyor" sanırdı. Telefondaki
    // `lastError` karşılığı — sessiz başarısızlık bu ürünün asıl derdiydi, saatte de olmasın.
    @Published var kuyrukHatasi: String?
    @Published var locDenied = false

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let mgr = CLLocationManager()
    private var lastLoc: CLLocation?
    private var lastQueuedAt = Date.distantPast   // eski adı lastSentAt: artık KUYRUĞA giriş kapısı

    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        mgr.distanceFilter = 10
        // Kuyruk durumu -> UI. 🔴 WatchGpsKuyruk.init HİÇBİR singleton'a dokunmaz (o dosyadaki
        // kural 1), bu yüzden buradan erişmek static-let lazy init kilidi yaratmaz.
        // Geri bildirim zaten ana iş parçacığında geliyor (durumYayinla).
        WatchGpsKuyruk.shared.durumBildirKur { [weak self] bekleyen, teslim, hata in
            guard let self else { return }
            self.pendingCount = bekleyen
            // 🔴 Hata artık YUTULMUYOR (eskiden `_` ile atılıyordu). Uç kalıcı 403/5xx dönerse
            // kuyruk backoff'a oturur ve hiçbir nokta teslim edilmez; kullanıcı yalnız büyüyen bir
            // sayı görüp "gönderiliyor" sanırdı. Teslim gelince temizlenir.
            if teslim > 0 { self.sentCount += teslim; self.kuyrukHatasi = nil }
            else if let hata { self.kuyrukHatasi = hata }
        }
        // Açılış: önceki sürüşten teslim edilmemiş nokta kaldıysa hemen gitsin. Saat uygulaması
        // sürüş biter bitmez askıya alınabildiği için tamponun asıl boşaldığı an BURASI olabilir.
        WatchGpsKuyruk.shared.bosalt()
    }

    private func activity(for type: String) -> HKWorkoutActivityType {
        switch type {
        case "bike": return .cycling
        case "run":  return .running
        case "walk": return .walking
        default:     return .other          // moto / car
        }
    }

    func start(type: String) {
        rideType = type
        let types: Set<HKSampleType> = [HKQuantityType(.heartRate), HKObjectType.workoutType()]
        store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: types) { [weak self] ok, _ in
            DispatchQueue.main.async { self?.begin(type: type) }
        }
    }

    private func begin(type: String) {
        let cfg = HKWorkoutConfiguration()
        cfg.activityType = activity(for: type)
        cfg.locationType = .outdoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: cfg)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: cfg)
            b.delegate = self
            session = s; builder = b
            s.startActivity(with: Date())
            b.beginCollection(withStart: Date()) { _, _ in }
        } catch { return }
        mgr.requestWhenInUseAuthorization()
        mgr.startUpdatingLocation()
        startedAt = Date(); endedAt = nil
        distanceKm = 0; speedKmh = 0; heartRate = 0; sentCount = 0; lastLoc = nil
        // 🔴 lastQueuedAt SIFIRLANIR: önceki sürüşten kalan kapı yüzünden yeni sürüşün ilk
        // noktası 5 sn'ye kadar gecikmesin (eski kodda da bu sıfırlama yoktu, burada düzeltiliyor).
        lastQueuedAt = .distantPast
        running = true
        // Yeni sürüş başlarken önceki sürüşten kalan tampon varsa boşaltmayı dene.
        WatchGpsKuyruk.shared.bosalt()
    }

    func end() {
        mgr.stopUpdatingLocation()
        // 🔴 KUYRUĞU OTURUM KAPANMADAN ÖNCE BOŞALT. HKWorkoutSession bitince watchOS uygulamayı
        // hızla askıya alır; burada denemek elde kalan noktalara en geniş çalışma zamanını verir.
        // Yetişmeyen nokta KAYBOLMAZ — diskte durur, uygulama bir dahaki açılışta gönderir.
        WatchGpsKuyruk.shared.bosalt()
        session?.end()
        builder?.endCollection(withEnd: Date()) { [weak self] _, _ in
            self?.builder?.finishWorkout { _, _ in }
        }
        endedAt = Date()
        running = false
    }

    // ---- ANLIK NABIZ PEEK (2026-07-16): aktivite GEREKMEZ ----
    // Arkadaş canlı ekranı açınca telefon sessiz push alır -> saate "kısa HR ölçümü" der.
    // Saat sadece nabzı toplayan hafif bir oturum açar, 4 sn'de bir sunucuya raporlar.
    // Sunucu want=false dönerse (kimse bakmıyor) ölçüm durur -> pil serbest. 90 sn üst emniyet.
    private var peekActive = false
    private var peekTimer: Timer?
    private var peekStarted = Date.distantPast
    private let apiBase = "https://kisisel-api.nickdegs.com"

    func startHRPeek() {
        guard !running, !peekActive else { return }   // aktif sürüşte HR zaten akıyor, gerek yok
        peekActive = true; peekStarted = Date()
        let types: Set<HKSampleType> = [HKQuantityType(.heartRate)]
        store.requestAuthorization(toShare: [], read: types) { [weak self] _, _ in
            DispatchQueue.main.async { self?.beginPeek() }
        }
    }

    private func beginPeek() {
        guard peekActive else { return }
        let cfg = HKWorkoutConfiguration()
        cfg.activityType = .other
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: cfg)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: cfg)
            b.delegate = self
            session = s; builder = b
            s.startActivity(with: Date())
            b.beginCollection(withStart: Date()) { _, _ in }
        } catch { peekActive = false; return }
        peekTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.reportPeek() }
    }

    private func reportPeek() {
        guard peekActive else { return }
        if Date().timeIntervalSince(peekStarted) > 90 { stopHRPeek(); return }   // sert emniyet
        let link = WatchLink.shared
        guard !link.token.isEmpty, let url = URL(string: apiBase + "/api/live/hr-report") else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + link.token, forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["hr": heartRate])   // hr=0 ise sunucu yok sayar, want yine döner
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            if let d = data, let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               (o["want"] as? Bool) == false {
                DispatchQueue.main.async { self?.stopHRPeek() }   // kimse bakmıyor -> durdur
            }
        }.resume()
    }

    func stopHRPeek() {
        guard peekActive else { return }
        peekActive = false
        peekTimer?.invalidate(); peekTimer = nil
        if !running {                              // gerçek sürüş yoksa HR oturumunu kapat
            session?.end()
            builder?.endCollection(withEnd: Date()) { [weak self] _, _ in
                self?.builder?.finishWorkout { _, _ in }
            }
            session = nil; builder = nil
            DispatchQueue.main.async { self.heartRate = 0 }
        }
    }

    // Sürüş bittikten sonra bilekten video isteği (telefondaki generate ile aynı uç).
    func requestVideo(link: WatchLink, done: @escaping (Bool) -> Void) {
        guard let s = startedAt, let e = endedAt,
              let url = URL(string: "https://kisisel-api.nickdegs.com/api/rides/generate") else { done(false); return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + link.token, forHTTPHeaderField: "Authorization")
        let body: [String: Any] = ["from": s.timeIntervalSince1970, "to": e.timeIntervalSince1970,
                                   "type": rideType, "mode": link.premium ? "3d" : "flat",
                                   "aspect": "9:16", "speed": "medium", "premium": link.premium]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    // Konum noktasını ingest ucuna yolla — 🔴 ARTIK ATEŞLE-UNUT DEĞİL (22.09 "otobüs vakası").
    // Nokta ÖNCE diske (WatchGpsKuyruk), SONRA gönderilir; kuyruktan düşürme YALNIZ 2xx alınınca.
    // Çevrimiçiyken kuyrukta tek kayıt bulunur -> tek POST, davranış bugünküyle AYNI.
    // URL kurma/gönderme işi tamamen kuyruğa taşındı (parametre kümesi birebir korundu).
    private func send(_ loc: CLLocation) {
        // 5 sn'lik kapı artık KUYRUĞA GİRİŞİ sınırlıyor. Eskiden gönderimi sınırlıyordu ama
        // `lastSentAt` POST'tan ÖNCE yazıldığı için BAŞARISIZ istek de pencereyi yakıyordu:
        // nokta hem kayboluyor hem 5 sn boyunca yenisi denenmiyordu. Kayıt hızı bugünküyle AYNI.
        guard Date().timeIntervalSince(lastQueuedAt) >= 5 else { return }
        lastQueuedAt = Date()
        let n = WatchNokta(ts: loc.timestamp.timeIntervalSince1970,
                           lat: loc.coordinate.latitude,
                           lon: loc.coordinate.longitude,
                           // 🔴 FİKS 05.09: saat hızı m/s gönderiyordu ama sunucu KNOT varsayıp ×1.852
                           // ile km/h'ye çeviriyor (motor3d/iz.ts:75, grup7.ts:347/352/584) → %94 hatalı
                           // hız. Telefon (Tracker.swift) ×1.94384 ile knot'a çeviriyor; saat de uyar.
                           spd: Float(max(0, loc.speed) * 1.94384),
                           alt: Float(loc.altitude),
                           acc: Float(loc.horizontalAccuracy),
                           brg: Float(max(0, loc.course)),
                           // Nabız ÖLÇÜM ANINDA donar. Eskiden gönderim anındaki güncel değer
                           // gidiyordu; kuyrukla nokta saatler sonra boşalabildiği için o değer
                           // yanlış noktaya yapışırdı.
                           hr: heartRate > 0 ? Int16(min(250, heartRate)) : -1)
        // 🔴 `guard !link.devid.isEmpty` KALDIRILDI: kimlik yokken nokta iz bırakmadan düşüyordu.
        // Kimlik artık BOŞALTMA anında okunuyor -> telefonla henüz eşleşmemişken de noktalar birikir.
        // Ayrıca `URLComponents(string: link.ingest)!` zorlama açılımı gitti (çökme riski).
        WatchGpsKuyruk.shared.ekle(n)      // önce diske
        WatchGpsKuyruk.shared.bosalt()     // sonra gönder (ağ yoksa şebeke gelince otomatik)
    }
}

extension WorkoutManager: CLLocationManagerDelegate {
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard running, let loc = locs.last, loc.horizontalAccuracy > 0, loc.horizontalAccuracy <= 100 else { return }
        if let p = lastLoc { distanceKm += loc.distance(from: p) / 1000 }
        lastLoc = loc
        speedKmh = max(0, loc.speed) * 3.6
        send(loc)
    }
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        locDenied = (m.authorizationStatus == .denied || m.authorizationStatus == .restricted)
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(_ b: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        guard types.contains(HKQuantityType(.heartRate)),
              let stats = b.statistics(for: HKQuantityType(.heartRate)),
              let q = stats.mostRecentQuantity() else { return }
        let bpm = Int(q.doubleValue(for: HKUnit.count().unitDivided(by: .minute())))
        DispatchQueue.main.async { self.heartRate = bpm }
    }
    func workoutBuilderDidCollectEvent(_ b: HKLiveWorkoutBuilder) {}
}
