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
