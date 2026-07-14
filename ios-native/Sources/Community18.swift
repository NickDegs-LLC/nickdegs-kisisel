import SwiftUI

// ==================== 1.8 TOPLULUK+GÜVENLİK PAKETİ ====================
// SafetySheet: "Eve sağ salim vardım" — güvenlik kişisi (arkadaş) + bildirim tercihleri.
// BadgesSheet: rozet vitrini. WrappedSheet: yıl özeti. ShareRouteSheet: rotayı arkadaşa/kulübe gönder.
// SharedRoutesSheet: sana gelen rotalar.

let BADGE_META: [(key: String, emoji: String, tr: String, en: String)] = [
    ("first", "🏁", "İlk Sürüş", "First Ride"),
    ("km1000", "🛣️", "1.000 km Kulübü", "1,000 km Club"),
    ("km5000", "🌍", "5.000 km Kulübü", "5,000 km Club"),
    ("longride", "🚀", "Uzun Yol Ustası", "Long Haul Master"),
    ("night", "🌙", "Gece Kartalı", "Night Owl"),
    ("cities5", "🗺️", "5 Bölge Gezgini", "5-Region Explorer"),
    ("streak7", "🔥", "7 Gün Seri", "7-Day Streak"),
    ("social", "🤝", "Yol Arkadaşı", "Road Buddy"),
]

struct SafetySheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var friendsList: [Friend] = []
    @State private var buddy = ""
    @State private var buddyName = ""
    @State private var arrive = true
    @State private var longstop = true
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("🛡️ " + L("Güvenli sürüş","Ride safety")).font(.title2.bold())
                        Text(L("Bir güvenlik kişisi seç: sürüşünü bitirdiğinde ona otomatik 'sağ salim' bildirimi gider; yolda uzun süre hareketsiz kalırsan haberdar edilir.",
                               "Pick a safety contact: they get an automatic 'safe and sound' notification when you finish a ride, and a heads-up if you stay still too long mid-ride."))
                            .font(.caption).foregroundStyle(.secondary)
                        if loading { ProgressView().frame(maxWidth: .infinity).padding(.top, 20) }
                        else {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(L("Güvenlik kişin","Your safety contact")).font(.headline)
                                if friendsList.isEmpty {
                                    Text(L("Önce bir arkadaş ekle — güvenlik kişisi arkadaş listenden seçilir.",
                                           "Add a friend first — your safety contact comes from your friends list."))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                ForEach(friendsList) { f in
                                    Button {
                                        let nb = (buddy == f.username) ? "" : f.username
                                        buddy = nb; buddyName = nb.isEmpty ? "" : (f.name ?? f.username)
                                        Task { await store.setSafety(buddy: nb, arrive: nil, longstop: nil) }
                                    } label: {
                                        HStack(spacing: 12) {
                                            AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 40)
                                            Text(f.name ?? f.username).font(.system(size: 15, weight: .medium))
                                            Spacer()
                                            Image(systemName: buddy == f.username ? "checkmark.circle.fill" : "circle")
                                                .foregroundStyle(buddy == f.username ? Brand.accent : .secondary)
                                        }.padding(12).contentShape(Rectangle())
                                    }.buttonStyle(.plain).glassPanel(14)
                                }
                            }
                            VStack(spacing: 0) {
                                Toggle(isOn: Binding(get: { arrive },
                                    set: { v in arrive = v; Task { await store.setSafety(buddy: nil, arrive: v, longstop: nil) } })) {
                                    Label(L("Vardım bildirimi","Arrival notification"), systemImage: "checkmark.shield")
                                        .font(.system(size: 15, weight: .medium))
                                }.tint(Brand.accent)
                                Divider().padding(.vertical, 10)
                                Toggle(isOn: Binding(get: { longstop },
                                    set: { v in longstop = v; Task { await store.setSafety(buddy: nil, arrive: nil, longstop: v) } })) {
                                    Label(L("Uzun duraklama uyarısı","Long-stop alert"), systemImage: "exclamationmark.triangle")
                                        .font(.system(size: 15, weight: .medium))
                                }.tint(Brand.accent)
                            }.padding(14).glassPanel(18)
                            .opacity(buddy.isEmpty ? 0.45 : 1)
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Güvenlik","Safety"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task {
            friendsList = await store.friends()
            let s = await store.safety()
            buddy = s.buddy; buddyName = s.buddyName; arrive = s.arrive; longstop = s.longstop
            loading = false
        }
    }
}

struct BadgesSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var mine: [String] = []

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("🏅 " + L("Rozetlerim","My badges")).font(.title2.bold())
                        Text(L("Sürdükçe açılır. Hepsini toplayan efsane olur.",
                               "Unlock them by riding. Collect them all, become a legend."))
                            .font(.caption).foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(BADGE_META, id: \.key) { b in
                                let has = mine.contains(b.key)
                                VStack(spacing: 6) {
                                    Text(b.emoji).font(.system(size: 38)).opacity(has ? 1 : 0.25)
                                    Text(L(b.tr, b.en)).font(.system(size: 13, weight: .semibold))
                                        .multilineTextAlignment(.center)
                                        .foregroundStyle(has ? .primary : .secondary)
                                    if has { Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(Brand.accent) }
                                    else { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 16).glassPanel(16)
                            }
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Rozetler","Badges"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task { mine = await store.badges() }
    }
}

