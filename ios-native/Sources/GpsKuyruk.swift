import Foundation
import Network
import UIKit

// GpsKuyruk — OFFLINE KONUM TAMPONU (22.09 "otobüs vakası").
//
// VAKA: 20.09'da şebekesiz uzun otobüs yolculuğunda oto-takip AÇIKTI ama TEK BİR NOKTA bile
// sunucuya ulaşmadı, rota KALICI olarak kayboldu. Kök neden: Tracker.sendLoc ateşle-unut POST
// ediyordu; istek patlayınca yalnız `lastError` yazılıyor, nokta HİÇBİR YERE saklanmıyordu.
//
// ÇÖZÜM — WRITE-AHEAD: nokta ÖNCE diske, SONRA gönderilir. Kuyruktan düşürme YALNIZ HTTP 2xx
// alınınca. Çevrimiçiyken kuyrukta tek kayıt bulunur -> tek POST, davranış bugünküyle AYNI.
//
// 🔴 BU DOSYAYI DÜZENLEYEN OKUSUN — ÜÇ KURAL:
//  1. init() (ve buradan çağrılan HİÇBİR şey) `Tracker.shared`a DOKUNMAZ. Tracker.init ->
//     GpsKuyruk.shared zinciri var; ters yönde referans eklenirse iki static-let lazy init
//     kilidi birbirini bekler ve uygulama AÇILIŞTA KİLİTLENİR. Bu yüzden bu sınıf düz bir
//     sınıftır (ObservableObject DEĞİL) ve Tracker'a hiç referansı yoktur; geri bildirim
//     `durumBildirKur(_:)` ile DIŞARIDAN kurulur.
//  2. Dosyaya `.complete` koruma sınıfı VERME. Kilitli telefonda (yani yolculuğun TAMAMINDA)
//     yazma başarısız olur ve yama sessizce hiçbir şey yapmaz.
//  3. 4xx'i "kalıcı ret" sayıp kaydı ATMA. Uç Cloudflare arkasında: WAF/bot-fight/rate-limit
//     403 döndürebilir ve bu KAYDA değil İSTEĞE aittir — 8 saatlik rota tek hamlede silinirdi.
//     Kayıt yalnız KENDİ İÇERİĞİ bozuksa (gecerli() false) tüketilir.

private enum NdKuyrukHata: Error { case bozuk }

struct NdNokta {
    var ts: Double      // epoch SANİYE — GERÇEK ölçüm anı. gps worker bunu aynen yazar
                        // (gps/src/index.ts yalnız 2000 öncesini ve gelecek+5dk'yı kırpar),
                        // bu yüzden saatler sonra gönderilen nokta rotada doğru yerine oturur.
    var lat: Double
    var lon: Double
    var spd: Float      // KNOT (sözleşme: sunucu knot bekleyip çeviriyor)
    var alt: Float
    var acc: Float
    var brg: Float
    var batt: Int8      // 0..100; okunamadıysa -1
    var sarj: Bool
}

final class GpsKuyruk {
    static let shared = GpsKuyruk()

    // --- sabitler ---
    private static let basBayt = 16           // magic(4)+sürüm(2)+ayrılmış(2)+baş ofseti(8)
    private static let kayitBayt = 44         // 8+8+8 + 4+4+4+4 + 1+1+2
    private static let surum: UInt64 = 1
    // TAVAN: 60.000 kayıt ≈ 2,6 MB. 20.000 denenmişti ama hesap YANLIŞTI: noktalar yalnız
    // heartbeat'ten gelmiyor, asıl akış didUpdateLocations (Tracker.swift sendLoc(force:false)).
    // Otobüs ~90 km/h + "hassas" modda distanceFilter 5 m -> pratikte ~1 Hz -> saatte ~3600 kayıt.
    // 20.000 ≈ 5,5 saatte dolardı (yolculuğun ORTASI). 60.000 ≈ 16+ saat; telefonda 2,6 MB sorun değil.
    private static let tavanKayit = 60_000
    // Seyreltme bu boşluğu AŞAMAZ. Sunucuda GAP_SEC = 15 dk (activity-detect.ts): daha uzun boşluk
    // tek yolculuğu İKİYE böler ve parçalar valid() eşiklerinin altında kalıp TAMAMEN düşer.
    private static let maxBosluk: Double = 600
    private static let turTavanKayit = 400    // tek boşaltma turunda en çok bu kadar nokta
    private static let sikistirEsigi: UInt64 = 256 * 1024

