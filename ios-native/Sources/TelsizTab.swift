import SwiftUI

// "Telsiz" sekmesi (16.09 — Barış): Telsiz + Sohbet tek sekmede, üstte segment geçişiyle.
// ESKİDEN: "Harita" sekmesi = canlı konum haritası (arkadaş pinleri) + Sohbet.
// Canlı takip/arkadaş görme KALDIRILDI — konum paylaşımı iOS ve Android'de zaten yerleşik (Bul/Find My).
// Yerine Profil/Ayarlar sekmesindeki telsiz (bas-konuş + canlı telsiz) buraya taşındı.
// Sekme sayısı yine 5 → iOS'un çirkin "More" taşma menüsü oluşmaz.
struct TelsizTab: View {
    @AppStorage("nd_mapchat_seg") private var seg = 0   // 0 = Telsiz, 1 = Sohbet
    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $seg) {
                Text(L("Telsiz", "Radio")).tag(0)
                Text(L("Sohbet", "Chat")).tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 6)
            if seg == 0 {
                TelsizView()
            } else {
                ChatListView()
            }
        }
    }
}

// TELSİZ: arkadaş listesi — mikrofona basılı tut konuş (sesli mesaj, ücretsiz)
// + 📻 canlı telsiz (2 kişilik LiveKit odası) daveti ve gelen davetin kabulü.
// 16.09'da Profil sekmesinden bütün olarak buraya taşındı.
struct TelsizView: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var ptt = PttEngine.shared
    @State private var friends: [Friend] = []
    @State private var pairTalkFriend: Friend? = nil                  // 📻 davet gönderen taraf
    @State private var vcIncoming: (from: String, name: String)? = nil // gelen canlı-telsiz daveti
    @State private var vcJoinPeer: Friend? = nil                       // kabul sonrası katılım
    @State private var pttBusyFriends: Set<String> = []                // şu an bana konuşan arkadaşlar

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if friends.isEmpty {
                            VStack(spacing: 10) {
                                Image(systemName: "dot.radiowaves.left.and.right")
                                    .font(.system(size: 34)).foregroundStyle(.secondary)
                                Text(L("Henüz arkadaşın yok — Profil'den ekle",
                                       "No friends yet — add one from Profile"))
                                    .font(.system(size: 15)).foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }.padding(.top, 70)
                        } else {
                            Text(L("Basılı tut, konuş — telsiz gibi","Hold and talk — like a radio"))
                                .font(.caption).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 4)
                        }
                        ForEach(friends) { f in row(f) }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Telsiz","Radio"))
        }
        .task { friends = await store.friends() }
        .onChange(of: store.davetYenile) { _, _ in
            Task { friends = await store.friends() }
        }
        // ÇİFT CANLI TELSİZ: davet eden taraf (bekler + bağlanır)
        .sheet(item: $pairTalkFriend) { f in
            PairTalkView(peer: f.username, peerLabel: f.name ?? f.username, inviting: true)
        }
        // kabul eden taraf (direkt katılır)
        .sheet(item: $vcJoinPeer) { f in
            PairTalkView(peer: f.username, peerLabel: f.name ?? f.username, inviting: false)
        }
        .alert(L("Canlı telsiz daveti 📻", "Live radio invite 📻"), isPresented: Binding(
            get: { vcIncoming != nil }, set: { if !$0 { vcIncoming = nil } })) {
            Button(L("Kabul et", "Accept")) {
                if let inv = vcIncoming {
                    Task {
                        _ = await store.vcRespond(from: inv.from, accept: true)
                        vcJoinPeer = Friend(username: inv.from, name: inv.name, handle: nil, avatar: nil, online: nil)
                    }
                    vcIncoming = nil
                }
            }
            Button(L("Reddet", "Decline"), role: .cancel) {
                if let inv = vcIncoming { Task { _ = await store.vcRespond(from: inv.from, accept: false) } }
                vcIncoming = nil
            }
        } message: {
            Text(L("\(vcIncoming?.name ?? "") seni canlı sesli sohbete davet ediyor",
                   "\(vcIncoming?.name ?? "") is inviting you to a live voice chat"))
        }
        // PTT meşgul + gelen davet polling'i (telsiz görünürken 2.5 sn'de bir, hafif)
        .task {
            while !Task.isCancelled {
                if !friends.isEmpty {
                    var busy: Set<String> = []
                    for fr in friends.prefix(8) {
                        if await store.pttBusyOf(fr.username) { busy.insert(fr.username) }
                    }
                    pttBusyFriends = busy
                }
                let st = await store.vcStatus()
                if let f = st.invFrom, vcIncoming == nil, pairTalkFriend == nil, vcJoinPeer == nil {
                    vcIncoming = (f, st.invName ?? f)
                }
                try? await Task.sleep(nanoseconds: 2_500_000_000)
            }
        }
    }

    @ViewBuilder func row(_ f: Friend) -> some View {
        // PTT ÇAKIŞMA KİLİDİ: arkadaş şu an bana konuşuyorsa mikrofon pasif ("konuşuyor")
        let isBusy = pttBusyFriends.contains(f.username)
        HStack(spacing: 12) {
            AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold))
                if isBusy {
                    Text(L("konuşuyor…","talking…")).font(.caption).foregroundStyle(.orange)
                } else if let h = f.handle, !h.isEmpty {
                    Text("@\(h)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            // ÇİFTLER: basılı tut, konuş -> arkadaşa sesli mesaj (ücretsiz, kulüp gerekmez)
            Image(systemName: isBusy ? "waveform" : (ptt.recording ? "mic.fill" : "mic"))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isBusy ? Color.orange : (ptt.recording ? Color.red : Brand.accent))
                .symbolEffect(.variableColor.iterative, options: .repeating, isActive: isBusy)
                .frame(width: 38, height: 38).glassPanel(19)
                .opacity(isBusy ? 0.65 : 1)
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !isBusy else { return }
                        if !ptt.recording {
                            ptt.store = store; ptt.startRecording()
                            Task { await store.pttBusySet(f.username, on: true) }
                        }
                    }
                    .onEnded { _ in
                        guard !isBusy else { return }
                        if ptt.recording {
                            ptt.stopAndSend(toUser: f.username)
                            Task { await store.pttBusySet(f.username, on: false) }
                        }
                    })
            // ÇİFT CANLI TELSİZ: davet et -> kabul edince 2 kişilik canlı sesli sohbet
            Button { pairTalkFriend = f } label: {
                Image(systemName: "phone.and.waveform.fill")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Brand.accent)
                    .frame(width: 38, height: 38).glassPanel(19)
            }.buttonStyle(.borderless)
        }.padding(12).glassPanel(18).smoothAppear()
    }
}
