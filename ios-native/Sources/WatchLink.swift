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
            "premium": true,   // 03.11.2026: Move Log ücretsiz — saat tarafı her özelliği açık görsün
        ]
        try? WCSession.default.updateApplicationContext(ctx)
    }

    // ANLIK NABIZ PEEK: sessiz push gelince saate "kısa nabız ölçümü başlat" de. Saat ulaşılabilirse
    // anında (sendMessage), değilse kuyruğa (transferUserInfo — saat uyanınca alır). Ölçüm saatte
    // başlar, sunucuya raporlar; kimse bakmıyorsa (want=false) kendi kendine durur (pil serbest).
    func startHRPeek() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        let msg: [String: Any] = ["cmd": "hrpeek"]
        if s.isReachable {
            s.sendMessage(msg, replyHandler: nil) { _ in s.transferUserInfo(msg) }
        } else {
            s.transferUserInfo(msg)
        }
    }

    func session(_ s: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) { push() }
    func sessionDidBecomeInactive(_ s: WCSession) {}
    func sessionDidDeactivate(_ s: WCSession) { s.activate() }
    func sessionWatchStateDidChange(_ s: WCSession) { push() }   // saat sonradan eşleşirse
}