    // --- durum: HEPSİ yalnız `q` üzerinde okunur/yazılır ---
    private let q = DispatchQueue(label: "nd.gps.kuyruk")
    private var durumBildir: ((Int, Int, String?) -> Void)?
    private var tutamak: FileHandle?
    private var basOfset: UInt64 = UInt64(GpsKuyruk.basBayt)
    private var mesgul = false
    private var agVar = true                  // NWPathMonitor ilk callback'e kadar İYİMSER
    private var hataUstUste = 0
    private var sonrakiDeneme = Date.distantPast
    private var bitisZamani = Date.distantPast
    private var turSayaci = 0
    private var nesil: UInt64 = 0             // tampon yeniden yazıldığında artar (uçuştaki turu geçersizler)
    private var sonKuyruklananTs: Double = -1 // heartbeat mükerrerini eleyen tek satırlık koruma
    private let izleyici = NWPathMonitor()

    // bgGorev YALNIZ ana iş parçacığında okunur/yazılır (UIApplication sözleşmesi)
    private var bgGorev = UIBackgroundTaskIdentifier.invalid

    /// Application Support (yoksa Documents). temporaryDirectory KULLANILMAZ: repodaki büyük-veri
    /// emsali orası (Store.swift) ama iOS orayı haber vermeden temizler — tam da korumak
    /// istediğimiz veri giderdi.
    private static var dosyaURL: URL {
        let fm = FileManager.default
        if let d = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                               appropriateFor: nil, create: true) {
            return d.appendingPathComponent("nd_gps_kuyruk.bin")
        }
        let d2 = fm.urls(for: .documentDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory
        return d2.appendingPathComponent("nd_gps_kuyruk.bin")
    }

