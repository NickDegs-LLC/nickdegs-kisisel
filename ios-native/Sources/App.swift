import SwiftUI

@main
struct MoveLogApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = Store()
    @StateObject private var iap = IAP()
    @StateObject private var cloud = CloudSync()
    @StateObject private var tracker = Tracker.shared
    @AppStorage("nd_font") var fontId = "default"
    @AppStorage("nd_scheme") var scheme = "dark"
    @AppStorage("bekleyenDavet") private var bekleyenDavet = ""
    var design: Font.Design {
        switch fontId { case "serif": return .serif; case "rounded": return .rounded; case "mono": return .monospaced; default: return .default }
    }
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                // AÇILIŞ KAPISI: yalnızca sunucu-doğrulanmış kimlikle aç (internetsiz/kopya token çalışmaz).
                switch store.gate {
                case .valid: RootView()
                case .needLogin: LoginView()
                case .checking: AuthGateView(checking: true) {}
                case .offline: AuthGateView(checking: false) { Task { await store.validate() } }
                }
            }
            // 17.09 KILIT FIKSI: .checking ekrani ("Kimlik dogrulaniyor...") sonsuza kadar
            // kalabiliyordu - validate() donmezse cikis yolu YOKTU (Yeniden dene yalniz .offline'da).
            // Bekci: 20 sn sonra hala .checking ise .offline'a gecir, kullanici retry gorsun.
            .task(id: store.gate) {
                guard store.gate == .checking else { return }
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if store.gate == .checking { store.gate = .offline }
            }
            .task {
                if store.gate == .checking { await store.validate() }
                // 18.09: ConvoyVoice / PttEngine kaldırıldı (sesli iletişim çıktı).
                if store.gate == .valid { await bekleyenDavetiKabulEt() }
            }
            // 17.09 ASIL FIKS (olculdu): uygulama .checking'de askida kalinca ON PLANA DONUS
            // hicbir seyi tetiklemiyordu - scenePhase yalniz RootView'da dinleniyor, yani ancak
            // gate .valid iken. Arka plandaki Tracker calismaya devam ettigi icin "internet var
            // ama uygulama acilmiyor" goruntusu olusuyordu; kullanici uygulamayi komple kapatip
            // acmadan kurtulamiyordu. Artik her one gelisde gate .valid degilse yeniden dogrulanir.
            .onChange(of: scenePhase) { _, ph in
                if ph == .active && store.gate != .valid { Task { await store.validate() } }
            }
            .environmentObject(store)
            .environmentObject(iap)
            .environmentObject(cloud)
            .environmentObject(tracker)
            .tint(Brand.accent)
            .fontDesign(design)
            .preferredColorScheme(scheme == "light" ? .light : .dark)
            .onOpenURL { url in davetURLIsle(url) }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { davetURLIsle(url) }
            }
            .onChange(of: store.gate) { _, g in
                if g == .valid { Task { await bekleyenDavetiKabulEt() } }
            }
            .alert(store.davetSonuc, isPresented: Binding(
                get: { !store.davetSonuc.isEmpty },
                set: { if !$0 { store.davetSonuc = "" } }
            )) {
                Button("OK", role: .cancel) { store.davetSonuc = "" }
            }
        }
    }

    /// Pano okunmaz (gizlilik uyarısı çıkmasın). Yalnız URL'den kod.
    private func davetURLIsle(_ url: URL) {
        guard let kod = DavetLink.from(url: url) else { return }
        Task { await davetKoduIsle(kod) }
    }

    private func davetKoduIsle(_ kod: String) async {
        if store.gate == .valid {
            await davetKabulGoster(kod)
            bekleyenDavet = ""
        } else {
            bekleyenDavet = kod
        }
    }

    private func bekleyenDavetiKabulEt() async {
        let kod = bekleyenDavet.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !kod.isEmpty, store.gate == .valid else { return }
        bekleyenDavet = ""
        await davetKabulGoster(kod)
    }

    private func davetKabulGoster(_ kod: String) async {
        let ok = await store.acceptInvite(kod)
        store.davetSonuc = ok
            ? L("Arkadaş eklendi 🤝", "Friend added 🤝")
            : L("Kod geçersiz veya süresi dolmuş.", "Invalid or expired code.")
        if ok { store.davetYenile += 1 }
    }
}

