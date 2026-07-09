import SwiftUI
import CoreLocation
import DeviceCheck
import CryptoKit

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
    func positions() async -> [Position] {
        if AppEnv.demo { return DemoData.positions }
        return (try? dec().decode([String:[Position]].self, from: await req("/api/gps/live"))["positions"]) ?? []
    }
    func profile() async -> Profile? {
        if AppEnv.demo { return Profile(username: "me", name: Demo.user, avatar: Avatar()) }
        return try? dec().decode(Profile.self, from: await req("/api/profile")) }
    // Sunucu-taraflı premium'u cihaza senkronla (yalnızca Profil değil her yerden tetiklenir).
    func syncPremium() async {
        guard let p = await profile(), p.premium else { return }
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
    func addRideMusic(session: Double, data: Data) async {
        let dataURL = "data:audio/m4a;base64," + data.base64EncodedString()
        _ = try? await req("/api/rides/music", method: "POST", body: ["session": session, "data": dataURL])
    }
    func addRidePhoto(session: Double, jpeg: Data, lat: Double, lon: Double) async {
        let dataURL = "data:image/jpeg;base64," + jpeg.base64EncodedString()
        _ = try? await req("/api/rides/photo", method: "POST",
                           body: ["session": session, "data": dataURL, "lat": lat, "lon": lon, "ts": Date().timeIntervalSince1970])
    }
    func generateRide(from: Double, to: Double, type: String, mode: String, aspect: String, premium: Bool, speed: String = "medium", music: String = "", line: String = "", dot: String = "", camdist: String = "orta", cam: String = "") async -> Bool {
        let body: [String:Any] = ["from": from, "to": to, "type": type, "mode": mode,
                                  "aspect": aspect, "speed": speed, "premium": premium, "music": music,
                                  "line": line, "dot": dot, "camdist": camdist, "cam": cam]
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
    func regenerateRide(_ id: String, type: String, mode: String, aspect: String, premium: Bool, speed: String, music: String = "", line: String = "", dot: String = "", camdist: String = "orta", cam: String = "") async -> Bool {
        let body: [String:Any] = ["type": type, "mode": mode, "aspect": aspect,
                                  "speed": speed, "premium": premium, "music": music,
                                  "line": line, "dot": dot, "camdist": camdist, "cam": cam]
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
