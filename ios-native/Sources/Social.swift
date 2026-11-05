import SwiftUI

// 05.11.2026 SOSYAL SEKMESİ (Barış: "sosyal sekme ekleyelim, kulüp arkadaşları orada dursun").
// Profil'deki arkadaş istekleri / davet / arkadaş listesi BURAYA taşındı (kod birebir), kulüpler
// (Clubs.swift) ve ortak sürüş videosu tercihi eklendi. Profil artık yalnız kişisel ayarlar.
struct SocialView: View {
    @EnvironmentObject var store: Store
    @State private var prof: Profile?
    @State private var friends: [Friend] = []
    @State private var incoming: [Friend] = []
    @State private var outgoing: [Friend] = []
    @State private var clubs: [Club] = []
    @State private var showAddFriend = false
    @State private var showClubs = false
    @State private var secilenKulup: Club? = nil
    @State private var groupPref = "both"   // both|group|solo
    @State private var showPro = false
    @State private var silinecekArkadas: Friend? = nil
    @State private var davetKod = ""
    @State private var davetPaylas = false
    @State private var davetGirisAcik = false
    @State private var davetGirisi = ""

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(spacing: 14) {
                        // Gelen arkadaşlık istekleri — onayla/reddet
                        if !incoming.isEmpty {
                            section(L("Arkadaşlık istekleri","Friend requests"))
                            ForEach(incoming) { f in
                                HStack(spacing: 12) {
                                    AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold))
                                        if let h = f.handle, !h.isEmpty { Text("@\(h)").font(.caption).foregroundStyle(.secondary) }
                                    }
                                    Spacer()
                                    Button {
                                        Task { await store.respondFriend(f.username, accept: true); await reloadFriends() }
                                    } label: {
                                        Image(systemName: "checkmark").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                                            .frame(width: 38, height: 38).background(Brand.accent, in: Circle())
                                    }.buttonStyle(.plain)
                                    Button {
                                        Task { await store.respondFriend(f.username, accept: false); await reloadFriends() }
                                    } label: {
                                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.secondary)
                                            .frame(width: 38, height: 38).background(.white.opacity(0.08), in: Circle())
                                    }.buttonStyle(.plain)
                                }.padding(12).glassPanel(18).smoothAppear()
                            }
                        }

                        // 🔴 FİKS 05.09: /api/invite ve /api/invite/accept uçları sunucuda VARDI ama
                        // istemcide HİÇ kullanılmıyordu (ne link üretimi ne kabul) → davet akışı ölüydü.
                        section(L("Davet","Invite"))
                        HStack(spacing: 10) {
                            Button {
                                Task {
                                    davetKod = await store.invite()
                                    if !davetKod.isEmpty { davetPaylas = true }
                                }
                            } label: {
                                Label(L("Davet linki oluştur","Create invite link"), systemImage: "link")
                                    .font(.system(size: 14, weight: .semibold))
                            }.buttonStyle(.borderless)
                            Spacer()
                            Button(L("Kodum var","I have a code")) { davetGirisAcik = true }
                                .font(.system(size: 14, weight: .semibold))
                        }.padding(12).glassPanel(18)

                        section(L("Arkadaşlar","Friends"))
                        ForEach(friends) { f in
                            HStack(spacing: 12) {
                                AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold))
                                    if let h = f.handle, !h.isEmpty { Text("@\(h)").font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                // 16.09: telsiz (bas-konuş) + canlı telsiz butonları TELSİZ sekmesine taşındı,
                                // canlı takip tamamen kaldırıldı. Burada arkadaş YÖNETİMİ kalır (ekle/çıkar).
                            }.padding(12).glassPanel(18).smoothAppear()
                            // 🔴 FİKS 05.09: sunucudaki DELETE /api/friends/{uname} hiçbir yerden
                            // çağrılmıyordu — arkadaşlıktan çıkarma özelliği fiilen YOKTU.
                            .contextMenu {
                                Button(role: .destructive) { silinecekArkadas = f } label: {
                                    Label(L("Arkadaşlıktan çıkar","Remove friend"), systemImage: "person.badge.minus")
                                }
                            }
                        }
                        ForEach(outgoing) { f in
                            HStack(spacing: 12) {
                                AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44).opacity(0.6)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold)).foregroundStyle(.secondary)
                                    Text(L("İstek gönderildi — onay bekleniyor","Request sent — awaiting approval")).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "hourglass").foregroundStyle(.secondary)
                            }.padding(12).glassPanel(18).smoothAppear()
                        }
                        Button { showAddFriend = true } label: {
                            Label(L("Arkadaş ekle","Add friend"), systemImage: "person.badge.plus")
                        }.buttonStyle(.glassy)


                        // KULÜPLER — davet koduyla girilir; kulüptekiler birlikte sürünce ortak video
                        section(L("Kulüpler","Clubs"))
                        if clubs.isEmpty {
                            Text(L("Henüz bir kulübün yok. Kur ya da davet koduyla katıl.","No clubs yet. Create one or join with an invite code."))
                                .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(clubs) { c in
                            Button { secilenKulup = c } label: {
                                HStack(spacing: 12) {
                                    Text("🏍️").font(.system(size: 24))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(c.name).font(.system(size: 16, weight: .semibold))
                                        Text("\(c.memberCount) " + L("üye","members")).font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").foregroundStyle(.secondary)
                                }.padding(14).contentShape(Rectangle())
                            }.buttonStyle(.plain).glassPanel(18)
                        }
                        Button { showClubs = true } label: {
                            Label(L("Kulüp kur / koda katıl","Create / join a club"), systemImage: "person.3.fill")
                        }.buttonStyle(.glassy)

                        // 05.11.2026: GRUP SÜRÜŞ GERİ GELDİ — ortak video artık TELEFONDA (3D motor eşleri çizer).
                        // Yalnız EKLENMİŞ arkadaşlar eşleşir (sunucu: friends tablosu, karşılıklı).
                        section(L("Grup sürüş","Group ride"))
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Label(L("Birlikte sürüş videosu","Ride-together video"), systemImage: "person.2.fill")
                                    .font(.system(size: 16, weight: .medium))
                                Spacer()
                                Picker("", selection: Binding(
                                    get: { groupPref },
                                    set: { v in groupPref = v; Task { await store.setGroupVideoPref(v) } })) {
                                    Text(L("Ortak + kendi videom","Joint + my own")).tag("both")
                                    Text(L("Sadece ortak video","Joint video only")).tag("group")
                                    Text(L("Sadece kendi videom","My own video only")).tag("solo")
                                }.pickerStyle(.menu).tint(Brand.accent)
                            }
                            Text(L("Arkadaşların ya da kulüp üyelerinle birlikte sürünce hepinizin yer aldığı ortak 3D video telefonunda üretilir. Yalnız tanıdıkların algılanır.",
                                   "When you ride with friends or club members, a joint 3D video featuring all of you is made on your phone. Only people you know are detected."))
                                .font(.caption2).foregroundStyle(.secondary)
                        }.padding(14).glassPanel(18)
                        // 05.11.2026: ortak videolar Move Log Pro ile (tek seferlik)
                        if !store.pro {
                            Button { showPro = true } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "lock.fill").foregroundStyle(Brand.accent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(L("Ortak videolar Pro ile","Joint videos with Pro")).font(.system(size: 15, weight: .semibold))
                                        Text(L("Tek seferlik satın alma, abonelik yok","One-time purchase, no subscription"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").foregroundStyle(.secondary)
                                }.padding(14).contentShape(Rectangle())
                            }.buttonStyle(.plain).glassPanel(18)
                        }

                    }.padding(16)
                }
            }
            .navigationTitle(L("Sosyal","Social"))
            .navigationDestination(item: $secilenKulup) { c in
                ClubDetailView(clubId: c.id, onChanged: { Task { clubs = await store.clubs() } })
            }
        }
        .task { await yenile() }
        .refreshable { await yenile() }
        .onChange(of: store.davetYenile) { _, _ in Task { await reloadFriends() } }
        .sheet(isPresented: $showAddFriend) { AddFriendSheet(myHandle: prof?.handle ?? "", onDone: { Task { await reloadFriends() } }) }
        .sheet(isPresented: $showClubs, onDismiss: { Task { clubs = await store.clubs() } }) { ClubsSheet() }
        .sheet(isPresented: $showPro) { ProSheet() }
        .confirmationDialog(
            L("Arkadaşlıktan çıkarılsın mı?","Remove this friend?"),
            isPresented: Binding(get: { silinecekArkadas != nil }, set: { if !$0 { silinecekArkadas = nil } }),
            titleVisibility: .visible
        ) {
            Button(L("Arkadaşlıktan çıkar","Remove friend"), role: .destructive) {
                if let f = silinecekArkadas {
                    Task { await store.removeFriend(f.username); await reloadFriends() }
                }
                silinecekArkadas = nil
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) { silinecekArkadas = nil }
        } message: {
            Text(silinecekArkadas.map { $0.name ?? $0.username } ?? "")
        }
        .sheet(isPresented: $davetPaylas) {
            if #available(iOS 16.0, *) {
                ShareLink(item: davetKod) { Text(L("Davet linkini paylaş","Share invite link")) }
                    .presentationDetents([.medium])
            }
        }
        .alert(L("Davet kodu","Invite code"), isPresented: $davetGirisAcik) {
            TextField(L("Kodu yapıştır","Paste the code"), text: $davetGirisi)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(L("Kabul et","Accept")) {
                let kod = DavetLink.ayikla(davetGirisi)
                davetGirisi = ""
                Task {
                    let ok = await store.acceptInvite(kod)
                    store.davetSonuc = ok ? L("Arkadaş eklendi 🤝","Friend added 🤝")
                                          : L("Kod geçersiz veya süresi dolmuş.","Invalid or expired code.")
                    if ok { store.davetYenile += 1; await reloadFriends() }
                }
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) { davetGirisi = "" }
        }
    }

    func yenile() async {
        prof = await store.profile()
        await reloadFriends()
        clubs = await store.clubs()
        groupPref = await store.groupVideoPref()
    }
    func reloadFriends() async {
        friends = await store.friends()
        let r = await store.friendRequests()
        incoming = r.incoming; outgoing = r.outgoing
    }
    func section(_ t: String) -> some View {
        Text(t.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
    }
}
