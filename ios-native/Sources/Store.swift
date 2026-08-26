import SwiftUI
import UIKit
import CoreLocation
import DeviceCheck
import CryptoKit
import Photos
import UserNotifications

let API = "https://kisisel-api.nickdegs.com"

// MARK: - Modeller
struct Avatar: Codable, Hashable { var type: String = "initials"; var value: String? = nil }
struct Ride: Codable, Identifiable, Hashable {
    var id: String; var date: String; var type: String?; var mode: String?; var size: Double
    var ts: Double? = nil; var to: Double? = nil; var aspect: String? = nil; var speed: String? = nil
    var done: Double? = nil          // video ÜRETIM zamanı (epoch) — Videolarım'da gösterilir + sıralama
    var added: Double? = nil         // eklenme/üretim zamanı — Rotalar "Son eklenen" sıralaması (GPX yüklemeler eski tarihli olsa da üstte)
    var rendering: Bool? = nil       // hâlâ render oluyor mu — true ise app oynatmayı kilitler ("Hazırlanıyor")
    var novideo: Bool? = nil         // algılandı ama videosu yok -> Rotalar'da "Video oluştur" gösterilir
    var failed: Bool? = nil          // render başarısız — Videolarım'da HATA kartı olarak kalır (kaybolmaz)
    var error: String? = nil         // başarısızlık sebebi (kartta gösterilir)
}
struct Stats: Codable { var totalRides: Int; var byType: [String:Int]; var latest: Ride? }
struct Position: Codable, Identifiable, Hashable {
    var device: String; var lat: Double; var lon: Double; var speedKmh: Double; var online: Bool
    var avatar: Avatar? = nil           // harita pini profil fotoğrafını göstersin
    var id: String { device }
}
struct Profile: Codable { var username: String?; var name: String; var handle: String? = nil; var avatar: Avatar; var premium: Bool = false; var ultra: Bool = false }
struct Announcement: Identifiable { var title: String; var body: String; var url: String; var ts: Int; var id: Int { ts } }
struct ActivitySummary: Codable, Identifiable, Hashable { var date: String; var summary: String; var videoId: String? = nil; var from: Double? = nil; var to: Double? = nil; var id: String { date } }
struct SummaryVid: Equatable { var mode = "flyover"; var speed = "medium"; var aspect = "16:9"; var cam = "orta"; var music = ""; var line = "#00E5FF" }
struct SummaryCfg { var enabled = true; var hour = 21; var video = SummaryVid() }
struct Friend: Codable, Identifiable, Hashable {
    var username: String; var name: String?; var handle: String? = nil; var avatar: Avatar?; var online: Bool?
    var id: String { username }
}
// MOTORCU GRUBU / KULÜP (1.8): davet koduyla katıl, arkadaşlık şartsız otomatik grup videosu
struct Club: Codable, Identifiable, Hashable {
    var id: String; var name: String; var owner: String; var memberCount: Int; var created: Int
    var code: String? = nil; var members: [Friend]? = nil
}
// 1.8: canlı takip telemetrisi
struct LiveTelemetry: Codable {
    var lat: Double; var lon: Double; var spd: Double; var hr: Int?
    var alt: Int; var age: Int; var todayKm: Double; var name: String
    var batt: Int? = nil; var charging: Bool? = nil; var course: Int? = nil; var acc: Int? = nil
    var trail: [[Double]]? = nil; var rideMin: Int? = nil
    var avgKmh: Double? = nil; var maxKmh: Double? = nil
    var temp: Double? = nil; var wcode: Int? = nil
}
struct ClubRider: Codable, Identifiable {
    var user: String; var name: String; var lat: Double; var lon: Double
    var spd: Double; var age: Int; var course: Int
    var id: String { user }
}
// 1.8: paylaşılan rota (gelen kutusu)
struct SharedRoute: Codable, Identifiable, Hashable {
    var id: String; var fromName: String; var from: String
    var km: Double?; var date: String?; var ts: Int; var rideId: String; var ridden: Bool
}
// 1.8: yıl özeti
struct WrappedStats: Codable {
    var year: Int; var km: Double; var rides: Int; var hours: Double
    var longestKm: Double; var nightRides: Int; var badges: [String]
}
// Kullanıcı arama sonucu (@handle ile bul + istek durumu)
struct FoundUser: Codable, Identifiable, Hashable {
    var username: String; var name: String; var handle: String; var avatar: Avatar?
    var status: String   // none | outgoing | incoming | friend
    var id: String { username }
}
struct Message: Codable, Identifiable, Hashable {
    var id: String?; var frm: String; var text: String?; var ts: Double; var type: String?; var media: String?
    var mid: String { id ?? "\(frm)\(ts)" }
}
struct Convo: Codable, Identifiable, Hashable {
    var username: String; var name: String?; var avatar: Avatar?; var online: Bool?
    var unread: Int?; var last: Message?
    var id: String { username }
}

// Açılış kapısı: uygulama yalnızca SUNUCU-DOĞRULANMIŞ kimlikle açılır (internetsiz/kopya token çalışmaz).
enum AuthGate { case checking, valid, needLogin, offline }

// MARK: - API + Durum
@MainActor final class Store: ObservableObject {
    static weak var shared: Store?   // arka plan (BGTask/push) oto-kayıt için AppDelegate erişimi (2026-07-27)
    @Published var token: String = UserDefaults.standard.string(forKey: "nd_token") ?? ""
    @Published var me: String = ""
    @Published var loginError = false
    @Published var jumpToVideos = false   // "Video oluştur" sonrası Videolarım sekmesine geç ("Hazırlanıyor" görünür)
    @Published var gate: AuthGate = .checking   // açılış doğrulama durumu
    var loggedIn: Bool { !token.isEmpty || (AppEnv.demo && AppEnv.screen != "hero") }
    init() {
        if AppEnv.demo && AppEnv.screen != "hero" { me = "me"; gate = .valid }
        else if token.isEmpty { gate = .needLogin }   // token yoksa giriş; varsa CHECKING (sunucuda doğrula)
    }

