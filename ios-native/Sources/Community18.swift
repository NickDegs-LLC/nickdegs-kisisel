import SwiftUI

// ==================== ROTA PAYLAŞIMI ====================
// 18.09: SafetySheet / BadgesSheet / WrappedSheet kaldırıldı (güvenlik, rozet, yıl özeti çıktı).
// ShareRouteSheet: rotayı arkadaşına gönder. SharedRoutesSheet: sana gelen rotalar.

struct ShareRouteSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var rideId: String
    @State private var friendsList: [Friend] = []
    @State private var sentTo: Set<String> = []
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("🗺️ " + L("Rotayı gönder","Send this route")).font(.title2.bold())
                        Text(L("Bu rotayı bir arkadaşına gönder — 'sen de sür' meydan okuması gibi düşün.",
                               "Send this route to a friend — think of it as a 'you ride it too' challenge."))
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
                        if friendsList.isEmpty {
                            Text(L("Önce bir arkadaş ekle.","Add a friend first."))
                                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 10)
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Rotayı gönder","Send route"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task { friendsList = await store.friends() }
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
