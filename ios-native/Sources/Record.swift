import SwiftUI
import UniformTypeIdentifiers
import Photos

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

// Gezi bitince video oluşturma: tip (değiştirilebilir) + mod + en-boy (premium gating)
struct GenerateSheet: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var iap: IAP
    @Environment(\.dismiss) var dismiss
    let from: Double
    let to: Double
    let rideId: String?                         // nil = yeni üretim, dolu = mevcut videoyu düzenle
    @State var type: String
    @AppStorage("nd_premium") var premium = false
    @State private var mode: String
    @State private var aspect: String
    @State private var speed: String            // "fast"=Kısa / "medium"=Orta / "slow"=Uzun
    @State private var sending = false
    @State private var done = false
    @State private var renderPct: Double = 0
    @State private var localErr = false
    @State private var showPaywall = false
    @AppStorage("nd_camdist") private var camdist = "orta"   // kamera mesafesi yakın/orta/uzak (premium)
    @AppStorage("nd_cammode") private var camMode = ""       // 3D kamera açısı: ""=yandan, chase=orta arkadan, pacman=agresif tam arkadan (premium, sadece 3D)
    @AppStorage("nd_ultra") private var ultraStored = false  // sunucu/admin Ultra (syncPremium yazar) — StoreKit dışı da açılsın
    private var isUltra: Bool { iap.ultra || ultraStored }   // Ultra = StoreKit ultra VEYA sunucu/admin ultra
    @State private var stock: [[String:String]] = []
    @State private var music = ""               // "", "stock:<id>", "upload"
    @State private var showAudioPicker = false
    @AppStorage("nd_line_color") private var lineColor = "#00E5FF"   // kullanıcının seçtiği rota çizgi rengi
    @AppStorage("nd_dot_color") private var dotColor = "#FF3B30"     // takip noktası rengi ("line" = çizgiyle aynı)
    // "Çizgiyle aynı" seçiliyken gönderilecek gerçek renk: glass/clear/none çizgide beyaz nokta
    private var resolvedDot: String { dotColor == "line" ? (lineColor.hasPrefix("#") ? lineColor : "#FFFFFF") : dotColor }

    init(from: Double, to: Double, type: String, mode: String = "flat",
         aspect: String = "16:9", speed: String = "medium", rideId: String? = nil) {
        self.from = from; self.to = to; self.rideId = rideId
        _type = State(initialValue: type)
        _mode = State(initialValue: mode)
        _aspect = State(initialValue: aspect)
        _speed = State(initialValue: speed)
    }

    var body: some View {
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

                    field(L("Süre","Length"))
                    // Otonom = PREMIUM: süre tamamen rotaya göre, max 3dk (günde 1). Free seçince paywall.
                    Picker("", selection: Binding(
                        get: { speed },
                        set: { v in if v == "auto" && !premium { showPaywall = true } else { speed = v } })) {
                        Text(L("Kısa","Short")).tag("fast")
                        Text(L("Orta","Medium")).tag("medium")
                        Text(L("Uzun","Long")).tag("slow")
                        Text(premium ? L("Otonom","Auto") : L("Otonom 🔒","Auto 🔒")).tag("auto")
                    }.pickerStyle(.segmented)
                    Text(speed == "auto"
                         ? L("Otonom: süre TAMAMEN rotaya göre ayarlanır (max 3 dk). Şehir yolculukları için ideal. Premium, günde 1.",
                             "Auto: length fully scales with your route (max 3 min). Great for city trips. Premium, once a day.")
                         : L("Kısa ≈15sn, Orta ≈30sn, Uzun rotaya göre (max 60sn). Süre rota uzunluğuna göre ölçeklenir.",
                             "Short ≈15s, Medium ≈30s, Long scales with distance (max 60s)."))
                        .font(.caption2).foregroundStyle(speed == "auto" ? Brand.accent : .secondary)

                    // KAMERA MESAFESİ (premium, her video): kameranın rotaya yakınlığı.
                    field(L("Kamera mesafesi","Camera distance"))
                    Picker("", selection: Binding(
                        get: { premium ? camdist : "orta" },
                        set: { v in if premium { camdist = v } else { showPaywall = true } })) {
                        Text(L("Yakın","Near")).tag("yakin")
                        Text(L("Orta","Medium")).tag("orta")
                        Text(L("Uzak","Far")).tag("uzak")
                    }.pickerStyle(.segmented)
                    Text(premium
                         ? L("Kameranın rotaya yakınlığı: Yakın daha yakın çekim, Uzak daha geniş kadraj.",
                             "How close the camera follows: Near = tighter shot, Far = wider framing.")
                         : L("Kamera mesafesi Premium ile seçilebilir.",
                             "Camera distance is a Premium option."))
                        .font(.caption2).foregroundStyle(premium ? .secondary : Brand.accent)

                    // KAMERA AÇISI (sadece 3D · Google, ULTRA): takip açısı — yandan / arkadan / Sokak(Street View)
                    if mode == "3d" {
                        field(L("Kamera açısı","Camera angle") + (isUltra ? "" : " · Ultra"))
                        Picker("", selection: Binding(
                            get: { isUltra ? camMode : "" },
                            set: { v in if isUltra { camMode = v } else { showPaywall = true } })) {
                            Text(L("Yandan","Side")).tag("")
                            Text(L("Arkadan","Chase")).tag("chase")
                            Text(L("Sokak","Street")).tag("pacman")
                        }.pickerStyle(.segmented)
                        Text(isUltra
                             ? L("Yandan: klasik yan takip. Arkadan: tam arkadan hafif yukarıdan. Sokak: gerçek Google Street View (DENEYSEL — sokak fotoğrafları ~20m arayla olduğundan akış yer yer atlayabilir; kısa/dar sokaklarda veya çok detaylı rotalarda bozuk görünebilir).",
                                 "Side: classic. Chase: from directly behind, slightly above. Street: real Google Street View (EXPERIMENTAL — street photos are ~20m apart so motion may skip; can look rough on short/narrow streets or very detailed routes).")
                             : L("Kamera açıları (Arkadan, Sokak/Street View) Ultra pakete dahildir.",
                                 "Camera angles (Chase, Street View) are included in Ultra."))
                            .font(.caption2).foregroundStyle(isUltra ? .secondary : Brand.accent)
                    }

                    field(L("Görünüm","Style"))
                    modeRow("flat", L("Düz","Flat"), free: true)
                    modeRow("flyover", L("Kuş bakışı (Flyover)","Bird's-eye (Flyover)"), free: false)
                    modeRow("3d", L("3D · arazi kabartmalı","3D · terrain relief"), free: false)
                    // TACTICAL (Ultra): CoD tarzı askeri uydu görevi videosu — uçtan uca ayrı render hattı
                    HStack {
                        Text("🎖️ " + L("Tactical · uydu görevi","Tactical · satellite op"))
                        if !isUltra { Text("Ultra").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Capsule().fill(Brand.accent.opacity(0.25))) }
                        Spacer()
                        if mode == "tactical" { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassPanel(14)
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onTapGesture { if isUltra { mode = "tactical" } else { showPaywall = true } }
                    if mode == "tactical" {
                        Text(L("Askeri uydu operasyonu: telsiz brifingi, dünya çapında rastgele arama, hedef kilidi, canlı takip ve görev kapanışı. Her video %100 benzersiz üretilir (9:16).",
                               "Military satellite op: radio briefing, global random search, target lock, live tracking and mission outro. Every video is 100% unique (9:16)."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }

                    field(L("En-boy","Aspect"))
                    Picker("", selection: $aspect) {
                        Text("16:9").tag("16:9"); Text("9:16").tag("9:16")
                    }.pickerStyle(.segmented)

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
                    }   // tactical: çizgi/nokta seçimi yok

                    field(L("Müzik","Music"))
                    Menu {
                        if mode == "tactical" {
                            Button(L("Rastgele (öner)","Random (suggest)")) { music = "" }
                            ForEach(TACTICAL_TRACKS, id: \.self) { t in
                                Button(t.replacingOccurrences(of: "_", with: " ")) { music = t }
                            }
                        } else {
                        Button(L("Yok","None")) { music = "" }
                        ForEach(stock, id: \.self) { s in
                            Button(s["name"] ?? "") {
                                if premium { music = "stock:\(s["id"] ?? "")" } else { showPaywall = true }
                            }
                        }
                        Button(L("Kendi müziğin… (yükle)","Your own… (upload)")) {
                            if premium { showAudioPicker = true } else { showPaywall = true }
                        }
                        }   // tactical/normal müzik listeleri
                    } label: {
                        HStack {
                            Image(systemName: "music.note")
                            Text(musicLabel).lineLimit(1).truncationMode(.tail)   // uzun şarkı adı satırı itmesin (her ekran boyutu)
                            if !premium { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                            Spacer(); Image(systemName: "chevron.down").font(.caption2)
                        }.padding(.horizontal, 14).padding(.vertical, 12)
                    }.buttonStyle(.plain).glassPanel(14).tint(.primary)

                    if !premium {
                        Text(L("Rota kaydı ücretsiz. Videoya dökmek Premium: 1080p, filigransız, Flyover/3B, müzik.",
                               "Route tracking is free. Turning it into a video is Premium: 1080p, no watermark, Flyover/3D, music."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }

                    Button {
                        // Kural: algılama free, videoya dökme premium.
                        if !premium { showPaywall = true; return }
                        sending = true; localErr = false
                        Task {
                            // CİHAZDA render (Düz/Flyover, 2026-07-06 Barış): telefon GPU'su üretir, buluta
                            // sadece hazır mp4 yüklenir -> sunucu GPU maliyeti SIFIR. Olmazsa sessizce buluta düşer.
                            if mode == "flat" || mode == "flyover" {
                                let pts = await store.track(from: from, to: to)
                                if pts.count >= 3 {
                                    renderPct = 0.01
                                    if let vurl = await LocalRouteVideo.render(points: pts, aspect: aspect,
                                                                               onProgress: { p in Task { @MainActor in renderPct = p } }),
                                       await store.uploadLocalVideo(vurl, ts: from, to: to, mode: mode, aspect: aspect, type: type, speed: speed) {
                                        renderPct = 0; sending = false; done = true
                                        store.jumpToVideos = true; try? await Task.sleep(for: .seconds(1.0)); dismiss(); return
                                    }
                                    renderPct = 0   // cihazda olmadı -> buluta düş (aşağıda)
                                }
                            }
                            // BULUT render: sunucuya istek bırak -> Cloud Run render eder -> R2 -> bitince bildirim.
                            // Telefon yorulmaz, uygulama kapatılabilir (sıfır cihaz yükü).
                            let ok = rideId == nil
                                ? await store.generateRide(from: from, to: to, type: type, mode: mode,
                                                           aspect: aspect, premium: premium, speed: speed, music: music, line: lineColor, dot: resolvedDot, camdist: camdist, cam: mode == "3d" ? camMode : "")
                                : await store.regenerateRide(rideId!, type: type, mode: mode,
                                                             aspect: aspect, premium: premium, speed: speed, music: music, line: lineColor, dot: resolvedDot, camdist: camdist, cam: mode == "3d" ? camMode : "")
                            sending = false; done = ok; localErr = !ok
                            // başarılı -> Videolarım'a geç + sheet kapat; video orada "Hazırlanıyor" kilitli görünür
                            if ok { store.jumpToVideos = true; try? await Task.sleep(for: .seconds(1.2)); dismiss() }
                        }
                    } label: {
                        if sending && renderPct > 0 { HStack(spacing: 8) { ProgressView(value: renderPct)
                            Text(L("Cihazda üretiliyor… %","Rendering on device… %") + "\(Int(renderPct * 100))") } }
                        else if sending { HStack(spacing: 8) { ProgressView()
                            Text(L("Kuyruğa alınıyor…", "Queuing…")) } }
                        else if done { Label(L("Bulutta hazırlanıyor 🎬","Rendering in cloud"), systemImage: "checkmark.icloud") }
                        else { Text(rideId == nil ? L("Video oluştur","Create video")
                                                  : L("Yeniden oluştur","Regenerate")) }
                    }.buttonStyle(.glassyProminent()).disabled(sending)

                    // Günlük limit dolunca / proaktif: bugünün limitini 2x yapan boost (consumable IAP)
                    if premium, let b = iap.boost {
                        Button {
                            Task { _ = await iap.buyBoost() }
                        } label: {
                            HStack(spacing: 8) {
                                if iap.boostWorking { ProgressView() }
                                else { Image(systemName: "bolt.fill").foregroundStyle(.yellow) }
                                Text(L("Bugünün limitini 2× yap","Double today's limit") + " — \(b.displayPrice)")
                                Spacer()
                                Image(systemName: "sparkles").font(.caption2)
                            }.padding(.horizontal, 14).padding(.vertical, 12)
                        }.buttonStyle(.plain).glassPanel(14).tint(.primary).disabled(iap.boostWorking)
                        if let m = iap.boostMsg {
                            Text(m).font(.caption2).foregroundStyle(Brand.accent)
                        } else {
                            Text(L("Günlük video limitin dolduysa anında 2 katına çıkar (sadece bugün).",
                                   "If you hit today's limit, instantly double it (today only)."))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }

                    if localErr {
                        Text(L("Bu rotada konum verisi yok ya da istek başarısız.","No location data for this route or request failed."))
                            .font(.caption2).foregroundStyle(.red)
                    }
                    if done {
                        Text(L("Videon bulutta hazırlanıyor. Hazır olunca bildirim gelir; Rotalar ve Özet'te görünür.",
                               "Your video is rendering in the cloud. You'll get a notification; it shows up in Routes and Summary."))
                            .font(.caption2).foregroundStyle(Brand.accent)
                    }
                    Text(L("Video bulut sunucularında oluşturulur — telefonun yorulmaz, uygulamayı kapatabilirsin.",
                           "Rendered on our cloud servers — your phone stays free; you can close the app."))
                        .font(.caption2).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(sending)   // render sırasında sheet kapatılamaz
        .sheet(isPresented: $showPaywall) { PaywallSheet(premium: $premium) }
        .task { await store.syncPremium(); stock = await store.musicList() }
        .fileImporter(isPresented: $showAudioPicker, allowedContentTypes: [.audio]) { res in
            if case .success(let url) = res {
                Task {
                    let ok = url.startAccessingSecurityScopedResource()
                    defer { if ok { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url), data.count < 12_000_000 {
                        await store.addRideMusic(session: from, data: data)
                        music = "upload"
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
        if music.hasPrefix("stock:") {
            let id = String(music.dropFirst(6))
            return stock.first { $0["id"] == id }?["name"] ?? id
        }
        return L("Yok","None")
    }

    func field(_ t: String) -> some View {
        Text(t.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }
    func modeRow(_ id: String, _ label: String, free: Bool) -> some View {
        // Button + interaktif glassEffect dokunuşu yutuyordu → doğrudan tap-gesture + contentShape.
        HStack {
            Text(label)
            if !free && !premium { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
            Spacer()
            if mode == id { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(14)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture { if free || premium { mode = id } else { showPaywall = true } }
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