    // Token'ı SUNUCUYA doğrulat. 200=geçerli, 401/403=geçersiz->giriş, ağ hatası=OFFLINE (uygulama açılmaz).
    func validate() async {
        if AppEnv.demo && AppEnv.screen != "hero" { gate = .valid; return }
        if token.isEmpty { gate = .needLogin; return }
        gate = .checking
        var r = URLRequest(url: URL(string: API + "/api/profile")!)
        r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        r.timeoutInterval = 15
        do {
            let (data, resp) = try await URLSession.shared.data(for: r)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200 {
                if let o = try? JSONSerialization.jsonObject(with: data) as? [String:Any] {
                    me = (o["username"] as? String) ?? me
                }
                gate = .valid
                PhoneWatchLink.shared.push()        // saate güncel kimliği ilet
                Task { await attestIfPossible() }   // App Attest (fire-and-forget; fail-open, kilitlemez)
            } else if code == 401 || code == 403 {
                logout(); gate = .needLogin            // geçersiz/iptal/kopya token
            } else {
                gate = .offline                        // sunucu/internet sorunu -> kullanılamaz
            }
        } catch {
            gate = .offline                            // internet yok -> uygulama açılmaz
        }
    }

    // Apple App Attest — uygulamanın gerçek (kurcalanmamış, App Store) olduğunu Apple'a doğrulatır.
    // FAIL-OPEN: desteklenmiyor/entitlement yok/hata -> sessizce geçer, kullanıcıyı ASLA kilitlemez.
    func attestIfPossible() async {
        guard DCAppAttestService.shared.isSupported else { return }
        guard let cd = try? await req("/api/attest/challenge"),
              let o = try? JSONSerialization.jsonObject(with: cd) as? [String:Any],
              let challenge = o["challenge"] as? String else { return }
        let svc = DCAppAttestService.shared
        do {
            let keyId = try await svc.generateKey()
            let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
            let attestation = try await svc.attestKey(keyId, clientDataHash: clientDataHash)
            _ = try? await req("/api/attest", method: "POST",
                               body: ["attestation": attestation.base64EncodedString(), "keyId": keyId])
        } catch {
            // App Attest desteklenmiyor / entitlement yok / hata -> sessizce geç (zarar yok)
        }
    }

    private func dec() -> JSONDecoder { let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; return d }