    private init() {
        // AĞ DÖNÜŞÜ = "online olduğu an". Sistem çerçevesi, YENİ BAĞIMLILIK YOK.
        // Ayrıca ağ yokken istek HİÇ açılmaz -> 20 sn'lik boşuna timeout'lar ve pil yakımı olmaz.
        izleyici.pathUpdateHandler = { [weak self] yol in
            guard let self else { return }
            let acik = (yol.status == .satisfied)
            self.q.async {
                let onceki = self.agVar
                self.agVar = acik
                guard acik, !onceki else { return }
                // 🔴 Backoff'u SIFIRLAMA, yalnız BİR kademe geri al. Otobüste hücre kapsaması
                // dakikada birkaç kez flap edebilir; her flap'te sıfırlamak backoff'u tamamen
                // devre dışı bırakır ve 20 sn'lik timeout'lu denemeler pili/ısıyı yakar.
                self.hataUstUste = max(0, self.hataUstUste - 1)
                if self.hataUstUste == 0 { self.sonrakiDeneme = .distantPast }
                self.turBaslat(butce: 20)
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
    /// 🔴 DEMO modunda da KUYRUKLANIR ama gönderilmez -> aşağıdaki bosalt()'a bak.
    func ekle(_ n: NdNokta) {
        q.async { self.diskeEkle(n) }
    }

    private func diskeEkle(_ n: NdNokta) {              // yalnız q
        guard Self.gecerli(n) else { return }
        // Heartbeat, didUpdateLocations'ın zaten gönderdiği lastLoc'u force:true ile TEKRAR
        // gönderiyor (aynı ts, aynı koordinat). Çevrimdışıyken bunlar eskiden buharlaşıyordu;
        // artık diske yazılacağı için tampon iki kat hızlı dolardı. Tek satırlık koruma:
        if n.ts == sonKuyruklananTs { return }
        guard let h = ac() else { yedekGonder(n); return }
        do {
            _ = try h.seekToEnd()
            try h.write(contentsOf: Self.paketle(n))
        } catch {
            // Disk dolu / koruma sınıfı / bozuk tutamak: BUGÜNKÜ yola düş.
            // Yeni kod hiçbir koşulda çalışan yolu kötüleştirmesin.
            tutamakKapat(); yedekGonder(n); return
        }
        sonKuyruklananTs = n.ts
        seyreltGerekirse()
        durumYayinla(teslim: 0, hata: nil)
    }

    /// TAŞMA POLİTİKASI: bitişik blok SİLME YOK. GAP_SEC=15 dk — blok atmak 15 dk'dan uzun
    /// boşluk yaratır, tek yolculuğu ikiye böler ve parçalar sunucunun valid() eşiklerinin
    /// altında kalıp TAMAMEN düşer. Onun yerine SEYRELTME: bir atlayarak, zaman kapsamı TAM
    /// kalır; ilk ve son nokta her zaman korunur. Ek emniyet: bir noktayı atmak komşular arası
    /// boşluğu maxBosluk'un üstüne çıkaracaksa O NOKTA ATILMAZ.
    private func seyreltGerekirse() {                   // yalnız q
        // 🔴 Gönderim UÇUŞTAYKEN tamponu yeniden yazma: dönen 2xx başı YENİ (sıkışmış) tamponun
        // birinci kaydının üzerinden atlatır -> teslim edilmemiş nokta sessizce silinirdi.
        guard !mesgul else { return }
        let d = durum()
        guard d.adet > Self.tavanKayit, let h = ac(),
              let hepsi = oku(bas: d.bas, adet: d.adet), hepsi.count == d.adet else { return }
        var tutulan: [NdNokta] = []
        tutulan.reserveCapacity(hepsi.count / 2 + 2)
        var sonTs = -Double.greatestFiniteMagnitude
        for (i, p) in hepsi.enumerated() {
            let ilk = (i == 0), son = (i == hepsi.count - 1)
            if !ilk, !son, i % 2 == 1, hepsi[i + 1].ts - sonTs <= Self.maxBosluk { continue }
            tutulan.append(p); sonTs = p.ts
        }
        // Seyreltme kâr etmediyse (maxBosluk kapısı her atlamayı engelledi) tampon sınırsız
        // büyür ve BUNDAN SONRAKİ HER ekle çağrısı tüm dosyayı okuyup çözerdi. Sert emniyet:
        // en eski %10'u at. Veri kaybı ama sınırsız büyüme + her noktada tam okuma daha kötü.
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
        // UCUZ KAPI — önce `q`da bak: sendLoc her noktada (yolculukta ~1 Hz) bunu çağırıyor.
        // Meşgulsek / ağ yoksa / backoff'taysak ana iş parçacığına HİÇ iş atmayalım; aksi hâlde
        // saniyede bir boşuna main-hop + UIApplication okuması olurdu.
        q.async {
            guard !self.mesgul, self.agVar, Date() >= self.sonrakiDeneme else { return }
            self.butceOlcVeBaslat()
        }
    }

    private func butceOlcVeBaslat() {
        // Zaman bütçesi ANA İŞ PARÇACIĞINDA okunur (UIApplication sözleşmesi), sonra iş `q`ya geçer.
        DispatchQueue.main.async {
            var butce: TimeInterval = 60
            if UIApplication.shared.applicationState != .active {
                // Ön planda/limitsizken iOS greatestFiniteMagnitude döner -> min() tavanlar.
                let kalan = UIApplication.shared.backgroundTimeRemaining
                butce = max(0, min(kalan - 6, 20))
            }
            self.q.async { self.turBaslat(butce: butce) }
        }
    }

    private func turBaslat(butce: TimeInterval) {       // yalnız q
        // 🔴 DEMO (mağaza çekimi/simülatör): kuyruk çalışır ama AĞA ÇIKILMAZ. Bugünkü sendLoc de
        // demo'da POST ediyordu; ama çekim makinesinde ingest kimliği yok, istek zaten boşa gider.
        // Kuyrukta birikmesi zararsız: gerçek kullanıcıda bu dal hiç işlemez.
        if AppEnv.demo { return }
        guard !mesgul, agVar, butce > 1, Date() >= sonrakiDeneme else { return }
        // 🔴 URL'yi TUR BAŞINDA BİR KEZ çöz. Döngü içinde çözülürse bozuk bir nd_ingest her kaydı
        // "bozuk kayıt" sanıp TÜM tamponu tüketirdi — yapılandırma hatası veri kaybına dönüşmesin.
        guard let kim = kimlik(), URLComponents(string: kim.base) != nil else {
            durumYayinla(teslim: 0, hata: nil); return
        }
        guard durum().adet > 0 else { durumYayinla(teslim: 0, hata: nil); return }
        mesgul = true
        bitisZamani = Date().addingTimeInterval(butce)
        turSayaci = 0
        bgGorevAl()
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
            var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 20
            URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
                guard let self else { return }
                let kod = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let teslim = (200..<300).contains(kod)
                self.q.async {
                    guard self.mesgul, n0 == self.nesil else { return }
                    if teslim {
                        self.basIlerlet(adet: 1)
                        self.turSayaci += 1
                        self.hataUstUste = 0
                        self.durumYayinla(teslim: 1, hata: nil)
                        self.siradakiniGonder(kim, nesil: n0)   // yeni yığın (ağ gidiş-dönüşü) -> büyüme yok
                    } else {
                        // 🔴 4xx dahil HER başarısızlıkta DUR, sırayı bozma, başı İLERLETME.
                        // 4xx'i "kalıcı ret" sayan dal KALDIRILDI: Cloudflare WAF/rate-limit 403'ü
                        // isteğe aittir, kayda değil — tüm tamponu sessizce silerdi.
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
        bgGorevBirak()
        // 🔴 Kısmi tur (süre bütçesi/tur tavanı doldu) sonrası KENDİNİ yeniden planla. Yoksa
        // sıradaki deneme tamamen dışarıdan bir bosalt() çağrısına kalır: takip kapalıysa
        // heartbeat de yok demektir ve kuyruk takılı kalır, kullanıcı sayacın donduğunu görür.
        if basarili, agVar, durum().adet > 0 {
            q.asyncAfter(deadline: .now() + 2) { self.turBaslat(butce: 20) }
        }
    }

    /// Diske yazılamayan noktayı BUGÜNKÜ ateşle-unut yoluyla gönder (regresyon emniyeti).
    /// Arka plan koruması BUGÜNKÜ sendLoc ile aynı — bozulma yolunda davranış gerilemesin.
    private func yedekGonder(_ n: NdNokta) {            // yalnız q
        if AppEnv.demo { return }
        guard Self.gecerli(n), let kim = kimlik(),
              let url = Self.istekURL(n, id: kim.id, base: kim.base) else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 20
        bgGorevAl()
        URLSession.shared.dataTask(with: req) { [weak self] _, _, _ in
            self?.bgGorevBirak()
        }.resume()
    }

    // --------------------------------------------------------------- temizlik
    /// 🔴 logout()'ta ZORUNLU. Store.swift'teki 05.09 fiksi: tampon kalırsa eski hesabın
    /// noktaları yeni oturumda eski tracker'a akar ve rotalar karışır.
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
            self.bgGorevBirak()         // uçuştaki tur bitir() göremeyeceği için görevi burada bırak
        }
    }

    // ----------------------------------------------------------- dosya katmanı
    private func ac() -> FileHandle? {                  // yalnız q
        if let h = tutamak { return h }
        let fm = FileManager.default
        let u = Self.dosyaURL
        if !fm.fileExists(atPath: u.path) {
            var bas = Data()
            bas.append(contentsOf: [0x4E, 0x44, 0x47, 0x51])                  // "NDGQ"
            bas.append(contentsOf: Self.leBayt(Self.surum, 2))
            bas.append(contentsOf: [0, 0])                                    // ayrılmış
            bas.append(contentsOf: Self.leBayt(UInt64(Self.basBayt), 8))       // baş ofseti
            // 🔴 .complete VERME: kilitli telefonda yazma başarısız olur, yama sessizce çalışmaz.
            // Varsayılan sınıf zaten bu; AÇIKÇA yazıyoruz ki ileride biri veri-koruma entitlement'ı
            // eklerse tampon sessizce kırılmasın.
            guard fm.createFile(atPath: u.path, contents: bas, attributes: [
                .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
            ]) else { return nil }
            var uu = u
            var rv = URLResourceValues(); rv.isExcludedFromBackup = true      // geçici veri, yedeğe girmesin
            try? uu.setResourceValues(rv)
        }
        guard let h = try? FileHandle(forUpdating: u) else { return nil }
        do {
            let boyut = try h.seekToEnd()
            guard boyut >= UInt64(Self.basBayt) else { throw NdKuyrukHata.bozuk }
            try h.seek(toOffset: 0)
            guard let bd = try h.read(upToCount: Self.basBayt), bd.count == Self.basBayt else {
                throw NdKuyrukHata.bozuk
            }
            let b = [UInt8](bd)                          // Data dilim-indeksi tuzağı: diziye KOPYALA
            guard b[0] == 0x4E, b[1] == 0x44, b[2] == 0x47, b[3] == 0x51,
                  Self.leOku(b, 4, 2) == Self.surum else { throw NdKuyrukHata.bozuk }
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

    private func oku(bas: UInt64, adet: Int) -> [NdNokta]? {   // yalnız q
        guard adet > 0, let h = ac() else { return [] }
        do {
            try h.seek(toOffset: bas)
            guard let d = try h.read(upToCount: adet * Self.kayitBayt), !d.isEmpty else { return nil }
            let b = [UInt8](d)
            var out: [NdNokta] = []; out.reserveCapacity(adet)
            var o = 0
            while o + Self.kayitBayt <= b.count { out.append(Self.coz(b, o)); o += Self.kayitBayt }
            return out
        } catch { return nil }
    }

    /// Baş göstergesi HER başarılı kayıttan sonra diske yazılır (8. bayta 8 bayt, fsync yok ->
    /// ucuz). Bu yüzden süreç ölümünde en fazla 1 nokta tekrar gönderilir (mükerrer = zararsız:
    /// sunucu mesafeyi haversine ile topluyor, aynı koordinatın katkısı 0).
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

    /// 🔴 ATOMİK: geçici dosyaya yaz + replaceItemAt ile değiştir. Eski hâli önce truncate edip
    /// sonra yazıyordu; arada süreç ölürse (arka planda jetsam gerçekçi) teslim edilmemiş NE
    /// VARSA yok olurdu — tam da önlemeye çalıştığımız kayıp.
    private func yenidenYaz(_ h: FileHandle, _ kayitlar: [NdNokta]) {   // yalnız q
        var govde = Data(); govde.reserveCapacity(Self.basBayt + kayitlar.count * Self.kayitBayt)
        govde.append(contentsOf: [0x4E, 0x44, 0x47, 0x51])
        govde.append(contentsOf: Self.leBayt(Self.surum, 2))
        govde.append(contentsOf: [0, 0])
        govde.append(contentsOf: Self.leBayt(UInt64(Self.basBayt), 8))
        for p in kayitlar { govde.append(Self.paketle(p)) }
        let u = Self.dosyaURL
        let gecici = u.deletingLastPathComponent()
            .appendingPathComponent("nd_gps_kuyruk.yeni")
        let fm = FileManager.default
        try? fm.removeItem(at: gecici)
        guard fm.createFile(atPath: gecici.path, contents: govde, attributes: [
            .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
        ]) else { return }
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
    /// 🔴 Kimlik BOŞALTMA ANINDA okunur, kayda GÖMÜLMEZ: hesap değişirse eski deviceId ile
    /// gönderim olmaz (Store.swift'teki 05.09 fiksinin ruhu).
    private func kimlik() -> (id: String, base: String)? {
        let d = UserDefaults.standard
        guard let id = d.string(forKey: "nd_dev"), !id.isEmpty,
              let base = d.string(forKey: "nd_ingest"), !base.isEmpty else { return nil }
        return (id, base)
    }

    /// Sunucu sözleşmesi gps/src/index.ts ile BİREBİR (gövde yok, her şey query'de).
    private static func istekURL(_ n: NdNokta, id: String, base: String) -> URL? {
        guard var c = URLComponents(string: base) else { return nil }
        var q: [URLQueryItem] = [
            .init(name: "id", value: id),
            .init(name: "lat", value: String(n.lat)),
            .init(name: "lon", value: String(n.lon)),
            .init(name: "timestamp", value: String(Int(n.ts))),   // GERÇEK ölçüm anı
            .init(name: "speed", value: String(n.spd)),           // KNOT
            .init(name: "altitude", value: String(n.alt)),
            .init(name: "accuracy", value: String(n.acc)),
            .init(name: "bearing", value: String(n.brg)),
        ]
        if n.batt >= 0 { q.append(.init(name: "batt", value: String(Int(n.batt)))) }
        if n.sarj { q.append(.init(name: "charge", value: "true")) }
        c.queryItems = q
        return c.url
    }

    /// Worker'ın sessizce YUTTUĞU çöpü (tam-tamsayı çift / Null Island) istemcide ele —
    /// boşuna istek gitmesin ve kuyrukta yer kaplamasın.
    private static func gecerli(_ n: NdNokta) -> Bool {
        guard n.ts.isFinite, n.lat.isFinite, n.lon.isFinite else { return false }
        guard n.ts > 946684800, abs(n.lat) <= 90, abs(n.lon) <= 180 else { return false }
        if n.lat == 0 && n.lon == 0 { return false }                             // Null Island
        if n.lat == n.lat.rounded() && n.lon == n.lon.rounded() { return false }  // tam-tamsayı çift
        return true
    }

    private func bgGorevAl() {
        DispatchQueue.main.async {
            guard self.bgGorev == .invalid else { return }
            self.bgGorev = UIApplication.shared.beginBackgroundTask(withName: "nd-gps-kuyruk") {
                self.bgGorevBirak()
            }
        }
    }
    private func bgGorevBirak() {
        DispatchQueue.main.async {
            guard self.bgGorev != .invalid else { return }
            UIApplication.shared.endBackgroundTask(self.bgGorev)
            self.bgGorev = .invalid
        }
    }

    // --- bayt paketleme: ELLE little-endian. MemoryLayout/struct yerleşimine GÜVENİLMEZ
    //     (derleyici sürümü değişirse dosya biçimi sessizce değişirdi). loadUnaligned de
    //     KULLANILMIYOR: repoda emsali yok, kaydırma her Swift sürümünde kesin derlenir.
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

    private static func paketle(_ n: NdNokta) -> Data {
        var b = [UInt8](); b.reserveCapacity(kayitBayt)
        b += leBayt(n.ts.bitPattern, 8)
        b += leBayt(n.lat.bitPattern, 8)
        b += leBayt(n.lon.bitPattern, 8)
        b += leBayt(UInt64(n.spd.bitPattern), 4)
        b += leBayt(UInt64(n.alt.bitPattern), 4)
        b += leBayt(UInt64(n.acc.bitPattern), 4)
        b += leBayt(UInt64(n.brg.bitPattern), 4)
        b.append(UInt8(bitPattern: n.batt))
        b.append(n.sarj ? 1 : 0)
        b.append(0); b.append(0)                        // ayrılmış -> toplam 44
        return Data(b)
    }
    private static func coz(_ b: [UInt8], _ o: Int) -> NdNokta {
        NdNokta(ts:  Double(bitPattern: leOku(b, o, 8)),
                lat: Double(bitPattern: leOku(b, o + 8, 8)),
                lon: Double(bitPattern: leOku(b, o + 16, 8)),
                spd: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 24, 4))),
                alt: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 28, 4))),
                acc: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 32, 4))),
                brg: Float(bitPattern: UInt32(truncatingIfNeeded: leOku(b, o + 36, 4))),
                batt: Int8(bitPattern: b[o + 40]),
                sarj: b[o + 41] == 1)
    }
}
