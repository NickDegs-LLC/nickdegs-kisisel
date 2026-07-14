import SwiftUI
import MapKit

// 1.8 KULÜP CANLI HARİTASI: tüm üyeler tek haritada — gerçek konvoy görünümü, 5 sn'de bir tazelenir.
struct ClubLiveView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var clubId: String
    var clubName: String
    @State private var riders: [ClubRider] = []
    @State private var cam: MapCameraPosition = .automatic
    @State private var timer: Timer? = nil

    var body: some View {
        NavigationStack {
            Map(position: $cam) {
                ForEach(riders) { r in
                    Annotation(r.name, coordinate: .init(latitude: r.lat, longitude: r.lon)) {
                        VStack(spacing: 2) {
                            ZStack {
                                Circle().fill((r.age < 300 ? Brand.accent : Color.gray).opacity(0.25)).frame(width: 40, height: 40)
                                AvatarView(name: r.name, avatar: nil, size: 30)
                            }
                            if r.spd > 5 {
                                Text(String(format: "%.0f", r.spd)).font(.system(size: 10, weight: .bold))
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(.ultraThinMaterial, in: Capsule())
                            }
                        }
                    }
                }
            }
            .navigationTitle("🏍️ " + clubName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
            .overlay(alignment: .bottom) {
                if riders.isEmpty {
                    Text(L("Şu an konum paylaşan üye yok","No members sharing location right now"))
                        .font(.caption).padding(10).glassPanel(12).padding()
                }
            }
        }
        .task {
            await refresh(fit: true)
            timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in Task { await refresh(fit: false) } }
        }
        .onDisappear { timer?.invalidate() }
    }

    func refresh(fit: Bool) async {
        riders = await store.liveClub(clubId)
        if fit, let f = riders.first {
            let lats = riders.map(\.lat), lons = riders.map(\.lon)
            let c = CLLocationCoordinate2D(latitude: (lats.min()! + lats.max()!) / 2, longitude: (lons.min()! + lons.max()!) / 2)
            let span = MKCoordinateSpan(latitudeDelta: max(0.02, (lats.max()! - lats.min()!) * 1.6),
                                        longitudeDelta: max(0.02, (lons.max()! - lons.min()!) * 1.6))
            _ = f
            cam = .region(.init(center: c, span: span))
        }
    }
}

// MOTORCU GRUPLARI (1.8): kulüp kur -> 6 haneli davet koduyla katıl -> arkadaşlık ŞARTSIZ,
// aynı gruptakiler birlikte sürünce otomatik grup videosu (sunucu algılar, herkese gelir).
struct ClubsSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var clubs: [Club] = []
    @State private var newName = ""
    @State private var joinCode = ""
    @State private var busy = false
    @State private var err = ""
    @State private var selected: Club? = nil

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("🏍️ " + L("Motorcu grupların","Your rider groups")).font(.title2.bold())
                        Text(L("Gruptakiler birlikte sürünce ikinizin/hepinizin yer aldığı ortak video otomatik gelir — arkadaş eklemeye gerek yok.",
                               "When group members ride together, a shared video featuring all of you arrives automatically — no friend-adding needed."))
                            .font(.caption).foregroundStyle(.secondary)

                        if clubs.isEmpty {
                            Text(L("Henüz bir grubun yok. Kur ya da koda katıl!","No groups yet. Create one or join with a code!"))
                                .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8)
                        }
                        ForEach(clubs) { c in
                            Button { selected = c } label: {
                                HStack(spacing: 12) {
                                    Text("🏍️").font(.system(size: 24))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(c.name).font(.system(size: 16, weight: .semibold))
                                        Text("\(c.member_count) " + L("üye","members"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").foregroundStyle(.secondary)
                                }.padding(14).contentShape(Rectangle())
                            }.buttonStyle(.plain).glassPanel(16)
                        }

                        Text(L("Grup kur","Create a group")).font(.headline).padding(.top, 6)
                        HStack(spacing: 8) {
                            TextField(L("Grup adı (örn. Kartal Riders)","Group name (e.g. Night Riders)"), text: $newName)
                                .textFieldStyle(.roundedBorder)
                            Button(L("Kur","Create")) {
                                Task { await create() }
                            }.buttonStyle(.borderedProminent).tint(Brand.accent)
                                .disabled(busy || newName.trimmingCharacters(in: .whitespaces).count < 3)
                        }

                        Text(L("Koda katıl","Join with a code")).font(.headline).padding(.top, 6)
                        HStack(spacing: 8) {
                            TextField(L("6 haneli davet kodu","6-letter invite code"), text: $joinCode)
                                .textFieldStyle(.roundedBorder)
                                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            Button(L("Katıl","Join")) {
                                Task { await join() }
                            }.buttonStyle(.borderedProminent).tint(Brand.accent)
                                .disabled(busy || joinCode.trimmingCharacters(in: .whitespaces).count != 6)
                        }
                        if !err.isEmpty { Text(err).font(.caption).foregroundStyle(.red) }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Gruplar","Groups"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
            .navigationDestination(item: $selected) { c in
                ClubDetailView(clubId: c.id, onChanged: { Task { clubs = await store.clubs() } })
            }
        }
        .task { clubs = await store.clubs() }
    }

    func create() async {
        busy = true; err = ""
        if let c = await store.createClub(newName.trimmingCharacters(in: .whitespaces)) {
            newName = ""; clubs = await store.clubs(); selected = c
        } else { err = L("Grup kurulamadı — tekrar dene","Couldn't create the group — try again") }
        busy = false
    }

    func join() async {
        busy = true; err = ""
        if let c = await store.joinClub(joinCode.trimmingCharacters(in: .whitespaces).uppercased()) {
            joinCode = ""; clubs = await store.clubs(); selected = c
        } else { err = L("Kod bulunamadı ya da grup dolu","Code not found or the group is full") }
        busy = false
    }
}