    private func req(_ path: String, method: String = "GET", body: [String:Any]? = nil) async throws -> Data {
        var r = URLRequest(url: URL(string: API + path)!)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Sunucunun push/metin dilini kullanıcının cihaz diline sabitle (örtük URLSession header'ına güvenme).
        r.setValue(currentLang(), forHTTPHeaderField: "Accept-Language")
        if !token.isEmpty { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, h.statusCode == 401 { await MainActor.run { self.logout() } }
        return data
    }

    func login(_ user: String, _ pass: String) async {
        loginError = false
        do {
            var r = URLRequest(url: URL(string: API + "/auth/login")!)
            r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["user": user, "password": pass])
            let (data, _) = try await URLSession.shared.data(for: r)
            if let o = try JSONSerialization.jsonObject(with: data) as? [String:Any], let t = o["token"] as? String {
                token = t; me = user
                UserDefaults.standard.set(t, forKey: "nd_token"); gate = .valid
                PhoneWatchLink.shared.push()
            } else { loginError = true }
        } catch { loginError = true }
    }
    // SMS-OTP: kod gönder
    func smsStart(_ phone: String) async -> Bool {
        loginError = false
        do {
            var r = URLRequest(url: URL(string: API + "/auth/sms/start")!)
            r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["phone": phone])
            let (_, resp) = try await URLSession.shared.data(for: r)
            if let h = resp as? HTTPURLResponse, h.statusCode < 300 { return true }
        } catch {}
        loginError = true; return false
    }
    // SMS-OTP: kodu doğrula ve gir
    func smsVerify(_ phone: String, _ code: String) async {
        loginError = false
        do {
            var r = URLRequest(url: URL(string: API + "/auth/sms/verify")!)
            r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["phone": phone, "code": code])
            let (data, resp) = try await URLSession.shared.data(for: r)
            if let h = resp as? HTTPURLResponse, h.statusCode < 300,
               let o = try JSONSerialization.jsonObject(with: data) as? [String:Any], let t = o["token"] as? String {
                token = t; me = (o["user"] as? String) ?? ""
                UserDefaults.standard.set(t, forKey: "nd_token"); gate = .valid
                PhoneWatchLink.shared.push()
            } else { loginError = true }
        } catch { loginError = true }
    }

    // APPLE İLE GİRİŞ (2026-08-08, Barış: "Google+Apple ekle, SMS kalksın"): backend /auth/apple
    // taşımadan beri hazırdı (JWKS imza doğrulamalı, aud=com.nickdegs.kisisel) — yalnız istemci eksikti.
    // smsVerify ile AYNI oturum deseni: token sakla + gate aç + saat linkine it.
    func appleLogin(identityToken: String, name: String) async {
        loginError = false
        do {
            var r = URLRequest(url: URL(string: API + "/auth/apple")!)
            r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["identity_token": identityToken, "name": name])
            let (data, resp) = try await URLSession.shared.data(for: r)
            if let h = resp as? HTTPURLResponse, h.statusCode < 300,
               let o = try JSONSerialization.jsonObject(with: data) as? [String:Any], let t = o["token"] as? String {
                token = t; me = (o["user"] as? String) ?? ""
                UserDefaults.standard.set(t, forKey: "nd_token"); gate = .valid
                PhoneWatchLink.shared.push()
            } else { loginError = true }
        } catch { loginError = true }
    }

    // GOOGLE İLE GİRİŞ: backend /auth/google hazır. iOS Google OAuth client'ı henüz YOK
    // (film-ozet Firebase'ine iOS app eklenince aktifleşir) -> buton Login'de o zamana kadar gizli.
    func googleLogin(idToken: String) async {
        loginError = false
        do {
            var r = URLRequest(url: URL(string: API + "/auth/google")!)
            r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["id_token": idToken])
            let (data, resp) = try await URLSession.shared.data(for: r)
            if let h = resp as? HTTPURLResponse, h.statusCode < 300,
               let o = try JSONSerialization.jsonObject(with: data) as? [String:Any], let t = o["token"] as? String {
                token = t; me = (o["user"] as? String) ?? ""
                UserDefaults.standard.set(t, forKey: "nd_token"); gate = .valid
                PhoneWatchLink.shared.push()
            } else { loginError = true }
        } catch { loginError = true }
    }

    func logout() { token = ""; UserDefaults.standard.removeObject(forKey: "nd_token"); gate = .needLogin }

    func deleteAccount() async {
        _ = try? await req("/api/account", method: "DELETE")
        UserDefaults.standard.removeObject(forKey: "nd_premium")
        logout()
    }

    func rides() async -> [Ride] {
        if AppEnv.demo { return DemoData.rides }
        return (try? dec().decode([String:[Ride]].self, from: await req("/api/rides"))["rides"]) ?? []
    }
    func stats() async -> Stats? {
        if AppEnv.demo { return DemoData.stats }
        return try? dec().decode(Stats.self, from: await req("/api/stats")) }

    // OTOMATİK GALERİ KAYDI (Barış 2026-07-26): video biter bitmez sessizce telefonun galerisine iner.
    // Sunucu/depolama şişmesin diye R2'de video yalnızca 1 gün durur -> KALICI kopya kullanıcının galerisinde.
    // İlk kurulumda mevcut videolar "kaydedilmiş" işaretlenir (eski onlarca videoyu galeriye BOŞALTMAYIZ);
    // sonrasında yalnızca YENİ üretilen videolar otomatik iner. Uygulama her öne geldiğinde çalışır (1 günlük pencereye yetişir).
    func autoSaveNewVideos() async {
        // OTO-KAYIT İPTAL (Barış 2026-07-27): uygulama açıkken sürekli tetikleniyordu + arka planda güvenilmez.
        // Kullanıcı MANUEL kaydeder (Videolarım'daki "kaydet" butonu). Re-enable: nd_autosave_enabled=true.
        guard UserDefaults.standard.bool(forKey: "nd_autosave_enabled") else { return }
        if AppEnv.demo { return }
        let d = UserDefaults.standard
        var saved = Set(d.stringArray(forKey: "nd_autosaved_ids") ?? [])
        let done = (await rides()).filter { $0.rendering != true && $0.failed != true }
        // İLK KURULUM (v2, 2026-07-27): eski kütüphaneyi baseline'la AMA son 2 günde ÜRETİLEN videoları KAYDET.
        // v2 anahtarı -> yeni build'de YENİDEN çalışır (v1 baseline'ının yanlışlıkla yuttuğu son videolar kurtulur).
        // Böylece "güncelledim ama son videolarım inmedi" bitiyor; eski onlarca video yine boşaltılmıyor.
        if !d.bool(forKey: "nd_autosave_init_v2") {
            let _cut = Date().timeIntervalSince1970 - 2 * 86400   // son 2 gün "yeni" sayılır -> otomatik iner
            saved.formUnion(done.filter { ($0.done ?? 0) < _cut }.map { $0.id })
            d.set(Array(saved), forKey: "nd_autosaved_ids")
            d.set(true, forKey: "nd_autosave_init_v2")
            // return YOK -> son 2 günün videoları aşağıda kaydedilir
        }
        let todo = done.filter { !saved.contains($0.id) }
        guard !todo.isEmpty else { return }
        let status = await withCheckedContinuation { (c: CheckedContinuation<PHAuthorizationStatus, Never>) in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { c.resume(returning: $0) }
        }
        guard status == .authorized || status == .limited else {
            // İzin yok -> İŞARETLEME (kalıcı kaybetme); izin sonradan açılınca otomatik yetişir. Manuel kaydet yedek.
            return
        }
        var _savedN = 0
        for r in todo {
            var req = URLRequest(url: videoURL(r.id))
            for (k, v) in authHeader { req.setValue(v, forHTTPHeaderField: k) }
            guard let (data, _) = try? await URLSession.shared.data(for: req), !data.isEmpty else { continue }  // inemezse: işaretlenmez, sonraki öne gelişte tekrar denenir (R2'de 1 gün var)
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(r.id).mp4")
            guard (try? data.write(to: tmp)) != nil else { continue }
            let _ok = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
                PHPhotoLibrary.shared().performChanges({
                    PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: tmp)
                }) { success, _ in
                    try? FileManager.default.removeItem(at: tmp)
                    c.resume(returning: success)
                }
            }
            if _ok {                                    // yalnız GERÇEKTEN kaydolunca işaretle (başarısızsa sonra tekrar dener)
                saved.insert(r.id); d.set(Array(saved), forKey: "nd_autosaved_ids"); _savedN += 1
            }
        }
        if _savedN > 0 { notifyGallerySaved(_savedN) }   // bildirim çıksın (Barış: "kaydedince bildirim çıksın")
    }
    // Galeriye otomatik kayıt bildirimi (Barış 2026-07-27): video sessizce inince kullanıcıya "kaydedildi" bildirimi.
    func notifyGallerySaved(_ n: Int) {
        let c = UNMutableNotificationContent()
        c.title = "Move Log"
        c.body = n == 1 ? L("Videon galerine kaydedildi 🎬", "Your video was saved to your gallery 🎬")
                        : L("\(n) video galerine kaydedildi 🎬", "\(n) videos saved to your gallery 🎬")
        c.sound = .default
        let req = UNNotificationRequest(identifier: "nd_gallery_saved", content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
    func positions() async -> [Position] {
        if AppEnv.demo { return DemoData.positions }
        return (try? dec().decode([String:[Position]].self, from: await req("/api/gps/live"))["positions"]) ?? []
    }
    func profile() async -> Profile? {
        if AppEnv.demo { return Profile(username: "me", name: Demo.user, avatar: Avatar()) }
        return try? dec().decode(Profile.self, from: await req("/api/profile")) }
    // Sunucu-taraflı premium'u cihaza senkronla (yalnızca Profil değil her yerden tetiklenir).
    func syncPremium() async {
        guard let d = try? await req("/api/profile") else { return }
        // GÜVENLİ: free_tactical'ı HAM JSON'dan oku — Profile struct'ına DOKUNMA (profil decode'u asla bozulmaz)
        if let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] {
            UserDefaults.standard.set((o["free_tactical"] as? Bool) ?? false, forKey: "nd_free_tactical")
        }
        guard let p = try? dec().decode(Profile.self, from: d), p.premium else { return }
        UserDefaults.standard.set(true, forKey: "nd_gift")     // hediye/sunucu premium kalıcı
        UserDefaults.standard.set(true, forKey: "nd_premium")
        if p.ultra {   // sunucu/admin Ultra (StoreKit satın alma olmadan) -> kamera modları/Street View açılır
            UserDefaults.standard.set(true, forKey: "nd_gift_ultra")
            UserDefaults.standard.set(true, forKey: "nd_ultra")
        }
    }
    func friends() async -> [Friend] {
        if AppEnv.demo { return DemoData.friends }
        return (try? dec().decode([String:[Friend]].self, from: await req("/api/friends"))["friends"]) ?? []
    }
    func setAvatar(_ a: Avatar) async {
        let body: [String:Any] = ["avatar": ["type": a.type, "value": a.value ?? ""]]
        _ = try? await req("/api/profile", method: "PUT", body: body)
    }
    func addFriend(_ u: String) async -> Bool {
        guard let d = try? await req("/api/friends", method: "POST", body: ["username": u]) else { return false }
        return (try? JSONSerialization.jsonObject(with: d)) != nil
    }
    func invite() async -> String {
        guard let d = try? await req("/api/invite", method: "POST"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return "" }
        return (o["link"] as? String) ?? ""
    }
    // Durum kodlu istek (handle çakışması gibi hataları ayırt etmek için)
    private func reqCode(_ path: String, method: String = "GET", body: [String:Any]? = nil) async -> (Int, Data) {
        var r = URLRequest(url: URL(string: API + path)!)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { r.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        guard let (data, resp) = try? await URLSession.shared.data(for: r) else { return (0, Data()) }
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }
    // Benzersiz @kullanıcıadı ayarla. nil=başarılı; değilse hata türü: "taken" | "invalid" | "network"
    func setHandle(_ h: String) async -> String? {
        let (code, _) = await reqCode("/api/handle", method: "PUT", body: ["handle": h])
        switch code {
        case 200: return nil
        case 409: return "taken"
        case 400: return "invalid"
        default:  return "network"
        }
    }
    // @kullanıcıadı / isimle kullanıcı ara
    func findUsers(_ q: String) async -> [FoundUser] {
        let esc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        guard let d = try? await req("/api/users/find?q=" + esc) else { return [] }
        return (try? dec().decode([String:[FoundUser]].self, from: d)["users"]) ?? []
    }
    // Arkadaşlık isteği gönder -> "requested" | "friends" | nil(hata)
    func friendRequest(_ u: String) async -> String? {
        let (code, d) = await reqCode("/api/friends/request", method: "POST", body: ["username": u])
        guard code == 200, let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return nil }
        return o["status"] as? String
    }
    // Gelen + giden bekleyen istekler
    func friendRequests() async -> (incoming: [Friend], outgoing: [Friend]) {
        guard let d = try? await req("/api/friends/requests"),
              let o = try? dec().decode([String:[Friend]].self, from: d) else { return ([], []) }
        return (o["incoming"] ?? [], o["outgoing"] ?? [])
    }
    // Fikir kutusu: kullanıcı fikri doğrudan geliştiriciye gider
    @discardableResult
    func sendFeedback(_ text: String) async -> Bool {
        let (code, _) = await reqCode("/api/feedback", method: "POST", body: ["text": text])
        return code == 200
    }
    // Gelen isteği onayla/reddet
    @discardableResult
    func respondFriend(_ u: String, accept: Bool) async -> Bool {
        let (code, _) = await reqCode("/api/friends/respond", method: "POST", body: ["username": u, "accept": accept])
        return code == 200
    }
    func chatList() async -> [Convo] {
        if AppEnv.demo { return DemoData.convos }
        return (try? dec().decode([String:[Convo]].self, from: await req("/api/chat/list"))["conversations"]) ?? []
    }
    func chatWith(_ other: String) async -> [Message] {
        if AppEnv.demo { return DemoData.thread }
        struct R: Codable { var messages: [Message] }
        return (try? dec().decode(R.self, from: await req("/api/chat/with/" + other)).messages) ?? []
    }
    func send(_ to: String, _ text: String) async {
        _ = try? await req("/api/chat/send", method: "POST", body: ["to": to, "text": text])
    }
    func uploadPhoto(_ jpeg: Data) async -> String? {
        let dataURL = "data:image/jpeg;base64," + jpeg.base64EncodedString()
        guard let d = try? await req("/api/profile/photo", method: "POST", body: ["data": dataURL]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return nil }
        return o["url"] as? String
    }
    func trackerInfo() async -> (id: String, url: String)? {
        guard let d = try? await req("/api/tracker"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let id = o["deviceId"] as? String, let url = o["url"] as? String else { return nil }
        return (id, url)
    }
    func setRideType(_ rideId: String, _ type: String) async -> Bool {
        guard let d = try? await req("/api/rides/\(rideId)/type", method: "POST", body: ["type": type]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    func setName(_ name: String) async {
        _ = try? await req("/api/profile", method: "PUT", body: ["name": name])
    }
    func registerPush() async {
        guard !token.isEmpty, let t = UserDefaults.standard.string(forKey: "nd_apns") else { return }
        _ = try? await req("/api/pushtoken", method: "POST", body: ["token": t])
    }
    func musicList() async -> [[String:String]] {
        guard let d = try? await req("/api/music"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let s = o["stock"] as? [[String:Any]] else { return [] }
        return s.map { item in item.mapValues { "\($0)" } }
    }
    // 1.61 CİHAZDA ÜRETİM: seçili müziği (active/lib:/stock:/upload) yerel dosyaya indir -> render miksler.
    func musicFile(_ ref: String, session: Double = 0) async -> URL? {
        guard !ref.isEmpty, ref != "none" else { return nil }
        var q = "/api/music/file?ref=" + (ref.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ref)
        if session > 0 { q += "&session=\(Int(session))" }
        guard let d = try? await req(q), d.count > 2000 else { return nil }
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("music_\(Int(Date().timeIntervalSince1970)).m4a")
        try? d.write(to: u)
        return u
    }
    // 1.61 OTO-VİDEO CİHAZDA: sunucunun "telefon üretsin" kuyruğu (bulut GPU maliyeti SIFIR).
    func localRenders() async -> [[String:Any]] {
        guard let d = try? await req("/api/local-renders"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let p = o["pending"] as? [[String:Any]] else { return [] }
        return p
    }
    func localRenderDone(from: Double) async {
        _ = try? await req("/api/local-renders/done", method: "POST", body: ["from": from])
    }
    // Uygulama öne gelince bekleyen oto-videoları TELEFONDA üret + yükle (sessiz; push atmayız — darlama yok).
    // Battarya nezaketi: açılış başına en çok 2 video.
    private static var localQueueBusy = false
    func processLocalRenderQueue() async {
        guard !Self.localQueueBusy else { return }
        Self.localQueueBusy = true
        defer { Self.localQueueBusy = false }
        guard let prof = await profile(), prof.premium else { return }   // oto-video Premium özelliği
        let jobs = await localRenders()
        for j in jobs.prefix(2) {
            guard let frm = j["from"] as? Double ?? (j["from"] as? Int).map(Double.init),
                  let to = j["to"] as? Double ?? (j["to"] as? Int).map(Double.init) else { continue }
            let mode = (j["mode"] as? String) ?? "flyover"
            guard ["flat", "flyover", "3d"].contains(mode) else { continue }
            let pts = await track(from: frm, to: to)
            guard pts.count >= 3 else { await localRenderDone(from: frm); continue }
            var o = LocalRouteVideo.Opts()
            o.mode = mode
            o.aspect = (j["aspect"] as? String) ?? "16:9"
            o.line = (j["line"] as? String) ?? o.line
            o.dot = (j["dot"] as? String) ?? o.dot
            o.musicURL = await musicFile((j["music"] as? String) ?? "active", session: frm)
            if let v = await LocalRouteVideo.render(points: pts, opts: o, onProgress: { _ in }),
               await uploadLocalVideo(v, ts: frm, to: to,
                                      mode: mode, aspect: o.aspect,
                                      type: (j["type"] as? String) ?? "moto",
                                      speed: (j["speed"] as? String) ?? "medium") {
                await localRenderDone(from: frm)
            }
        }
    }
    func addRideMusic(session: Double, data: Data) async -> Bool {
        let dataURL = "data:audio/m4a;base64," + data.base64EncodedString()
        let r = try? await req("/api/rides/music", method: "POST", body: ["session": session, "data": dataURL])
        return r != nil
    }
    func musicLibrary() async -> [[String:String]] {
        // SAĞLAM PARSE (Barış 2026-07-27): eski `as? [[String:String]]` cast'i JSONSerialization'ın [String:Any]
        // değerlerinde BOŞ dönebiliyordu -> yüklenen müzikler uygulamada "eklendi" görünmüyordu. [String:Any] -> compactMap.
        guard let d = try? await req("/api/music/library"),
              let arr = (try? JSONSerialization.jsonObject(with: d)) as? [String:Any],
              let raw = arr["tracks"] as? [[String:Any]] else { return [] }
        return raw.compactMap { t in
            guard let id = t["id"] as? String, let nm = t["name"] as? String else { return nil }
            return ["id": id, "name": nm]
        }
    }
    func musicLibraryAdd(name: String, data: Data) async -> String? {
        let dataURL = "data:audio/m4a;base64," + data.base64EncodedString()
        guard let d = try? await req("/api/music/library", method: "POST", body: ["name": name, "data": dataURL]),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String:Any] else { return nil }
        return o["id"] as? String
    }
    func addRidePhoto(session: Double, jpeg: Data, lat: Double, lon: Double) async {
        let dataURL = "data:image/jpeg;base64," + jpeg.base64EncodedString()
        _ = try? await req("/api/rides/photo", method: "POST",
                           body: ["session": session, "data": dataURL, "lat": lat, "lon": lon, "ts": Date().timeIntervalSince1970])
    }
    func generateRide(from: Double, to: Double, type: String, mode: String, aspect: String, premium: Bool, speed: String = "medium", music: String = "", line: String = "", dot: String = "", camdist: String = "orta", cam: String = "", theme: String = "", callsign: String = "", reel: Bool = false) async -> Bool {
        let body: [String:Any] = ["from": from, "to": to, "type": type, "mode": mode,
                                  "aspect": aspect, "speed": speed, "premium": premium, "music": music,
                                  "line": line, "dot": dot, "camdist": camdist, "cam": cam,
                                  "theme": theme, "callsign": callsign, "reel": reel]
        guard let d = try? await req("/api/rides/generate", method: "POST", body: body),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    // GPX/TCX dosyası yükle (ham body) -> backend parse eder, Rotalar'a ekler. (from,to) döner.
    // 402 = premium değil, 400 = geçersiz/iz yok. Dönüş nil ise hata.
    func uploadRoute(_ data: Data) async -> (from: Double, to: Double, km: Double)? {
        guard !token.isEmpty else { return nil }
        var r = URLRequest(url: URL(string: API + "/api/rides/upload")!)
        r.httpMethod = "POST"
        r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        r.httpBody = data
        guard let (d, resp) = try? await URLSession.shared.data(for: r),
              let h = resp as? HTTPURLResponse, h.statusCode == 200,
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let f = (o["from"] as? NSNumber)?.doubleValue,
              let t = (o["to"] as? NSNumber)?.doubleValue else { return nil }
        return (f, t, (o["km"] as? NSNumber)?.doubleValue ?? 0)
    }
    // Cihazda lokal render için GPS izini çek
    func track(from: Double, to: Double) async -> [LocalRouteVideo.Pt] {
        guard let d = try? await req("/api/track?frm=\(from)&to=\(to)"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let arr = o["points"] as? [[String:Any]] else { return [] }
        return arr.compactMap { p in
            guard let lat = p["lat"] as? Double, let lon = p["lon"] as? Double else { return nil }
            return LocalRouteVideo.Pt(coord: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                                      spd: (p["spd"] as? Double) ?? 0)
        }
    }
    // CİHAZDA üretilen videoyu backend'e yükle -> R2 + Videolarım'da normal video gibi görünür
    func uploadLocalVideo(_ url: URL, ts: Double, to: Double, mode: String, aspect: String, type: String, speed: String) async -> Bool {
        guard let data = try? Data(contentsOf: url) else { return false }
        var comp = URLComponents(string: API + "/api/videos/upload")!
        comp.queryItems = [.init(name: "ts", value: String(Int(ts))), .init(name: "to", value: String(Int(to))),
                           .init(name: "mode", value: mode), .init(name: "aspect", value: aspect),
                           .init(name: "type", value: type), .init(name: "speed", value: speed)]
        guard let u = comp.url else { return false }
        var rq = URLRequest(url: u); rq.httpMethod = "POST"; rq.timeoutInterval = 240
        rq.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        authHeader.forEach { rq.setValue($1, forHTTPHeaderField: $0) }
        guard let (_, resp) = try? await URLSession.shared.upload(for: rq, from: data),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return false }
        try? FileManager.default.removeItem(at: url)
        return true
    }
    // Videoyu geçmişten sil (yumuşak-sil)
    @discardableResult
    func deleteRide(_ id: String) async -> Bool {
        guard let d = try? await req("/api/rides/\(id)", method: "DELETE"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    // Mevcut bir rota videosunu yeni ayarlarla baştan üret (Rotalar > Düzenle).
    func regenerateRide(_ id: String, type: String, mode: String, aspect: String, premium: Bool, speed: String, music: String = "", line: String = "", dot: String = "", camdist: String = "orta", cam: String = "", theme: String = "", callsign: String = "", reel: Bool = false) async -> Bool {
        let body: [String:Any] = ["type": type, "mode": mode, "aspect": aspect,
                                  "speed": speed, "premium": premium, "music": music,
                                  "line": line, "dot": dot, "camdist": camdist, "cam": cam,
                                  "theme": theme, "callsign": callsign, "reel": reel]
        guard let d = try? await req("/api/rides/\(id)/regenerate", method: "POST", body: body),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    // Uygulama içi duyuru (admin panelinden)
    func announcement() async -> Announcement? {
        guard let d = try? await req("/api/announcement"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let a = o["announcement"] as? [String:Any],
              let t = a["title"] as? String, !t.isEmpty else { return nil }
        return Announcement(title: t, body: a["body"] as? String ?? "",
                            url: a["url"] as? String ?? "", ts: (a["ts"] as? Int) ?? 0)
    }
    // Hediye kodu → premium (sunucu doğrular)
    @discardableResult
    func redeem(_ code: String) async -> Bool {
        guard let d = try? await req("/api/redeem", method: "POST", body: ["code": code]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              (o["ok"] as? Bool) == true else { return false }
        UserDefaults.standard.set(true, forKey: "nd_gift")
        UserDefaults.standard.set(true, forKey: "nd_premium")
        return true
    }
    // Günlük özet ayarları (premium) + gün özeti VİDEOSU render seçenekleri (rotalar gibi)
    func summarySettings() async -> SummaryCfg {
        guard let d = try? await req("/api/summary/settings"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return SummaryCfg() }
        var c = SummaryCfg()
        c.enabled = (o["enabled"] as? Bool) ?? true
        c.hour = (o["hour"] as? Int) ?? 21
        if let v = o["video"] as? [String:Any] {
            c.video = SummaryVid(mode: v["mode"] as? String ?? "flyover", speed: v["speed"] as? String ?? "medium",
                                 aspect: v["aspect"] as? String ?? "16:9", cam: v["cam"] as? String ?? "orta",
                                 music: v["music"] as? String ?? "", line: v["line"] as? String ?? "#00E5FF")
        }
        return c
    }
    @discardableResult
    func setSummarySettings(_ cfg: SummaryCfg) async -> Bool {
        let video: [String:Any] = ["mode": cfg.video.mode, "speed": cfg.video.speed, "aspect": cfg.video.aspect,
                                   "cam": cfg.video.cam, "music": cfg.video.music, "line": cfg.video.line]
        guard let d = try? await req("/api/summary/settings", method: "PUT",
                                     body: ["enabled": cfg.enabled, "hour": cfg.hour, "video": video]),
              let _ = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return true
    }
    // GRUP SÜRÜŞ video tercihi (1.7): both=ortak+kendi | group=sadece ortak | solo=sadece kendi
    func groupVideoPref() async -> String {
        guard let d = try? await req("/api/groupvideo"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return "both" }
        return (o["pref"] as? String) ?? "both"
    }
    @discardableResult
    func setGroupVideoPref(_ pref: String) async -> Bool {
        guard let d = try? await req("/api/groupvideo", method: "PUT", body: ["pref": pref]),
              let _ = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return true
    }
    // MOTORCU GRUPLARI (1.8)
    func clubs() async -> [Club] {
        (try? dec().decode([String:[Club]].self, from: await req("/api/clubs"))["clubs"]) ?? []
    }
    func createClub(_ name: String) async -> Club? {
        guard let d = try? await req("/api/clubs", method: "POST", body: ["name": name]) else { return nil }
        return try? dec().decode(Club.self, from: d)
    }
    func joinClub(_ code: String) async -> Club? {
        guard let d = try? await req("/api/clubs/join", method: "POST", body: ["code": code]) else { return nil }
        return try? dec().decode(Club.self, from: d)
    }
    func clubDetail(_ id: String) async -> Club? {
        guard let d = try? await req("/api/clubs/\(id)") else { return nil }
        return try? dec().decode(Club.self, from: d)
    }
    @discardableResult
    func leaveClub(_ id: String) async -> Bool {
        (try? await req("/api/clubs/leave", method: "POST", body: ["id": id])) != nil
    }
    @discardableResult
    func kickClubMember(_ id: String, _ user: String) async -> Bool {
        (try? await req("/api/clubs/kick", method: "POST", body: ["id": id, "user": user])) != nil
    }
    func renameClub(_ id: String, _ name: String) async -> Club? {
        guard let d = try? await req("/api/clubs/rename", method: "POST", body: ["id": id, "name": name]) else { return nil }
        return try? dec().decode(Club.self, from: d)
    }
    // LİDERLİK TABLOSU (1.7): haftalık km — arkadaşlar + kulüp arkadaşları
    func leaderboard() async -> ([LeaderRow], Int) {
        guard let d = try? await req("/api/leaderboard"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let wk = o["week"],
              let wd = try? JSONSerialization.data(withJSONObject: wk),
              let rows = try? dec().decode([LeaderRow].self, from: wd) else { return ([], 0) }
        return (rows, (o["me"] as? Int) ?? 0)
    }
    // 1.8: GÜVENLİK PAKETİ
    func safety() async -> (buddy: String, arrive: Bool, longstop: Bool, buddyName: String) {
        guard let d = try? await req("/api/safety"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return ("", true, true, "") }
        let bp = o["buddy_profile"] as? [String:Any]
        return (o["buddy"] as? String ?? "", o["arrive"] as? Bool ?? true,
                o["longstop"] as? Bool ?? true, bp?["name"] as? String ?? "")
    }
    @discardableResult
    func setSafety(buddy: String?, arrive: Bool?, longstop: Bool?) async -> Bool {
        var b: [String:Any] = [:]
        if let x = buddy { b["buddy"] = x }
        if let x = arrive { b["arrive"] = x }
        if let x = longstop { b["longstop"] = x }
        return (try? await req("/api/safety", method: "PUT", body: b)) != nil
    }
    // 1.8: ROZETLER
    func badges() async -> [String] {
        guard let d = try? await req("/api/badges"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return [] }
        return o["badges"] as? [String] ?? []
    }
    // 1.8: RIDE WRAPPED
    func wrapped() async -> WrappedStats? {
        guard let d = try? await req("/api/wrapped") else { return nil }
        return try? dec().decode(WrappedStats.self, from: d)
    }
    // 1.8: CANLI TAKİP
    @discardableResult
    func liveStart(_ friend: String) async -> Bool {
        guard let d = try? await req("/api/live/start", method: "POST", body: ["user": friend]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["fresh"] as? Bool) ?? false
    }
    func liveGet(_ friend: String) async -> LiveTelemetry? {
        guard let d = try? await req("/api/live/\(friend)") else { return nil }
        return try? dec().decode(LiveTelemetry.self, from: d)
    }
    @discardableResult
    func liveWave(_ friend: String) async -> Bool {
        (try? await req("/api/live/wave", method: "POST", body: ["user": friend])) != nil
    }
    // ANLIK NABIZ PEEK (izleyen): arkadaşı uyandır + "nabzını istiyorum" penceresini taze tut.
    // Canlı ekran açıkken periyodik çağrılır; arkadaşın saati kısa ölçüm yapıp raporlar, dönüş
    // hr taze ise anlık nabzı verir (liveGet de merge eder).
    @discardableResult
    func hrRequest(_ friend: String) async -> Int? {
        guard let d = try? await req("/api/live/hr-request", method: "POST", body: ["user": friend]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return nil }
        return o["hr"] as? Int
    }
    // GİZLİLİK: "Nabzımı arkadaşlarım görebilsin" (varsayılan AÇIK).
    @discardableResult
    func hrShare(_ on: Bool) async -> Bool {
        (try? await req("/api/live/hr-share", method: "POST", body: ["on": on])) != nil
    }
    // ==================== ÇİFT CANLI TELSİZ (2 kişilik canlı sesli sohbet) ====================
    @discardableResult
    func vcInvite(_ friend: String) async -> Bool {
        (try? await req("/api/voicecall/invite", method: "POST", body: ["user": friend])) != nil
    }
    @discardableResult
    func vcRespond(from: String, accept: Bool) async -> Bool {
        (try? await req("/api/voicecall/respond", method: "POST", body: ["user": from, "accept": accept])) != nil
    }
    func vcStatus() async -> (invFrom: String?, invName: String?, goPeer: String?, goName: String?) {
        guard let d = try? await req("/api/voicecall/status"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return (nil, nil, nil, nil) }
        return (o["invite_from"] as? String, o["invite_name"] as? String,
                o["go_peer"] as? String, o["go_name"] as? String)
    }
    func vcToken(peer: String) async -> (url: String, token: String, room: String, peerName: String)? {
        guard let esc = peer.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let d = try? await req("/api/voicecall/token?peer=\(esc)"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let u = o["url"] as? String, let t = o["token"] as? String else { return nil }
        return (u, t, o["room"] as? String ?? "", o["peer_name"] as? String ?? peer)
    }
    // PTT ÇAKIŞMA: basılı tutarken karşı tarafın butonu pasifleşsin
    func pttBusySet(_ friend: String, on: Bool) async {
        _ = try? await req("/api/ptt/busy", method: "POST", body: ["user": friend, "on": on])
    }
    func pttBusyOf(_ friend: String) async -> Bool {
        guard let esc = friend.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let d = try? await req("/api/ptt/busy/\(esc)"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
        return (o["busy"] as? Bool) ?? false
    }
    // CANLI TAKİP BEACON: app açılınca batarya+konum bildir -> arkadaş kayıt yapmasa bile son durum taze
    func beacon() async {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let lvl = UIDevice.current.batteryLevel
        let st = UIDevice.current.batteryState
        var body: [String: Any] = ["charging": st == .charging || st == .full]
        if lvl >= 0 { body["batt"] = Int((lvl * 100).rounded()) }
        if let loc = CLLocationManager().location {
            body["lat"] = loc.coordinate.latitude; body["lon"] = loc.coordinate.longitude
        }
        _ = try? await req("/api/live/beacon", method: "POST", body: body)
    }
    func liveClub(_ cid: String) async -> [ClubRider] {
        guard let d = try? await req("/api/live/club/\(cid)"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let rr = o["riders"],
              let rd = try? JSONSerialization.data(withJSONObject: rr) else { return [] }
        return (try? dec().decode([ClubRider].self, from: rd)) ?? []
    }
    // 1.9-C İNTERKOM
    func intercomToken(_ cid: String) async -> (url: String, token: String, room: String)? {
        guard let d = try? await req("/api/intercom/\(cid)/token"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let u = o["url"] as? String, let t = o["token"] as? String else { return nil }
        return (u, t, o["room"] as? String ?? "")
    }
    // 1.9-B TELSİZ
    func pttSend(club: String, data: Data) async -> Bool {
        guard let url = URL(string: API + "/api/ptt/send?club=\(club)") else { return false }
        var rq = URLRequest(url: url); rq.httpMethod = "POST"
        rq.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { rq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        rq.httpBody = data
        guard let (_, resp) = try? await URLSession.shared.data(for: rq),
              let http = resp as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }
    // ÇİFTLER: bir ARKADAŞA sesli mesaj (kulüp gerekmez, ÜCRETSİZ). /api/ptt/send-user
    func pttSendUser(user: String, data: Data) async -> Bool {
        guard let esc = user.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: API + "/api/ptt/send-user?user=\(esc)") else { return false }
        var rq = URLRequest(url: url); rq.httpMethod = "POST"
        rq.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { rq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        rq.httpBody = data
        guard let (_, resp) = try? await URLSession.shared.data(for: rq),
              let http = resp as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }
    func pttGet(_ id: String) async -> Data? {
        guard let url = URL(string: API + "/api/ptt/\(id)") else { return nil }
        var rq = URLRequest(url: url)
        if !token.isEmpty { rq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        guard let (d, resp) = try? await URLSession.shared.data(for: rq),
              let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        return d
    }
    // 1.8: ROTA PAYLAŞIMI
    @discardableResult
    func shareRoute(_ rideId: String, toUser: String? = nil, toClub: String? = nil) async -> Bool {
        var b: [String:Any] = ["ride_id": rideId]
        if let u = toUser { b["to_user"] = u }
        if let c = toClub { b["to_club"] = c }
        guard let d = try? await req("/api/routes/share", method: "POST", body: b),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    func sharedRoutes() async -> [SharedRoute] {
        (try? dec().decode([String:[SharedRoute]].self, from: await req("/api/routes/shared"))["routes"]) ?? []
    }
    // Şimdiye kadarki günü hemen özetle (on-demand)
    @discardableResult
    func summaryNow(premium: Bool) async -> Bool {
        guard let d = try? await req("/api/summary/now", method: "POST", body: ["premium": premium]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    // Özet listesi (günlük + range özetleri)
    func activities() async -> [ActivitySummary] {
        guard let d = try? await req("/api/activities"),
              let o = try? dec().decode([String:[ActivitySummary]].self, from: d)["activities"] else { return [] }
        return o
    }
    // Kullanıcının seçtiği tarih+saat aralığı için özet üret
    @discardableResult
    func summaryRange(from: Double, to: Double) async -> Bool {
        guard let d = try? await req("/api/summary/range", method: "POST", body: ["from": from, "to": to]),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any] else { return false }
        return (o["ok"] as? Bool) ?? false
    }
    func videoURL(_ id: String) -> URL { URL(string: API + "/api/rides/\(id)/video")! }
    // Presigned R2 URL'ini auth'lu al -> doğrudan (header'sız) oynat. Redirect'te Authorization R2'ye
    // iletilip oynatmayı yarıda BEYAZA döndürme sorununu çözer. (Yerel yedekte /video path döner.)
    func signedVideoURL(_ id: String) async -> URL? {
        guard let d = try? await req("/api/rides/\(id)/videourl"),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String:Any],
              let s = o["url"] as? String else { return nil }
        if s.hasPrefix("http") { return URL(string: s) }
        return URL(string: API + s)
    }
    var authHeader: [String:String] { ["Authorization": "Bearer " + token] }
}

// İsimden baş harf + tutarlı renk avatarı
func initials(_ name: String) -> String {
    let p = name.split(separator: " ")
    let a = p.first?.first.map(String.init) ?? "?"
    let b = p.count > 1 ? (p.last?.first.map(String.init) ?? "") : ""
    return (a + b).uppercased()
}
func avatarColor(_ name: String) -> Color {
    var h = 0; for c in name.unicodeScalars { h = (h &* 31 &+ Int(c.value)) % 360 }
    return Color(hue: Double(h)/360.0, saturation: 0.5, brightness: 0.55)
}

// MARK: - Demo veri (native ekran görüntüleri)
enum DemoData {
    static var rides: [Ride] {
        let types = ["moto","bike","run","walk","moto","bike"]
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        return types.enumerated().map { i, t in
            let d = Calendar.current.date(byAdding: .day, value: -i*5, to: Date())!
            return Ride(id: "d\(i)", date: df.string(from: d), type: t, mode: "flyover", size: (1.2 + Double(i)*0.9)*1048576)
        }
    }
    static var stats: Stats { Stats(totalRides: 24, byType: ["moto":11,"bike":7,"run":4,"walk":2], latest: rides.first) }
    static func uname(_ s: String) -> String { s.lowercased().replacingOccurrences(of: " ", with: "") }
    static var positions: [Position] {
        let (la, lo): (Double, Double) = Demo.city[currentLang()] ?? Demo.city["en"]!
        let nm = Demo.nm; let sp: [Double] = [0, 32, 0]
        var out: [Position] = []
        for i in 1...3 {
            let lat: Double = la + Double(i - 2) * 0.012
            let lon: Double = lo + Double(i - 2) * 0.014
            out.append(Position(device: nm[i], lat: lat, lon: lon, speedKmh: sp[i - 1], online: i == 2))
        }
        return out
    }
    static var friends: [Friend] {
        let nm = Demo.nm
        var out: [Friend] = []
        for i in 1...3 { out.append(Friend(username: uname(nm[i]), name: nm[i], avatar: Avatar(), online: i == 2)) }
        return out
    }
    static var convos: [Convo] {
        let nm = Demo.nm
        let th = Demo.thread[currentLang()] ?? Demo.thread["en"]!
        let now: Double = Date().timeIntervalSince1970
        var out: [Convo] = []
        for i in 1...3 {
            let txt: String = th[min(i, th.count - 1)]
            let msg = Message(id: "l\(i)", frm: nm[i], text: txt, ts: now - Double(i) * 900, type: "text", media: nil)
            out.append(Convo(username: uname(nm[i]), name: nm[i], avatar: Avatar(), online: i == 2, unread: i == 1 ? 2 : 0, last: msg))
        }
        return out
    }
    static var thread: [Message] {
        let th = Demo.thread[currentLang()] ?? Demo.thread["en"]!
        let other = Demo.nm[1]
        let now: Double = Date().timeIntervalSince1970
        var out: [Message] = []
        for (i, t) in th.enumerated() {
            let frm: String = (i % 2 == 1) ? "me" : other
            let ts: Double = now - Double(th.count - i) * 240
            out.append(Message(id: "m\(i)", frm: frm, text: t, ts: ts, type: "text", media: nil))
        }
        return out
    }
}
