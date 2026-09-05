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
    private static func bitir(_ neden: String) -> URL? { sonHata = neden; return nil }

    struct Meta: Decodable { let html: String; let frames: Int; let fps: Int; let W: Int; let H: Int }

    static func render(from: Double, to: Double, type: String, speed: String,
                       aspect: String, camdist: String, line: String, dot: String,
                       token: String, musicURL: URL?, qaKareTavan: Int? = nil,
                       onAsama: @escaping (String) -> Void = { _ in },
                       onProgress: @escaping (Double) -> Void) async -> URL? {
        sonHata = ""
        // Ekran kilidi koruması EN BAŞTA: `sayfaAl` 190 sn'ye kadar sürebiliyor ve o pencerede
        // ekran kendiliğinden kilitlenirse üretim daha başlamadan "arka plana alındı" ile ölüyordu.
        UIApplication.shared.isIdleTimerDisabled = true
        defer { UIApplication.shared.isIdleTimerDisabled = false }
        onAsama("harita hazırlanıyor")
        // 1) motor sayfasını al (bulutla aynı spec; sunucu sadece CPU-saniyesi harcar)
        guard let meta = await sayfaAl(from: from, to: to, type: type, speed: speed,
                                       aspect: aspect, camdist: camdist, line: line, dot: dot, token: token)
        else { return sonHata.isEmpty ? bitir("motor sayfası alınamadı (sunucu /api/motor3d)") : nil }

        // 2) görünmez WKWebView (ekran hiyerarşisinde olmalı — yoksa snapshot boş döner)
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: meta.W, height: meta.H), configuration: cfg)
        wv.isUserInteractionEnabled = false
        guard let pencere = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return bitir("ekran penceresi bulunamadı") }
        let kap = UIView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        kap.clipsToBounds = true                       // 1px kap: webview "ekranda" ama görünmez
        kap.alpha = 0.02
        kap.addSubview(wv)
        pencere.addSubview(kap)
        defer { kap.removeFromSuperview() }

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
        _ = try? await wv.callAsyncJavaScript("return await window.motorHazir();", contentWorld: .page)

        // 4) MP4 yazıcı
        let outURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("motor_\(Int(Date().timeIntervalSince1970)).mp4")
        try? FileManager.default.removeItem(at: outURL)
        guard let writer = try? AVAssetWriter(outputURL: outURL, fileType: .mp4) else { return bitir("video yazıcı açılamadı") }
        let boy = CGSize(width: meta.W, height: meta.H)
        let vset: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264,
                                   AVVideoWidthKey: boy.width, AVVideoHeightKey: boy.height]
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
        func yaz(_ img: UIImage) {
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
            for _ in 0..<introN { yaz(img) }
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
                yaz(img)
            }
            if f % 5 == 0 { onProgress(Double(f) / toplamIs) }
        }
        // 7) outro / dünya finali
        let hedefOutro = qaKareTavan != nil ? min(12, outroN) : outroN
        onAsama("kapanış sahnesi")
        for k in 0..<hedefOutro {
            if Task.isCancelled { input.markAsFinished(); writer.cancelWriting(); return bitir("iptal edildi") }
            if arkaPlan.dustu { input.markAsFinished(); writer.cancelWriting(); return bitir("uygulama arka plana alındı — üretim durduruldu") }
            _ = try? await wv.callAsyncJavaScript("return await window.finalCiz(\(k));", contentWorld: .page)
            if let img = await cek(wv, boy: boy) { yaz(img) }
            if k % 5 == 0 { onProgress(Double(hedefKare + k) / toplamIs) }
        }
        onAsama("video kapatılıyor")
        onProgress(0.92)   // 0.92-1.00 finalize/mux/yükleme
        input.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        guard writer.status == .completed, kareNo > Int64(hedefKare / 2) else { return bitir("video tamamlanamadı (\(kareNo)/\(hedefKare) kare)") }
        // 8) müzik (cihazda miks — LocalRouteVideo ile ortak yol)
        if let m = musicURL {
            onAsama("müzik ekleniyor")
            if let muxed = await LocalRouteVideo.muxMusic(video: outURL, music: m) { return muxed }
        }
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
                                camdist: String, line: String, dot: String, token: String) async -> Meta? {
        var rq = URLRequest(url: URL(string: API + "/api/motor3d")!)
        rq.httpMethod = "POST"; rq.timeoutInterval = 190
        rq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        rq.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        rq.httpBody = try? JSONSerialization.data(withJSONObject: [
            "from": from, "to": to, "type": type, "speed": speed, "aspect": aspect,
            "camdist": camdist, "line": line, "dot": dot])
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

    private static func karart(_ img: UIImage, oran: CGFloat) -> UIImage {
        let r = UIGraphicsImageRenderer(size: img.size)
        return r.image { ctx in
            img.draw(at: .zero)
            UIColor.black.withAlphaComponent(oran).setFill()
            ctx.fill(CGRect(origin: .zero, size: img.size))
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

/// Uygulama arka plana düştü mü — cihazda video üretimi sırasında tek seferlik bayrak.
/// İKİ MOTOR DA kullanır (WebRouteVideo 3B + LocalRouteVideo düz/kuşbakışı): arka planda
/// WKWebView snapshot'ı ve MKMapSnapshotter boş/donuk kare üretir; üretim orada kesilmeli.
/// ⚠️ YALNIZ `didEnterBackground` dinlenir. `willResignActive` Control Center, Bildirim Merkezi,
/// gelen arama, Siri ve uygulama değiştiricide de gelir — bunların hiçbirinde kare bozulmaz;
/// o bildirimi dinlemek kullanıcı Control Center'a dokununca üretimi öldürüyordu (denetim bulgusu).
@MainActor
final class ArkaPlanGozcu {
    private(set) var dustu = false
    private var gozlem: NSObjectProtocol?
    init() {
        gozlem = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                self?.dustu = true
            }
    }
    deinit { if let g = gozlem { NotificationCenter.default.removeObserver(g) } }
}