struct ClubDetailView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var clubId: String
    var onChanged: () -> Void
    @State private var club: Club? = nil
    @State private var me = ""
    @State private var showLeave = false
    @State private var renaming = false
    @State private var newName = ""
    @State private var showLive = false

    var isOwner: Bool { club?.owner == me && !me.isEmpty }
    var shareText: String {
        L("Move Log'da motorcu grubuma katıl","Join my rider group on Move Log") +
        ": \(club?.name ?? "") · " + L("Kod","Code") + ": \(club?.code ?? "")" +
        " · https://apps.apple.com/app/id6780779399"
    }

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("🏍️ " + (club?.name ?? "…")).font(.title2.bold())
                        Spacer()
                        if isOwner {
                            Button { newName = club?.name ?? ""; renaming = true } label: {
                                Image(systemName: "pencil")
                            }.tint(Brand.accent)
                        }
                    }
                    Button { showLive = true } label: {
                        HStack {
                            Image(systemName: "dot.radiowaves.left.and.right").foregroundStyle(Brand.accent)
                            Text(L("Canlı konvoy haritası","Live convoy map")).font(.system(size: 15, weight: .semibold))
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.padding(13).contentShape(Rectangle())
                    }.buttonStyle(.plain).glassPanel(16)
                    if let code = club?.code {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(L("Davet kodu","Invite code")).font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Text(code).font(.system(size: 28, weight: .bold, design: .monospaced))
                                    .kerning(4)
                                Spacer()
                                ShareLink(item: shareText) {
                                    Label(L("Paylaş","Share"), systemImage: "square.and.arrow.up")
                                }.tint(Brand.accent)
                            }
                            Text(L("Bu kodu motorcu arkadaşlarına gönder — girip katılsınlar.",
                                   "Send this code to your rider friends — they enter it and join."))
                                .font(.caption2).foregroundStyle(.secondary)
                        }.padding(14).glassPanel(16)
                    }
                    Text(L("Üyeler","Members") + " (\(club?.members?.count ?? 0))").font(.headline)
                    ForEach(club?.members ?? []) { m in
                        HStack(spacing: 12) {
                            AvatarView(name: m.name ?? m.username, avatar: m.avatar, size: 40)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(m.name ?? m.username).font(.system(size: 15, weight: .medium))
                                if m.username == club?.owner {
                                    Text(L("Kurucu","Founder")).font(.caption2).foregroundStyle(Brand.accent)
                                }
                            }
                            Spacer()
                            if isOwner && m.username != me {
                                Button(role: .destructive) {
                                    Task {
                                        _ = await store.kickClubMember(clubId, m.username)
                                        club = await store.clubDetail(clubId); onChanged()
                                    }
                                } label: { Image(systemName: "person.badge.minus") }
                            }
                        }.padding(12).glassPanel(14)
                    }
                    Button(role: .destructive) { showLeave = true } label: {
                        Label(L("Gruptan ayrıl","Leave group"), systemImage: "rectangle.portrait.and.arrow.right")
                            .frame(maxWidth: .infinity)
                    }.buttonStyle(.glassy).tint(.red).padding(.top, 10)
                }.padding(16)
            }
        }
        .navigationTitle(club?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            club = await store.clubDetail(clubId)
            me = (await store.profile())?.username ?? ""
        }
        .sheet(isPresented: $showLive) { ClubLiveView(clubId: clubId, clubName: club?.name ?? "") }
        .alert(L("Gruptan ayrıl?","Leave the group?"), isPresented: $showLeave) {
            Button(L("Ayrıl","Leave"), role: .destructive) {
                Task { _ = await store.leaveClub(clubId); onChanged(); dismiss() }
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) {}
        }
        .alert(L("Grubu yeniden adlandır","Rename group"), isPresented: $renaming) {
            TextField(L("Grup adı","Group name"), text: $newName)
            Button(L("Kaydet","Save")) {
                Task { club = await store.renameClub(clubId, newName); onChanged() }
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) {}
        }
    }
}
