import SwiftUI
import StoreKit
import UIKit
import AVKit
import AVFoundation
import UIKit

// Video önizleme (poster): videodan bir kare çıkarıp gösterir; bellek cache'i (kaydırınca yeniden üretmez).
enum ThumbCache { static var imgs: [String: UIImage] = [:] }

struct VideoThumb: View {
    let id: String
    let url: URL
    let icon: String
    var headers: [String:String] = [:]   // R2 videosu auth ister; play() gibi header geçilmeli (yoksa 401 -> önizleme boş)
    @State private var img: UIImage?
    var body: some View {
        ZStack {
            if let img {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Brand.gradient.opacity(0.18)
                Image(systemName: icon).font(.system(size: 30)).foregroundStyle(Brand.accent.opacity(0.5))
            }
            Image(systemName: "play.circle.fill").font(.system(size: 52))
                .foregroundStyle(.white.opacity(0.95)).shadow(radius: 8)
        }
        .frame(height: 150).frame(maxWidth: .infinity)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .task(id: id) { await load() }
    }
    func load() async {
        if let c = ThumbCache.imgs[id] { img = c; return }
        if img != nil { return }
        // play() ile AYNI: auth header geç -> backend /video 302 R2'ye yönlendirir, kare çekilir
        let asset = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.requestedTimeToleranceBefore = .positiveInfinity
        gen.requestedTimeToleranceAfter = .positiveInfinity
        gen.maximumSize = CGSize(width: 720, height: 1280)
        let t = CMTime(seconds: 1.2, preferredTimescale: 600)
        if let cg = try? await gen.image(at: t).image {
            let ui = UIImage(cgImage: cg)
            ThumbCache.imgs[id] = ui
            await MainActor.run { img = ui }
        }
    }
}

// "Videolarım" sekmesi: üretilen TÜM videolar burada listelenir.
// Kullanıcı izleyebilir, galerisine tekrar kaydedebilir veya geçmişten silebilir.
// (Rotalar sekmesinden ayrı: burası saf video kitaplığı — düzenleme/tip yok, sadece izle/kaydet/sil.)
struct VideosView: View {
    @EnvironmentObject var store: Store
    @State private var rides: [Ride] = []
    @State private var playerBox: PlayerBox?
    @State private var savingId: String? = nil
    @State private var savedId: String? = nil
    @State private var pendingDelete: Ride?
    @State private var loaded = false
    @State private var pollTask: Task<Void, Never>? = nil   // render olan varken otomatik yenile

