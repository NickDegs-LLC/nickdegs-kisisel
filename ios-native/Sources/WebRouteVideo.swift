import WebKit
import AVFoundation
import UIKit

// GERÇEK MOTOR TELEFONDA (2026-08-26, Barış: "telefon üretecek ama AYNI video oluştur").
// Bulut 3B videolarını üreten MapLibre motorunun SAYFASI sunucudan hazır gelir
// (/api/motor3d: bulutla AYNI route-video.py spec'i + AYNI render3d.js sayfası);
// telefon WKWebView'da kare kare çekip MP4 yazar. Taklit yok — motor, kamera
// matematiği, karolar, HUD birebir bulutla aynı; tek fark GPU'nun sahibi (telefon, bedava).
@MainActor
enum WebRouteVideo {

    /// SON HATA NEDENİ (1.62). Bu motor her başarısızlıkta sessizce `nil` dönüyordu; kullanıcı da
    /// biz de "Üretilemedi"den başka bir şey görmüyorduk (Barış 05.09: "niye üretilemedi ki?").
    /// Artık her çıkış noktası nedenini buraya yazar, UI onu gösterir.
    static var sonHata = ""
    /// Kare hizası (güvenli alan payı) sıfırlanamadıysa tanı metni — üretim yine de sürer.
    static var hizaUyarisi = ""
    // 05.09: iptal/hata yollarında yarım kalan MP4 tmp'de birikiyordu (yalnız :69'da, ÜRETMEDEN
    // ÖNCE siliniyordu). Artık her çıkışta temizlenir.
    private static var kismiCikti: URL?
    private static func bitir(_ neden: String) -> URL? {
        sonHata = neden
        if let u = kismiCikti { try? FileManager.default.removeItem(at: u); kismiCikti = nil }
        return nil
    }

    struct Meta: Decodable { let html: String; let frames: Int; let fps: Int; let W: Int; let H: Int }

