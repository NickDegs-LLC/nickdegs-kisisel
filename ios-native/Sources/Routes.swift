import SwiftUI
import AVKit
import UIKit
import UniformTypeIdentifiers

// .sheet(item:) için: player hazır olmadan sheet açılmasın (ilk dokunuşta kara ekran bug'ı).
struct PlayerBox: Identifiable { let id = UUID(); let player: AVPlayer }

// PAYLAŞILABİLİR KART (26.10): sunucunun ürettiği PNG geçici dosyaya yazılır, paylaşım sayfası
// dosya URL'iyle açılır → alıcıda/Dosyalar'da adı "movelog-<id>.png" görünür; sayfa zaten
// "Görüntüyü Kaydet" sunduğu için ayrıca galeriye kaydetme yok. Rotalar + Özet ortak kullanır.
struct PaylasimKarti: Identifiable { let id = UUID(); let url: URL }

func kartDosyasi(_ data: Data, ad: String) throws -> URL {
    let temiz = ad.replacingOccurrences(of: "/", with: "-")
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("movelog-\(temiz).png")
    try data.write(to: url, options: .atomic)
    return url
}

// iOS paylaşım sayfası (UIActivityViewController) SwiftUI sarmalayıcısı. Bir eylem bitince veya
// "Kapat"a basılınca `bitince` çağrılır → çağıran `.sheet(item:)` bağını nil'ler (boş sheet kalmasın).
struct PaylasimSayfasi: UIViewControllerRepresentable {
    let ogeler: [Any]
    var bitince: () -> Void = {}
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let vc = UIActivityViewController(activityItems: ogeler, applicationActivities: nil)
        vc.completionWithItemsHandler = { _, _, _, _ in bitince() }
        return vc
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

struct RoutesView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var tracker: Tracker
    @State private var trackerBusy = false   // "Aç" düğmesi: trackerInfo beklenirken
    @State private var rides: [Ride] = []
    @State private var playerBox: PlayerBox?
    @State private var editRide: Ride?
    @State private var createRide: Ride?   // videosuz rota -> "Video oluştur" (sıfırdan üretim)
    @State private var savingId: String? = nil
    @State private var savedId: String? = nil
    @State private var pendingDelete: Ride?
    @State private var pollTask: Task<Void, Never>? = nil   // render/yeni rota varken otomatik yenile
    @AppStorage("nd_route_sort") private var sortMode = "date"   // "date"=rota tarihi | "added"=son eklenen (kullanıcı seçer)
    @State private var showImporter = false   // GPX/TCX dosya seçici
    @State private var uploading = false
    @State private var uploadErr: String?
    @State private var kartId: String? = nil          // kartı indirilen rota (düğmede ProgressView)
    @State private var paylasKart: PaylasimKarti?     // indirilen kart -> paylaşım sayfası
    @State private var demoSonuc: URL? = nil          // yalnız DEMO (mağaza görseli): Documents/demo.mp4 sonuç ekranı

