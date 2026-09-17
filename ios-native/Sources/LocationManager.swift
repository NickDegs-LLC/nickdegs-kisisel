import CoreLocation
import UIKit

// Kullanıcının kendi konumu için CoreLocation (mavi nokta + izin isteği).
//
// 🔴 FİKS 17.09 gece (Barış: "Dynamic Island'daki konum oku 7/24 gitmiyor"): bu yönetici Rotalar
// ekranındaki kayıt çubuğu için `startUpdatingLocation()` diyor ve HİÇBİR YERDE durdurulmuyordu.
// Uygulama arka plana geçince (Tracker beklemede, oto-takip KAPALI olsa bile) bu açık talep iOS'ta
// "Move Log konum kullanıyor" olarak kalıyor → Dynamic Island'da ok sönmüyor, dokununca Move Log
// açılıyordu. Teşhis: telefon 50 dk telemetri atmamış (uygulama askıda) ama ok yanıyordu; oto-takip
// kapatılınca da gitmedi → Tracker değil, bu yönetici. Artık: arka plana geçince DUR, öne gelince
// (hâlâ isteniyorsa) sürdür; çubuk ekrandan çıkınca DUR.
final class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let mgr = CLLocationManager()
    @Published var coordinate: CLLocationCoordinate2D?
    @Published var denied = false
    private var wanted = false          // request() çağrıldı ve stop() çağrılmadı

    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyHundredMeters
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.mgr.stopUpdatingLocation()                       // arka planda açık talep bırakma
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.resumeIfWanted()
        }
    }

    func request() {
        // 16.09 ÇEKİM KURALI (Barış): mağaza ekran görüntülerinde izin penceresi ASLA görünmemeli.
        // DEMO (çekim/simülatör) modunda konum izni HİÇ istenmez. Gerçek kullanıcıda davranış AYNI.
        if AppEnv.demo { return }
        wanted = true
        switch mgr.authorizationStatus {
        case .notDetermined: mgr.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: mgr.startUpdatingLocation()
        default: denied = true
        }
    }

    /// Çubuk ekrandan çıkınca çağrılır: talep kapanır, ok söner.
    func stop() {
        wanted = false
        mgr.stopUpdatingLocation()
    }

    private func resumeIfWanted() {
        guard wanted, !AppEnv.demo else { return }
        let st = mgr.authorizationStatus
        if st == .authorizedWhenInUse || st == .authorizedAlways { mgr.startUpdatingLocation() }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        switch m.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            DispatchQueue.main.async { self.denied = false }
            if wanted { m.startUpdatingLocation() }
        case .denied, .restricted:
            DispatchQueue.main.async { self.denied = true }
        default: break
        }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let c = locs.last?.coordinate else { return }
        DispatchQueue.main.async { self.coordinate = c }
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {}
}
