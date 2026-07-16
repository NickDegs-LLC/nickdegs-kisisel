import SwiftUI
import AVFoundation

// Sohbette SESLİ MESAJ baloncuğu: dokun -> klibi indir (pttGet) -> çal. (Telsiz anlık çalma ayrı durur.)
struct VoiceMsgBubble: View {
    @EnvironmentObject var store: Store
    let pid: String
    let mine: Bool
    @State private var playing = false
    @State private var player: AVAudioPlayer? = nil
    var body: some View {
        Button {
            if playing { player?.stop(); playing = false; return }
            Task {
                guard let data = await store.pttGet(pid) else { return }
                await MainActor.run {
                    let s = AVAudioSession.sharedInstance()
                    try? s.setCategory(.playback, options: [.duckOthers, .allowBluetooth, .allowBluetoothA2DP])
                    try? s.setActive(true)
                    player = try? AVAudioPlayer(data: data)
                    player?.play(); playing = true
                    if let d = player?.duration, d > 0 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + d) { playing = false }
                    }
                }
            }
        } label: {
            HStack(spacing: 9) {
                Image(systemName: playing ? "stop.fill" : "play.fill").font(.system(size: 15, weight: .bold))
                Image(systemName: "waveform").font(.system(size: 17))
                Text(L("Sesli mesaj", "Voice message")).font(.system(size: 14.5, weight: .medium))
            }
            .foregroundStyle(mine ? .white : .primary)
            .padding(.horizontal, 15).padding(.vertical, 11)
        }.buttonStyle(.plain)
    }
}

struct ChatListView: View {
    @EnvironmentObject var store: Store
    @State private var convos: [Convo] = []
    @State private var path: [Convo] = []
    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                AuroraBackground()
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(convos) { c in
                            NavigationLink(value: c) { row(c) }.buttonStyle(.plain).smoothAppear()
                        }
                        if convos.isEmpty {
                            Text(L("Henüz sohbet yok","No conversations yet"))
                                .foregroundStyle(.secondary).padding(.top, 60)
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Sohbet","Chat"))
            .navigationDestination(for: Convo.self) { c in
                ConversationView(peer: c.username, name: c.name ?? c.username, avatar: c.avatar)
            }
        }
        .task {
            convos = await store.chatList()
            if AppEnv.demo, AppEnv.screen == "chat", let first = convos.first { path = [first] }
        }
    }
    func row(_ c: Convo) -> some View {
        HStack(spacing: 13) {
            ZStack(alignment: .bottomTrailing) {
                AvatarView(name: c.name ?? c.username, avatar: c.avatar, size: 50)
                if c.online == true { Circle().fill(.green).frame(width: 13, height: 13)
                    .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2)) }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(c.name ?? c.username).font(.system(size: 17, weight: .semibold))
                Text(c.last?.type == "voice" ? L("🎙️ Sesli mesaj", "🎙️ Voice message") : (c.last?.text ?? ""))
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if let u = c.unread, u > 0 {
                Text("\(u)").font(.caption.bold()).foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 4).background(Brand.gradient, in: Capsule())
            }
        }
        .padding(14).glassPanel(20)
    }
}

struct ConversationView: View {
    @EnvironmentObject var store: Store
    let peer: String; let name: String; var avatar: Avatar?
    @State private var msgs: [Message] = []
    @State private var draft = ""
    @State private var appeared = false

    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(msgs) { m in bubble(m).id(m.mid) }
                        }.padding(.horizontal, 14).padding(.vertical, 16)
                    }
                    .onChange(of: msgs.count) { _, _ in
                        withAnimation(.smooth(duration: 0.42)) {
                            proxy.scrollTo(msgs.last?.mid, anchor: .bottom)
                        }
                    }
                }
                // Giriş çubuğu (cam)
                HStack(spacing: 8) {
                    TextField(L("Mesaj","Message"), text: $draft)
                        .padding(.horizontal, 16).padding(.vertical, 11).glassCapsule()
                    Button { sendIt() } label: {
                        Image(systemName: "paperplane.fill").foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                    }.background(Brand.gradient, in: Circle())
                }.padding(12)
            }
        }
        .navigationTitle(name).navigationBarTitleDisplayMode(.inline)
        .task { msgs = await store.chatWith(peer) }
    }

    func isMine(_ m: Message) -> Bool { m.frm == store.me || m.frm == "me" }
    func bubble(_ m: Message) -> some View {
        HStack {
            if isMine(m) { Spacer(minLength: 50) }
            Group {
                if m.type == "voice", let pid = m.media, !pid.isEmpty {
                    VoiceMsgBubble(pid: pid, mine: isMine(m))
                } else {
                    Text(m.text ?? "")
                        .font(.system(size: 15.5))
                        .foregroundStyle(isMine(m) ? .white : .primary)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                }
            }
            .background {
                if isMine(m) {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Brand.gradient.opacity(0.9))
                } else { Color.clear }
            }
            .glassPanelIf(!isMine(m))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            if !isMine(m) { Spacer(minLength: 50) }
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    func sendIt() {
        let t = draft.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }
        draft = ""
        let m = Message(id: UUID().uuidString, frm: store.me.isEmpty ? "me" : store.me, text: t, ts: Date().timeIntervalSince1970, type: "text", media: nil)
        withAnimation(.snappy(duration: 0.34, extraBounce: 0.16)) { msgs.append(m) }
        Task { await store.send(peer, t) }
    }
}

extension View {
    @ViewBuilder func glassPanelIf(_ cond: Bool) -> some View {
        if cond { self.glassPanel(20) } else { self }
    }
}
