import Foundation
import WatchConnectivity

// Apple Watch köprüsü (iOS tarafı): saate kimlik/cihaz bilgisi yollar —
// token + Traccar cihaz no + ingest URL + premium. Saat kendi başına giriş yapmaz.
final class PhoneWatchLink: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchLink()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // Saate güncel bağlamı bas (login sonrası, tracker bilgisi yenilenince, uygulama açılınca).
    func push() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let d = UserDefaults.standard
        let ctx: [String: Any] = [
            "token": d.string(forKey: "nd_token") ?? "",
            "devid": d.string(forKey: "nd_dev") ?? "",
            "ingest": d.string(forKey: "nd_ingest") ?? "https://gpsdata.nickdegs.com",
            "premium": d.bool(forKey: "nd_premium"),
        ]
        try? WCSession.default.updateApplicationContext(ctx)
    }

    func session(_ s: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) { push() }
    func sessionDidBecomeInactive(_ s: WCSession) {}
    func sessionDidDeactivate(_ s: WCSession) { s.activate() }
    func sessionWatchStateDidChange(_ s: WCSession) { push() }   // saat sonradan eşleşirse
}
