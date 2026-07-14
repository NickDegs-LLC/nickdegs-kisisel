import Foundation
import AVFoundation
import CoreLocation
import UIKit

// 1.9-A SESLİ KONVOY ANONSLARI: sürüş sırasında kask kulaklığına otomatik sesli bilgi —
// "Semra 400 metre geride", "Can durdu", "Efe yaklaşıyor"... Eller gidonda, gözler yolda.
// Kaynak: kulüp canlı telemetrisi (25 sn'de bir); ses: AVSpeechSynthesizer (müziği kısar, BT kulaklığa gider).
final class ConvoyVoice: NSObject, ObservableObject {
    static let shared = ConvoyVoice()
    @Published var enabled = UserDefaults.standard.bool(forKey: "nd_convoy_voice")
    private let synth = AVSpeechSynthesizer()
    private var timer: Timer? = nil
    private var lastState: [String: (dist: Double, spd: Double, ts: Date)] = [:]
    private var lastSpokenAt: [String: Date] = [:]          // anons türü başına bekleme
    private var announcedStop: Set<String> = []
    weak var store: Store? = nil

    func setEnabled(_ on: Bool) {
        enabled = on
        UserDefaults.standard.set(on, forKey: "nd_convoy_voice")
        if on { start() } else { stop() }
    }

    func start() {
        guard enabled, timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            Task { await self?.tick() }
        }
    }
    func stop() { timer?.invalidate(); timer = nil; lastState.removeAll(); announcedStop.removeAll() }

    private func speak(_ trBody: String, _ enBody: String, key: String, cooldown: TimeInterval = 90) {
        if let last = lastSpokenAt[key], Date().timeIntervalSince(last) < cooldown { return }
        lastSpokenAt[key] = Date()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.duckOthers, .allowBluetooth, .allowBluetoothA2DP])
        try? session.setActive(true)
        let tr = Locale.preferredLanguages.first?.hasPrefix("tr") ?? false
        let u = AVSpeechUtterance(string: tr ? trBody : enBody)
        u.voice = AVSpeechSynthesisVoice(language: tr ? "tr-TR" : "en-US")
        u.rate = 0.5
        synth.speak(u)
    }

    @MainActor
    private func tick() async {
        guard enabled, let store, Tracker.shared.active, !Tracker.shared.idleMode else { return }
        guard let me = CLLocationManager().location else { return }
        // tüm kulüplerimin canlı sürücüleri (kendim hariç)
        let clubs = await store.clubs()
        var seen: Set<String> = []
        for c in clubs {
            let riders = await store.liveClub(c.id)
            for r in riders where r.user != store.me && !seen.contains(r.user) && r.age < 300 {
                seen.insert(r.user)
                let d = me.distance(from: CLLocation(latitude: r.lat, longitude: r.lon))
                let name = r.name
                if let prev = lastState[r.user] {
                    // DURDU: hızı sürüş bandından sıfıra düştü
                    if prev.spd > 15 && r.spd < 3 && !announcedStop.contains(r.user) {
                        announcedStop.insert(r.user)
                        speak("\(name) durdu.", "\(name) stopped.", key: "stop_\(r.user)", cooldown: 120)
                    }
                    if r.spd > 15 { announcedStop.remove(r.user) }
                    // MESAFE: anlamlı değişim -> geride/önde anonsu (500m adımlarında)
                    let step = 500.0
                    let bPrev = (prev.dist / step).rounded(.down)
                    let bNow = (d / step).rounded(.down)
                    if bNow != bPrev && d > 300 {
                        let m = Int((d / 100).rounded() * 100)
                        if d > prev.dist + 120 {
                            speak("\(name) \(m) metre geride kaldı.", "\(name) fell \(m) meters behind.",
                                  key: "gap_\(r.user)")
                        } else if d < prev.dist - 120 {
                            speak("\(name) yaklaşıyor, \(m) metre.", "\(name) is catching up, \(m) meters.",
                                  key: "gap_\(r.user)")
                        }
                    }
                    // TOPARLANDI
                    if prev.dist > 400 && d < 150 {
                        speak("\(name) seninle.", "\(name) is with you.", key: "join_\(r.user)", cooldown: 180)
                    }
                } else if d < 100000 {
                    speak("\(name) konvoyda.", "\(name) joined the convoy.", key: "hello_\(r.user)", cooldown: 600)
                }
                lastState[r.user] = (d, r.spd, Date())
            }
        }
    }
}
