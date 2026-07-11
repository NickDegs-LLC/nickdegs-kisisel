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
        if let v = ctx["devid"] as? String, !v.isEmpty { d.set(v, forKey: "w_devid") }
        if let u = ctx["ingest"] as? String, !u.isEmpty { d.set(u, forKey: "w_ingest") }
        if let p = ctx["premium"] as? Bool { d.set(p, forKey: "w_premium") }
        refresh()
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        store(session.receivedApplicationContext)
    }
    func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) {
        store(ctx)
    }
}