// Açılış kapısı ekranı: checking=doğrulanıyor; değilse İNTERNET GEREKLİ (uygulama çevrimdışı açılmaz).
struct AuthGateView: View {
    let checking: Bool
    let onRetry: () -> Void
    var body: some View {
        ZStack {
            Color(red: 0.02, green: 0.027, blue: 0.047).ignoresSafeArea()
            VStack(spacing: 16) {
                Text("Move Log").font(.system(size: 30, weight: .bold)).foregroundStyle(Brand.accent)
                if checking {
                    ProgressView().tint(Brand.accent)
                    Text("Kimlik doğrulanıyor…").foregroundStyle(.secondary)
                } else {
                    Image(systemName: "wifi.slash").font(.system(size: 40)).foregroundStyle(.secondary)
                    Text("İnternet gerekli").font(.headline).foregroundStyle(.white)
                    Text("Bu uygulama çevrimdışı çalışmaz. Kimliğini doğrulamak için internet bağlantısı gerekir.")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 32)
                    Button("Yeniden dene", action: onRetry).buttonStyle(.borderedProminent).tint(Brand.accent)
                }
            }
        }
    }
}

struct RootView: View {
    // QA (yalnız Debug/simülatör): -qaVideoSheet <from> <to> -> "Video oluştur" ekranını
    // doğrudan açar; ücretsiz katmanda video paketi satın alma paneli görünür.
    // App Store inceleme görselleri bu yolla çekilir. Release'e ETKİSİ YOK (#if DEBUG).
    @State private var qaVideoSheet: (Double, Double)? = nil
    @EnvironmentObject var iap: IAP
    @EnvironmentObject var store: Store
    @EnvironmentObject var tracker: Tracker
    @Environment(\.scenePhase) private var scenePhase
    @State private var sel = RootView.initialTab()
    @State private var ann: Announcement?
    @AppStorage("nd_ann_seen") private var annSeen = 0
    static func initialTab() -> Int {
        // 18.09: Telsiz sekmesi kalktı (5 -> 4). "chat"/"gps"/"map" artık Rotalar'a düşer.
        switch AppEnv.screen { case "videos": return 1; case "stats": return 2; case "profile","paywall","avatar": return 3; default: return 0 }
    }
    var body: some View {
        TabView(selection: $sel) {
            RoutesView().tabItem { Label(L("Rotalar","Routes"), systemImage: "map") }.tag(0)
            // not: aşağıda .onChange ile "Video oluştur" sonrası otomatik Videolarım'a geçilir
            VideosView().tabItem { Label(L("Videolarım","My Videos"), systemImage: "film.stack") }.tag(1)
            SummariesView().tabItem { Label(L("Özet","Summary"), systemImage: "doc.text.magnifyingglass") }.tag(2)
            // 18.09: Telsiz sekmesi kaldırıldı (sesli/yazılı sohbet çıktı) -> 4 sekme.
            ProfileView().tabItem { Label(L("Profil","Profile"), systemImage: "person.crop.circle") }.tag(3)
        }
        .onChange(of: store.jumpToVideos) { _, v in
            if v { sel = 1; store.jumpToVideos = false }   // "Video oluştur" -> Videolarım'a geç ("Hazırlanıyor" görünür)
        }
        // BİLDİRİM DOKUNMA -> ilgili ekran (route: "voice:<user>:<pid>:<isim>", "videos", "friends", "map"...)
        .onReceive(NotificationCenter.default.publisher(for: .ndDeepLink)) { note in
            guard let route = note.object as? String else { return }
            let p = route.split(separator: ":", maxSplits: 3).map(String.init)
            // 18.09: telsiz/sohbet/interkom bildirimleri kalktı. Arkadaşlık bildirimleri
            // Profil'e (artık tag 3) gider; bilinmeyen rota sessizce yok sayılır.
            switch p.first {
            case "videos": sel = 1
            case "friends", "profile", "wave": sel = 3
            default: break
            }
        }
        // iOS 26'da TabView otomatik Liquid Glass tab bar kullanır.
        .safeAreaInset(edge: .top) {
            if let a = ann, a.ts > annSeen {
                AnnouncementBanner(a: a) { annSeen = a.ts; withAnimation { ann = nil } }
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .sheet(isPresented: Binding(get: { qaVideoSheet != nil },
                                    set: { if !$0 { qaVideoSheet = nil } })) {
            if let q = qaVideoSheet {
                GenerateSheet(from: q.0, to: q.1, type: "moto")
                    .environmentObject(store).environmentObject(iap)
            }
        }
        .task {
            if store.me.isEmpty { let p = await store.profile(); store.me = p?.username ?? "" }
            await store.syncPremium()                 // premium'u açılışta cihaza yansıt (kilitler kalksın)
            await store.registerPush()
            await store.refreshTokenIfNeeded()         // 05.09: 30 günde bir zorla çıkışı önler
            await store.beacon()                       // canlı-takip: son batarya/konum (arkadaşlar görsün)
            // Oto-takip açıksa her açılışta GPS göndermeyi yeniden başlat (relaunch'ta sessizce
            // durmasın diye). start() idempotent: zaten çalışıyorsa zarar vermez.
            if tracker.active, let t = await store.trackerInfo() { tracker.start(deviceId: t.id, url: t.url) }
            if let a = await store.announcement(), a.ts > annSeen { withAnimation { ann = a } }
            await store.autoSaveNewVideos()            // açılışta: yeni videoları sessizce galeriye kaydet (R2'de 1 gün durur)
            await store.processLocalRenderQueue()      // 1.61: bekleyen oto-videoları TELEFONDA üret (bulut maliyeti sıfır)
            #if DEBUG
            // QA (yalnız Debug/simülatör): -qaMotor3d <from> <to> -> web motoru 36 kareyle dener, Documents'a yazar
            let _qa = ProcessInfo.processInfo.arguments
            if let vx = _qa.firstIndex(of: "-qaVideoSheet"), vx + 2 < _qa.count,
               let vf = Double(_qa[vx + 1]), let vt = Double(_qa[vx + 2]) {
                try? await Task.sleep(for: .seconds(1.2))
                qaVideoSheet = (vf, vt)
            }
            if let ix = _qa.firstIndex(of: "-qaMotor3d"), ix + 2 < _qa.count,
               let qf = Double(_qa[ix + 1]), let qt = Double(_qa[ix + 2]) {
                let u = await WebRouteVideo.render(from: qf, to: qt, type: "moto", speed: "medium",
                                                   aspect: "16:9", camdist: "orta",
                                                   line: "#00E5FF", dot: "#FF3B30",
                                                   token: store.token, musicURL: nil, qaKareTavan: 36,
                                                   onProgress: { _ in })
                let doc = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                if let u { try? FileManager.default.moveItem(at: u, to: doc.appendingPathComponent("qa_motor3d.mp4")) }
                try? "SONUC: \(u != nil ? "OK" : "HATA")".write(to: doc.appendingPathComponent("qa_motor3d.txt"), atomically: true, encoding: .utf8)
            }
            #endif
        }
        .onChange(of: scenePhase) { _, ph in
            if ph == .active { Task { await store.autoSaveNewVideos(); await store.processLocalRenderQueue() } }   // her öne gelişte: 1 günlük pencereye yetiş
        }
        .onReceive(NotificationCenter.default.publisher(for: .ndApns)) { _ in
            Task { await store.registerPush() }
        }
    }
}

// Admin panelinden gelen uygulama içi duyuru banner'ı
struct AnnouncementBanner: View {
    let a: Announcement
    var onClose: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "megaphone.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
            VStack(alignment: .leading, spacing: 2) {
                Text(a.title).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                if !a.body.isEmpty {
                    Text(a.body).font(.caption).foregroundStyle(.white.opacity(0.92)).fixedSize(horizontal: false, vertical: true)
                }
                if !a.url.isEmpty, let u = URL(string: a.url) {
                    Link(L("Detay","Details"), destination: u).font(.caption.bold()).tint(.white).padding(.top, 2)
                }
            }
            Spacer(minLength: 4)
            Button(action: onClose) { Image(systemName: "xmark").font(.caption.bold()).foregroundStyle(.white.opacity(0.85)) }
        }
        .padding(14)
        .background(Brand.gradient, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white.opacity(0.2)))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
        .padding(.horizontal, 12).padding(.top, 6)
    }
}

// Yeniden kullanılabilir avatar (emoji / foto / baş harf)
struct AvatarView: View {
    var name: String
    var avatar: Avatar?
    var size: CGFloat = 46
    @EnvironmentObject var store: Store
    var body: some View {
        let a = avatar ?? Avatar()
        Group {
            if a.type == "emoji", let v = a.value, !v.isEmpty {
                Text(v).font(.system(size: size * 0.6))
                    .frame(width: size, height: size).background(.ultraThinMaterial, in: Circle())
            } else if a.type == "photo", let v = a.value, let url = URL(string: v.hasPrefix("http") ? v : API + v) {
                AsyncImage(url: url) { img in img.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.3) }
                    .frame(width: size, height: size).clipShape(Circle())
            } else {
                Text(initials(name)).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: size, height: size).background(avatarColor(name), in: Circle())
            }
        }
        .overlay(Circle().strokeBorder(.white.opacity(0.25), lineWidth: 1))
    }
}

// Cam başlık şeridi (ekran üstü)
struct ScreenTitle: View {
    var text: String
    var body: some View {
        Text(text).font(.system(size: 32, weight: .bold)).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 6)
    }
}
