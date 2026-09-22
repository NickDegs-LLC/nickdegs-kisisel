import Foundation
import Network

// WatchGpsKuyruk — APPLE WATCH OFFLINE KONUM TAMPONU (22.09 "otobüs vakası"nın saat ayağı).
//
// VAKA: telefon tarafı 5e82822 ile write-ahead kuyruğa geçti ama BİLEKTEN başlatılan sürüşler
// korumasız kaldı: WorkoutManager.send(_:) aynı ingest ucuna BAĞIMSIZ, ateşle-unut POST atıyordu.
// İstek patlayınca nokta hiçbir yere yazılmadan düşüyordu — üstelik `lastSentAt` POST'tan ÖNCE
// güncellendiği için o 5 sn'lik pencere de yanıyordu. Şebekesiz sürüşte rota KALICI kaybolurdu.
//
// ÇÖZÜM — WRITE-AHEAD (iOS GpsKuyruk.swift ile AYNI SEMANTİK): nokta ÖNCE diske, SONRA gönderilir.
// Kuyruktan düşürme YALNIZ HTTP 2xx alınınca. Çevrimiçiyken kuyrukta tek kayıt bulunur -> tek POST,
// davranış bugünküyle AYNI.
//
// 🔴 BU DOSYAYI DÜZENLEYEN OKUSUN — DÖRT KURAL:
//  1. init() (ve buradan çağrılan HİÇBİR şey) `WorkoutManager.shared`a ya da `WatchLink.shared`a
//     DOKUNMAZ. WorkoutManager.init -> WatchGpsKuyruk.shared zinciri var; ters yönde referans
//     eklenirse iki static-let lazy init kilidi birbirini bekler ve uygulama AÇILIŞTA KİLİTLENİR.
//     Bu yüzden bu sınıf düz bir sınıftır (ObservableObject DEĞİL), geri bildirim
//     `durumBildirKur(_:)` ile DIŞARIDAN kurulur ve kimlik doğrudan UserDefaults'tan okunur.
//  2. 4xx'i "kalıcı ret" sayıp kaydı ATMA. Uç Cloudflare arkasında: WAF/bot-fight/rate-limit 403
//     döndürebilir ve bu KAYDA değil İSTEĞE aittir — tüm sürüş tek hamlede silinirdi.
//     Kayıt yalnız KENDİ İÇERİĞİ bozuksa (gecerli() false) tüketilir.
//  3. 🔴 watchOS: `UIApplication` YOK. iOS'taki beginBackgroundTask kalıbı buraya TAŞINMADI.
//     Saat tarafında antrenman boyunca HKWorkoutSession uygulamayı zaten diri tutuyor; karmaşık
//     uyanma mekanizması (WKApplication.scheduleBackgroundRefresh vb.) BİLEREK kurulmadı.
//  4. Dosyaya `.complete` koruma sınıfı VERME — aşağıda ac() içindeki nota bak.

private enum WatchKuyrukHata: Error { case bozuk }

/// Saat kaydı. iOS'taki NdNokta'dan TEK farkı: batt/sarj yerine `hr` (nabız) taşır.
/// Saat batarya göndermiyor (bugünkü send() de göndermiyordu), telefon ise nabız göndermiyor —
/// bu yüzden iki kayıt biçimi bilerek ayrı. İkisi de 44 bayt.
struct WatchNokta {
    var ts: Double      // epoch SANİYE — GERÇEK ölçüm anı. gps worker bunu aynen yazar
                        // (gps/src/index.ts yalnız 2000 öncesini ve gelecek+5dk'yı kırpar),
                        // bu yüzden saatler sonra gönderilen nokta rotada doğru yerine oturur.
    var lat: Double
    var lon: Double
    var spd: Float      // KNOT (sözleşme: sunucu knot bekleyip ×1.852 ile km/h'ye çeviriyor)
    var alt: Float
    var acc: Float
    var brg: Float
    var hr: Int16       // 1..250 nabız; ölçüm yoksa -1
}

final class WatchGpsKuyruk {
    static let shared = WatchGpsKuyruk()

