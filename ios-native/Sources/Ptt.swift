import Foundation
import AVFoundation
import SwiftUI

// 1.9-B TELSİZ MODU: bas-konuş ses klibi -> kulübe gider, sürüştekilerin KULAKLIĞINDA otomatik çalar.
// Kayıt: m4a 16kHz mono ≤10sn. Alma: sessiz push "ptt:<id>:<isim>" -> indir -> duck ile çal.
final class PttEngine: NSObject, ObservableObject, AVAudioRecorderDelegate {
    static let shared = PttEngine()
    @Published var recording = false
    @Published var sending = false
    weak var store: Store? = nil
    private var rec: AVAudioRecorder? = nil
    private var player: AVAudioPlayer? = nil
    private var fileURL: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("ptt_out.m4a")
    }

    func startRecording() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, options: [.duckOthers, .allowBluetooth, .defaultToSpeaker])
        try? s.setActive(true)
        AVAudioApplication.requestRecordPermission { ok in
            guard ok else { return }
            DispatchQueue.main.async {
                let cfg: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC,
                                          AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                                          AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue]
                self.rec = try? AVAudioRecorder(url: self.fileURL, settings: cfg)
                self.rec?.delegate = self
                self.rec?.record(forDuration: 10)         // tavan 10 sn
                self.recording = self.rec?.isRecording ?? false
            }
        }
    }

    func stopAndSend(club: String) {
        rec?.stop(); recording = false
        guard let data = try? Data(contentsOf: fileURL), data.count > 500, let store else { return }
        sending = true
        Task {
            _ = await store.pttSend(club: club, data: data)
            await MainActor.run { self.sending = false }
        }
    }

    func cancel() { rec?.stop(); recording = false }

    // Gelen klip: indir + kulaklıkta çal (arka planda da çalışır — konum modu app'i ayakta tutuyor)
    func playIncoming(id: String, from name: String) {
        guard let store else { return }
        Task {
            guard let data = await store.pttGet(id) else { return }
            await MainActor.run {
                let s = AVAudioSession.sharedInstance()
                try? s.setCategory(.playback, options: [.duckOthers, .allowBluetooth, .allowBluetoothA2DP])
                try? s.setActive(true)
                // önce kısa anons: kimden geldiği
                let tr = Locale.preferredLanguages.first?.hasPrefix("tr") ?? false
                let u = AVSpeechUtterance(string: tr ? "\(name):" : "\(name):")
                u.voice = AVSpeechSynthesisVoice(language: tr ? "tr-TR" : "en-US"); u.rate = 0.55
                AVSpeechSynthesizer().speak(u)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                    self.player = try? AVAudioPlayer(data: data)
                    self.player?.play()
                }
            }
        }
    }
}
