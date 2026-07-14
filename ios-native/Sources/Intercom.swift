import SwiftUI
import LiveKit
import AVFoundation

// 1.9-C CANLI İNTERKOM: kulübe özel sürekli-açık sesli oda (Cardo/Sena tarzı) — LiveKit üzerinden.
// Katıl → herkesle canlı konuş, eller gidonda. Sustur/ayrıl serbest. Ses arka planda da akar (audio bg mode).
@MainActor
final class IntercomEngine: ObservableObject {
    static let shared = IntercomEngine()
    @Published var connected = false
    @Published var connecting = false
    @Published var muted = false
    @Published var speakers: [String] = []      // şu an konuşanların adları
    @Published var roomName = ""
    private var room: Room? = nil

    func join(clubId: String, store: Store) async {
        guard !connected, !connecting else { return }
        connecting = true
        defer { connecting = false }
        guard let cfg = await store.intercomToken(clubId) else { return }
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .voiceChat,
                           options: [.allowBluetooth, .allowBluetoothA2DP, .duckOthers, .defaultToSpeaker])
        try? s.setActive(true)
        let r = Room()
        r.add(delegate: self)
        do {
            try await r.connect(url: cfg.url, token: cfg.token)
            try await r.localParticipant.setMicrophone(enabled: true)
            room = r; connected = true; roomName = cfg.room
        } catch {
            connected = false
        }
    }

    func toggleMute() {
        muted.toggle()
        Task { try? await room?.localParticipant.setMicrophone(enabled: !muted) }
    }

    func leave() {
        Task {
            await room?.disconnect()
            await MainActor.run { connected = false; room = nil; speakers = [] }
        }
    }

    fileprivate func refreshSpeakers(_ r: Room) {
        var names: [String] = []
        for p in r.allParticipants.values where p.isSpeaking {
            names.append(p.name ?? p.identity?.stringValue ?? "?")
        }
        Task { @MainActor in self.speakers = names }
    }
}

extension IntercomEngine: RoomDelegate {
    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        Task { @MainActor in self.refreshSpeakers(room) }
    }
    nonisolated func room(_ room: Room, didDisconnectWithError error: Error?) {
        Task { @MainActor in self.connected = false }
    }
}

struct IntercomBar: View {
    @EnvironmentObject var store: Store
    @ObservedObject var eng = IntercomEngine.shared
    var clubId: String

    var body: some View {
        VStack(spacing: 8) {
            if eng.connected {
                HStack(spacing: 10) {
                    Circle().fill(.green).frame(width: 9, height: 9)
                    Text(eng.speakers.isEmpty ? L("İnterkom açık — konuş","Intercom on — talk")
                                              : "🔊 " + eng.speakers.joined(separator: ", "))
                        .font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Spacer()
                    Button { eng.toggleMute() } label: {
                        Image(systemName: eng.muted ? "mic.slash.fill" : "mic.fill")
                            .foregroundStyle(eng.muted ? .red : Brand.accent)
                            .frame(width: 40, height: 40).glassPanel(20)
                    }
                    Button { eng.leave() } label: {
                        Image(systemName: "phone.down.fill").foregroundStyle(.red)
                            .frame(width: 40, height: 40).glassPanel(20)
                    }
                }.padding(.horizontal, 12).padding(.vertical, 8).glassPanel(14)
            } else {
                Button {
                    Task { await eng.join(clubId: clubId, store: store) }
                } label: {
                    HStack(spacing: 8) {
                        if eng.connecting { ProgressView() }
                        else { Image(systemName: "dot.radiowaves.left.and.right") }
                        Text(eng.connecting ? L("Bağlanıyor…","Connecting…") : L("Canlı interkoma katıl","Join live intercom"))
                            .font(.system(size: 15, weight: .semibold))
                    }.frame(maxWidth: .infinity).padding(.vertical, 12).glassPanel(14)
                }.buttonStyle(.plain).tint(Brand.accent)
            }
        }
    }
}