    // --- sabitler ---
    private static let basBayt = 16           // magic(4)+sürüm(2)+ayrılmış(2)+baş ofseti(8)
    private static let kayitBayt = 44         // 8+8+8 + 4+4+4+4 + 2+2
    private static let surum: UInt64 = 1
    // TAVAN: iOS 60.000 kullanıyor ama oradaki akış didUpdateLocations (~1 Hz). SAATTE kayıt hızı
    // WorkoutManager'daki 5 sn'lik kapıyla SABİT: en çok 12 nokta/dk = 720/saat. 20.000 kayıt
    // ≈ 27,7 saat ≈ 880 KB — en uzun saat pil ömrünün (düşük güç modunda ~36 sa, normalde ~18 sa)
    // ötesinde. Tavanı iOS'la aynı tutmak 2,6 MB'a çıkarırdı, kazancı YOK.
    private static let tavanKayit = 20_000
    // Seyreltme bu boşluğu AŞAMAZ. Sunucuda GAP_SEC = 15 dk (activity-detect): daha uzun boşluk
    // tek yolculuğu İKİYE böler ve parçalar valid() eşiklerinin altında kalıp TAMAMEN düşer.
    private static let maxBosluk: Double = 600
    private static let turTavanKayit = 400    // tek boşaltma turunda en çok bu kadar nokta
    private static let sikistirEsigi: UInt64 = 256 * 1024
    private static let turButcesi: TimeInterval = 25
    // Uçuşta kalmış turu kurtarma payı: watchOS uygulamayı iOS'tan çok daha agresif askıya alır,
    // askıdayken URLSession completion'ı HİÇ gelmeyebilir -> `mesgul` sonsuza dek true kalır ve
    // kuyruk o oturum boyunca kilitlenirdi. Bu payın ötesindeki tur ÖLÜ sayılır (bkz. bosalt()).
    private static let turAsimPayi: TimeInterval = 30

    // --- durum: HEPSİ yalnız `q` üzerinde okunur/yazılır ---
    private let q = DispatchQueue(label: "nd.watch.gps.kuyruk")
    private var durumBildir: ((Int, Int, String?) -> Void)?
    private var tutamak: FileHandle?
    private var basOfset: UInt64 = UInt64(WatchGpsKuyruk.basBayt)
    private var mesgul = false
    private var agVar = true                  // NWPathMonitor ilk callback'e kadar İYİMSER:
                                              // monitör hiç ateşlemezse kuyruk kilitlenmesin
    private var hataUstUste = 0
    private var sonrakiDeneme = Date.distantPast
    private var bitisZamani = Date.distantPast
    private var turBasladi = Date.distantPast
    private var turSayaci = 0
    private var nesil: UInt64 = 0             // tampon yeniden yazıldığında/tur ölünce artar
    private var sonKuyruklananTs: Double = -1 // aynı saniyeye düşen mükerrer fix'i eleyen koruma
    private let izleyici = NWPathMonitor()

    /// Application Support (yoksa Documents). temporaryDirectory KULLANILMAZ: watchOS orayı haber
    /// vermeden temizler — tam da korumak istediğimiz veri giderdi.
    private static var dosyaURL: URL {
        let fm = FileManager.default
        if let d = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                               appropriateFor: nil, create: true) {
            return d.appendingPathComponent("nd_watch_kuyruk.bin")
        }
        let d2 = fm.urls(for: .documentDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory
        return d2.appendingPathComponent("nd_watch_kuyruk.bin")
    }

    private init() {
        // AĞ DÖNÜŞÜ = "online olduğu an". Network çerçevesi watchOS 6+'da var, YENİ BAĞIMLILIK YOK.
        // Ayrıca ağ yokken istek HİÇ açılmaz -> 15 sn'lik boşuna timeout'lar ve pil yakımı olmaz
        // (saatte pil bütçesi telefondan çok daha dar, bu kazanç burada daha da değerli).
        izleyici.pathUpdateHandler = { [weak self] yol in
            guard let self else { return }
            let acik = (yol.status == .satisfied)
            self.q.async {
                let onceki = self.agVar
                self.agVar = acik
                guard acik, !onceki else { return }
                // 🔴 Backoff'u SIFIRLAMA, yalnız BİR kademe geri al. Saat telefonla/WiFi ile
                // bağlantıyı dakikada birkaç kez kaybedip kazanabilir; her flap'te sıfırlamak
                // backoff'u tamamen devre dışı bırakır ve boşuna denemeler pili yakar.
                self.hataUstUste = max(0, self.hataUstUste - 1)
                if self.hataUstUste == 0 { self.sonrakiDeneme = .distantPast }
                self.turBaslat()
            }
        }
        izleyici.start(queue: q)
    }

