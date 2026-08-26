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

    struct Meta: Decodable { let html: String; let frames: Int; let fps: Int; let W: Int; let H: Int }

    static func render(from: Double, to: Double, type: String, speed: String,
                       aspect: String, camdist: String, line: String, dot: String,
                       token: String, musicURL: URL?, qaKareTavan: Int? = nil,
                       onProgress: @escaping (Double) -> Void) async -> URL? {
        // 1) motor sayfasını al (bulutla aynı spec; sunucu sadece CPU-saniyesi harcar)
        guard let meta = await sayfaAl(from: from, to: to, type: type, speed: speed,
                                       aspect: aspect, camdist: camdist, line: line, dot: dot, token: token)
        else { return nil }

        // 2) görünmez WKWebView (ekran hiyerarşisinde olmalı — yoksa snapshot boş döner)
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: meta.W, height: meta.H), configuration: cfg)
        wv.isUserInteractionEnabled = false
        guard let pencere = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return nil }
        let kap = UIView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        kap.clipsToBounds = true                       // 1px kap: webview "ekranda" ama görünmez
        kap.alpha = 0.02
        kap.addSubview(wv)
        pencere.addSubview(kap)
        defer { kap.removeFromSuperview() }

        // 3) sayfayı yükle + motor hazır olsun (karo ön-ısıtma dahil — bulutla aynı)
        wv.loadHTMLString(meta.html, baseURL: URL(string: "https://kisisel-api.nickdegs.com"))
        guard await bekle(wv, js: "window._ready===true", saniye: 60) else { return nil }
        _ = try? await wv.callAsyncJavaScript("return await window.motorHazir();", contentWorld: .page)

        // 4) MP4 yazıcı
        let outURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("motor_\(Int(Date().timeIntervalSince1970)).mp4")
        try? FileManager.default.removeItem(at: outURL)
        guard let writer = try? AVAssetWriter(outputURL: outURL, fileType: .mp4) else { return nil }
        let boy = CGSize(width: meta.W, height: meta.H)
        let vset: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264,
                                   AVVideoWidthKey: boy.width, AVVideoHeightKey: boy.height]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: vset)
        input.expectsMediaDataInRealTime = false
        let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                                    kCVPixelBufferWidthKey as String: meta.W,
                                    kCVPixelBufferHeightKey as String: meta.H]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
        guard writer.canAdd(input) else { return nil }
        writer.add(input)
        guard writer.startWriting() else { return nil }
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
                while !input.isReadyForMoreMediaData { usleep(6000) }
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
        for f in 0..<hedefKare {
            _ = try? await wv.callAsyncJavaScript("return await window.kareCiz(\(f));", contentWorld: .page)
            if let img = await cek(wv, boy: boy) { yaz(img) }
            if f % 5 == 0 { onProgress(Double(f) / Double(max(1, meta.frames))) }
        }
        // 7) outro / dünya finali
        let hedefOutro = qaKareTavan != nil ? min(12, outroN) : outroN
        for k in 0..<hedefOutro {
            _ = try? await wv.callAsyncJavaScript("return await window.finalCiz(\(k));", contentWorld: .page)
            if let img = await cek(wv, boy: boy) { yaz(img) }
        }
        input.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        guard writer.status == .completed, kareNo > Int64(hedefKare / 2) else { return nil }
        // 8) müzik (cihazda miks — LocalRouteVideo ile ortak yol)
        if let m = musicURL, let muxed = await LocalRouteVideo.muxMusic(video: outURL, music: m) { return muxed }
        return outURL
    }

    // MARK: - yardımcılar
    private static func sayfaAl(from: Double, to: Double, type: String, speed: String, aspect: String,
                                camdist: String, line: String, dot: String, token: String) async -> Meta? {
        var rq = URLRequest(url: URL(string: API + "/api/motor3d")!)
        rq.httpMethod = "POST"; rq.timeoutInterval = 190
        rq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        rq.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        rq.httpBody = try? JSONSerialization.data(withJSONObject: [
            "from": from, "to": to, "type": type, "speed": speed, "aspect": aspect,
            "camdist": camdist, "line": line, "dot": dot])
        guard let (d, resp) = try? await URLSession.shared.data(for: rq),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(Meta.self, from: d)
    }

    private static func bekle(_ wv: WKWebView, js: String, saniye: Int) async -> Bool {
        for _ in 0..<(saniye * 4) {
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
