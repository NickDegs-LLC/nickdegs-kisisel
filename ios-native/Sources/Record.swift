import SwiftUI
import UniformTypeIdentifiers
import Photos
import AVKit

// Aktivite tipleri (her yerde ortak)
let RIDE_TYPES: [(id: String, icon: String)] = [
    ("moto", "motorcycle"), ("car", "car.fill"), ("bike", "bicycle"),
    ("run", "figure.run"), ("walk", "figure.walk"),
]
func rideLabel(_ t: String) -> String {
    switch t {
    case "moto": return L("Motor","Motorcycle"); case "car": return L("Araba","Car")
    case "bike": return L("Bisiklet","Cycling"); case "run": return L("Koşu","Running")
    case "walk": return L("Yürüyüş","Walking"); default: return L("Diğer","Other")
    }
}

// Gezi bitince video oluşturma: tip (değiştirilebilir) + mod + en-boy. 03.11.2026: herkese açık, telefonda üretim.
struct GenerateSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    let from: Double
    let to: Double
    let rideId: String?                         // nil = yeni üretim, dolu = mevcut videoyu düzenle
    @State var type: String
    @State private var mode: String
    @State private var aspect: String
    @State private var speed: String            // "fast"=Kısa / "medium"=Orta / "slow"=Uzun
    @AppStorage("nd_reel") private var reel = false   // Faz 3c: ~15-20sn dikey paylaşım teaser'ı (9:16 zorlar)
    @State private var done = false
    @State private var localErr = false
    // TELEFONDA ÜRET: 03.11.2026'dan beri TEK üretim yolu (bulut kapandı). Tam ekran ilerleme
    // katmanı kullanıcıya üretimin telefonda olduğunu ve ekranın açık kalması gerektiğini söyler.
    @State private var telefonAktif = false            // tam ekran üretim katmanı açık mı
    @State private var telefonPct: Double = 0
    /// 🔴 FİKS 05.09: yüzdeyi TÜKETİCİDE monotonlaştır. Motorlar 0.99 raporlayıp ardından sabit
    /// bir değere (0.88/0.92) düşebiliyor; kullanıcı bunu "geri gitti / takıldı" diye görüyordu.
    /// Tek kapı: yüzde asla azalmaz, yalnız ileri gider (sıfırlama açıkça `telefonPct = 0`).
    @MainActor private func pctYaz(_ p: Double) { if p > telefonPct { telefonPct = min(1.0, p) } }
    @State private var telefonIs: Task<Void, Never>?   // ekrandan çıkılırsa iptal edilir
    @State private var telefonHata = false
    @State private var telefonNeden = ""
    // 10.11.2026 (Barış): video SUNUCUYA GİTMEZ. Telefonda üretilir, burada izlenir; "Galeriye kaydet"e
    // basılmazsa kapatınca silinir. Ortak sürüş anahtarı (grup) sunucunun önerisinden okunur.
    @State private var hazirVideo: URL? = nil
    @State private var grup: String? = nil
    @State private var ortak = true
    @State private var telefonAsama = ""   // "kareler çiziliyor" / "kapanış sahnesi" / "yükleniyor"…      // BAŞARISIZLIK NEDENİ — "Üretilemedi" tek başına hiçbir şey söylemiyordu
    @AppStorage("nd_camdist") private var camdist = "orta"   // kamera mesafesi yakın/orta/uzak
    @State private var stock: [[String:String]] = []
    @State private var musicUploading = false
    @State private var note = ""
    @State private var userTracks: [[String:String]] = []
    @State private var music = ""               // "", "stock:<id>", "upload"
    @State private var showAudioPicker = false
    @AppStorage("nd_line_color") private var lineColor = "#00E5FF"   // kullanıcının seçtiği rota çizgi rengi
    @AppStorage("nd_dot_color") private var dotColor = "#FF3B30"     // takip noktası rengi ("line" = çizgiyle aynı)
    // "Çizgiyle aynı" seçiliyken gönderilecek gerçek renk: glass/clear/none çizgide beyaz nokta
    private var resolvedDot: String { dotColor == "line" ? (lineColor.hasPrefix("#") ? lineColor : "#FFFFFF") : dotColor }

    init(from: Double, to: Double, type: String, mode: String = "flat",
         aspect: String = "9:16", speed: String = "medium", rideId: String? = nil) {   // varsayılan DİKEY (Barış 2026-08-26: "insanların ilgilendiği dikey")
        self.from = from; self.to = to; self.rideId = rideId
        _type = State(initialValue: type)
        // 03.11.2026: telefonda yalnız düz/kuşbakışı/3B üretilir. Eski kayıtlardan gelen bilinmeyen
        // modlar (tactical/street/google3d…) düz moda düşer — telefon motoru onları tanımaz.
        _mode = State(initialValue: ["flat", "flyover", "3d"].contains(mode) ? mode : "flat")
        _aspect = State(initialValue: aspect)
        _speed = State(initialValue: speed)
    }

    var body: some View {
        if let v = hazirVideo {
            VideoSonucView(url: v) { try? FileManager.default.removeItem(at: v); hazirVideo = nil; dismiss() }
        } else {
            uretimGovdesi
        }
    }

    @ViewBuilder private var uretimGovdesi: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(rideId == nil ? L("Video oluştur","Create video")
                                       : L("Videoyu düzenle","Edit video")).font(.title2.bold())

                    field(L("Aktivite","Activity"))
                    Picker("", selection: $type) {
                        ForEach(RIDE_TYPES, id: \.id) { t in
                            Label(rideLabel(t.id), systemImage: t.icon).tag(t.id)
                        }
                    }.pickerStyle(.menu).tint(Brand.accent)
                    if mode != "tactical" {

                    field(L("Süre","Length"))
                    }
                    // Otonom: süre tamamen rotaya göre, max 3dk. 03.11.2026: herkese açık.
                    if mode != "tactical" {
                    Picker("", selection: $speed) {
                        Text(L("Kısa","Short")).tag("fast")
                        Text(L("Orta","Medium")).tag("medium")
                        Text(L("Uzun","Long")).tag("slow")
                        Text(L("Otonom","Auto")).tag("auto")
                    }.pickerStyle(.segmented)
                    Text(speed == "auto"
                         ? L("Otonom: süre TAMAMEN rotaya göre ayarlanır (max 3 dk). Şehir yolculukları için ideal.",
                             "Auto: length fully scales with your route (max 3 min). Great for city trips.")
                         : L("Kısa ≈15sn, Orta ≈30sn, Uzun rotaya göre (max 60sn). Süre rota uzunluğuna göre ölçeklenir.",
                             "Short ≈15s, Medium ≈30s, Long scales with distance (max 60s)."))
                        .font(.caption2).foregroundStyle(speed == "auto" ? Brand.accent : .secondary)
                    }

                    // KAMERA MESAFESİ (her video): kameranın rotaya yakınlığı.
                    if mode != "tactical" {
                    field(L("Kamera mesafesi","Camera distance"))
                    Picker("", selection: $camdist) {
                        Text(L("Yakın","Near")).tag("yakin")
                        Text(L("Orta","Medium")).tag("orta")
                        Text(L("Uzak","Far")).tag("uzak")
                    }.pickerStyle(.segmented)
                    }
                    Text(L("Kameranın rotaya yakınlığı: Yakın daha yakın çekim, Uzak daha geniş kadraj.",
                           "How close the camera follows: Near = tighter shot, Far = wider framing."))
                        .font(.caption2).foregroundStyle(.secondary)

                    field(L("Görünüm","Style"))
                    modeRow("flat", L("Düz","Flat"))
                    modeRow("flyover", L("Kuş bakışı (Flyover)","Bird's-eye (Flyover)"))
                    modeRow("3d", L("3D · arazi kabartmalı","3D · terrain relief"))
                    // 10.11.2026: ortak sürüş (arkadaş/kulüp) — sunucu bu sürüş için grup önerdiyse
                    if grup != nil {
                        Toggle(isOn: $ortak) {
                            Label(L("Arkadaşlarınla ortak video","Joint video with your friends"), systemImage: "person.2.fill")
                        }.tint(Brand.accent).padding(.horizontal, 14).padding(.vertical, 10).glassPanel(14)
                        Text(L("Bu sürüşte arkadaşların da vardı; ortak video 3B olarak hepinizi birlikte gösterir.",
                               "Your friends rode with you; the joint video shows all of you together in 3D."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if mode != "tactical" {
                        field(L("En-boy","Aspect"))
                        Picker("", selection: $aspect) {
                            Text("16:9").tag("16:9"); Text("9:16").tag("9:16")
                        }.pickerStyle(.segmented)
                        // 03.11: REEL anahtarı KALDIRILDI — telefon motorları (LocalRouteVideo/WebRouteVideo)
                        // reel üretmiyor; bulut yolu kapandığı için düğme işlevsizdi.
                    }
                    // (tactical aspect picker'ı yukarıdaki tactical bloğunda — 9:16/4:5, clamp'li; ayrı/çakışan UI YOK)

                    if mode != "tactical" {
                    field(L("Rota çizgisi","Route line"))
                    ScrollView(.horizontal, showsIndicators: false) {
                      HStack(spacing: 12) {
                        // Çizgisiz (sadece nokta)
                        ZStack {
                            Circle().fill(Color(.systemGray4)).frame(width: 30, height: 30)
                            Image(systemName: "line.diagonal").font(.system(size: 14)).foregroundStyle(.secondary)
                        }
                        .overlay(Circle().strokeBorder(.white, lineWidth: lineColor == "none" ? 3 : 0))
                        .onTapGesture { lineColor = "none" }
                        // Liquid glass (şeffaf frosted çizgi)
                        ZStack {
                            Circle().fill(LinearGradient(colors: [.white.opacity(0.45), Color(hex: "#AEE6FF").opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 30, height: 30)
                            Image(systemName: "drop.fill").font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                        }
                        .overlay(Circle().strokeBorder(.white.opacity(lineColor == "glass" ? 1 : 0.5), lineWidth: lineColor == "glass" ? 3 : 1))
                        .onTapGesture { lineColor = "glass" }
                        // Renksiz tam şeffaf (en minimal cam — basit görünüm)
                        ZStack {
                            Circle().fill(Color.white.opacity(0.06)).frame(width: 30, height: 30)
                            Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1).frame(width: 22, height: 22)
                        }
                        .overlay(Circle().strokeBorder(.white.opacity(lineColor == "clear" ? 1 : 0.5), lineWidth: lineColor == "clear" ? 3 : 1))
                        .onTapGesture { lineColor = "clear" }
                        ForEach(ROUTE_LINE_COLORS, id: \.self) { hex in
                            Circle().fill(Color(hex: hex))
                                .frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
                                .overlay(Circle().strokeBorder(.white, lineWidth: lineColor.caseInsensitiveCompare(hex) == .orderedSame ? 3 : 0))
                                .onTapGesture { lineColor = hex }
                        }
                      }
                    }.padding(.horizontal, 2)

                    }   // tactical: çizgi seçimi yok (crosshair rengi aşağıda)

                    field(L("Takip noktası","Tracking dot"))
                    ScrollView(.horizontal, showsIndicators: false) {
                      HStack(spacing: 12) {
                        // Çizgiyle aynı renk
                        ZStack {
                            Circle().fill(lineColor.hasPrefix("#") ? Color(hex: lineColor) : Color.white.opacity(0.35)).frame(width: 30, height: 30)
                            Image(systemName: "link").font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.9))
                        }
                        .overlay(Circle().strokeBorder(.white, lineWidth: dotColor == "line" ? 3 : 0))
                        .overlay(Circle().strokeBorder(.white.opacity(0.3), lineWidth: dotColor == "line" ? 0 : 1))
                        .onTapGesture { dotColor = "line" }
                        ForEach(["#FF3B30"] + ROUTE_LINE_COLORS.filter { $0 != "#FF3B30" }, id: \.self) { hex in
                            Circle().fill(Color(hex: hex))
                                .frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
                                .overlay(Circle().strokeBorder(.white, lineWidth: dotColor.caseInsensitiveCompare(hex) == .orderedSame ? 3 : 0))
                                .onTapGesture { dotColor = hex }
                        }
                      }
                    }.padding(.horizontal, 2)

                    field(L("Müzik","Music"))
                    Menu {
                        if mode == "tactical" {
                            Button(L("Rastgele (öner)","Random (suggest)")) { music = "random" }
                            Button(L("Sessiz — müziksiz (Reels'te kendi müziğini ekle)","Silent — no music (add your own in Reels)")) { music = "none" }
                            Button(L("Yeni müzik yükle…","Upload new music…")) { showAudioPicker = true }
                            if !userTracks.isEmpty {
                                Divider()
                                ForEach(userTracks, id: \.self) { tr in
                                    Button("🎵 " + (tr["name"] ?? "Müzik")) { music = "lib:" + (tr["id"] ?? "") }
                                }
                                // 🔴 FİKS 05.09: DELETE /api/music/library/{mid} sunucuda vardı ama
                                // hiçbir istemciden çağrılmıyordu — kullanıcı müzik ekleyip SİLEMİYORDU.
                                Divider()
                                ForEach(userTracks, id: \.self) { tr in
                                    Button(role: .destructive) {
                                        Task {
                                            let mid = tr["id"] ?? ""
                                            if await store.musicLibraryDelete(mid) {
                                                if music == "lib:" + mid { music = "" }
                                                userTracks = await store.musicLibrary()
                                            }
                                        }
                                    } label: { Text("🗑️ " + (tr["name"] ?? "Müzik")) }
                                }
                            }
                            Divider()
                            ForEach(TACTICAL_TRACKS, id: \.self) { t in
                                Button(t.replacingOccurrences(of: "_", with: " ")) { music = t }
                            }
                        } else {
                        Button(L("Yok","None")) { music = "" }
                        ForEach(stock, id: \.self) { s in
                            Button(s["name"] ?? "") { music = "stock:\(s["id"] ?? "")" }
                        }
                        Button(L("Kendi müziğin… (yükle)","Your own… (upload)")) { showAudioPicker = true }
                        }   // tactical/normal müzik listeleri
                    } label: {
                        HStack {
                            Image(systemName: "music.note")
                            Text(musicLabel).lineLimit(1).truncationMode(.tail)   // uzun şarkı adı satırı itmesin (her ekran boyutu)
                            Spacer(); Image(systemName: "chevron.down").font(.caption2)
                        }.padding(.horizontal, 14).padding(.vertical, 12)
                    }.buttonStyle(.plain).glassPanel(14).tint(.primary)

                    // ═══ TEK "VİDEO ÜRET" DÜĞMESİ (Barış 03.11.2026) ═══
                    // Move Log tamamen ÜCRETSİZ; abonelik/IAP ve bulut (sunucu GPU) üretimi kalıcı
                    // KAPANDI. Video HER ZAMAN bu telefonda üretilir: düz/kuşbakışı LocalRouteVideo,
                    // 3B WebRouteVideo. Bitince `uploadLocalVideo` ile sunucuya yüklenir, Videolarım'da
                    // görünür. Yeniden üretimde (rideId dolu) de aynı yol — rotanın from/to'su burada var.
                    // Uygulama ön planda kalmalı (WKWebView arka planda BOŞ kare döndürür): tam ekran
                    // ilerleme katmanı + "çıkarsan iptal olur" uyarısı aşağıdaki fullScreenCover'da.
                    Button {
                        guard telefonIs == nil else { return }   // çift dokunuş -> ikinci üretim başlatma
                        localErr = false
                        telefonHata = false; telefonNeden = ""; telefonAsama = ""; telefonPct = 0.001; telefonAktif = true
                        telefonIs = Task { await telefondaUret() }
                    } label: {
                        if done { Label(L("Videon hazır 🎬","Your video is ready 🎬"), systemImage: "checkmark.circle.fill") }
                        else { Label(L("Video üret","Create video"), systemImage: "iphone.gen3") }
                    }.buttonStyle(.glassyProminent()).disabled(telefonAktif || telefonIs != nil)
                    Text(L("Video telefonunda üretilir; üretim bitene kadar ekranı açık tut.",
                           "The video is made on your phone; keep the screen on until it's done."))
                        .font(.caption2).foregroundStyle(.secondary)

                    if localErr {
                        Text(note.isEmpty ? L("Bu rotada konum verisi yok ya da istek başarısız.","No location data for this route or request failed.") : note)
                            .font(.caption2).foregroundStyle(.red)
                    }
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(telefonAktif)   // telefonda üretim sırasında sheet kapatılamaz
        // ═══ TELEFONDA ÜRETİM EKRANI (Barış 05.09: "yükleniyor ekranı olsun, sayfadan çıkarsan
        // iptal olur tarzında bir şey olsun") ═══
        // fullScreenCover: kullanıcı kazara kaydırıp kapatamasın (interactiveDismissDisabled).
        // Çıkış tek yoldan: "İptal" düğmesi. Kapanınca görev iptal edilir, yarım video yazılmaz.
        .fullScreenCover(isPresented: $telefonAktif) {
            ZStack {
                Brand.gradient.opacity(0.25).ignoresSafeArea()
                VStack(spacing: 18) {
                    Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                        .font(.system(size: 44)).foregroundStyle(Brand.accent)
                    Text(L("Telefonunda üretiliyor…", "Rendering on your phone…"))
                        .font(.title3.weight(.semibold))
                    ProgressView(value: max(0.001, telefonPct)).progressViewStyle(.linear)
                        .frame(width: 240).tint(Brand.accent)
                    Text("%\(Int(telefonPct * 100))").font(.system(size: 15, weight: .semibold)).monospacedDigit()
                    if !telefonAsama.isEmpty {
                        Text(telefonAsama).font(.caption).foregroundStyle(.secondary)
                    }
                    Label(L("Bu ekrandan çıkarsan üretim iptal olur.",
                            "Leaving this screen cancels the render."),
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
                    Text(L("Uygulamayı arka plana alma — ekran kararırsa kareler boş çıkar.",
                           "Don't background the app — frames come out blank if the screen sleeps."))
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                    if telefonHata {
                        VStack(spacing: 4) {
                            Text(L("Üretilemedi. Tekrar deneyebilirsin.",
                                   "Couldn't render. Please try again."))
                                .font(.footnote).foregroundStyle(.red)
                            if !telefonNeden.isEmpty {
                                Text(telefonNeden)          // NEDEN — teşhis için şart
                                    .font(.caption2).foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center).padding(.horizontal, 24)
                            }
                        }
                    }
                    Button(role: .cancel) { telefonIptal() } label: {
                        Text(L("İptal", "Cancel")).frame(maxWidth: 200)
                    }.buttonStyle(.glassy).padding(.top, 6)
                }.padding(28)
            }
            .interactiveDismissDisabled(true)
            .onDisappear { telefonIptal() }   // katman kapandıysa üretim de kapanır
        }
        .task {
            stock = await store.musicList(); userTracks = await store.musicLibrary()
            grup = await store.grupAnahtari(from: from, to: to)   // 10.11: bu sürüş arkadaşla/kulüple mi?
            // YÜKLÜ MÜZİK OTOMATİK SEÇİLİ (Barış 2026-07-27): kullanıcı müzik yüklediyse + henüz seçim yapmadıysa
            // varsayılan "active" (son yüklenen) -> "eklendi" görünür + videoda kullanılır (eskiden boş/sessiz kalıyordu).
            // 🔴 KALDIRILDI 05.09 (Barış: "garip bir müzik çalıyor, müzik seçmediğim halde").
            // Bu satır, kütüphanesinde yüklü parçası olan kullanıcıya SEÇMEDİĞİ hâlde son
            // yüklediği parçayı ("active") otomatik atıyordu. Aynı dosyanın 632. satırı
            // `if music.isEmpty { return L("Sessiz","Silent") } // boş = SESSİZ (Barış kuralı)`
            // diyor — yani kod kendi kuralını burada eziyordu. Varsayılan artık SESSİZ;
            // kullanıcı müzik isterse listeden kendisi seçer.
        }
        .fileImporter(isPresented: $showAudioPicker, allowedContentTypes: [.audio]) { res in
            if case .success(let url) = res {
                Task {
                    let ok = url.startAccessingSecurityScopedResource()
                    defer { if ok { url.stopAccessingSecurityScopedResource() } }
                    guard let data = try? Data(contentsOf: url) else {
                        localErr = true; note = L("Müzik dosyası okunamadı.","Couldn't read the music file."); return
                    }
                    if data.count >= 20_000_000 {
                        localErr = true; note = L("Müzik çok büyük (max 20 MB). Daha kısa/düşük kaliteli bir dosya seç.","Music too large (max 20 MB). Pick a shorter/lower-quality file."); return
                    }
                    musicUploading = true                       // YÜKLENİYOR göstergesi
                    let nm = url.deletingPathExtension().lastPathComponent
                    let before = userTracks.count
                    let mid = await store.musicLibraryAdd(name: nm, data: data)   // BİR KEZ yükle, kütüphaneye kaydet
                    musicUploading = false
                    userTracks = await store.musicLibrary()      // her durumda tazele
                    if let mid = mid, userTracks.contains(where: { $0["id"] == mid }) {
                        music = "lib:" + mid
                    } else if userTracks.count > before, let last = userTracks.last {
                        music = "lib:" + (last["id"] ?? "")       // internet yarıda kaldı ama dosya ulaştı -> yakala
                    } else {
                        localErr = true; note = L("Müzik yüklenemedi. İnternetini kontrol et, listede yoksa tekrar dene.","Upload failed. Check your connection; if not in the list, try again.")
                    }
                }
            }
        }
    }

    // Render edilen videoyu galeriye kaydet
    func saveToPhotos(_ url: URL) async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { return false }
        return await withCheckedContinuation { cont in
            PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: url)
            } completionHandler: { ok, _ in cont.resume(returning: ok) }
        }
    }

    var musicLabel: String {
        if music == "upload" { return L("Kendi müziğin","Your music") }
        if music == "none" { return L("Sessiz","Silent") }
        // YÜKLÜ MÜZİK her iki modda (Barış 2026-07-27): eskiden lib:/active SADECE tactical dalındaydı ->
        // 3D/premium modda seçili müzik "Yok" görünüyordu. En üste alındı -> her modda "eklendi" görünür.
        if music == "active" { return "🎵 " + L("Yüklenen müziğin","Your uploaded music") }
        if music.hasPrefix("lib:") { let id=String(music.dropFirst(4)); return "🎵 " + (userTracks.first{ $0["id"]==id }?["name"] ?? L("Yüklenen","Uploaded")) }
        if music.hasPrefix("stock:") {
            let id = String(music.dropFirst(6))
            return stock.first { $0["id"] == id }?["name"] ?? id
        }
        if mode == "tactical" {
            if musicUploading { return L("Yükleniyor…","Uploading…") }
            if music.isEmpty { return L("Sessiz","Silent") }          // boş = SESSİZ (Barış kuralı)
            if music == "random" { return L("Rastgele","Random") }
            if music.hasPrefix("lib:") { let id=String(music.dropFirst(4)); return "🎵 " + (userTracks.first{ $0["id"]==id }?["name"] ?? L("Yüklenen","Uploaded")) }
            return music.replacingOccurrences(of: "_", with: " ")
        }
        return L("Yok","None")
    }

    /// Telefonda üretimi iptal eder — görev durur, katman kapanır, yarım video YAZILMAZ.
    /// Görevin kendisi de `Task.isCancelled` ve WebRouteVideo'nun arka plan gözcüsüyle korunuyor.
    func telefonIptal() {
        telefonIs?.cancel(); telefonIs = nil
        telefonAktif = false; telefonPct = 0; telefonAsama = ""
    }

    /// TELEFONDA ÜRET: düz/kuşbakışı LocalRouteVideo, 3B WebRouteVideo (bulutla aynı motor sayfası).
    /// Başarılıysa video sunucuya yüklenir ve Videolarım'a geçilir; başarısızsa katmanda hata gösterilir.
    /// 03.11.2026: TEK üretim yolu (bulut kapandı) — yeni üretim de yeniden üretim de buradan geçer.
    func telefondaUret() async {
        // 🔴 FİKS 05.09 — EKRAN KİLİDİ: koruma yalnız WebRouteVideo (3B) içindeydi. Düz/kuşbakışı
        // yolunda YOKTU; kullanıcı ekrana dokunmazsa iOS otomatik kilit devreye giriyor,
        // `didEnterBackground` düşüyor ve LocalRouteVideo üretimi iptal ediyordu. Yani telefonda
        // düz/kuşbakışı üretimi neredeyse HER ZAMAN ölüyordu. Koruma artık iki motoru da kapsıyor.
        await MainActor.run { UIApplication.shared.isIdleTimerDisabled = true }
        // defer GUARD'DAN ÖNCE: kilit alınamayıp erken dönsek bile ekran kilidi geri açılmalı
        defer { Task { @MainActor in UIApplication.shared.isIdleTimerDisabled = false } }
        // 🔴 FİKS 05.09 — PAYLAŞILAN KİLİT: elle üretim kuyruk render'ıyla AYNI kilidi alır.
        // Öncesi: tek koruma `guard telefonIs == nil` idi (yalnız kendi çift dokunuşuna karşı);
        // otomatik kuyruk aynı anda ikinci bir render başlatabiliyor, ikisi de ana aktörü
        // paylaştığı için üretim kabaca yarı hıza düşüyordu.
        // 03.11: kilit otomatik kuyruktaysa kuyruğu iptal et (iş yerelq'de kalır) ve kilidi devral.
        var kilit = await MainActor.run(body: { Store.telefonKilidiAl() })
        if !kilit {
            await MainActor.run { telefonAsama = L("bekleyen üretim durduruluyor…", "stopping the queued render…") }
            await store.kuyrukIptalEt()
            kilit = await MainActor.run(body: { Store.telefonKilidiAl() })
        }
        guard kilit else {
            await MainActor.run {
                telefonNeden = L("telefonda zaten bir video üretiliyor — bitmesini bekle",
                                 "a video is already being made on your phone — please wait")
                telefonHata = true; telefonPct = 0; telefonAsama = ""; telefonIs = nil
            }
            return
        }
        // "Telefonunda üretiliyor…" etiketi ELLE üretimde de yansın (Barış 05.09)
        await MainActor.run { store.telefondaUretiliyor = true }
        defer {
            Task { @MainActor in
                store.telefondaUretiliyor = false
                Store.telefonKilidiBirak()
            }
        }
        let pts = await store.track(from: from, to: to)
        if pts.count < 3 {
            await MainActor.run { telefonNeden = L("bu sürüşte yeterli GPS noktası yok ({n})",
                                                   "not enough GPS points in this ride ({n})").replacingOccurrences(of: "{n}", with: "\(pts.count)")
                                  telefonHata = true; telefonPct = 0; telefonAsama = ""; telefonIs = nil }
            return
        }
        let mURL = await store.musicFile(music, session: from)
        // müzik geçici dosyası: hangi yoldan çıkarsak çıkalım silinsin (eskiden hiç silinmiyordu)
        defer { if let m = mURL { try? FileManager.default.removeItem(at: m) } }
        var video: URL?
        let ortakAnahtar = (ortak && grup != nil) ? grup : nil   // ortak video yalnız 3B motorda (eşler orada çizilir)
        if mode == "3d" || ortakAnahtar != nil {
            video = await WebRouteVideo.render(from: from, to: to, type: type, speed: speed,
                                               aspect: aspect, camdist: camdist,
                                               line: lineColor, dot: resolvedDot,
                                               token: store.token, musicURL: mURL, grup: ortakAnahtar,
                                               onAsama: { a in Task { @MainActor in telefonAsama = a } },
                                               onProgress: { p in Task { @MainActor in pctYaz(p) } })
        } else {
            var lopt = LocalRouteVideo.Opts()
            lopt.mode = mode; lopt.aspect = aspect   // lopt.premium varsayılan true (1080p) — herkese
            lopt.line = lineColor; lopt.dot = resolvedDot; lopt.camdist = camdist
            lopt.musicURL = mURL
            video = await LocalRouteVideo.render(points: pts, opts: lopt,
                                                 onAsama: { a in Task { @MainActor in telefonAsama = a } },
                                                 onProgress: { p in Task { @MainActor in pctYaz(p) } })
        }
        if Task.isCancelled { return }                       // iptal edildi -> hiçbir şey yükleme
        guard let v = video else {
            let neden = mode == "3d" ? WebRouteVideo.sonHata : LocalRouteVideo.sonHata
            await MainActor.run { telefonNeden = neden; telefonHata = true; telefonPct = 0
                                  telefonAsama = ""; telefonIs = nil }
            return
        }
        // 10.11.2026: YÜKLEME YOK — video telefonda kalır; sonuç ekranında izlenir, kaydedilir ya da silinir.
        await MainActor.run { telefonIs = nil; telefonAktif = false; telefonPct = 0; telefonAsama = "" }
        try? await Task.sleep(for: .seconds(0.6))   // üretim katmanı kapansın, sonra sonuç ekranı
        await MainActor.run { hazirVideo = v }
    }

    func field(_ t: String) -> some View {
        Text(t.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }
    func modeRow(_ id: String, _ label: String) -> some View {
        // Button + interaktif glassEffect dokunuşu yutuyordu → doğrudan tap-gesture + contentShape.
        // 03.11.2026: tüm modlar herkese açık (kilit yok).
        HStack {
            Text(label)
            Spacer()
            if mode == id { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(14)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture { mode = id }
    }
}
let TACTICAL_TRACKS: [String] = [
    "Achilles",
    "Aggressor",
    "Anxiety",
    "Burnt_Spirit",
    "Chase",
    "Crusade",
    "Crypto",
    "Curse_of_the_Scarab",
    "Dark_Times",
    "Exotic_Battle",
    "Final_Battle_of_the_Dark_Wizards",
    "Five_Armies",
    "Grim_League",
    "Hitman",
    "Impact_Prelude",
    "Interloper",
    "Invariance",
    "Kick_Shock",
    "Killers",
    "Mechanolith",
    "Movement_Proposition",
    "Nerves",
    "Oppressive_Gloom",
    "Overheat",
    "Prelude_and_Action",
    "Raw",
    "Rites",
    "Spy_Glass",
    "Stormfront",
    "Strength_of_the_Titans",
    "Tabuk",
    "The_Descent",
    "Undaunted",
    "Volatile_Reaction"
]


// 10.11.2026 (Barış): ÜRETİM SONUCU — video yalnız bu telefonda, geçici dosyada. Sunucuya yüklenmez.
// "Galeriye kaydet" → Fotoğraflar; "Paylaş" → paylaşım sayfası; "Kapat" → dosya silinir (kaydedilmediyse kaybolur).
struct VideoSonucView: View {
    let url: URL
    var kapat: () -> Void
    @State private var player: AVPlayer? = nil
    @State private var kaydediliyor = false
    @State private var kaydedildi = false
    @State private var kayitHata = false
    @State private var soruyor = false

    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(spacing: 14) {
                Text(L("Videon hazır 🎬","Your video is ready 🎬")).font(.title2.bold()).padding(.top, 16)
                if let player {
                    VideoPlayer(player: player)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .frame(maxHeight: .infinity)
                }
                Button {
                    Task {
                        kaydediliyor = true; kayitHata = false
                        let st = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                        var ok = false
                        if st == .authorized || st == .limited {
                            ok = await withCheckedContinuation { cont in
                                PHPhotoLibrary.shared().performChanges {
                                    PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: url)
                                } completionHandler: { o, _ in cont.resume(returning: o) }
                            }
                        }
                        kaydediliyor = false; kaydedildi = ok; kayitHata = !ok
                    }
                } label: {
                    HStack(spacing: 8) {
                        if kaydediliyor { ProgressView().tint(.white) }
                        else { Image(systemName: kaydedildi ? "checkmark.circle.fill" : "square.and.arrow.down") }
                        Text(kaydedildi ? L("Galeriye kaydedildi","Saved to Photos") : L("Galeriye kaydet","Save to Photos"))
                    }.frame(maxWidth: .infinity)
                }.buttonStyle(.glassyProminent()).disabled(kaydediliyor || kaydedildi)
                if kayitHata {
                    Text(L("Kaydedilemedi — Ayarlar'dan Fotoğraflar iznini kontrol et.",
                           "Couldn't save — check Photos permission in Settings."))
                        .font(.caption).foregroundStyle(.red)
                }
                HStack(spacing: 12) {
                    ShareLink(item: url) {
                        Label(L("Paylaş","Share"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                    }.buttonStyle(.glassy)
                    Button { if kaydedildi { kapat() } else { soruyor = true } } label: {
                        Text(L("Kapat","Close")).frame(maxWidth: .infinity)
                    }.buttonStyle(.glassy)
                }
                if !kaydedildi {
                    Text(L("Video sunucuda saklanmaz. Kaydetmezsen kapatınca silinir.",
                           "Videos aren't stored on our servers. If you don't save it, it's deleted when you close."))
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }.padding(20)
        }
        .interactiveDismissDisabled(!kaydedildi)   // kaydedilmemiş video kazara kaydırmayla kaybolmasın
        .onAppear { if player == nil { let p = AVPlayer(url: url); player = p; p.play() } }
        .onDisappear { player?.pause() }
        .confirmationDialog(L("Video kaydedilmedi. Kapatırsan silinecek.","The video isn't saved. Closing deletes it."),
                            isPresented: $soruyor, titleVisibility: .visible) {
            Button(L("Sil ve kapat","Delete and close"), role: .destructive) { kapat() }
            Button(L("Vazgeç","Cancel"), role: .cancel) {}
        }
    }
}