    func dayTime(_ r: Ride) -> String {
        guard let ts = r.ts, ts > 0 else { return r.date }
        let f = DateFormatter()
        f.locale = Locale(identifier: L("tr_TR", "en_US"))
        f.dateFormat = L("d MMM yyyy · HH:mm", "MMM d, yyyy · HH:mm")
        return f.string(from: Date(timeIntervalSince1970: ts))
    }
    // video ÜRETIM tarihi (done) — sürüş tarihinin yanında gösterilir
    func producedLabel(_ r: Ride) -> String? {
        guard let d = r.done, d > 0 else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: L("tr_TR", "en_US"))
        f.dateFormat = L("d MMM HH:mm", "MMM d, HH:mm")
        return f.string(from: Date(timeIntervalSince1970: d))
    }
    // sıralama: render olanlar en üstte, sonra ÜRETIM zamanına göre yeni->eski (yeni video hemen görünür)
    func sortKey(_ r: Ride) -> Double { r.rendering == true ? .greatestFiniteMagnitude : (r.done ?? r.ts ?? 0) }
    func reload() async {
        let sorted = (await store.rides()).sorted { sortKey($0) > sortKey($1) }
        await MainActor.run { rides = sorted; loaded = true; managePoll() }
        await store.autoSaveNewVideos()   // aktif oturumda yeni biten videoyu hemen galeriye kaydet (sekme açıkken)
    }
    // render olan video varsa 12 sn'de bir tazele -> bitince kilidi açılıp önizleme gelir
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
    func typeLabel(_ t: String?) -> String {
        switch t { case "moto": return L("Motosiklet","Motorcycle"); case "car": return L("Araba","Car")
        case "bike": return L("Bisiklet","Cycling")
        case "run": return L("Koşu","Running"); case "walk": return L("Yürüyüş","Walking"); default: return L("Diğer","Other") }
    }
    func typeIcon(_ t: String?) -> String {
        switch t { case "moto": return "motorcycle"; case "car": return "car.fill"; case "bike": return "bicycle"
        case "run": return "figure.run"; case "walk": return "figure.walk"; default: return "film" }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    LazyVStack(spacing: 14) {
                        if rides.isEmpty && loaded {
                            VStack(spacing: 10) {
                                Image(systemName: "film.stack").font(.system(size: 40)).foregroundStyle(.secondary)
                                Text(L("Henüz video yok", "No videos yet")).font(.headline)
                                Text(L("Bir rota sür; videon bulutta otomatik oluşturulup burada listelenir. Dilediğini galerine kaydedebilir veya silebilirsin.",
                                       "Ride a route; your video is auto-rendered in the cloud and listed here. Save any to Photos or delete it."))
                                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            }.padding(.top, 70).padding(.horizontal, 26)
                        }
                        ForEach(rides) { r in
                            let rendering = (r.rendering == true)
                            let failed = (r.failed == true)
                            VStack(spacing: 0) {
                                // büyük izleme kartı — render bitene kadar KİLİTLİ (oynatma yok, beyaz ekran olmaz)
                                if rendering {
                                    ZStack {
                                        Brand.gradient.opacity(0.18)
                                        VStack(spacing: 8) {
                                            ProgressView().tint(.white)
                                            // 1.63 (Barış 05.09): telefonda üretiliyorsa DÜRÜST metin.
                                            // Kullanıcı uygulamayı kapatırsa/arka plana alırsa üretim
                                            // iptal oluyor (WebRouteVideo arka plan koruması) — bunu bilmeli.
                                            Text(store.telefondaUretiliyor
                                                 ? L("Telefonunda üretiliyor…","Rendering on your phone…")
                                                 : L("Hazırlanıyor…","Rendering…"))
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(.white.opacity(0.9))
                                            if store.telefondaUretiliyor {
                                                Text(L("Uygulamayı açık tut","Keep the app open"))
                                                    .font(.system(size: 11)).foregroundStyle(.white.opacity(0.7))
                                            }
                                        }
                                    }
                                    .frame(height: 150).frame(maxWidth: .infinity).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                } else if failed {
                                    // HATA kartı — silinene/yeniden denenene kadar listede kalır (sessizce kaybolmaz)
                                    ZStack {
                                        Color.red.opacity(0.14)
                                        VStack(spacing: 8) {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .font(.system(size: 28)).foregroundStyle(.red)
                                            Text(L("Oluşturulamadı","Failed")).font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(.white.opacity(0.9))
                                        }
                                    }
                                    .frame(height: 150).frame(maxWidth: .infinity).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                } else {
                                    Button { play(r) } label: {
                                        VideoThumb(id: r.id, url: store.videoURL(r.id), icon: typeIcon(r.type), headers: store.authHeader)
                                            .contentShape(Rectangle())
                                    }.buttonStyle(.borderless)
                                }

                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(dayTime(r)).font(.system(size: 15, weight: .semibold))     // sürüş tarihi
                                        Text(typeLabel(r.type)).font(.caption).foregroundStyle(.secondary)
                                        if rendering {
                                            Text(L("Video hazırlanıyor, bitince izlenebilir","Rendering, playable when done"))
                                                .font(.caption2).foregroundStyle(Brand.accent)
                                        } else if failed {
                                            Text(r.error ?? L("Video oluşturulamadı","Video failed"))
                                                .font(.caption2).foregroundStyle(.red).lineLimit(3)
                                        } else if let pl = producedLabel(r) {
                                            Text(L("Üretildi: ","Created: ") + pl)                      // VIDEO üretim tarihi
                                                .font(.caption2).foregroundStyle(.secondary.opacity(0.8))
                                        }
                                    }
                                    Spacer()
                                    if !rendering && !failed {
                                        // galerine kaydet
                                        Button { save(r) } label: {
                                            Group {
                                                if savingId == r.id { ProgressView() }
                                                else if savedId == r.id { Image(systemName: "checkmark").foregroundStyle(.green) }
                                                else { Image(systemName: "square.and.arrow.down").foregroundStyle(Brand.accent) }
                                            }.font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44).contentShape(Rectangle()).glassPanel(21)
                                        }.buttonStyle(.borderless).disabled(savingId == r.id)
                                    }
                                    // sil (borderless = bağımsız tıklama alanı; yoksa tap play'e gidiyordu)
                                    // 10.10: ÖRNEK (appreview) videoda yok — sunucu 404 veriyordu, düğme sessizce ölüydü
                                    if r.sample != true {
                                        Button { pendingDelete = r } label: {
                                            Image(systemName: "trash").font(.system(size: 16, weight: .semibold))
                                                .foregroundStyle(.red).frame(width: 44, height: 44).contentShape(Rectangle()).glassPanel(21)
                                        }.buttonStyle(.borderless)
                                    }
                                }.padding(.top, 10)
                            }
                            .padding(12).glassPanel(22).smoothAppear()
                        }
                    }.padding(16)
                }
                .refreshable { await reload() }
            }
            .navigationTitle(L("Videolarım","My Videos"))
        }
        .onAppear { Task { await reload() } }   // sekmeye her gelişte tazele (yeni video hemen görünsün)
        .onDisappear { pollTask?.cancel(); pollTask = nil }
        .confirmationDialog(L("Bu videoyu geçmişten sil?", "Delete this video?"),
                            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            presenting: pendingDelete) { r in
            Button(L("Sil", "Delete"), role: .destructive) {
                Task { _ = await store.deleteRide(r.id); await reload(); pendingDelete = nil }
            }
            Button(L("Vazgeç", "Cancel"), role: .cancel) { pendingDelete = nil }
        }
        .sheet(item: $playerBox) { box in
            VideoPlayer(player: box.player).ignoresSafeArea()
                .onAppear { box.player.play() }
                .onDisappear {
                    box.player.pause()
                    maybeAskReview()   // ASO: ilk videosunu izleyen mutlu anında puan istenir (iOS yılda 3 kez sınırlar)
                }
        }
    }

    // PUAN İSTEME: kullanıcı bir videoyu izleyip kapattığında — ürünün en tatmin edici anı.
    // Yalnızca 1 kez tetiklenir (nd_review_asked); iOS zaten gösterimi yılda 3 ile sınırlar.
    func maybeAskReview() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: "nd_review_asked") else { return }
        d.set(true, forKey: "nd_review_asked")
        if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                AppStore.requestReview(in: scene)
            }
        }
    }

    // Oynat: presigned R2 URL'ini al (hızlı), header'SIZ oynat -> beyaz ekran/yarıda kesilme olmaz.
    func play(_ r: Ride) {
        Task {
            let signed = await store.signedVideoURL(r.id)
            let asset: AVURLAsset
            if let u = signed, u.absoluteString.hasPrefix("http"), !u.absoluteString.contains("/api/") {
                asset = AVURLAsset(url: u)   // presigned R2 -> Authorization header YOK (dual-auth yok)
            } else {
                asset = AVURLAsset(url: store.videoURL(r.id), options: ["AVURLAssetHTTPHeaderFieldsKey": store.authHeader])
            }
            // SESSİZ ANAHTAR FIX: uygulama içi video, yan sessiz anahtarı açıkken de SESLİ çalsın
            // (Fotoğraflar gibi .playback kategorisi; galeri sesli - uygulama sessiz tutarsızlığı biterr)
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
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
