import SwiftUI

struct WatchContentView: View {
    @EnvironmentObject var link: WatchLink
    @EnvironmentObject var workout: WorkoutManager
    @State private var videoState = 0   // 0=yok 1=istendi/ok 2=hata

    var body: some View {
        Group {
            if workout.running { liveView }
            else if workout.endedAt != nil { doneView }
            else if link.ready { startView }
            else { pairView }
        }
    }

    // Telefonla eşleşme bekleniyor
    var pairView: some View {
        VStack(spacing: 8) {
            Image(systemName: "iphone.and.arrow.forward").font(.title2).foregroundStyle(.cyan)
            Text(WL("iPhone'da Move Log'u açıp giriş yap — saat kendini otomatik bağlar.",
                    "Open Move Log on your iPhone and sign in — the watch links automatically."))
                .font(.footnote).multilineTextAlignment(.center)
        }.padding()
    }

    // Tip seç + başlat
    var startView: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(WL("Kayıt başlat","Start recording")).font(.headline)
                ForEach([("moto","🏍️", WL("Motosiklet","Motorcycle")),
                         ("car","🚗", WL("Araba","Car")),
                         ("bike","🚴", WL("Bisiklet","Cycling")),
                         ("run","🏃", WL("Koşu","Running")),
                         ("walk","🚶", WL("Yürüyüş","Walking"))], id: \.0) { t in
                    Button {
                        videoState = 0
                        workout.start(type: t.0)
                    } label: {
                        HStack { Text(t.1); Text(t.2).font(.system(size: 15, weight: .semibold)); Spacer() }
                    }
                }
                if workout.locDenied {
                    Text(WL("Konum izni gerekli — saat Ayarlar > Gizlilik > Konum.",
                            "Location permission needed — watch Settings > Privacy > Location."))
                        .font(.caption2).foregroundStyle(.red)
                }
            }
        }
    }

    // Canlı sürüş ekranı
    var liveView: some View {
        VStack(spacing: 4) {
            HStack {
                Text(elapsed).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(.cyan)
                Spacer()
                if workout.heartRate > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "heart.fill").foregroundStyle(.red).font(.system(size: 12))
                        Text("\(workout.heartRate)").font(.system(size: 15, weight: .bold, design: .rounded))
                    }
                }
            }
            Text(String(format: "%.0f", workout.speedKmh))
                .font(.system(size: 54, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(WL("km/s","km/h")).font(.caption2).foregroundStyle(.secondary)
            HStack {
                Text(String(format: "%.2f km", workout.distanceKm)).font(.system(size: 14, weight: .semibold))
                Spacer()
                Text("↑\(workout.sentCount)").font(.caption2).foregroundStyle(.secondary)
            }
            Button(role: .destructive) { workout.end() } label: {
                Label(WL("Bitir","Finish"), systemImage: "stop.fill")
            }.padding(.top, 2)
        }
        .padding(.horizontal, 6)
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in tick += 1 }
    }
    @State private var tick = 0
    var elapsed: String {
        _ = tick
        guard let s = workout.startedAt else { return "0:00" }
        let t = Int(Date().timeIntervalSince(s))
        return t >= 3600 ? String(format: "%d:%02d:%02d", t/3600, (t%3600)/60, t%60)
                         : String(format: "%d:%02d", t/60, t%60)
    }

    // Kayıt bitti — video iste veya kapat
    var doneView: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(.green)
            Text(String(format: "%.2f km", workout.distanceKm)).font(.headline)
            if videoState == 1 {
                Text(WL("Video isteği gönderildi 🎬 — hazır olunca telefonuna bildirim gelir.",
                        "Video requested 🎬 — you'll get a notification when it's ready."))
                    .font(.caption2).multilineTextAlignment(.center)
            } else {
                Button {
                    workout.requestVideo(link: link) { ok in videoState = ok ? 1 : 2 }
                } label: { Label(WL("Video oluştur","Create video"), systemImage: "video.fill") }
                if videoState == 2 {
                    Text(WL("Olmadı — telefondan dene (Premium gerekebilir).",
                            "Failed — try from phone (may need Premium)."))
                        .font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
            Button(WL("Kapat","Close")) { workout.endedAt = nil; videoState = 0 }
                .foregroundStyle(.secondary)
        }.padding(.horizontal, 6)
    }
}
