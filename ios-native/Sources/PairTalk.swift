import SwiftUI
import LiveKit
import AVFoundation

// ÇİFT CANLI TELSİZ (2026-07-19): arkadaşla 2 kişilik canlı sesli sohbet (LiveKit).
// Akış: 📻 butonu -> davet push'u -> karşı taraf kabul -> ikisi de odaya bağlanır.
// Oda çiftten türetilir, token sadece o iki kişiye verilir -> kesinlikle max 2 kişi.
@MainActor
final class PairTalkEngine: ObservableObject {
    static let shared = PairTalkEngine()
    @Published var connected = false
    @Published var connecting = false
    @Published var muted = false
    @Published var peerTalking = false
    @Published var peerJoined = false
    @Published var peerName = ""
    private var room: Room? = nil

    func join(peer: String, store: Store) async {
        guard !connected, !connecting else { return }
        connecting = true
        defer { connecting = false }
        guard let cfg = await store.vcToken(peer: peer) else { return }
        peerName = cfg.peerName
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .voiceChat,
                           options: [.allowBluetooth, .allowBluetoothA2DP, .duckOthers, .defaultToSpeaker])
        try? s.setActive(true)
        let r = Room()
        r.add(delegate: self)
        do {
            try await r.connect(url: cfg.url, token: cfg.token)
            try await r.localParticipant.setMicrophone(enabled: true)
            room = r; connected = true
            peerJoined = !r.remoteParticipants.isEmpty
        } catch { connected = false }
    }

    func toggleMute() {
        muted.toggle()
        Task { try? await room?.localParticipant.setMicrophone(enabled: !muted) }
    }

    func leave() {
        Task {
            await room?.disconnect()
            await MainActor.run {
                connected = false; room = nil; peerTalking = false; peerJoined = false
            }
        }
    }
}

extension PairTalkEngine: RoomDelegate {
    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        let talking = participants.contains { !($0 is LocalParticipant) && $0.isSpeaking }
        Task { @MainActor in self.peerTalking = talking }
    }
    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in self.peerJoined = true }
    }
    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in self.peerJoined = false }
    }
}

// Canlı telsiz ekranı — davet eden (bekler) ve kabul eden (direkt bağlanır) için ortak.
struct PairTalkView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @StateObject private var eng = PairTalkEngine.shared
    let peer: String            // arkadaş username
    let peerLabel: String       // görünen ad
    let inviting: Bool          // true = davet gönder + kabul bekle; false = davet kabul edildi, direkt katıl
    @State private var waiting = false
    @State private var declinedOrTimeout = false
    @State private var pollTimer: Timer? = nil

    var body: some View {
        VStack(spacing: 22) {
            Capsule().fill(.secondary.opacity(0.4)).frame(width: 44, height: 5).padding(.top, 10)
            Spacer()
            ZStack {
                Circle().fill(Brand.accent.opacity(eng.peerTalking ? 0.35 : 0.12))
                    .frame(width: 150, height: 150)
                    .scaleEffect(eng.peerTalking ? 1.15 : 1.0)
                    .animation(.easeInOut(duration: 0.4), value: eng.peerTalking)
                AvatarView(name: peerLabel, avatar: nil, size: 110)
            }
            Text(peerLabel).font(.title2.bold())
            Group {
                if eng.connected && eng.peerJoined {
                    Label(eng.peerTalking ? L("Konuşuyor…", "Talking…") : L("Canlı — bağlı", "Live — connected"),
                          systemImage: "dot.radiowaves.left.and.right")
                        .foregroundStyle(eng.peerTalking ? Brand.accent : .green)
                } else if eng.connected {
                    Label(L("Bağlandın — arkadaşın bekleniyor…", "Connected — waiting for your friend…"),
                          systemImage: "hourglass").foregroundStyle(.secondary)
                } else if declinedOrTimeout {
                    Label(L("Davet kabul edilmedi", "Invite not accepted"), systemImage: "xmark.circle")
                        .foregroundStyle(.red)
                } else if waiting {
                    HStack(spacing: 8) { ProgressView(); Text(L("Davet gönderildi — kabul bekleniyor…", "Invite sent — waiting for accept…")) }
                        .foregroundStyle(.secondary)
                } else {
                    Label(L("Bağlanılıyor…", "Connecting…"), systemImage: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(.secondary)
                }
            }.font(.system(size: 15, weight: .medium))
            Text(L("2 kişilik canlı telsiz — daha kalabalığı için kulüp interkomu 🏍️",
                   "2-person live radio — for more riders use club intercom 🏍️"))
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 30)
            Spacer()
            HStack(spacing: 40) {
                Button {
                    eng.toggleMute()
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: eng.muted ? "mic.slash.fill" : "mic.fill")
                            .font(.system(size: 24)).frame(width: 64, height: 64).glassPanel(32)
                            .foregroundStyle(eng.muted ? .red : Brand.accent)
                        Text(eng.muted ? L("Aç", "Unmute") : L("Sustur", "Mute")).font(.caption2)
                    }
                }.disabled(!eng.connected)
                Button {
                    endCall()
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "phone.down.fill")
                            .font(.system(size: 24)).frame(width: 64, height: 64)
                            .background(Circle().fill(Color.red.opacity(0.85)))
                            .foregroundStyle(.white)
                        Text(L("Bitir", "End")).font(.caption2)
                    }
                }
            }.padding(.bottom, 40)
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(eng.connected)
        .task {
            if inviting {
                waiting = true
                _ = await store.vcInvite(peer)
                // kabulü bekle (90 sn) — status poll
                var tries = 0
                while waiting && tries < 45 {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    let st = await store.vcStatus()
                    if st.goPeer == peer {
                        waiting = false
                        await eng.join(peer: peer, store: store)
                        return
                    }
                    tries += 1
                }
                if waiting { waiting = false; declinedOrTimeout = true }
            } else {
                await eng.join(peer: peer, store: store)
            }
        }
        .onDisappear { if eng.connected { eng.leave() } }
    }

    private func endCall() {
        eng.leave()
        dismiss()
    }
}
