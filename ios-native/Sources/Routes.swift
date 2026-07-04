import SwiftUI
import AVKit
import UIKit
import UniformTypeIdentifiers

// .sheet(item:) için: player hazır olmadan sheet açılmasın (ilk dokunuşta kara ekran bug'ı).
struct PlayerBox: Identifiable { let id = UUID(); let player: AVPlayer }

struct RoutesView: View {
    @EnvironmentObject var store: Store
    @State private var rides: [Ride] = []
    @State private var playerBox: PlayerBox?
    @State private var editRide: Ride?
    @State private var createRide: Ride?   // videosuz rota -> "Video oluştur" (sıfırdan üretim)
    @State private var savingId: String? = nil
    @State private var savedId: String? = nil
    @State private var pendingDelete: Ride?
    @State private var pollTask: Task<Void, Never>? = nil   // render/yeni rota varken otomatik yenile
    @AppStorage("nd_premium") private var premium = false
    @AppStorage("nd_route_sort") private var sortMode = "date"   // "date"=rota tarihi | "added"=son eklenen (kullanıcı seçer)
    @State private var showImporter = false   // GPX/TCX dosya seçici
    @State private var uploading = false
    @State private var showPaywall = false
    @State private var uploadErr: String?

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
    var sortedRides: [Ride] {
        if sortMode == "added" {
            return rides.sorted { (a: Ride, b: Ride) -> Bool in addedKey(a) > addedKey(b) }
        }
        return rides   // backend zaten rota tarihine göre (yeni->eski) sıralı gönderir
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(sortedRides) { r in
                            HStack(spacing: 14) {
                                Image(systemName: typeIcon(r.type)).font(.system(size: 22))
                                    .foregroundStyle(Brand.accent).frame(width: 50, height: 50).glassPanel(16)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(dayTime(r)).font(.system(size: 17, weight: .semibold))
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
                                Spacer()
                                if r.novideo == true {
                                    // Videosuz algılanan rota -> kullanıcı isterse video ürettirir
                                    Button { createRide = r } label: {
                                        HStack(spacing: 6) {
                                            Image(systemName: "film.stack").font(.system(size: 13, weight: .bold))
                                            Text(L("Video oluştur","Create video")).font(.system(size: 13, weight: .semibold))
                                        }.foregroundStyle(.white).padding(.horizontal, 14).frame(height: 42)
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
                            }
                            .padding(14).glassPanel(20).smoothAppear()
                            .contextMenu {   // uzun bas → sil
                                Button(role: .destructive) { pendingDelete = r } label: {
                                    Label(L("Geçmişten sil", "Delete"), systemImage: "trash")
                                }
                            }
                        }
                    }.padding(16)
                }
                .refreshable { await reload() }
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
                    // GPX/TCX yükle (akıllı saat / Strava dosyasından video) — premium
                    Button {
                        if premium { showImporter = true } else { showPaywall = true }
                    } label: {
                        if uploading { ProgressView() }
                        else { Image(systemName: "tray.and.arrow.up").font(.system(size: 16, weight: .semibold)) }
                    }.disabled(uploading)
                }
            }
        }
        .onAppear { Task { await reload() } }      // sekmeye her gelişte tazele (yeni oto-rota hemen görünsün)
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
        .sheet(isPresented: $showPaywall) { PaywallSheet(premium: $premium) }
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
                          mode: r.mode ?? "flat", aspect: r.aspect ?? "16:9",
                          speed: r.speed ?? "medium", rideId: r.id)
        }
        .sheet(item: $createRide) { r in   // videosuz rota -> sıfırdan üretim (rideId: nil)
            GenerateSheet(from: r.ts ?? 0, to: r.to ?? 0, type: r.type ?? "moto",
                          mode: "flat", aspect: r.aspect ?? "16:9",
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

    func save(_ r: Ride) {
        savingId = r.id
        Task {
            defer { savingId = nil }
            var req = URLRequest(url: store.videoURL(r.id))
            for (k, v) in store.authHeader { req.setValue(v, forHTTPHeaderField: k) }
            guard let (data, _) = try? await URLSession.shared.data(for: req) else { return }
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(r.id).mp4")
            try? data.write(to: tmp)
            if UIVideoAtPathIsCompatibleWithSavedPhotosAlbum(tmp.path) {
                UISaveVideoAtPathToSavedPhotosAlbum(tmp.path, nil, nil, nil)
            }
            savedId = r.id
            try? await Task.sleep(for: .seconds(2))
            if savedId == r.id { savedId = nil }
        }
    }
}