    static func render(from: Double, to: Double, type: String, speed: String,
                       aspect: String, camdist: String, line: String, dot: String,
                       token: String, musicURL: URL?, qaKareTavan: Int? = nil,
                       grup: String? = nil,   // 05.11: ortak sürüş anahtarı (sunucu eş izlerini ekler)
                       onAsama: @escaping (String) -> Void = { _ in },
                       onProgress: @escaping (Double) -> Void) async -> URL? {
        sonHata = ""
        hizaUyarisi = ""
        // Ekran kilidi koruması EN BAŞTA: `sayfaAl` 190 sn'ye kadar sürebiliyor ve o pencerede
        // ekran kendiliğinden kilitlenirse üretim daha başlamadan "arka plana alındı" ile ölüyordu.
        UIApplication.shared.isIdleTimerDisabled = true
        defer { UIApplication.shared.isIdleTimerDisabled = false }
        onAsama("harita hazırlanıyor")
        // 1) motor sayfasını al (bulutla aynı spec; sunucu sadece CPU-saniyesi harcar)
        guard let meta = await sayfaAl(from: from, to: to, type: type, speed: speed,
                                       aspect: aspect, camdist: camdist, line: line, dot: dot, token: token, grup: grup)
        else { return sonHata.isEmpty ? bitir("motor sayfası alınamadı (sunucu /api/motor3d)") : nil }

        // 2) görünmez WKWebView (ekran hiyerarşisinde olmalı — yoksa snapshot boş döner)
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: meta.W, height: meta.H), configuration: cfg)
        wv.isUserInteractionEnabled = false
        guard let pencere = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return bitir("ekran penceresi bulunamadı") }
        // 🔴 FİKS 05.09 — ÜSTTE 62 PİKSEL BEYAZ ŞERİT.
        // `kap` pencerenin (0,0) noktasına ekleniyor (durum çubuğu bölgesi), UIKit güvenli alan
        // payını alt görünümlere yayıyor ve WKWebView'ın kaydırma görünümü onu içerik boşluğuna
        // çeviriyordu: sayfa 62 px AŞAĞI kayıyor, üstte webview'ın beyaz zemini kalıyor, ALTTA da
        // belgenin son 62 px'i kırpılıyordu — oradaki harita lisans satırı ("© OpenStreetMap ·
        // Esri, Maxar", sayfa.js:461, taban çizgisi y=1901 → 1963 = kare dışı) videoya HİÇ girmiyor.
        // Bu aynı zamanda bir LİSANS UYUM sorunu: o satır görünmek zorunda.
        // ÖLÇÜLDÜ: 2136 karenin 2042'sinde (%95,6) satır 0..61 düz RGB(253,253,253); bulut 0/2136.
        // İki katman: (a) kapsayıcı payı hiç yaymasın, (b) kaydırma görünümü payı hiç uygulamasın.
        let kap = GuvenliAlansizKap(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        kap.clipsToBounds = true                       // 1px kap: webview "ekranda" ama görünmez
        kap.alpha = 0.02
        kap.addSubview(wv)
        pencere.addSubview(kap)
        defer { kap.removeFromSuperview() }
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.contentInset = .zero
        wv.scrollView.contentOffset = .zero
        wv.scrollView.bounces = false

        // 🔴 ARKA PLAN KORUMASI (1.63, Barış 05.09: "telefonda üretiliyorsa ve arka planı alıyorsa
        // beyaz ekran sorunu olabilir" — DOĞRU çıktı). Yukarıdaki yorumun dediği gibi WKWebView'ın
        // ekran hiyerarşisinde olması ŞART; uygulama arka plana düşünce takeSnapshot BOŞ/BEYAZ kare
        // döndürür ve aşağıdaki döngü onu videoya YAZAR. Sonuç: kullanıcıya beyaz video.
        // Artık: (a) ekranın kendiliğinden kilitlenmesi engellenir, (b) arka plana düşerse üretim
        // İPTAL edilir (yarım/beyaz video ÜRETİLMEZ) — sunucudaki yerelq-bekçisi 6 saat sonra işi
        // buluta devreder, yani iş kaybolmaz.
        let arkaPlan = ArkaPlanGozcu()

        // 3) sayfayı yükle + motor hazır olsun (karo ön-ısıtma dahil — bulutla aynı)
        wv.loadHTMLString(meta.html, baseURL: URL(string: "https://kisisel-api.nickdegs.com"))
        onAsama("motor yükleniyor")
        guard await bekle(wv, js: "window._ready===true", saniye: 60) else { return bitir("motor 60 sn içinde hazırlanamadı (harita/karo yüklenmedi?)") }
        // KARE HİZASI — SON ÇARE DÜZELTME (ÜRETİMİ ASLA DURDURMAZ).
        // ⚠️ Bu blok önce üretimi İPTAL ediyordu. Yanlıştı: yukarıdaki iki katmanın gerçek cihazda
        // tuttuğunu doğrulayamıyorum (burada iOS cihaz/simülatör yok). Tutmazsa iptal etmek,
        // "beyaz şeritli ama ÇALIŞAN" durumu "hiç çalışmayan"a çevirirdi — kullanıcı için daha kötü.
        // Bu yüzden: bir kez daha sıfırlamayı dene, sonuç ne olursa olsun DEVAM ET.
        // En kötü hâl = bugünkü davranış (şerit), asla toptan başarısızlık değil.
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.contentInset = .zero
        wv.scrollView.contentOffset = .zero
        let pay = wv.scrollView.adjustedContentInset
        let ofs = wv.scrollView.contentOffset
        if pay.top > 0.5 || pay.left > 0.5 || abs(ofs.y) > 0.5 || abs(ofs.x) > 0.5 {
            // Tanı için sakla; kullanıcıyı engelleme.
            hizaUyarisi = "pay \(Int(pay.top))px / ofset \(Int(ofs.y))px"
            print("⚠️ WebRouteVideo: kare hizası sıfırlanamadı — \(hizaUyarisi)")
        }
        _ = try? await wv.callAsyncJavaScript("return await window.motorHazir();", contentWorld: .page)

        // 4) MP4 yazıcı
        let outURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("motor_\(Int(Date().timeIntervalSince1970))_\(UUID().uuidString.prefix(8)).mp4")
        try? FileManager.default.removeItem(at: outURL)
        kismiCikti = outURL
        guard let writer = try? AVAssetWriter(outputURL: outURL, fileType: .mp4) else { return bitir("video yazıcı açılamadı") }
        // 🔴 FİKS 06.09 — FASTSTART. AVAssetWriter varsayılan olarak `moov` atomunu dosyanın SONUNA
        // yazar; böyle bir MP4 akışta hemen açılmaz, oynatıcı önce dosyanın tamamını (veya sondaki
        // indeksi ayrı istekle) çekmek zorunda kalır. ÖLÇÜLDÜ (video-kontrol bekçisi yakaladı):
        // telefon çıktısı `ftyp -> mdat -> moov`, bulut çıktısı `ftyp -> moov -> free -> mdat`.
        // 05.09'da müzik varsayılanı sessize çekildiği için ARTIK ÇOĞU VİDEO müziksiz yoldan
        // gidiyor (muxMusic'e uğramıyor), yani bu kusur her videoyu etkiliyordu.
        // Bu özellik indeksi başa yazdırır; ek geçiş/maliyet YOK.
        writer.shouldOptimizeForNetworkUse = true
        let boy = CGSize(width: meta.W, height: meta.H)
        // 🔴 FİKS 05.09 — BİT HIZI TAVANI. Ayar verilmediği için AVAssetWriter varsayılanı
        // kullanıyordu: ÖLÇÜLDÜ 14,0 Mbit/s → 62,5 MB. AYNI rotanın bulut çıktısı 6,1 Mbit/s →
        // 27,1 MB, üstelik telefon çıktısı ondan DAHA AZ keskin (5,75 vs 6,18 @ t=6s). Yani fazla
        // bit kaliteye gitmiyordu, sadece yüklemeyi uzatıyordu. 9 Mbit/s buluta göre %50 pay
        // bırakır (kaynak kayıpsız snapshot), kalite kaybı yok, dosya ~40 MB'a iner.
        let vset: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264,
                                   AVVideoWidthKey: boy.width, AVVideoHeightKey: boy.height,
                                   AVVideoCompressionPropertiesKey: [
                                       AVVideoAverageBitRateKey: 9_000_000,
                                       AVVideoExpectedSourceFrameRateKey: 60,
                                       AVVideoMaxKeyFrameIntervalKey: 120,
                                   ] as [String: Any]]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: vset)
        input.expectsMediaDataInRealTime = false
        let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                                    kCVPixelBufferWidthKey as String: meta.W,
                                    kCVPixelBufferHeightKey as String: meta.H]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
        guard writer.canAdd(input) else { return bitir("video girişi eklenemedi") }
        writer.add(input)
        guard writer.startWriting() else { return bitir("video yazımı başlamadı") }
        writer.startSession(atSourceTime: .zero)

        let fps = Int32(meta.fps)
        var kareNo: Int64 = 0
        let fadeKare = Int(Double(meta.fps) * 0.8)     // bulut ffmpeg fade'inin eşi (0.8sn)
        let introN = Int(Double(meta.fps) * 1.6)
        let outroN = Int(Double(meta.fps) * 6.0)       // satStyle outro (motor sayfası aynı sayıyı üretir)
        let toplam = introN + meta.frames + outroN
        func yaz(_ img: UIImage) async {
            let t = Double(kareNo)
            var son = img
            // fade in/out: bulut çıktısıyla aynı his (ilk/son 0.8sn siyaha karışır)
            let kalan = Double(toplam) - t - 1
            if t < Double(fadeKare) || kalan < Double(fadeKare) {
                let a = 1 - min(t, kalan) / Double(fadeKare)
                son = karart(img, oran: max(0, min(1, a)))
            }
            if let pb = pixelBuffer(son, size: boy, pool: adaptor.pixelBufferPool) {
                while !input.isReadyForMoreMediaData { try? await Task.sleep(nanoseconds: 6_000_000) }
                adaptor.append(pb, withPresentationTime: CMTime(value: kareNo, timescale: fps))
            }
            kareNo += 1
        }

        // 5) intro kartı (tek çekim, introN kez)
        if let ok = try? await wv.callAsyncJavaScript("return await window.introCiz();", contentWorld: .page),
           (ok as? Bool) == true, let img = await cek(wv, boy: boy) {
            for _ in 0..<introN { await yaz(img) }
        }
        // 6) rota kareleri — kamera matematiği sayfada, bulutla birebir
        let hedefKare = qaKareTavan.map { min($0, meta.frames) } ?? meta.frames
        var bosKare = 0
        // İLERLEME FİKSİ (05.09): eskiden payda `meta.frames` idi; ana döngü bitince yüzde %99'da
        // DONUYOR, arkasından 360 karelik outro + finalize + ses miksi + yükleme sessizce sürüyordu.
        // Barış: "%99'da takılı kaldı, bayağı uzun sürdü" — sebebi tam olarak buydu.
        let toplamIs = Double(max(1, hedefKare + (qaKareTavan != nil ? min(12, outroN) : outroN)))
        onAsama("kareler çiziliyor")
        for f in 0..<hedefKare {
            if Task.isCancelled {         // İPTAL artık dinleniyor (eskiden hiç bakılmıyordu)
                input.markAsFinished(); writer.cancelWriting()
                return bitir("iptal edildi")
            }
            if arkaPlan.dustu {           // uygulama arka plana geçti -> beyaz kare üretmeden çık
                input.markAsFinished(); writer.cancelWriting()
                return bitir("uygulama arka plana alındı — üretim durduruldu")
            }
            _ = try? await wv.callAsyncJavaScript("return await window.kareCiz(\(f));", contentWorld: .page)
            if let img = await cek(wv, boy: boy) {
                // Emniyet ağı: arka plana düşmese bile GPU/WebView boş kare döndürebilir.
                // 20 ardışık boş kare = üretim bozulmuş; yarım video yayınlamak yerine iptal.
                if bosMu(img) {
                    bosKare += 1
                    if bosKare >= 20 { input.markAsFinished(); writer.cancelWriting(); return bitir("ekran karardı/boş kare geldi — üretim durduruldu") }
                } else { bosKare = 0 }
                await yaz(img)
            }
            if f % 5 == 0 { onProgress(Double(f) / toplamIs * 0.85) }
        }
        // 7) outro / dünya finali
        let hedefOutro = qaKareTavan != nil ? min(12, outroN) : outroN
        onAsama("kapanış sahnesi")
        for k in 0..<hedefOutro {
            if Task.isCancelled { input.markAsFinished(); writer.cancelWriting(); return bitir("iptal edildi") }
            if arkaPlan.dustu { input.markAsFinished(); writer.cancelWriting(); return bitir("uygulama arka plana alındı — üretim durduruldu") }
            _ = try? await wv.callAsyncJavaScript("return await window.finalCiz(\(k));", contentWorld: .page)
            if let img = await cek(wv, boy: boy) { await yaz(img) }
            if k % 5 == 0 { onProgress(Double(hedefKare + k) / toplamIs * 0.85) }
        }
        onAsama("video kapatılıyor")
        // 🔴 FİKS 05.09 — İLERLEME GERİ GİDİYORDU. Eskiden outro son raporu ~0.99'a çıkıyor,
        // hemen ardından buradaki SABİT 0.92 yüzdeyi 7 puan GERİ ATIYORDU; Record.swift de
        // arkasından 0.96 yazıyordu. Barış'ın gördüğü dizi tam olarak buydu: "%99 oldu, yazılar
        // geldi, %96 yükleniyorda geri kaldı". Artık bütçe monoton: kareler+outro 0-0.85,
        // finalize 0.88, mux 0.90, yükleme 0.90-1.00 (Store.uploadLocalVideo gerçek ilerlemeyle).
        onProgress(0.88)
        input.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        guard writer.status == .completed, kareNo > Int64(hedefKare / 2) else { return bitir("video tamamlanamadı (\(kareNo)/\(hedefKare) kare)") }
        // 8) müzik (cihazda miks — LocalRouteVideo ile ortak yol)
        if let m = musicURL {
            onAsama("müzik ekleniyor")
            if let muxed = await LocalRouteVideo.muxMusic(video: outURL, music: m) {
                kismiCikti = nil
                onProgress(0.90)
                return muxed
            }
        }
        kismiCikti = nil            // başarı: dosya çağırana devredildi
        onProgress(0.90)
        return outURL
    }

    // MARK: - yardımcılar


    /// Kare pratikte boş mu (beyaz/şeffaf)? 5x5 örnekle ortalama parlaklık + değişim ölçülür.
    /// Gerçek harita karesinde renk değişimi her zaman vardır; boş snapshot'ta yoktur.
    private static func bosMu(_ img: UIImage) -> Bool {
        guard let cg = img.cgImage else { return false }
        let n = 5
        var piksel = [UInt8](repeating: 0, count: n * n * 4)
        guard let ctx = CGContext(data: &piksel, width: n, height: n, bitsPerComponent: 8,
                                  bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))
        var toplam = 0, enAz = 255, enCok = 0
        for i in stride(from: 0, to: piksel.count, by: 4) {
            let l = (Int(piksel[i]) * 299 + Int(piksel[i+1]) * 587 + Int(piksel[i+2]) * 114) / 1000
            toplam += l; enAz = min(enAz, l); enCok = max(enCok, l)
        }
        let ort = toplam / (n * n)
        return ort > 240 && (enCok - enAz) < 8        // hem çok parlak hem düz => boş kare
    }
    private static func sayfaAl(from: Double, to: Double, type: String, speed: String, aspect: String,
                                camdist: String, line: String, dot: String, token: String, grup: String? = nil) async -> Meta? {
        var rq = URLRequest(url: URL(string: API + "/api/motor3d")!)
        rq.httpMethod = "POST"; rq.timeoutInterval = 190
        rq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        rq.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        var govde: [String: Any] = [
            "from": from, "to": to, "type": type, "speed": speed, "aspect": aspect,
            "camdist": camdist, "line": line, "dot": dot]
        if let grup, !grup.isEmpty { govde["grup"] = grup }
        rq.httpBody = try? JSONSerialization.data(withJSONObject: govde)
        guard let (d, resp) = try? await URLSession.shared.data(for: rq) else {
            sonHata = "sunucuya ulaşılamadı (bağlantı?)"
            return nil
        }
        let kod = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard kod == 200 else {
            // SUNUCUNUN KENDİ MESAJINI göster — 05.09'da "spec uretilemedi" (500) çıkmıştı ve
            // kullanıcıya yalnız "Üretilemedi" deniyordu. Sunucu artık 422 + anlaşılır sebep dönüyor
            // ("bu rotada hareket yok", "yeterli konum yok (4 nokta)"); onu aynen aktarıyoruz.
            let detay = (try? JSONSerialization.jsonObject(with: d) as? [String: Any])??["detail"] as? String
            sonHata = detay ?? "sunucu \(kod) döndü"
            return nil
        }
        guard let m = try? JSONDecoder().decode(Meta.self, from: d) else {
            sonHata = "sunucu cevabı çözülemedi"
            return nil
        }
        return m
    }

    private static func bekle(_ wv: WKWebView, js: String, saniye: Int) async -> Bool {
        for _ in 0..<(saniye * 4) {
            if Task.isCancelled { return false }
            if let v = try? await wv.evaluateJavaScript(js), (v as? Bool) == true { return true }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return false
    }

    private static func cek(_ wv: WKWebView, boy: CGSize) async -> UIImage? {
        let cfg = WKSnapshotConfiguration()
        cfg.rect = CGRect(origin: .zero, size: boy)
        cfg.snapshotWidth = NSNumber(value: Double(boy.width) / UIScreen.main.scale)   // px = points*scale -> tam W
        cfg.afterScreenUpdates = true
        return await withCheckedContinuation { cont in
            wv.takeSnapshot(with: cfg) { img, _ in cont.resume(returning: img) }
        }
    }

    /// 🔴 FİKS 05.09 — VİDEONUN BAŞI VE SONU TAMAMEN SİYAHTI.
    /// `UIGraphicsImageRendererContext.fill(_:)` TEK ARGÜMANLI hâli `CGBlendMode.copy` kullanır:
    /// pikselleri harmanlamaz, DEĞİŞTİRİR. Yani "karart" fonksiyonu kareyi karartmak yerine
    /// siyahla SİLİYORDU. ÖLÇÜLDÜ (2026-09-05_1788598167_1788613246.mp4): ilk 48 kare (0,8 sn)
    /// ortalama parlaklık 0.00, sonra 48. karede birden 30.21'e sıçrıyor — rampa hiç yok.
    /// Aynı rotanın BULUT çıktısında düzgün rampa var (0 → 22.5). Videonun sonu da aynı şekilde
    /// tam siyahtı (t=35,3 → 0.00). Harman kipi açıkça `.normal` verilerek düzeltildi.
    private static func karart(_ img: UIImage, oran: CGFloat) -> UIImage {
        let r = UIGraphicsImageRenderer(size: img.size)
        return r.image { ctx in
            img.draw(at: .zero)
            UIColor.black.withAlphaComponent(oran).setFill()
            ctx.fill(CGRect(origin: .zero, size: img.size), blendMode: .normal)
        }
    }

    private static func pixelBuffer(_ img: UIImage, size: CGSize, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
        var pb: CVPixelBuffer?
        if let pool { CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb) }
        if pb == nil {
            let a: [String: Any] = [kCVPixelBufferCGImageCompatibilityKey as String: true,
                                    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
            CVPixelBufferCreate(nil, Int(size.width), Int(size.height), kCVPixelFormatType_32ARGB, a as CFDictionary, &pb)
        }
        guard let buf = pb, let cg = img.cgImage else { return nil }
        CVPixelBufferLockBaseAddress(buf, [])
        defer { CVPixelBufferUnlockBaseAddress(buf, []) }
        guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf),
                                  width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
                                  bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(origin: .zero, size: size))
        return buf
    }
}

