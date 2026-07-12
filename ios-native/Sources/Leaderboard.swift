import SwiftUI

// LİDERLİK TABLOSU (1.7): son 7 günün km sıralaması — sadece arkadaşların + kulüp arkadaşların
// arasında (yabancı görünmez). Kulüplerle aynı gün doğdu: "Kartal Riders'ta bu hafta 1.sin" hissi.
struct LeaderRow: Codable, Identifiable, Hashable {
    var username: String; var name: String; var handle: String?; var avatar: Avatar?
    var km: Double; var rides: Int; var secs: Int; var rank: Int
    var id: String { username }
}

struct LeaderboardSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var rows: [LeaderRow] = []
    @State private var myRank = 0
    @State private var me = ""
    @State private var loading = true

    func medal(_ r: Int) -> String { r == 1 ? "🥇" : r == 2 ? "🥈" : r == 3 ? "🥉" : "\(r)." }

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("🏆 " + L("Haftanın liderleri","This week's leaders")).font(.title2.bold())
                        Text(L("Son 7 gün — arkadaşların ve grup arkadaşların arasında.",
                               "Last 7 days — among your friends and group mates."))
                            .font(.caption).foregroundStyle(.secondary)
                        if loading {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, 30)
                        } else if rows.count <= 1 {
                            Text(L("Henüz yarışacak kimse yok — arkadaş ekle ya da grup kur, km'ler konuşsun!",
                                   "No one to race yet — add friends or create a group and let the kilometers talk!"))
                                .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 16)
                        }
                        ForEach(rows) { r in
                            HStack(spacing: 12) {
                                Text(medal(r.rank))
                                    .font(.system(size: r.rank <= 3 ? 24 : 16, weight: .bold))
                                    .frame(width: 36)
                                AvatarView(name: r.name, avatar: r.avatar, size: 40)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(r.name).font(.system(size: 15, weight: r.username == me ? .bold : .medium))
                                    Text("\(r.rides) " + L("sürüş","rides"))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(String(format: "%.1f km", r.km))
                                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                                    .foregroundStyle(r.rank == 1 ? Brand.accent : .primary)
                            }
                            .padding(12).glassPanel(14)
                            .overlay(RoundedRectangle(cornerRadius: 14)
                                .stroke(r.username == me ? Brand.accent.opacity(0.7) : .clear, lineWidth: 1.5))
                        }
                        if myRank > 0 && !rows.isEmpty {
                            Text(L("Sıran","Your rank") + ": \(myRank)/\(rows.count) 🏍️")
                                .font(.footnote).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .center).padding(.top, 4)
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(L("Liderlik","Leaderboard"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task {
            me = (await store.profile())?.username ?? ""
            let d = await store.leaderboard()
            rows = d.0; myRank = d.1; loading = false
        }
    }
}
