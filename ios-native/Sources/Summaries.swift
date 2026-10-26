import SwiftUI
import AVKit

// Özet sekmesi: günlük + aralık özetleri listelenir; kullanıcı tarih/saat aralığı seçip özet çıkarabilir.
struct SummariesView: View {
    @EnvironmentObject var store: Store
    @AppStorage("nd_premium") var premium = false
    @State private var items: [ActivitySummary] = []
    @State private var showRange = false
    @State private var busy = false
    @State private var note: String?
    @State private var playerBox: PlayerBox?
    @State private var genSummary: ActivitySummary?   // özet videosunu seçeneklerle yeniden üret
    @State private var kartBusy = false               // haftalık kart indiriliyor
    @State private var paylasKart: PaylasimKarti?     // indirilen kart -> paylaşım sayfası (Routes.swift)

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    LazyVStack(spacing: 12) {
                        HStack(spacing: 10) {
                            Button { Task { await genToday() } } label: {
                                Label(L("Bugünü özetle", "Summarize today"), systemImage: "sparkles")
                                    .font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity)
                            }.buttonStyle(.glassyProminent()).disabled(busy)
                            Button { showRange = true } label: {
                                Label(L("Tarih aralığı", "Date range"), systemImage: "calendar")
                                    .font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity)
                            }.buttonStyle(.glassyProminent()).disabled(busy)
                        }
                        // HAFTALIK KART (26.10): bugünle biten 7 günün paylaşılabilir PNG kartı.
                        // Kısa bas = Story (9:16); uzun bas = biçim seç (Rotalar'daki kart düğmesiyle aynı).
                        Button { Task { await haftalikKart("dikey") } } label: {
                            HStack(spacing: 8) {
                                if kartBusy { ProgressView().tint(.white) }
                                else { Image(systemName: "square.and.arrow.up") }
                                Text(L("Haftalık kartı paylaş", "Share weekly card"))
                            }.font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity)
                        }.buttonStyle(.glassyProminent()).disabled(busy || kartBusy)
                        .contextMenu {
                            Button { Task { await haftalikKart("dikey") } } label: {
                                Label(L("Story (9:16)", "Story (9:16)"), systemImage: "rectangle.portrait")
                            }
                            Button { Task { await haftalikKart("kare") } } label: {
                                Label(L("Kare (1:1)", "Square (1:1)"), systemImage: "square")
                            }
                        }
                        if let note { Text(note).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }

                        if items.isEmpty && !busy {
                            VStack(spacing: 8) {
                                Image(systemName: "doc.text.magnifyingglass").font(.system(size: 34)).foregroundStyle(.secondary)
                                Text(L("Henüz özet yok. Bir gün sür ya da yukarıdan bir aralık seç, özetin burada listelensin.",
                                       "No summaries yet. Ride a day or pick a range above; summaries appear here."))
                                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            }.padding(.top, 48).padding(.horizontal, 20)
                        }

                        ForEach(items) { s in
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(s.date).font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.accent)
                                    Text(s.summary).font(.system(size: 14)).foregroundStyle(.primary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                VStack(spacing: 8) {
                                    if let vid = s.videoId {   // o günün videosu varsa izle
                                        Button { play(vid) } label: {
                                            Image(systemName: "play.fill").font(.system(size: 15, weight: .bold))
                                                .foregroundStyle(.white).frame(width: 40, height: 40)
                                                .background(Brand.gradient, in: Circle())
                                        }.buttonStyle(.plain)
                                    }
                                    // Özet videosunu istediğin ayarlarla yeniden üret (rotalar gibi)
                                    if s.from != nil && s.to != nil {
                                        Button { if premium { genSummary = s } else { note = L("Bu özellik Premium'a özel.", "This feature is Premium.") } } label: {
                                            Image(systemName: "slider.horizontal.3").font(.system(size: 15, weight: .semibold))
                                                .foregroundStyle(Brand.accent).frame(width: 40, height: 40)
                                                .background(.thinMaterial, in: Circle())
                                        }.buttonStyle(.plain)
                                    }
                                }
                            }
                            .padding(14).glassPanel(18).smoothAppear()
                        }
                    }.padding(16)
                }
                // AŞAĞI ÇEK-TAZELE (1.62): Barış'ın şikayeti "aşağı kaydırsam da yenilenmiyor".
                // Bu ekranda hiç yoktu; Rotalar (Routes.swift:166) ve Videolarım (Videos.swift:199)
                // ile AYNI desen. ScrollView'a takılı olmalı — ZStack/NavigationStack'e takılırsa
                // jest hiç görünmez (sessiz arıza). Liste boşken de çalışır: boş-durum kartı
                // LazyVStack'in içinde, ScrollView kaydırılabilir kalıyor.
                .refreshable { await tazele() }
            }
            .navigationTitle(L("Özet", "Summary"))
        }
        .task { await tazele() }
        .sheet(isPresented: $showRange) { RangeSheet { from, to in Task { await genRange(from, to) } } }
        .sheet(item: $genSummary, onDismiss: { Task { await tazele() } }) { s in
            // rideId: nil = TÜM GÜN aralığından (s.from–s.to) YENİ özet videosu üret
            // (s.videoId verilirse yalnız o tek aktivitenin videosu düzenlenirdi → tüm günü almazdı)
            GenerateSheet(from: s.from ?? 0, to: s.to ?? 0, type: "moto",
                          mode: "flyover", aspect: "9:16", speed: "medium", rideId: nil)
        }
        .sheet(item: $paylasKart) { k in
            PaylasimSayfasi(ogeler: [k.url]) { paylasKart = nil }
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
        .sheet(item: $playerBox) { box in
            VideoPlayer(player: box.player).ignoresSafeArea()
                .onAppear { box.player.play() }.onDisappear { box.player.pause() }
        }
    }

    /// Özet listesini sunucudan yeniden çeker. Hem ilk açılış (.task) hem aşağı-çek (.refreshable)
    /// buradan geçer — tek yol, tek davranış.
    func tazele() async {
        let taze = await store.activities()
        await MainActor.run { items = taze }
    }

    func play(_ id: String) {
        Task {
            let asset = AVURLAsset(url: store.videoURL(id), options: ["AVURLAssetHTTPHeaderFieldsKey": store.authHeader])
            _ = try? await asset.load(.isPlayable)
            let p = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            await MainActor.run { playerBox = PlayerBox(player: p) }
        }
    }

    // Haftalık kartı indir -> geçici PNG -> paylaşım sayfası. `gun` GÖNDERİLMEZ: sunucu kendi TR
    // gününü kullanır (rides.date TR günü; cihaz saat dilimi farklıysa gün kaymasın). Cihaz tarihi
    // yalnız dosya adı için. Hata (ör. 404 "bu hafta sürüş yok") sunucu metniyle `note` satırında.
    func haftalikKart(_ f: String) async {
        guard !kartBusy else { return }
        kartBusy = true
        defer { kartBusy = false }
        let df = DateFormatter()
        df.calendar = Calendar(identifier: .gregorian)
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = .current
        df.dateFormat = "yyyy-MM-dd"
        let gun = df.string(from: Date())
        do {
            let d = try await store.kartIndir(path: "/api/summary/kart?f=\(f)")
            paylasKart = PaylasimKarti(url: try kartDosyasi(d, ad: "hafta-\(gun)"))
            note = nil
        } catch {
            note = error.localizedDescription
        }
    }

    func genToday() async {
        busy = true; note = L("Hazırlanıyor…", "Preparing…")
        _ = await store.summaryNow(premium: premium)
        try? await Task.sleep(for: .seconds(2)); items = await store.activities()
        busy = false; note = nil
    }
    func genRange(_ from: Double, _ to: Double) async {
        busy = true; note = L("Aralık özeti hazırlanıyor…", "Preparing range summary…")
        _ = await store.summaryRange(from: from, to: to)
        try? await Task.sleep(for: .seconds(2)); items = await store.activities()
        busy = false; note = L("Hazır olunca listede görünür.", "Appears in the list when ready.")
    }
}

// Tarih + saat aralığı seçici
struct RangeSheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var from = Calendar.current.date(byAdding: .hour, value: -3, to: Date()) ?? Date()
    @State private var to = Date()
    var onGen: (Double, Double) -> Void
    var body: some View {
        NavigationStack {
            Form {
                DatePicker(L("Başlangıç", "Start"), selection: $from)
                DatePicker(L("Bitiş", "End"), selection: $to)
                if to <= from {
                    Text(L("Bitiş, başlangıçtan sonra olmalı.", "End must be after start.")).font(.caption).foregroundStyle(.red)
                }
            }
            .navigationTitle(L("Tarih aralığı", "Date range"))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Özet çıkar", "Summarize")) {
                        onGen(from.timeIntervalSince1970, to.timeIntervalSince1970); dismiss()
                    }.disabled(to <= from)
                }
                ToolbarItem(placement: .cancellationAction) { Button(L("Vazgeç", "Cancel")) { dismiss() } }
            }
        }
    }
}