/// Güvenli alan payını TÜRETİLEN görünümlere hiç yaymayan kapsayıcı (05.09 beyaz şerit fiksi).
/// WebKit'in kaydırma görünümü davranışından BAĞIMSIZ ikinci katman: `wv.safeAreaInsets` sıfır olur.
final class GuvenliAlansizKap: UIView {
    override var safeAreaInsets: UIEdgeInsets { .zero }
}

/// Uygulama arka plana düştü mü — cihazda video üretimi sırasında tek seferlik bayrak.
/// İKİ MOTOR DA kullanır (WebRouteVideo 3B + LocalRouteVideo düz/kuşbakışı): arka planda
/// WKWebView snapshot'ı ve MKMapSnapshotter boş/donuk kare üretir; üretim orada kesilmeli.
/// ⚠️ YALNIZ `didEnterBackground` dinlenir. `willResignActive` Control Center, Bildirim Merkezi,
/// gelen arama, Siri ve uygulama değiştiricide de gelir — bunların hiçbirinde kare bozulmaz;
/// o bildirimi dinlemek kullanıcı Control Center'a dokununca üretimi öldürüyordu (denetim bulgusu).
final class ArkaPlanGozcu: @unchecked Sendable {
    private let kilit = NSLock()
    private var _dustu = false
    private var gozlem: NSObjectProtocol?
    /// Herhangi bir aktörden okunabilir: bayrak ana kuyrukta yazılır, NSLock ile korunur.
    /// (LocalRouteVideo @MainActor DEĞİL — bu yüzden sınıf aktöre bağlanamaz.)
    var dustu: Bool { kilit.lock(); defer { kilit.unlock() }; return _dustu }
    init() {
        gozlem = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                self.kilit.lock(); self._dustu = true; self.kilit.unlock()
            }
    }
    deinit { if let g = gozlem { NotificationCenter.default.removeObserver(g) } }
}
