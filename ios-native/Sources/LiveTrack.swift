import SwiftUI
import MapKit

// 1.8 CANLI TAKİP: arkadaşını "Bul" tadında canlı izle — akan konum + anlık hız + nabız + bugünkü km.
// Açılınca /api/live/start (arkadaş sürüşte değilse sessiz push ile uyandırılır), 4 sn'de bir tazelenir.
struct LiveTrackView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var friend: Friend
    @State private var t: LiveTelemetry? = nil
    @State private var waking = true
    @State private var cam: MapCameraPosition = .automatic
    @State private var timer: Timer? = nil

    func chip(_ emoji: String, _ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(emoji).font(.system(size: 18))
            Text(value).font(.system(size: 17, weight: .bold, design: .rounded))
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).padding(.vertical, 10).glassPanel(14)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $cam) {
                    if let t {
                        Annotation(t.name, coordinate: .init(latitude: t.lat, longitude: t.lon)) {
                            ZStack {
                                Circle().fill(Brand.accent.opacity(0.25)).frame(width: 44, height: 44)
                                AvatarView(name: friend.name ?? friend.username, avatar: friend.avatar, size: 32)
                            }
                        }
                    }
                }
                .ignoresSafeArea(edges: .bottom)
                VStack {
                    Spacer()
                    VStack(spacing: 10) {
                        if let t {
                            HStack(spacing: 8) {
                                chip("🏍️", String(format: "%.0f", t.spd), "km/h")
                                chip("❤️", t.hr != nil ? "\(t.hr!)" : "—", L("nabız","bpm"))
                                chip("🛣️", String(format: "%.1f", t.today_km), L("bugün km","km today"))
                                chip("📡", t.age < 60 ? "\(t.age)s" : "\(t.age/60)dk", L("sinyal","signal"))
                            }
                            if t.age > 180 {
                                Text(L("Sinyal eski — telefon uyandırılıyor, birazdan tazelenir 📡",
                                       "Signal is stale — waking their phone, it'll refresh shortly 📡"))
                                    .font(.caption2).foregroundStyle(.secondary)
                            } else if t.hr == nil {
                                Text(L("Nabız için arkadaşının Apple Watch'u bağlı olmalı",
                                       "Heart rate needs their Apple Watch connected"))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        } else if waking {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text(L("Bağlanılıyor — arkadaşının telefonu uyandırılıyor…",
                                       "Connecting — waking your friend's phone…"))
                                    .font(.caption).foregroundStyle(.secondary)
                            }.padding(12).glassPanel(14)
                        } else {
                            Text(L("Konum alınamadı — arkadaşın uygulamayı hiç açmamış olabilir.",
                                   "Couldn't get a location — your friend may have never opened the app."))
                                .font(.caption).foregroundStyle(.secondary).padding(12).glassPanel(14)
                        }
                    }.padding(12)
                }
            }
            .navigationTitle((friend.name ?? friend.username))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(L("Kapat","Close")) { dismiss() } } }
        }
        .task {
            _ = await store.liveStart(friend.username)
            await refresh(center: true)
            waking = false
            timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in
                Task { await refresh(center: false) }
            }
        }
        .onDisappear { timer?.invalidate() }
    }

    func refresh(center: Bool) async {
        if let x = await store.liveGet(friend.username) {
            let moved = t == nil || abs(x.lat - (t?.lat ?? 0)) > 0.0001 || abs(x.lon - (t?.lon ?? 0)) > 0.0001
            t = x
            if center || moved {
                withAnimation(.easeInOut(duration: 1.2)) {
                    cam = .region(.init(center: .init(latitude: x.lat, longitude: x.lon),
                                        span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)))
                }
            }
        }
    }
}
