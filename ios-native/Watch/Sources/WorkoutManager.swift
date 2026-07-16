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
    @Published var locDenied = false

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let mgr = CLLocationManager()
    private var lastLoc: CLLocation?
    private var lastSentAt = Date.distantPast

    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        mgr.distanceFilter = 10
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
        running = true
    }

    func end() {
        mgr.stopUpdatingLocation()
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

    // Konum noktasını Traccar'a bas (OsmAnd protokolü) — nabız &hr= olarak eklenir.
    private func send(_ loc: CLLocation) {
        let link = WatchLink.shared
        guard !link.devid.isEmpty, Date().timeIntervalSince(lastSentAt) >= 5 else { return }
        lastSentAt = Date()
        var c = URLComponents(string: link.ingest)!
        var items = [
            URLQueryItem(name: "id", value: link.devid),
            URLQueryItem(name: "lat", value: String(loc.coordinate.latitude)),
            URLQueryItem(name: "lon", value: String(loc.coordinate.longitude)),
            URLQueryItem(name: "timestamp", value: String(Int(loc.timestamp.timeIntervalSince1970))),
            URLQueryItem(name: "speed", value: String(max(0, loc.speed))),
            URLQueryItem(name: "bearing", value: String(max(0, loc.course))),
            URLQueryItem(name: "altitude", value: String(loc.altitude)),
            URLQueryItem(name: "accuracy", value: String(loc.horizontalAccuracy)),
        ]
        if heartRate > 0 { items.append(URLQueryItem(name: "hr", value: String(heartRate))) }
        c.queryItems = items
        guard let u = c.url else { return }
        var req = URLRequest(url: u); req.httpMethod = "POST"; req.timeoutInterval = 15
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                DispatchQueue.main.async { self?.sentCount += 1 }
            }
        }.resume()
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