struct WrappedSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var w: WrappedStats? = nil

    func stat(_ emoji: String, _ title: String, _ value: String) -> some View {
        HStack(spacing: 12) {
            Text(emoji).font(.system(size: 26))
            Text(title).font(.system(size: 15, weight: .medium))
            Spacer()
            Text(value).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(Brand.accent)
        }.padding(13).glassPanel(14)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("🎁 " + L("Yıl özetim","My year wrapped") + (w != nil ? " — \(w!.year)" : "")).font(.title2.bold())
                        if let w {
                            stat("🛣️", L("Toplam yol","Total distance"), String(format: "%.0f km", w.km))
                            stat("🏍️", L("Sürüş sayısı","Rides"), "\(w.rides)")
                            stat("⏱️", L("Selede geçen saat","Hours in the saddle"), String(format: "%.1f", w.hours))
                            stat("🚀", L("En uzun sürüş","Longest ride"), String(format: "%.1f km", w.longestKm))
                            stat("🌙", L("Gece sürüşleri","Night rides"), "\(w.nightRides)")
                            stat("🏅", L("Rozetler","Badges"), "\(w.badges.count)/\(BADGE_META.count)")
                            Text(L("Yıl bitmeden bu sayıları büyütmek serbest 😄","Feel free to grow these numbers before the year ends 😄"))
                                .font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                        } else { ProgressView().frame(maxWidth: .infinity).padding(.top, 30) }
                    }.padding(16)
                }
            }
            .navigationTitle("Wrapped")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task { w = await store.wrapped() }
    }
}

struct ShareRouteSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var rideId: String
    @State private var friendsList: [Friend] = []
    @State private var clubs: [Club] = []
    @State private var sentTo: Set<String> = []
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("🗺️ " + L("Rotayı gönder","Send this route")).font(.title2.bold())
                        Text(L("Bu rotayı bir arkadaşına ya da kulübüne gönder — 'sen de sür' meydan okuması gibi düşün.",
                               "Send this route to a friend or your club — think of it as a 'you ride it too' challenge."))
                            .font(.caption).foregroundStyle(.secondary)
                        if !friendsList.isEmpty {
                            Text(L("Arkadaşlar","Friends")).font(.headline)
                            ForEach(friendsList) { f in
                                Button {
                                    busy = true
                                    Task { if await store.shareRoute(rideId, toUser: f.username) { sentTo.insert(f.username) }; busy = false }
                                } label: {
                                    HStack(spacing: 12) {
                                        AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 38)
                                        Text(f.name ?? f.username).font(.system(size: 15, weight: .medium))
                                        Spacer()
                                        if sentTo.contains(f.username) {
                                            Label(L("Gönderildi","Sent"), systemImage: "checkmark").font(.caption).foregroundStyle(.green)
                                        } else { Image(systemName: "paperplane").foregroundStyle(Brand.accent) }
                                    }.padding(12).contentShape(Rectangle())
                                }.buttonStyle(.plain).glassPanel(14).disabled(busy || sentTo.contains(f.username))
                            }
                        }
                        if !clubs.isEmpty {
                            Text(L("Gruplar","Groups")).font(.headline)
                            ForEach(clubs) { c in
                                Button {
                                    busy = true
                                    Task { if await store.shareRoute(rideId, toClub: c.id) { sentTo.insert(c.id) }; busy = false }
                                } label: {
                                    HStack(spacing: 12) {
                                        Text("🏍️").font(.system(size: 22))
                                        Text(c.name).font(.system(size: 15, weight: .medium))
                                        Spacer()
                                        if sentTo.contains(c.id) {
                                            Label(L("Gönderildi","Sent"), systemImage: "checkmark").font(.caption).foregroundStyle(.green)
                                        } else { Image(systemName: "paperplane").foregroundStyle(Brand.accent) }
                                    }.padding(12).contentShape(Rectangle())
                                }.buttonStyle(.plain).glassPanel(14).disabled(busy || sentTo.contains(c.id))
                            }
                        }
                        if friendsList.isEmpty && clubs.isEmpty {
                            Text(L("Önce arkadaş ekle ya da bir grup kur.","Add a friend or create a group first."))
                                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 10)
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Rotayı gönder","Send route"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task { friendsList = await store.friends(); clubs = await store.clubs() }
    }
}

struct SharedRoutesSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var routes: [SharedRoute] = []
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("🗺️ " + L("Sana gelen rotalar","Routes shared with you")).font(.title2.bold())
                        if loading { ProgressView().frame(maxWidth: .infinity).padding(.top, 30) }
                        else if routes.isEmpty {
                            Text(L("Henüz rota gelmemiş. Arkadaşların güzel bir rota sürünce buraya düşer.",
                                   "No routes yet. When friends ride something great, it lands here."))
                                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 16)
                        }
                        ForEach(routes) { r in
                            HStack(spacing: 12) {
                                Text("🗺️").font(.system(size: 24))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.fromName).font(.system(size: 15, weight: .semibold))
                                    Text("\(String(format: "%.1f", r.km ?? 0)) km · \(r.date ?? "")")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(r.ridden ? L("Sürdün ✅","Ridden ✅") : L("Seni bekliyor","Waiting for you"))
                                    .font(.caption).foregroundStyle(r.ridden ? .green : Brand.accent)
                            }.padding(13).glassPanel(14)
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Gelen rotalar","Shared routes"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task { routes = await store.sharedRoutes(); loading = false }
    }
}