    /// Geri bildirim kurulumu — HEP `q` üzerinden yazılır (veri yarışı yok) ve kurulum kuyruğa
    /// girdiği için kendisinden önce planlanmış turların bildirimlerini kaçırmaz.
    func durumBildirKur(_ f: @escaping (Int, Int, String?) -> Void) {
        q.async { self.durumBildir = f; self.durumYayinla(teslim: 0, hata: nil) }
    }

    // ------------------------------------------------------------------ yazma
    /// WRITE-AHEAD: noktayı diske ekle. Konum callback'ini bloklamaz.
    func ekle(_ n: WatchNokta) {
        q.async { self.diskeEkle(n) }
    }

    private func diskeEkle(_ n: WatchNokta) {           // yalnız q
        guard Self.gecerli(n) else { return }
        if n.ts == sonKuyruklananTs { return }
        guard let h = ac() else { yedekGonder(n); return }
        do {
            _ = try h.seekToEnd()
            try h.write(contentsOf: Self.paketle(n))
        } catch {
            // Disk dolu / bozuk tutamak: BUGÜNKÜ yola düş. Yeni kod hiçbir koşulda çalışan yolu
            // kötüleştirmesin.
            tutamakKapat(); yedekGonder(n); return
        }
        sonKuyruklananTs = n.ts
        seyreltGerekirse()
        durumYayinla(teslim: 0, hata: nil)
    }

    /// TAŞMA POLİTİKASI: bitişik blok SİLME YOK. GAP_SEC=15 dk — blok atmak 15 dk'dan uzun boşluk
    /// yaratır, tek yolculuğu ikiye böler ve parçalar sunucunun valid() eşiklerinin altında kalıp
    /// TAMAMEN düşer. Onun yerine SEYRELTME: bir atlayarak, zaman kapsamı TAM kalır; ilk ve son
    /// nokta her zaman korunur. Ek emniyet: bir noktayı atmak komşular arası boşluğu maxBosluk'un
    /// üstüne çıkaracaksa O NOKTA ATILMAZ.
    private func seyreltGerekirse() {                   // yalnız q
        // 🔴 Gönderim UÇUŞTAYKEN tamponu yeniden yazma: dönen 2xx başı YENİ (sıkışmış) tamponun
        // birinci kaydının üzerinden atlatır -> teslim edilmemiş nokta sessizce silinirdi.
        guard !mesgul else { return }
        let d = durum()
        guard d.adet > Self.tavanKayit, let h = ac(),
              let hepsi = oku(bas: d.bas, adet: d.adet), hepsi.count == d.adet else { return }
        var tutulan: [WatchNokta] = []
        tutulan.reserveCapacity(hepsi.count / 2 + 2)
        var sonTs = -Double.greatestFiniteMagnitude
        for (i, p) in hepsi.enumerated() {
            let ilk = (i == 0), son = (i == hepsi.count - 1)
            if !ilk, !son, i % 2 == 1, hepsi[i + 1].ts - sonTs <= Self.maxBosluk { continue }
            tutulan.append(p); sonTs = p.ts
        }
        // Seyreltme kâr etmediyse (maxBosluk kapısı her atlamayı engelledi) tampon sınırsız büyür
        // ve BUNDAN SONRAKİ HER ekle çağrısı tüm dosyayı okuyup çözerdi. Sert emniyet: en eski
        // %10'u at. Veri kaybı ama sınırsız büyüme + her noktada tam okuma daha kötü.
        if tutulan.count >= hepsi.count {
            let at = max(1, hepsi.count / 10)
            tutulan = Array(hepsi.dropFirst(at))
        }
        guard tutulan.count < hepsi.count else { return }
        yenidenYaz(h, tutulan)
    }

