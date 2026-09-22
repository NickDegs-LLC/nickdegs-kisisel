import Foundation
import WatchConnectivity

// iPhone'daki Move Log'dan kimlik alır (token / Traccar cihaz no / ingest URL / premium).
// Saat kendi başına giriş YAPMAZ — telefonda giriş yapılmış olmalı (SMS-OTP saatte çile olur).
final class WatchLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchLink()
    @Published var ready = false

    var token: String { UserDefaults.standard.string(forKey: "w_token") ?? "" }
    var devid: String { UserDefaults.standard.string(forKey: "w_devid") ?? "" }
    var ingest: String { UserDefaults.standard.string(forKey: "w_ingest") ?? "https://gpsdata.nickdegs.com" }
    var premium: Bool { UserDefaults.standard.bool(forKey: "w_premium") }

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
        refresh()
    }

    private func refresh() {
        DispatchQueue.main.async { self.ready = !self.token.isEmpty && !self.devid.isEmpty }
    }

    private func store(_ ctx: [String: Any]) {
        let d = UserDefaults.standard
        if let t = ctx["token"] as? String, !t.isEmpty { d.set(t, forKey: "w_token") }
        // 🔴 KİMLİK DEĞİŞİMİ = TAMPONU SİL. Cihaz numarası değiştiyse (telefonda çıkış + başka
        // hesapla giriş) eski hesabın bekleyen noktaları YENİ cihaza akar ve rotalar karışırdı.
        // Telefon tarafındaki Store.logout() -> GpsKuyruk.temizle() ile aynı koruma.
        if let v = ctx["devid"] as? String, !v.isEmpty {
            let eski = d.string(forKey: "w_devid") ?? ""
            if !eski.isEmpty, eski != v { WatchGpsKuyruk.shared.temizle() }
            d.set(v, forKey: "w_devid")
        }
        if let u = ctx["ingest"] as? String, !u.isEmpty { d.set(u, forKey: "w_ingest") }
        if let p = ctx["premium"] as? Bool { d.set(p, forKey: "w_premium") }
        refresh()
        // Kimlik YENİ geldi: kimliksizken birikmiş noktalar varsa hemen gitsin.
        WatchGpsKuyruk.shared.bosalt()
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        store(session.receivedApplicationContext)
    }
    func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) {
        store(ctx)
    }
    // Telefondan "anlık nabız ölçümü" komutu (izleyen arkadaş bakıyor): kısa HR-peek başlat.
    private func handle(_ m: [String: Any]) {
        if (m["cmd"] as? String) == "hrpeek" {
            DispatchQueue.main.async { WorkoutManager.shared.startHRPeek() }
        }
    }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { handle(message) }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) { handle(message); replyHandler([:]) }
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) { handle(userInfo) }
}
