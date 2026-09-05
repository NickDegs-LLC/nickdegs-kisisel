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
    @AppStorage("nd_reel") private var reel = false   // Faz 3c: ~15-20sn dikey paylaşım teaser'ı (9:16 zorlar)
    @AppStorage("nd_tac_theme") private var tacTheme = "auto"   // taktik HUD teması: auto(varsayılan, saate göre)/default/thermal/night/day
    @AppStorage("nd_tac_callsign") private var tacCallsign = ""    // kişisel operatör çağrı işareti (boş=ACTUAL)
    @State private var sending = false
    @State private var done = false
    @State private var renderPct: Double = 0
    @State private var localErr = false
    // TELEFONDA ÜRET (1.62, Barış 05.09): artık AYRI ve BİLEREK seçilen bir yol.
    // Eskiden ana buton premium'da sessizce telefonda üretiyordu; kullanıcı nerede üretildiğini
    // bilmiyordu ve uygulamadan çıkınca üretim beyaz kareler yazıyordu.
    @State private var telefonAktif = false            // tam ekran üretim katmanı açık mı
    @State private var telefonPct: Double = 0
    @State private var telefonIs: Task<Void, Never>?   // ekrandan çıkılırsa iptal edilir
    @State private var telefonHata = false
    @State private var telefonNeden = ""      // BAŞARISIZLIK NEDENİ — "Üretilemedi" tek başına hiçbir şey söylemiyordu
    @State private var showPaywall = false
    @AppStorage("nd_camdist") private var camdist = "orta"   // kamera mesafesi yakın/orta/uzak (premium)
    @AppStorage("nd_cammode") private var camMode = ""       // 3D kamera açısı: ""=yandan, chase=orta arkadan, pacman=agresif tam arkadan (premium, sadece 3D)
    @AppStorage("nd_ultra") private var ultraStored = false  // sunucu/admin Ultra (syncPremium yazar) — StoreKit dışı da açılsın
    private var isUltra: Bool { iap.ultra || ultraStored }   // Ultra = StoreKit ultra VEYA sunucu/admin ultra
    @AppStorage("nd_free_tactical") private var freeTacStored = false   // yeni kullanıcı TEK-SEFERLİK bedava aksiyon (syncPremium ham JSON'dan yazar)
    private var canTactical: Bool { isUltra || freeTacStored }          // Ultra VEYA bedava-aksiyon hakkı -> taktik açık
    @AppStorage("nd_sokak_hak") private var sokakHak = 0        // satın alınmış Sokak hakkı
    @AppStorage("nd_video_hak") private var videoHak = 0        // satın alınmış bulut video hakkı (3'lü/5'li paket)
    @AppStorage("nd_sokak_hediye") private var sokakHediye = false  // Ultra'nın bu ayki hediyesi duruyor mu
    private func sokakYenile() { Task { await store.syncPremium() } }
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
                    if mode != "tactical" {

                    field(L("Süre","Length"))
                    }
                    // Otonom = PREMIUM: süre tamamen rotaya göre, max 3dk (günde 1). Free seçince paywall.
                    if mode != "tactical" {
                    Picker("", selection: Binding(
                        get: { speed },
                        set: { v in if v == "auto" && !premium { showPaywall = true } else { speed = v } })) {
                        Text(L("Kısa","Short")).tag("fast")
                        Text(L("Orta","Medium")).tag("medium")
                        Text(L("Uzun","Long")).tag("slow")
                        Text(premium ? L("Otonom","Auto") : L("Otonom 🔒","Auto 🔒")).tag("auto")
                    }.pickerStyle(.segmented)
                    Text(speed == "auto"
                         ? L("Otonom: süre TAMAMEN rotaya göre ayarlanır (max 3 dk). Şehir yolculukları için ideal. Premium.",
                             "Auto: length fully scales with your route (max 3 min). Great for city trips. Premium.")
                         : L("Kısa ≈15sn, Orta ≈30sn, Uzun rotaya göre (max 60sn). Süre rota uzunluğuna göre ölçeklenir.",
                             "Short ≈15s, Medium ≈30s, Long scales with distance (max 60s)."))
                        .font(.caption2).foregroundStyle(speed == "auto" ? Brand.accent : .secondary)
                    }

                    // KAMERA MESAFESİ (premium, her video): kameranın rotaya yakınlığı.
                    if mode != "tactical" {
                    field(L("Kamera mesafesi","Camera distance"))
                    Picker("", selection: Binding(
                        get: { premium ? camdist : "orta" },
                        set: { v in if premium { camdist = v } else { showPaywall = true } })) {
                        Text(L("Yakın","Near")).tag("yakin")
                        Text(L("Orta","Medium")).tag("orta")
                        Text(L("Uzak","Far")).tag("uzak")
                    }.pickerStyle(.segmented)
                    }
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

                        // SOKAK HAKKI (2026-08-27, Barış: "Sokak videosu ayrı bir tek satın alım olsun"):
                        // Sokak videosu gerçek sokak fotoğraflarından kare kare üretilir, maliyeti yüksek ->
                        // aboneliğe dahil DEĞİL. Ultra'ya ayda 1 hediye; fazlası tek satın alım.
                        if camMode == "pacman" {
                            VStack(spacing: 8) {
                                HStack(spacing: 6) {
                                    Image(systemName: "ticket.fill").foregroundStyle(Brand.gradient)
                                    Text(sokakHak > 0
                                         ? L("Sokak hakkın: ","Street credits: ") + "\(sokakHak)"
                                         : (sokakHediye ? L("Bu ayki hediye hakkın hazır 🎁","Your monthly gift credit is ready 🎁")
                                                        : L("Sokak hakkın kalmadı","No street credits left")))
                                        .font(.system(size: 14, weight: .medium))
                                }
                                if sokakHak == 0 && !sokakHediye {
                                    HStack(spacing: 10) {
                                        if let p1 = iap.sokakTek {
                                            Button { Task { if await iap.buySokak(p1) { await store.syncPremium(); sokakYenile() } } }
                                            label: { Text("1 × \(p1.displayPrice)") }.buttonStyle(.glassy)
                                        }
                                        if let p3 = iap.sokakUclu {
                                            Button { Task { if await iap.buySokak(p3) { await store.syncPremium(); sokakYenile() } } }
                                            label: { Text("3 × \(p3.displayPrice)") }.buttonStyle(.glassyProminent())
                                        }
                                    }
                                    if iap.boostWorking { ProgressView() }
                                }
                                if let m = iap.boostMsg {
                                    Text(m).font(.caption2).foregroundStyle(.secondary)
                                }
                            }.padding(12).glassPanel(14)
                        }
                    }

                    field(L("Görünüm","Style"))
                    modeRow("flat", L("Düz","Flat"), free: true)
                    modeRow("flyover", L("Kuş bakışı (Flyover)","Bird's-eye (Flyover)"), free: false)
                    modeRow("3d", L("3D · arazi kabartmalı","3D · terrain relief"), free: false)
                    // TACTICAL (Ultra): CoD tarzı askeri uydu görevi videosu — uçtan uca ayrı render hattı
                    HStack {
                        Text("🎖️ " + L("Tactical · uydu görevi","Tactical · satellite op"))
                        if !isUltra {
                            if freeTacStored {   // TEK-SEFERLİK bedava aksiyon hakkı -> yeşil rozet
                                Text(L("1 ÜCRETSİZ","1 FREE")).font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Capsule().fill(Color.green.opacity(0.3)))
                            } else {
                                Text("Ultra").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Capsule().fill(Brand.accent.opacity(0.25)))
                            }
                        }
                        Spacer()
                        if mode == "tactical" { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassPanel(14)
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onTapGesture { if canTactical { mode = "tactical" } else { showPaywall = true } }
                    if mode == "tactical" {
                        Text(L("Askeri uydu operasyonu: telsiz brifingi, dünya çapında rastgele arama, hedef kilidi, canlı takip ve görev kapanışı. Her video %100 benzersiz üretilir (9:16).",
                               "Military satellite op: radio briefing, global random search, target lock, live tracking and mission outro. Every video is 100% unique (9:16)."))
                            .font(.caption2).foregroundStyle(.secondary)
                        Picker("", selection: Binding(
                            get: { speed == "slow" ? "slow" : "fast" },
                            set: { speed = $0 })) {
                            Text(L("Kısa (≤1 dk)","Short (≤1 min)")).tag("fast")
                            Text(L("Uzun (≤3 dk)","Long (≤3 min)")).tag("slow")
                        }.pickerStyle(.segmented)
                        // FIX (2026-07-23): carryover "16:9" (normal videodan) tactical picker'ını bozuyordu
                        // -> clamp'li binding: geçersiz değer "9:16" gösterir, "Kare 4:5" dokunuşu gerçekten 4:5 yapar.
                        Picker("", selection: Binding(
                            get: { aspect == "4:5" ? "4:5" : "9:16" },
                            set: { aspect = $0 })) {
                            Text(L("Dikey 9:16","Vertical 9:16")).tag("9:16")
                            Text(L("Kare 4:5","Square 4:5")).tag("4:5")
                        }.pickerStyle(.segmented)
                        Text(L("9:16 Reels/TikTok, 4:5 feed gönderisi. Her süre her formatta olur.",
                               "9:16 for Reels/TikTok, 4:5 for feed posts. Any length, any format."))
                            .font(.caption2).foregroundStyle(.secondary)
                        // Taktik HUD teması: uydu derecelendirme + HUD renk paleti
                        field(L("Görüş modu","Vision mode"))
                        Picker(L("Görüş modu","Vision mode"), selection: $tacTheme) {
                            Text(L("Otomatik (saate göre)","Auto (by time)")).tag("auto")
                            Text(L("Standart","Recon")).tag("default")
                            Text(L("Termal","Thermal")).tag("thermal")
                            Text(L("Gece","Night")).tag("night")
                            Text(L("Gündüz","Day")).tag("day")
                        }.pickerStyle(.menu).tint(Brand.accent).frame(maxWidth: .infinity, alignment: .leading)
                        Text(tacTheme == "auto"
                             ? L("Otomatik: sürüş gece ise yeşil gece görüşü, gündüz ise standart uydu — sürüşün gerçek saatine göre seçilir.",
                                 "Auto: green night vision if the ride was at night, standard satellite by day — based on the ride's real time.")
                             : L("Termal=sıcaklık, Gece=karanlık uydu (yakınlaşınca gece görüşü), Gündüz=net uydu. HUD rengi de değişir.",
                                 "Thermal=heat, Night=dark satellite (night vision on zoom-in), Day=clear satellite. HUD color changes too."))
                            .font(.caption2).foregroundStyle(tacTheme == "auto" ? Brand.accent : .secondary)
                        // Operatör çağrı işareti (intro/outro'da "WELCOME, <callsign>")
                        field(L("Çağrı işareti","Call sign"))
                        TextField("ACTUAL", text: $tacCallsign)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled(true)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: tacCallsign) { _, v in
                                let f = v.uppercased().filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "-" }
                                if f != v { tacCallsign = String(f.prefix(16)) }
                                else if v.count > 16 { tacCallsign = String(v.prefix(16)) }
                            }
                        Text(L("Brifingte adın: “WELCOME, <çağrı işareti>”. Boş=ACTUAL.",
                               "Your name in the briefing: “WELCOME, <call sign>”. Empty=ACTUAL."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }

                    if mode != "tactical" {
                        field(L("En-boy","Aspect"))
                        Picker("", selection: $aspect) {
                            Text("16:9").tag("16:9"); Text("9:16").tag("9:16")
                        }.pickerStyle(.segmented).disabled(reel)
                        // REEL: kısa dikey paylaşım teaser'ı (~15-20sn, 9:16 zorlar)
                        Toggle(isOn: $reel) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Reel — kısa paylaşım klibi 🎬","Reel — short share clip 🎬")).font(.subheadline)
                                Text(L("~15-20 sn dikey (9:16), sosyal medya için ideal. Uzun rotalarda hızlı teaser.",
                                       "~15-20s vertical (9:16), great for social. A fast teaser on long routes."))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }.tint(Brand.accent)
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

                    field(mode == "tactical" ? L("Crosshair rengi","Crosshair color") : L("Takip noktası","Tracking dot"))
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
                            }
                            Divider()
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

                    // ═══ VİDEO PAKETİ (2026-08-28, Barış) ═══
                    // Ücretsiz katmanda video üretilmez. Kullanıcı ya Premium olur ya paket alır.
                    // 5'li paketin birim fiyatı 3'lüden ucuz — teşvik burada görünür.
                    if !premium {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(videoHak > 0
                                  ? L("Video hakkın: \(videoHak)", "Your video credits: \(videoHak)")
                                  : L("Video hakkın yok", "No video credits"),
                                  systemImage: "film.stack")
                                .font(.subheadline.weight(.semibold))
                            Text(L("Sürüşlerin Rotalar'da kayıtlı. Videoya dönüştürmek için paket al ya da Premium'a geç — Premium'da her sürüş otomatik videoya döner.",
                                   "Your rides are saved in Routes. Buy a pack to turn them into videos, or go Premium — Premium turns every ride into a video automatically."))
                                .font(.caption2).foregroundStyle(.secondary)
                            HStack(spacing: 10) {
                                if let p3 = iap.videoUclu {
                                    Button { Task { if await iap.buyVideo(p3) { await store.syncPremium() } } }
                                    label: { Text(L("3 video · \(p3.displayPrice)", "3 videos · \(p3.displayPrice)")) }
                                        .buttonStyle(.glassy)
                                }
                                if let p5 = iap.videoBesli {
                                    Button { Task { if await iap.buyVideo(p5) { await store.syncPremium() } } }
                                    label: { Text(L("5 video · \(p5.displayPrice)", "5 videos · \(p5.displayPrice)")) }
                                        .buttonStyle(.glassyProminent())
                                }
                            }
                            if iap.boostWorking { ProgressView() }
                            if let m = iap.boostMsg { Text(m).font(.caption2).foregroundStyle(.secondary) }
                        }.padding(12).glassPanel(14)
                    }

                    Button {
                        // ═══ KATMAN KURALI (Barış 2026-08-28, nihai) ═══
                        //   ÜCRETSİZ      -> VİDEO YOK. Sürüşler Rotalar'da görüntülenir, o kadar.
                        //                    Video isterse: Premium olur VEYA video paketi satın alır.
                        //                    ("Hem telefonda üretme verip hem video başına satın alım
                        //                     koymak saçma oldu; bedavalardan video üretmeyi kaldır.")
                        //   PREMIUM/ULTRA -> düz/kuşbakışı telefonda, 3B bulutta (ödediği konfor).
                        //   VİDEO HAKKI   -> ücretsiz kullanıcı paket aldıysa video BULUTTA üretilir.
                        if !premium && videoHak <= 0 { showPaywall = true; return }
                        sending = true; localErr = false
                        Task {
                            // 1.62 (Barış 05.09: "Varsayılan olarak telefondan üretilmeyecek"):
                            // bu buton ARTIK HER ZAMAN BULUTTA üretir. Telefonda üretmek isteyen
                            // aşağıdaki ayrı "Telefonda üret" düğmesini kullanır — orada ne olduğunu
                            // gösteren tam ekran ilerleme ve "çıkarsan iptal olur" uyarısı var.
                            // BULUT render: sunucuya istek bırak -> Cloud Run render eder -> R2 -> bitince bildirim.
                            // Telefon yorulmaz, uygulama kapatılabilir (sıfır cihaz yükü).
                            let tacTh = mode == "tactical" ? tacTheme : ""
                            let tacCs = mode == "tactical" ? tacCallsign.trimmingCharacters(in: .whitespaces) : ""
                            let useReel = mode != "tactical" && reel
                            let ok = rideId == nil
                                ? await store.generateRide(from: from, to: to, type: type, mode: mode,
                                                           aspect: aspect, premium: premium, speed: speed, music: music, line: lineColor, dot: resolvedDot, camdist: camdist, cam: mode == "3d" ? camMode : "", theme: tacTh, callsign: tacCs, reel: useReel)
                                : await store.regenerateRide(rideId!, type: type, mode: mode,
                                                             aspect: aspect, premium: premium, speed: speed, music: music, line: lineColor, dot: resolvedDot, camdist: camdist, cam: mode == "3d" ? camMode : "", theme: tacTh, callsign: tacCs, reel: useReel)
                            sending = false; done = ok; localErr = !ok
                            // başarılı -> Videolarım'a geç + sheet kapat; video orada "Hazırlanıyor" kilitli görünür (bulut kelimesi YOK)
                            if ok { store.jumpToVideos = true; try? await Task.sleep(for: .seconds(1.2)); dismiss() }
                        }
                    } label: {
                        // 2026-08-26 (Barış: "bulutta hazırlanıyor diye bir şey yok, komple kaldır"):
                        // videolar TELEFONDA üretiliyor -> tüm metinler cihaz dilinde. Hazırlık aşaması
                        // (motor sayfası + karo ön-ısıtma) da "Hazırlanıyor…" der, "kuyruk/bulut" YOK.
                        if sending && renderPct > 0 { HStack(spacing: 8) { ProgressView(value: renderPct)
                            Text(L("Üretiliyor… %","Rendering… %") + "\(Int(renderPct * 100))") } }
                        else if sending { HStack(spacing: 8) { ProgressView()
                            Text(L("Hazırlanıyor…", "Preparing…")) } }
                        else if done { Label(L("Videon hazırlanıyor 🎬","Rendering your video"), systemImage: "checkmark.circle.fill") }
                        else { Text(rideId == nil ? L("Video oluştur","Create video")
                                                  : L("Yeniden oluştur","Regenerate")) }
                    }.buttonStyle(.glassyProminent()).disabled(sending)

                    // ═══ TELEFONDA ÜRET (ayrı yol) ═══
                    // Premium + düz/kuşbakışı/3B. Bedava (GPU parası yok) ama uygulama ön planda
                    // kalmalı: WKWebView arka planda BOŞ kare döndürüyor. O yüzden ayrı düğme,
                    // tam ekran ilerleme ve açık uyarı — kullanıcı ne yaptığını bilerek seçsin.
                    if premium && !sending && !done && ["flat", "flyover", "3d"].contains(mode) {
                        Button {
                            telefonHata = false; telefonNeden = ""; telefonPct = 0.001; telefonAktif = true
                            telefonIs = Task { await telefondaUret() }
                        } label: {
                            Label(L("Telefonda üret (bedava)", "Render on this phone (free)"),
                                  systemImage: "iphone.gen3")
                        }
                        .buttonStyle(.glassy)
                        Text(L("Telefonda üretim bedavadır ama ekranı açık tutman gerekir.",
                               "On-device rendering is free but the screen must stay on."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }

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
                        Text(note.isEmpty ? L("Bu rotada konum verisi yok ya da istek başarısız.","No location data for this route or request failed.") : note)
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
                            Text(L("Üretilemedi. Bulutta üretmeyi deneyebilirsin.",
                                   "Couldn't render. You can try the cloud instead."))
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
        }
        .onDisappear { telefonIptal() }   // sayfa kapanırsa üretim de kapanır
        .task {
            await store.syncPremium(); stock = await store.musicList(); userTracks = await store.musicLibrary()
            // YÜKLÜ MÜZİK OTOMATİK SEÇİLİ (Barış 2026-07-27): kullanıcı müzik yüklediyse + henüz seçim yapmadıysa
            // varsayılan "active" (son yüklenen) -> "eklendi" görünür + videoda kullanılır (eskiden boş/sessiz kalıyordu).
            if !userTracks.isEmpty && music.isEmpty { music = "active" }
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
        telefonAktif = false; telefonPct = 0
    }

    /// TELEFONDA ÜRET: düz/kuşbakışı LocalRouteVideo, 3B WebRouteVideo (bulutla aynı motor sayfası).
    /// Başarılıysa video sunucuya yüklenir ve Videolarım'a geçilir; başarısızsa katmanda hata gösterilir
    /// (kullanıcı buluta düşmeyi kendi seçer — sessizce para harcamayız).
    func telefondaUret() async {
        let pts = await store.track(from: from, to: to)
        if pts.count < 3 {
            await MainActor.run { telefonNeden = L("bu sürüşte yeterli GPS noktası yok (\(pts.count))",
                                                   "not enough GPS points in this ride (\(pts.count))")
                                  telefonHata = true; telefonPct = 0 }
            return
        }
        let mURL = await store.musicFile(music, session: from)
        var video: URL?
        if mode == "3d" {
            video = await WebRouteVideo.render(from: from, to: to, type: type, speed: speed,
                                               aspect: aspect, camdist: camdist,
                                               line: lineColor, dot: resolvedDot,
                                               token: store.token, musicURL: mURL,
                                               onProgress: { p in Task { @MainActor in telefonPct = p } })
        } else {
            var lopt = LocalRouteVideo.Opts()
            lopt.mode = mode; lopt.aspect = aspect; lopt.premium = premium
            lopt.line = lineColor; lopt.dot = resolvedDot; lopt.camdist = camdist
            lopt.musicURL = mURL
            video = await LocalRouteVideo.render(points: pts, opts: lopt,
                                                 onProgress: { p in Task { @MainActor in telefonPct = p } })
        }
        if Task.isCancelled { return }                       // iptal edildi -> hiçbir şey yükleme
        guard let v = video else {
            let neden = mode == "3d" ? WebRouteVideo.sonHata : LocalRouteVideo.sonHata
            await MainActor.run { telefonNeden = neden; telefonHata = true; telefonPct = 0 }
            return
        }
        guard await store.uploadLocalVideo(v, ts: from, to: to, mode: mode,
                                           aspect: aspect, type: type, speed: speed) else {
            await MainActor.run { telefonNeden = L("video yüklenemedi (bağlantı?)", "upload failed (network?)")
                                  telefonHata = true; telefonPct = 0 }
            return
        }
        await MainActor.run {
            telefonAktif = false; telefonPct = 0; telefonIs = nil
            done = true; store.jumpToVideos = true
        }
        try? await Task.sleep(for: .seconds(0.8))
        await MainActor.run { dismiss() }
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