    // --------------------------------------------------------------- boşaltma
    /// Kuyruğu boşaltmayı dener. Her yerden güvenle çağrılabilir (idempotent, ucuz):
    /// meşgulse / ağ yoksa / backoff'taysa hemen döner.
    func bosalt() {
        q.async {
            // ÖLÜ TUR KURTARMA: watchOS askıya alması yüzünden completion hiç gelmediyse `mesgul`
            // takılı kalır. Bütçe + pay aşıldıysa turu ölü say, nesli artırıp (geç gelen completion
            // artık hiçbir şey yapamaz) yeniden dene. Baş göstergesi ilerletilmediği için TEK
            // maliyet uçuştaki noktanın tekrar gönderilmesi — mükerrer zararsız (sunucuda
            // `insert or ignore` + uq_positions_dev_ts).
            if self.mesgul, Date() > self.turBasladi.addingTimeInterval(Self.turButcesi + Self.turAsimPayi) {
                self.nesil &+= 1
                self.mesgul = false
            }
            guard !self.mesgul, self.agVar, Date() >= self.sonrakiDeneme else { return }
            self.turBaslat()
        }
    }

    private func turBaslat() {                          // yalnız q
        guard !mesgul, agVar, Date() >= sonrakiDeneme else { return }
        // 🔴 URL'yi TUR BAŞINDA BİR KEZ çöz. Döngü içinde çözülürse bozuk bir w_ingest her kaydı
        // "bozuk kayıt" sanıp TÜM tamponu tüketirdi — yapılandırma hatası veri kaybına dönüşmesin.
        guard let kim = kimlik(), URLComponents(string: kim.base) != nil else {
            durumYayinla(teslim: 0, hata: nil); return
        }
        guard durum().adet > 0 else { durumYayinla(teslim: 0, hata: nil); return }
        mesgul = true
        turBasladi = Date()
        bitisZamani = turBasladi.addingTimeInterval(Self.turButcesi)
        turSayaci = 0
        siradakiniGonder(kim, nesil: nesil)
    }

