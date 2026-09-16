import CoreLocation

// Kullanıcının kendi konumu için CoreLocation (mavi nokta + izin isteği).
final class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let mgr = CLLocationManager()
    @Published var coordinate: CLLocationCoordinate2D?
    @Published var denied = false

    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func request() {
        // 16.09 ÇEKİM KURALI (Barış): mağaza ekran görüntülerinde izin penceresi ASLA görünmemeli.
        // DEMO (çekim/simülatör) modunda konum izni HİÇ istenmez. Gerçek kullanıcıda davranış AYNI.
        if AppEnv.demo { return }
        switch mgr.authorizationStatus {
        case .notDetermined: mgr.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: mgr.startUpdatingLocation()
        default: denied = true
        }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        switch m.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            DispatchQueue.main.async { self.denied = false }
            m.startUpdatingLocation()
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