    // Listeyi tazele: yeni (oto-algılanan) sürüşler + biten render'lar hemen görünsün.
    func reload() async {
        let fresh = await store.rides()
        await MainActor.run { rides = fresh; managePoll() }
    }
    // Hâlâ render olan kayıt varsa 12 sn'de bir tazele -> bitince "Hazırlanıyor" açılır.
    func managePoll() {
        let anyRendering = rides.contains { $0.rendering == true }
        if anyRendering, pollTask == nil {
            pollTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(12))
                    await reload()
                }
            }
        } else if !anyRendering {
            pollTask?.cancel(); pollTask = nil
        }
    }

    // Gün + saat: "11 Haz 2026 · 14:30" (kim hangi gün ne yapmış görünsün)
    func dayTime(_ r: Ride) -> String {
        guard let ts = r.ts, ts > 0 else { return r.date }
        let f = DateFormatter()
        f.locale = Locale(identifier: L("tr_TR", "en_US"))
        f.dateFormat = L("d MMM yyyy · HH:mm", "MMM d, yyyy · HH:mm")
        return f.string(from: Date(timeIntervalSince1970: ts))
    }
    func typeLabel(_ t: String?) -> String {
        switch t { case "moto": return L("Motosiklet","Motorcycle"); case "car": return L("Araba","Car")
        case "bike": return L("Bisiklet","Cycling")
        case "run": return L("Koşu","Running"); case "walk": return L("Yürüyüş","Walking"); default: return L("Diğer","Other") }
    }
    func typeIcon(_ t: String?) -> String {
        switch t { case "moto": return "motorcycle"; case "car": return "car.fill"; case "bike": return "bicycle"
        case "run": return "figure.run"; case "walk": return "figure.walk"; default: return "point.topleft.down.curvedto.point.bottomright.up" }
    }

    // Kullanıcının seçtiği sıralama: rota tarihi (varsayılan) veya son eklenen (GPX yüklemeler üstte görünsün)
    private func addedKey(_ r: Ride) -> Double {
        if let a = r.added, a > 0 { return a }
        if let d = r.done, d > 0 { return d }
        return r.ts ?? 0
    }
    // ROTA BAŞINA TEK KART (2026-07-06 Barış): her üretilen video ayrı vid taşıdığı için aynı rota
    // N kez listeleniyordu. Aynı (tarih+başlangıç) rotadan SADECE en güncelini göster
    // (render olan öncelikli -> kilit görünür; sonra en yeni üretim). Videolarım tüm videoları göstermeye devam eder.
    private func dedupedByRide(_ list: [Ride]) -> [Ride] {
        var seen = Set<String>(); var out: [Ride] = []
        let pref = list.sorted { (a: Ride, b: Ride) -> Bool in
            if (a.rendering == true) != (b.rendering == true) { return a.rendering == true }
            return (a.done ?? 0) > (b.done ?? 0)
        }
        for r in pref {
            let key = "\(r.date)_\(Int(r.ts ?? 0))"
            if seen.insert(key).inserted { out.append(r) }
        }
        // orijinal (rota tarihi) sırasını koru
        let keep = Set(out.map { $0.id })
        return list.filter { keep.contains($0.id) }
    }

    var sortedRides: [Ride] {
        let base = dedupedByRide(rides)
        if sortMode == "added" {
            return base.sorted { (a: Ride, b: Ride) -> Bool in addedKey(a) > addedKey(b) }
        }
        return base   // backend zaten rota tarihine göre (yeni->eski) sıralı gönderir
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    LazyVStack(spacing: 12) {
                        // 10.10 (Barış: "rotalar sekmesine otomatik takip kapalı butonu"). Profil'deki "Rotamı kaydet"
                        // anahtarı KAPALIYKEN burada kırmızı kart + "Aç" görünür. 26.09 Semra vakası: takip kapalıydı,
                        // iki uzun yolculuk kaydedilmedi, kullanıcı uygulamayı bozuk sandı; 18.09–10.10 arası 42 yeni
                        // üyenin 35'i hiç konum göndermedi. "Aç" = Profil anahtarıyla BİREBİR aynı yol (trackerInfo → start).
                        if !tracker.active && !tracker.recording && !AppEnv.demo {   // demo/mağaza görselinde gösterme
                            HStack(spacing: 12) {
                                Image(systemName: "location.slash.fill").font(.system(size: 20, weight: .semibold))
                                    .foregroundStyle(.red).frame(width: 44, height: 44).glassPanel(14)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(L("Otomatik takip kapalı", "Auto-tracking is off")).font(.system(size: 15, weight: .semibold))
                                    Text(L("Sürüşlerin kaydedilmiyor. Aç — her gezin otomatik rota olur.",
                                           "Your trips aren't being recorded. Turn it on and every ride becomes a route."))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button {
                                    trackerBusy = true
                                    Task {
                                        if let t = await store.trackerInfo() { tracker.start(deviceId: t.id, url: t.url) }
                                        await MainActor.run { trackerBusy = false }
                                    }
                                } label: {
                                    Group {
                                        if trackerBusy { ProgressView().tint(.white) }
                                        else { Text(L("Aç", "Turn on")).font(.system(size: 14, weight: .semibold)) }
                                    }.foregroundStyle(.white).padding(.horizontal, 16).frame(height: 38)
                                        .background(Brand.gradient, in: Capsule())
                                }.buttonStyle(.borderless).disabled(trackerBusy)
                            }
                            .padding(14).glassPanel(20).smoothAppear()
                        }
                        ForEach(sortedRides) { r in
                            HStack(spacing: 14) {
                                Image(systemName: typeIcon(r.type)).font(.system(size: 22))
                                    .foregroundStyle(Brand.accent).frame(width: 50, height: 50).glassPanel(16)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(dayTime(r)).font(.system(size: 17, weight: .semibold))
                                        .lineLimit(1).minimumScaleFactor(0.75)   // 10.11: düğmeye yer kalsın
                                    if r.sample == true {
                                        // 10.10: ÖRNEK rota (appreview) — tip menüsü yok (sunucu 404 verir), "Örnek" etiketi var
                                        HStack(spacing: 4) {
                                            Text(typeLabel(r.type)).foregroundStyle(.secondary)
                                            Text("· " + L("Örnek", "Sample")).foregroundStyle(Brand.accent)
                                        }.font(.caption)
                                    } else {
                                    Menu {
                                        ForEach(RIDE_TYPES, id: \.id) { t in
                                            Button {
                                                Task { if await store.setRideType(r.id, t.id) { rides = await store.rides() } }
                                            } label: { Label(rideLabel(t.id), systemImage: t.icon) }
                                        }
                                    } label: {
                                        HStack(spacing: 3) {
                                            Text(typeLabel(r.type))
                                            Image(systemName: "chevron.down").font(.system(size: 9))
                                        }.font(.caption).foregroundStyle(.secondary)
                                    }
                                    }
                                }
                                Spacer()
                                // 26.10: işlem düğmeleri tek grupta (8 pt aralık) — 4. düğme (kart) satıra sığsın
                                HStack(spacing: 8) {
                                if r.sample == true && r.novideo == true {
                                    EmptyView()   // örnek rotadan video üretilmez (kullanıcının kendi izi değil)
                                } else if r.sample != true || r.novideo == true || r.failed == true {
                                    // 10.11.2026: video sunucuda SAKLANMAZ → kendi sürüşünde her zaman "Video oluştur" (telefonda üretilir)
                                    // Videosuz algılanan rota VEYA başarısız render -> kullanıcı (yeniden) video ürettirir
                                    Button { createRide = r } label: {
                                        // 10.11: metin satıra sığmayınca "Creat / e vi…" diye bölünüyordu → tek satır, sabit genişlik
                                        HStack(spacing: 6) {
                                            Image(systemName: "film.stack").font(.system(size: 13, weight: .bold))
                                            Text(L("Video oluştur","Create video")).font(.system(size: 13, weight: .semibold))
                                                .lineLimit(1).minimumScaleFactor(0.8)
                                        }.fixedSize().foregroundStyle(.white).padding(.horizontal, 12).frame(height: 42)
                                            .background(Brand.gradient, in: Capsule())
                                    }.buttonStyle(.borderless).contentShape(Rectangle())
                                } else {
                                    // İzle
                                    Button { play(r) } label: {
                                        Image(systemName: "play.fill").font(.system(size: 15, weight: .bold))
                                            .foregroundStyle(.white).frame(width: 42, height: 42)
                                            .background(Brand.gradient, in: Circle())
                                    }.buttonStyle(.borderless).contentShape(Rectangle())
                                    // Düzenle (süre/görünüm/en-boy/müzik ile yeniden oluştur)
                                    Button { editRide = r } label: {
                                        Image(systemName: "slider.horizontal.3").font(.system(size: 16, weight: .semibold))
                                            .foregroundStyle(Brand.accent).frame(width: 42, height: 42).glassPanel(21)
                                    }.buttonStyle(.borderless).contentShape(Rectangle())
                                    // Kaydet (videoyu galeriye indir)
                                    Button { save(r) } label: {
                                        Group {
                                            if savingId == r.id { ProgressView() }
                                            else if savedId == r.id { Image(systemName: "checkmark").foregroundStyle(.green) }
                                            else { Image(systemName: "square.and.arrow.down").foregroundStyle(Brand.accent) }
                                        }.font(.system(size: 16, weight: .semibold)).frame(width: 42, height: 42).glassPanel(21)
                                    }.buttonStyle(.borderless).contentShape(Rectangle()).disabled(savingId == r.id)
                                }
                                // Kartı paylaş (26.10): kısa bas = Story (9:16) dikey kart; uzun bas = biçim seç.
                                // Örnek (sample) rotada da VAR: sunucu /kart ucunda appreview rotalarına izin verir
                                // (inceleyici paylaşımı deneyebilsin) — sil/tip menüsünden farklı.
                                Group {
                                    Menu {
                                        Button { kartPaylas(r, bicim: "dikey") } label: {
                                            Label(L("Story (9:16)", "Story (9:16)"), systemImage: "rectangle.portrait")
                                        }
                                        Button { kartPaylas(r, bicim: "kare") } label: {
                                            Label(L("Kare (1:1)", "Square (1:1)"), systemImage: "square")
                                        }
                                    } label: {
                                        Group {
                                            if kartId == r.id { ProgressView() }
                                            else { Image(systemName: "square.and.arrow.up").foregroundStyle(Brand.accent) }
                                        }.font(.system(size: 16, weight: .semibold)).frame(width: 42, height: 42).glassPanel(21)
                                    } primaryAction: {
                                        kartPaylas(r, bicim: "dikey")
                                    }
                                    .contentShape(Rectangle()).disabled(kartId != nil)
                                    .accessibilityLabel(L("Kartı paylaş", "Share card"))
                                }
                                }   // HStack(spacing: 8) — işlem düğmeleri
                            }
                            .padding(14).glassPanel(20).smoothAppear()
                            .contextMenu {   // uzun bas → sil (10.10: örnek içerikte yok — sunucu 404 veriyordu)
                                if r.sample != true {
                                    Button(role: .destructive) { pendingDelete = r } label: {
                                        Label(L("Geçmişten sil", "Delete"), systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }.padding(16)
                }
                .refreshable { await reload() }
            }
            // GEZİ KAYDI (16.09): Harita sekmesi kaldırıldı; "Gezi kaydı başlat / Bitir" çubuğu
            // oradan buraya taşındı — kaydı başlatmanın tek yolu buydu.
            .safeAreaInset(edge: .bottom) {
                RecordBar().padding(.horizontal, 16).padding(.bottom, 6)
            }
            .navigationTitle("Move Log")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // Sıralama seçici: rota tarihi / son eklenen (kullanıcı tercihi kalıcı)
                    Menu {
                        Picker(L("Sıralama","Sort"), selection: $sortMode) {
                            Label(L("Rota tarihi","Route date"), systemImage: "calendar").tag("date")
                            Label(L("Son eklenen","Recently added"), systemImage: "clock.arrow.circlepath").tag("added")
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down").font(.system(size: 15, weight: .semibold))
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    // GPX/TCX yükle (akıllı saat / Strava dosyasından video) — 03.11.2026: herkese açık
                    Button {
                        showImporter = true
                    } label: {
                        if uploading { ProgressView() }
                        else { Image(systemName: "tray.and.arrow.up").font(.system(size: 16, weight: .semibold)) }
                    }.disabled(uploading)
                }
            }
        }
        .onAppear { Task {
            await reload()      // sekmeye her gelişte tazele (yeni oto-rota hemen görünsün)
            // 10.11: yalnız DEMO/mağaza görseli — video oluştur ve sonuç ekranlarını doğrudan aç
            if AppEnv.demo && demoSonuc == nil && createRide == nil {
                try? await Task.sleep(for: .milliseconds(600))
                if AppEnv.screen == "uret", let r = rides.first(where: { $0.sample != true }) ?? rides.first { createRide = r }
                if AppEnv.screen == "sonuc" {
                    let u = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("demo.mp4")
                    if FileManager.default.fileExists(atPath: u.path) { demoSonuc = u }
                }
            }
        } }
        .sheet(isPresented: Binding(get: { demoSonuc != nil }, set: { if !$0 { demoSonuc = nil } })) {
            if let u = demoSonuc { VideoSonucView(url: u) { demoSonuc = nil } }
        }
        .onDisappear { pollTask?.cancel(); pollTask = nil }
        .fileImporter(isPresented: $showImporter,
                      allowedContentTypes: [UTType(filenameExtension: "gpx") ?? .xml,
                                            UTType(filenameExtension: "tcx") ?? .xml, .xml],
                      allowsMultipleSelection: false) { result in
            guard case .success(let urls) = result, let url = urls.first else { return }
            Task {
                let ok = url.startAccessingSecurityScopedResource()
                defer { if ok { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else {
                    await MainActor.run { uploadErr = L("Dosya okunamadı","Couldn't read the file") }; return
                }
                await MainActor.run { uploading = true }
                let res = await store.uploadRoute(data)
                await MainActor.run {
                    uploading = false
                    if let r = res {
                        // yükleme tamam -> direkt üretim seçenekleri (uploaded_tracks backend'de hazır)
                        createRide = Ride(id: "upload_\(Int(r.from))", date: "", type: "bike", mode: nil, size: 0, ts: r.from, to: r.to)
                        Task { await reload() }   // Rotalar'da da görünsün
                    } else {
                        uploadErr = L("Yükleme başarısız — geçerli bir GPX/TCX dosyası seç","Upload failed — pick a valid GPX/TCX file")
                    }
                }
            }
        }
        .sheet(item: $paylasKart) { k in
            PaylasimSayfasi(ogeler: [k.url]) { paylasKart = nil }
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
        // uploadErr uyarısı kart hatalarını da gösterir (tek alert, aynı kalıp)
        .alert(uploadErr ?? "", isPresented: Binding(get: { uploadErr != nil }, set: { if !$0 { uploadErr = nil } })) {
            Button("OK") { uploadErr = nil }
        }
        .confirmationDialog(L("Bu videoyu geçmişten sil?", "Delete this video?"),
                            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            presenting: pendingDelete) { r in
            Button(L("Sil", "Delete"), role: .destructive) {
                Task { if await store.deleteRide(r.id) { rides = await store.rides() }; pendingDelete = nil }
            }
            Button(L("Vazgeç", "Cancel"), role: .cancel) { pendingDelete = nil }
        }
        .sheet(item: $playerBox) { box in
            VideoPlayer(player: box.player)
                .ignoresSafeArea()
                .onAppear { box.player.play() }              // view hazır olunca oynat (kara kare olmaz)
                .onDisappear { box.player.pause() }
        }
        .sheet(item: $editRide) { r in
            GenerateSheet(from: r.ts ?? 0, to: r.to ?? 0, type: r.type ?? "moto",
                          mode: r.mode ?? "flat", aspect: r.aspect ?? "9:16",
                          speed: r.speed ?? "medium", rideId: r.id)
        }
        .sheet(item: $createRide) { r in   // videosuz rota -> sıfırdan üretim (rideId: nil)
            GenerateSheet(from: r.ts ?? 0, to: r.to ?? 0, type: r.type ?? "moto",
                          mode: "flat", aspect: r.aspect ?? "9:16",
                          speed: r.speed ?? "medium", rideId: nil)
        }
    }

    func play(_ r: Ride) {
        // presigned R2 URL'ini al, header'SIZ oynat -> beyaz ekran/yarıda kesilme olmaz.
        Task {
            let signed = await store.signedVideoURL(r.id)
            let asset: AVURLAsset
            if let u = signed, u.absoluteString.hasPrefix("http"), !u.absoluteString.contains("/api/") {
                asset = AVURLAsset(url: u)
            } else {
                asset = AVURLAsset(url: store.videoURL(r.id), options: ["AVURLAssetHTTPHeaderFieldsKey": store.authHeader])
            }
            let p = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            p.automaticallyWaitsToMinimizeStalling = true
            await MainActor.run { playerBox = PlayerBox(player: p) }
        }
    }

    // Rota kartını indir (dikey|kare) -> geçici PNG -> paylaşım sayfası. Hata: sunucu metni uyarıda.
    func kartPaylas(_ r: Ride, bicim f: String) {
        guard kartId == nil else { return }
        kartId = r.id
        Task {
            defer { kartId = nil }
            do {
                let d = try await store.kartIndir(path: "/api/rides/\(r.id)/kart?f=\(f)")
                paylasKart = PaylasimKarti(url: try kartDosyasi(d, ad: r.id))
            } catch {
                uploadErr = error.localizedDescription
            }
        }
    }

    func save(_ r: Ride) {
        savingId = r.id
        Task {
            defer { savingId = nil }
            var req = URLRequest(url: store.videoURL(r.id))
            for (k, v) in store.authHeader { req.setValue(v, forHTTPHeaderField: k) }
            guard let (data, _) = try? await URLSession.shared.data(for: req) else { return }
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(r.id).mp4")
            try? data.write(to: tmp)
            // 🔴 FİKS 05.09: `UISaveVideoAtPathToSavedPhotosAlbum(..., nil, nil, nil)` sonucu HİÇ
            // okunmuyordu ve `savedId` koşulsuz atanıyordu → izin reddedilse veya kaydetme başarısız
            // olsa bile kullanıcıya "kaydedildi ✓" gösteriliyordu (SAHTE onay). Ayrıca tmp dosyası
            // silinmiyordu. `Store.galeriyeKaydet` izni ister, sonucu okur ve dosyayı siler.
            guard await Store.galeriyeKaydet(tmp) else {
                try? FileManager.default.removeItem(at: tmp)
                return
            }
            savedId = r.id
            try? await Task.sleep(for: .seconds(2))
            if savedId == r.id { savedId = nil }
        }
    }
}