    /// SIRALI, TEK TEK, EN ESKİDEN EN YENİYE. Baş göstergesi yalnız BAŞTAN ilerler -> kuyrukta
    /// ASLA delik oluşmaz. Paralel pencere BİLEREK yok: veri güvenliği aynı, muhasebe üçte bir kod.
    private func siradakiniGonder(_ kim: (id: String, base: String), nesil n0: UInt64) {   // yalnız q
        guard mesgul, n0 == nesil else { return }
        while true {                                    // özyineleme DEĞİL: bozuk kayıt yığın taşırmasın
            guard Date() < bitisZamani, turSayaci < Self.turTavanKayit else { bitir(basarili: true); return }
            let d = durum()
            guard d.adet > 0 else { bitir(basarili: true); return }
            guard let kayitlar = oku(bas: d.bas, adet: 1), let n = kayitlar.first else {
                bitir(basarili: false); return
            }
            // Kayıt YALNIZ kendi içeriği bozuksa tüketilir (URL/yapılandırma hatası değil).
            guard Self.gecerli(n), let url = Self.istekURL(n, id: kim.id, base: kim.base) else {
                basIlerlet(adet: 1); continue
            }
            var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 15
            URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
                guard let self else { return }
                let kod = (resp as? HTTPURLResponse)?.statusCode ?? 0
                // 🔴 `== 200` DEĞİL, 2xx. Eski send() yalnız 200'ü sayıyordu; sözleşme 2xx.
                let teslim = (200..<300).contains(kod)
                self.q.async {
                    guard self.mesgul, n0 == self.nesil else { return }
                    if teslim {
                        self.basIlerlet(adet: 1)
                        self.turSayaci += 1
                        self.hataUstUste = 0
                        self.durumYayinla(teslim: 1, hata: nil)
                        // 🔴 `nesil: n0` DEĞİL, GÜNCEL nesil — iOS GpsKuyruk'tan BİLEREK AYRILIYOR.
                        // basIlerlet() içeride sikistir() -> yenidenYaz() çağırabilir (baş göstergesi
                        // 256 KB'ı geçince) ve yenidenYaz nesli ARTIRIR. Stale n0 ile devam edersek
                        // bir sonraki çağrının giriş guard'ı `n0 == nesil`de düşer, tur SESSİZCE
                        // terk edilir, bitir() hiç çalışmaz ve `mesgul` sonsuza dek true kalır ->
                        // kuyruk o oturum boyunca KİLİTLENİR (>5957 birikmiş noktada tetiklenir).
                        // Girişteki guard bu completion'ın geçerliliğini zaten doğruladı; buradan
                        // sonra nesil YALNIZCA kendi sıkıştırmamız yüzünden artmış olabilir, çünkü
                        // nesli değiştiren her yol (temizle/seyrelt) `q` üzerinde ve bu blok da
                        // `q` üzerinde kesintisiz çalışıyor.
                        self.siradakiniGonder(kim, nesil: self.nesil)   // yeni yığın -> büyüme yok
                    } else {
                        // 🔴 4xx dahil HER başarısızlıkta DUR, sırayı bozma, başı İLERLETME.
                        let m = err.map { "gönderim: " + $0.localizedDescription } ?? "gönderim: HTTP \(kod)"
                        self.durumYayinla(teslim: 0, hata: m)
                        self.bitir(basarili: false)
                    }
                }
            }.resume()
            return
        }
    }

    private func bitir(basarili: Bool) {                // yalnız q
        guard mesgul else { return }
        mesgul = false
        if basarili {
            hataUstUste = 0; sonrakiDeneme = .distantPast
        } else {
            hataUstUste = min(hataUstUste + 1, 4)
            let tablo: [TimeInterval] = [5, 15, 60, 300]
            sonrakiDeneme = Date().addingTimeInterval(tablo[hataUstUste - 1])
        }
        try? tutamak?.synchronize()
        durumYayinla(teslim: 0, hata: nil)
        // Kısmi tur (süre bütçesi/tur tavanı doldu) sonrası KENDİNİ yeniden planla. Yoksa sıradaki
        // deneme tamamen dışarıdan bir bosalt() çağrısına kalırdı.
        if basarili, agVar, durum().adet > 0 {
            q.asyncAfter(deadline: .now() + 2) { self.turBaslat() }
        }
    }

    /// Diske yazılamayan noktayı BUGÜNKÜ ateşle-unut yoluyla gönder (regresyon emniyeti):
    /// bozulma yolunda davranış bugünküden kötü olmasın.
    private func yedekGonder(_ n: WatchNokta) {         // yalnız q
        guard Self.gecerli(n), let kim = kimlik(),
              let url = Self.istekURL(n, id: kim.id, base: kim.base) else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 15
        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
    }

    // --------------------------------------------------------------- temizlik
    /// 🔴 Kimlik DEĞİŞİMİNDE zorunlu (WatchLink.store). Tampon kalırsa eski hesabın noktaları
    /// yeni oturumda yeni cihaz numarasına akar ve rotalar karışır.
    func temizle() {
        q.async {
            self.nesil &+= 1            // uçuştaki turun completion'ı artık hiçbir şey yapmaz
            self.mesgul = false
            self.tutamakKapat()
            try? FileManager.default.removeItem(at: Self.dosyaURL)
            self.basOfset = UInt64(Self.basBayt)
            self.hataUstUste = 0
            self.sonrakiDeneme = .distantPast
            self.sonKuyruklananTs = -1
            self.durumYayinla(teslim: 0, hata: nil)
        }
    }

    // ----------------------------------------------------------- dosya katmanı
    private func ac() -> FileHandle? {                  // yalnız q
        if let h = tutamak { return h }
        let fm = FileManager.default
        let u = Self.dosyaURL
        if !fm.fileExists(atPath: u.path) {
            var bas = Data()
            bas.append(contentsOf: [0x4E, 0x44, 0x57, 0x51])                  // "NDWQ" (watch)
            bas.append(contentsOf: Self.leBayt(Self.surum, 2))
            bas.append(contentsOf: [0, 0])                                    // ayrılmış
            bas.append(contentsOf: Self.leBayt(UInt64(Self.basBayt), 8))      // baş ofseti
            // 🔴 KORUMA SINIFI BİLEREK BELİRTİLMİYOR. iOS tarafı `.completeUntilFirstUserAuthentication`ı
            // AÇIKÇA yazıyor; burada yazmıyoruz çünkü watchOS'ta FileProtectionType'ı doğrulayacak
            // derleyici bu sunucuda YOK (bkz. rapor) ve varsayılan sınıf ZATEN
            // completeUntilFirstUserAuthentication — yani istediğimiz davranış.
            // ⚠️ İleride biri veri-koruma entitlement'ı ekleyip varsayılanı `.complete` yaparsa
            // KİLİTLİ saatte (bilekten çıkarılmış) yazma sessizce başarısız olur ve bu yama hiçbir
            // şey yapmaz. O gün burada koruma sınıfını AÇIKÇA belirtmek ŞART.
            guard fm.createFile(atPath: u.path, contents: bas) else { return nil }
            var uu = u
            var rv = URLResourceValues(); rv.isExcludedFromBackup = true      // geçici veri, yedeğe girmesin
            try? uu.setResourceValues(rv)
        }
        guard let h = try? FileHandle(forUpdating: u) else { return nil }
        do {
            let boyut = try h.seekToEnd()
            guard boyut >= UInt64(Self.basBayt) else { throw WatchKuyrukHata.bozuk }
            try h.seek(toOffset: 0)
            guard let bd = try h.read(upToCount: Self.basBayt), bd.count == Self.basBayt else {
                throw WatchKuyrukHata.bozuk
            }
            let b = [UInt8](bd)                          // Data dilim-indeksi tuzağı: diziye KOPYALA
            guard b[0] == 0x4E, b[1] == 0x44, b[2] == 0x57, b[3] == 0x51,
                  Self.leOku(b, 4, 2) == Self.surum else { throw WatchKuyrukHata.bozuk }
            // Uygulama 44 baytın ortasında öldürülmüş olabilir -> tam kayıt sınırına buda.
            let tam = (boyut - UInt64(Self.basBayt)) / UInt64(Self.kayitBayt)
            let tamBoyut = UInt64(Self.basBayt) + tam * UInt64(Self.kayitBayt)
            if tamBoyut != boyut { try h.truncate(atOffset: tamBoyut) }
            var bas = Self.leOku(b, 8, 8)
            if bas < UInt64(Self.basBayt) || bas > tamBoyut { bas = UInt64(Self.basBayt) }
            if (bas - UInt64(Self.basBayt)) % UInt64(Self.kayitBayt) != 0 { bas = UInt64(Self.basBayt) }
            basOfset = bas
            tutamak = h
            return h
        } catch {
            // Bozuk/başlıksız dosya: sil. ÖZYİNELEME YOK — bir sonraki çağrı temiz dosyayı kurar
            // (o turda tek nokta yedekGonder ile bugünkü yoldan gider).
            try? h.close()
            try? fm.removeItem(at: u)
            basOfset = UInt64(Self.basBayt)
            return nil
        }
    }

    private func tutamakKapat() {                       // yalnız q
        if let h = tutamak { try? h.close() }
        tutamak = nil
    }

    private func durum() -> (bas: UInt64, adet: Int) {  // yalnız q
        guard let h = ac(), let boyut = try? h.seekToEnd() else { return (UInt64(Self.basBayt), 0) }
        let bas = min(max(basOfset, UInt64(Self.basBayt)), boyut)
        return (bas, Int((boyut - bas) / UInt64(Self.kayitBayt)))
    }

    private func oku(bas: UInt64, adet: Int) -> [WatchNokta]? {   // yalnız q
        guard adet > 0, let h = ac() else { return [] }
        do {
            try h.seek(toOffset: bas)
            guard let d = try h.read(upToCount: adet * Self.kayitBayt), !d.isEmpty else { return nil }
            let b = [UInt8](d)
            var out: [WatchNokta] = []; out.reserveCapacity(adet)
            var o = 0
            while o + Self.kayitBayt <= b.count { out.append(Self.coz(b, o)); o += Self.kayitBayt }
            return out
        } catch { return nil }
    }

    /// Baş göstergesi HER başarılı kayıttan sonra diske yazılır (8. bayta 8 bayt, fsync yok ->
    /// ucuz). Bu yüzden süreç ölümünde en fazla 1 nokta tekrar gönderilir (mükerrer = zararsız:
    /// sunucuda `insert or ignore` + uq_positions_dev_ts).
    private func basIlerlet(adet: Int) {                // yalnız q
        guard adet > 0, let h = ac() else { return }
        basOfset += UInt64(adet * Self.kayitBayt)
        basYaz(h)
        guard let boyut = try? h.seekToEnd() else { return }
        if basOfset >= boyut { sifirla(h) }                                      // tamamen boşaldı
        else if basOfset - UInt64(Self.basBayt) > Self.sikistirEsigi { sikistir(h) }   // önü at
    }

    private func basYaz(_ h: FileHandle) {              // yalnız q
        do { try h.seek(toOffset: 8); try h.write(contentsOf: Data(Self.leBayt(basOfset, 8))) } catch {}
    }

    private func sifirla(_ h: FileHandle) {             // yalnız q
        try? h.truncate(atOffset: UInt64(Self.basBayt))
        basOfset = UInt64(Self.basBayt)
        basYaz(h)
    }

    private func sikistir(_ h: FileHandle) {            // yalnız q
        let d = durum()
        guard d.adet > 0 else { sifirla(h); return }
        guard let kalan = oku(bas: d.bas, adet: d.adet), kalan.count == d.adet else { return }
        yenidenYaz(h, kalan)
    }

    /// 🔴 ATOMİK: geçici dosyaya yaz + replaceItemAt ile değiştir. Önce truncate edip sonra yazmak,
    /// arada süreç ölürse (saatte askıya alma/jetsam çok daha sık) teslim edilmemiş NE VARSA yok
    /// ederdi — tam da önlemeye çalıştığımız kayıp.
    private func yenidenYaz(_ h: FileHandle, _ kayitlar: [WatchNokta]) {   // yalnız q
        var govde = Data(); govde.reserveCapacity(Self.basBayt + kayitlar.count * Self.kayitBayt)
        govde.append(contentsOf: [0x4E, 0x44, 0x57, 0x51])
        govde.append(contentsOf: Self.leBayt(Self.surum, 2))
        govde.append(contentsOf: [0, 0])
        govde.append(contentsOf: Self.leBayt(UInt64(Self.basBayt), 8))
        for p in kayitlar { govde.append(Self.paketle(p)) }
        let u = Self.dosyaURL
        let gecici = u.deletingLastPathComponent().appendingPathComponent("nd_watch_kuyruk.yeni")
        let fm = FileManager.default
        try? fm.removeItem(at: gecici)
        guard fm.createFile(atPath: gecici.path, contents: govde) else { return }
        tutamakKapat()
        do {
            _ = try fm.replaceItemAt(u, withItemAt: gecici)
        } catch {
            try? fm.removeItem(at: gecici)
            _ = ac()                       // tutamağı geri kur, eski dosya bozulmadan duruyor
            return
        }
        basOfset = UInt64(Self.basBayt)
        _ = ac()                           // yeni dosyayı aç (başlık zaten doğru)
        nesil &+= 1                        // uçuştaki tur varsa artık geçersiz
    }

    private func durumYayinla(teslim: Int, hata: String?) {   // yalnız q
        let n = durum().adet
        let cb = durumBildir
        DispatchQueue.main.async { cb?(n, teslim, hata) }
    }

    // ------------------------------------------------------------- yardımcılar
    /// 🔴 Kimlik BOŞALTMA ANINDA okunur, kayda GÖMÜLMEZ: hesap değişirse eski cihaz numarasıyla
    /// gönderim olmaz. Anahtarlar WatchLink ile AYNI (`w_devid` / `w_ingest`) ama `WatchLink.shared`
    /// üzerinden OKUNMAZ — bu sınıfın init'i hiçbir singleton'a dokunmamalı (yukarıdaki kural 1).
    private func kimlik() -> (id: String, base: String)? {
        let d = UserDefaults.standard
        guard let id = d.string(forKey: "w_devid"), !id.isEmpty else { return nil }
        let base = d.string(forKey: "w_ingest") ?? "https://gpsdata.nickdegs.com"
        guard !base.isEmpty else { return nil }
        return (id, base)
    }

    /// Sunucu sözleşmesi gps/src/index.ts ile BİREBİR (gövde yok, her şey query'de) ve bugünkü
    /// send(_:) ile AYNI parametre kümesi — çevrimiçi davranış değişmesin.
    /// ⚠️ `hr`: bugünkü send() de gönderiyordu, aynen korundu. Ama movelog-gps worker'ı `hr`yi
    /// OKUMUYOR (positions'ta hr kolonu yok — db/migrations/0001_init.sql:451). Yani parametre şu
    /// an sunucuda DÜŞÜYOR; eski Traccar okuyordu (main.py:3206). Bu bir GERİLEME ama bu işin
    /// kapsamı dışında (sunucu alanı) — raporda ayrıca bildirildi. Nabzı ÖLÇÜM ANINDA kayda
    /// yazıyoruz ki sunucu tarafı düzeldiğinde saatler sonra boşalan kuyruk da doğru nabzı taşısın.
    private static func istekURL(_ n: WatchNokta, id: String, base: String) -> URL? {
        guard var c = URLComponents(string: base) else { return nil }
        var q: [URLQueryItem] = [
            .init(name: "id", value: id),
            .init(name: "lat", value: String(n.lat)),
            .init(name: "lon", value: String(n.lon)),
            .init(name: "timestamp", value: String(Int(n.ts))),   // GERÇEK ölçüm anı
            .init(name: "speed", value: String(n.spd)),           // KNOT
            .init(name: "bearing", value: String(n.brg)),
            .init(name: "altitude", value: String(n.alt)),
            .init(name: "accuracy", value: String(n.acc)),
        ]
        if n.hr > 0 { q.append(.init(name: "hr", value: String(Int(n.hr)))) }
        c.queryItems = q
        return c.url
    }

    /// Worker'ın sessizce YUTTUĞU çöpü (tam-tamsayı çift / Null Island) istemcide ele —
    /// boşuna istek gitmesin ve kuyrukta yer kaplamasın.
    private static func gecerli(_ n: WatchNokta) -> Bool {
        guard n.ts.isFinite, n.lat.isFinite, n.lon.isFinite else { return false }
        guard n.ts > 946684800, abs(n.lat) <= 90, abs(n.lon) <= 180 else { return false }
        if n.lat == 0 && n.lon == 0 { return false }                             // Null Island
        if n.lat == n.lat.rounded() && n.lon == n.lon.rounded() { return false }  // tam-tamsayı çift
        return true
    }

    // --- bayt paketleme: ELLE little-endian. MemoryLayout/struct yerleşimine GÜVENİLMEZ
    //     (derleyici sürümü değişirse dosya biçimi sessizce değişirdi).
    private static func leBayt(_ v: UInt64, _ n: Int) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: n)
        for i in 0..<n { out[i] = UInt8((v >> (8 * UInt64(i))) & 0xFF) }
        return out
    }
    private static func leOku(_ b: [UInt8], _ o: Int, _ n: Int) -> UInt64 {
        var v: UInt64 = 0
        for i in 0..<n { v |= UInt64(b[o + i]) << (8 * UInt64(i)) }
        return v
    }

    private static func paketle(_ n: WatchNokta) -> Data {
        var b = [UInt8](); b.reserveCapacity(kayitBayt)
        b += leBayt(n.ts.bitPattern, 8)
        b += leBayt(n.lat.bitPattern, 8)
        b += leBayt(n.lon.bitPattern, 8)
        b += leBayt(UInt64(n.spd.bitPattern), 4)
        b += leBayt(UInt64(n.alt.bitPattern), 4)
        b += leBayt(UInt64(n.acc.bitPattern), 4)
        b += leBayt(UInt64(n.brg.bitPattern), 4)
        b += leBayt(UInt64(UInt16(bitPattern: n.hr)), 2)
        b.append(0); b.append(0)                        // ayrılmış -> toplam 44
        return Data(b)
    }
    private static func coz(_ b: [UInt8], _ o: Int) -> WatchNokta {
        WatchNokta(ts:  Double(bitPattern: leOku(b, o, 8)),
                   lat: Double(bitPattern: leOku(b, o + 8, 8)),
                   lon: Double(bitPattern: leOku(b, o + 16, 8)),
                   spd: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 24, 4))),
                   alt: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 28, 4))),
                   acc: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 32, 4))),
                   brg: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 36, 4))),
                   hr:  Int16(bitPattern: UInt16(truncatingIfNeeded: leOku(b, o + 40, 2))))
    }
}
