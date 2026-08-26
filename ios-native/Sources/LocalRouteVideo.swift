import MapKit
import AVFoundation
import UIKit
import CoreLocation

// CİHAZDA (lokal) rota videosu render — sunucu render etmez, telefon kendi GPU'suyla çizer.
// Apple Maps uydu (hybridFlyover) + yumuşak kamera takibi + ilerleyen rota + hız/mesafe bindirme -> MP4.
// 1.61 (Barış 2026-08-26 "hepsini masrafsız yap, kendi telefonlarından"): Düz/Flyover'a ek olarak
// 3B mod da cihazda (Apple foto-gerçekçi flyover, pitch 66) + 1080p + rota renkleri + müzik miksi.
// Buluta giden tek şey bitmiş MP4 -> sunucu GPU maliyeti SIFIR.
enum LocalRouteVideo {
    struct Pt { let coord: CLLocationCoordinate2D; let spd: Double }

    // Render seçenekleri — bulut motoruyla aynı kullanıcı tercihlerini taşır.
    struct Opts {
        var mode = "flyover"          // flat | flyover | 3d
        var aspect = "16:9"
        var premium = true            // true = 1080p (video üretimi zaten Premium kapılı)
        var line = "#00E5FF"          // hex | "none" (çizgisiz) | "glass"/"clear" (buzlu beyaz)
        var dot = "#FF3B30"           // hex
        var camdist = "orta"          // yakin | orta | uzak
        var musicURL: URL? = nil      // önceden indirilmiş yerel m4a (Store.musicFile)
    }

    static func render(points raw: [Pt], opts: Opts = Opts(),
                       onProgress: @escaping (Double) -> Void) async -> URL? {
        guard raw.count >= 3 else { return nil }
        let vertical = (opts.aspect == "9:16")
        // 1080p: modern iPhone GPU'su kaldırıyor; 60 sn'lik video ~1-3 dk'da çıkıyor.
        let size: CGSize = opts.premium
            ? CGSize(width: vertical ? 1080 : 1920, height: vertical ? 1920 : 1080)
            : CGSize(width: vertical ? 720 : 1280, height: vertical ? 1280 : 720)
        let fps: Int32 = 30
        let pts = densify(raw)
        let km = routeKm(pts)
        // MESAFE TABANLI İLERLEME (Barış 2026-08-26 "nokta zıplıyor" fiksi): nokta indeksiyle değil,
        // rota üzerindeki METRE ile ilerlenir -> aralıklar eşit olmasa da nokta/kamera SABİT hızda kayar.
        var cum: [Double] = [0]
        cum.reserveCapacity(pts.count)
        for i in 1..<pts.count {
            cum.append(cum[i - 1] + CLLocation(latitude: pts[i - 1].coord.latitude, longitude: pts[i - 1].coord.longitude)
                .distance(from: CLLocation(latitude: pts[i].coord.latitude, longitude: pts[i].coord.longitude)))
        }
        let totM = max(1.0, cum[pts.count - 1])
        // tempo: kullanıcı "Kısa/Normal/Uzun" seçimiyle km başına saniye (bulut pacing'ine yakın)
        let sPerKm: Double = 4.2
        let dur = max(10.0, min(60.0, km * sPerKm))
        let frames = max(90, Int(dur * Double(fps)))
        // rota üzerindeki hedef metreye karşılık (koordinat, hız, alt-indeks) — ark uzunluğu enterpolasyonu
        func konum(_ m: Double) -> (CLLocationCoordinate2D, Double, Int) {
            let h = min(max(0, m), totM)
            var lo = 0, hi = pts.count - 1
            while lo + 1 < hi { let mid = (lo + hi) / 2; if cum[mid] <= h { lo = mid } else { hi = mid } }
            let seg = max(1e-6, cum[hi] - cum[lo]); let t = (h - cum[lo]) / seg
            let a = pts[lo], b = pts[hi]
            return (CLLocationCoordinate2D(latitude: a.coord.latitude + (b.coord.latitude - a.coord.latitude) * t,
                                           longitude: a.coord.longitude + (b.coord.longitude - a.coord.longitude) * t),
                    a.spd + (b.spd - a.spd) * t, lo)
        }

        // Mod -> kamera karakteri. 3B = Apple foto-gerçekçi binalar (yakın + dik pitch),
        // flyover = klasik eğik uçuş, flat = tepeden düz (bulut "Düz" ile aynı his).
        let distMul: Double = opts.camdist == "yakin" ? 0.62 : (opts.camdist == "uzak" ? 1.6 : 1.0)
        let pitch: CGFloat
        let baseDist: Double
        switch opts.mode {
        case "flat":    pitch = 0;  baseDist = 1050
        case "3d":      pitch = 66; baseDist = 520
        default:        pitch = 55; baseDist = 720
        }
        let camDist = baseDist * distMul

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("route_\(Int(Date().timeIntervalSince1970)).mp4")
        try? FileManager.default.removeItem(at: url)
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return nil }
        let vset: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264,
                                   AVVideoWidthKey: size.width, AVVideoHeightKey: size.height]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: vset)
        input.expectsMediaDataInRealTime = false
        let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                                    kCVPixelBufferWidthKey as String: Int(size.width),
                                    kCVPixelBufferHeightKey as String: Int(size.height)]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
        guard writer.canAdd(input) else { return nil }
        writer.add(input)
        guard writer.startWriting() else { return nil }
        writer.startSession(atSourceTime: .zero)

        let lineColor = color(opts.line, fallback: UIColor(red: 0, green: 0.9, blue: 1, alpha: 1))
        let dotColor = color(opts.dot, fallback: UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1))

        var camLat = pts[0].coord.latitude, camLon = pts[0].coord.longitude
        var camHead = bearing(pts[0].coord, pts[min(pts.count - 1, 3)].coord)
        var headVel = 0.0                                 // yumuşatılmış dönüş hızı (derece/kare)
        // ═══ ÇAPA + ARA KARE MİMARİSİ (Barış 2026-08-26 "hafif zıp zıp, %100 yumuşak olsun") ═══
        // Apple'ın flyover üreticisi kamerayı KÜÇÜK ADIMLARLA kilitliyor (ölçüm: karelerin yarısı
        // donuk, sonra tek hamlede yetişme = zıp). Çare: her karede Apple'a sormak yerine 8 karede
        // BİR geniş "çapa" görüntüsü al; aradaki 7 kareyi çapayı KENDİMİZ kaydırıp döndürerek üret.
        // Akış tamamen bizim matematiğimizde -> kuantalama yok, %100 pürüzsüz. (Bonus: 8x az
        // snapshot = daha hızlı üretim + Apple frenine takılmama.)
        let CAPA_ARALIK = 6
        let capaOran: CGFloat = 1.30                      // kaydırma/dönme payı için geniş çapa
        // MKMapSnapshotter büyük boyutu ANINDA reddediyor (2784px denendi, nil döndü) ->
        // çapa DÜNYA kapsamı 1.30x kalır ama PİKSEL boyutu 2000'e sınırlanır; çizimde ölçeklenir.
        let hamCapa = CGSize(width: size.width * capaOran, height: size.height * capaOran)
        let pikselSinir: CGFloat = 2000
        let kucultme = min(1, pikselSinir / max(hamCapa.width, hamCapa.height))
        let capaBoy = CGSize(width: (hamCapa.width * kucultme).rounded(),
                             height: (hamCapa.height * kucultme).rounded())
        let olcek = 1.0 / kucultme                        // çapa pikseli -> çıktı pikseli büyütme
        var capa: MKMapSnapshotter.Snapshot?
        var pxPerMHedef: CGFloat = 0      // TÜM videoya tek ölçek kilidi (ilk karede ölçülür)
        for f in 0..<frames {
            let prog = Double(f) / Double(max(1, frames - 1))
            let hedefM = prog * totM
            let (c, spdNow, idx) = konum(hedefM)
            let (ileri, _, _) = konum(hedefM + 90)          // 90m ilerisi -> yön (gürültüsüz)
            let tHead = bearing(c, ileri)
            camLat += (c.latitude - camLat) * 0.25         // sıkı takip: nokta ekran merkezine mıhlı kalır
            camLon += (c.longitude - camLon) * 0.25
            // dönüş: hız da yumuşatılır (ivmeli başlar/durur), kare başı en çok 0.9° — savrulma yok
            headVel += (angDiff(tHead, camHead) * 0.08 - headVel) * 0.2
            camHead += min(0.9, max(-0.9, headVel))
            // Düz mod kuzeye sabit (bulut "Düz" gibi); diğerleri rotayı takip eder.
            let head = opts.mode == "flat" ? 0
                : (camHead.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)

            if f % CAPA_ARALIK == 0 || capa == nil {
                let opt = MKMapSnapshotter.Options()
                opt.camera = MKMapCamera(lookingAtCenter: CLLocationCoordinate2D(latitude: camLat, longitude: camLon),
                                         fromDistance: camDist, pitch: pitch, heading: head)
                opt.size = capaBoy
                // satelliteFlyover: ETİKETSİZ uydu (sokak yazıları her karede yeniden dizilip titriyordu).
                opt.mapType = .satelliteFlyover
                opt.pointOfInterestFilter = .excludingAll
                var yeni = await snapshot(opt)
                if yeni == nil { yeni = await snapshot(opt) }
                if let s = yeni { capa = s }                   // gelmezse eski çapa sürer (dönüşüm telafi eder)
            }
            guard let snap = capa else { continue }
            // ═══ DÜNYA-PROBLU KİLİT (Barış "zoom in zoom in" fiksi) ═══
            // Ölçek/dönüş TAHMİN EDİLMEZ, her karede ÖLÇÜLÜR: kamera merkezinin 25m önü ve arkası
            // çapaya sorulur; piksel/metre + yön o vektörden çıkar. Tüm video İLK karede ölçülen
            // TEK ölçeğe kilitlenir -> perspektif kayması, Apple'ın irtifa/zoom kuantalaması,
            // çapa değişimi... hiçbiri ölçeği OYNATAMAZ (pompalama biter).
            let merkez = CLLocationCoordinate2D(latitude: camLat, longitude: camLon)
            let merkezPx = snap.point(for: merkez)
            let hRad = head * .pi / 180
            func kaydir(_ m: Double) -> CLLocationCoordinate2D {
                CLLocationCoordinate2D(latitude: camLat + m * cos(hRad) / 111320,
                                       longitude: camLon + m * sin(hRad) / (111320 * cos(camLat * .pi / 180)))
            }
            let pGeri = snap.point(for: kaydir(-25)), pIleri = snap.point(for: kaydir(25))
            let vx = pIleri.x - pGeri.x, vy = pIleri.y - pGeri.y
            let capaPxPerM = max(0.01, (vx * vx + vy * vy).squareRoot() / 50)
            if pxPerMHedef == 0 { pxPerMHedef = capaPxPerM }          // ölçek kilidi (ilk kare)
            let olcekF = pxPerMHedef / capaPxPerM
            // yön: ileri-vektör çıktıda tam YUKARI baksın (ekran y aşağı) -> gereken dönüş
            let donusRad = -(atan2(vy, vx) + .pi / 2)

            let img = compose(snap: snap, pts: pts, idx: idx, size: size,
                              spd: spdNow, cumKm: hedefM / 1000, uc: c,
                              cam: CLLocationCoordinate2D(latitude: camLat, longitude: camLon),
                              camHeading: head, pitched: pitch > 0,
                              merkezPx: merkezPx, donusRad: donusRad, capaBoy: capaBoy, olcek: olcek * olcekF,
                              line: opts.line == "none" ? nil : lineColor,
                              glass: opts.line == "glass" || opts.line == "clear",
                              dot: dotColor)
            if let pb = pixelBuffer(from: img, size: size, pool: adaptor.pixelBufferPool) {
                while !input.isReadyForMoreMediaData { try? await Task.sleep(nanoseconds: 8_000_000) }
                adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: fps))
            }
            onProgress(Double(f) / Double(frames))
        }
        input.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        guard writer.status == .completed else { return nil }
        // Müzik seçildiyse cihazda mikse — bulut stitcher'ın yaptığı işin yereli.
        if let m = opts.musicURL, let muxed = await muxMusic(video: url, music: m) { return muxed }
        return url
    }

    // MARK: - müzik miksi (video pas geçilir, yeniden kodlama yok -> hızlı)
    private static func muxMusic(video: URL, music: URL) async -> URL? {
        let vAsset = AVURLAsset(url: video), mAsset = AVURLAsset(url: music)
        guard let vTrack = try? await vAsset.loadTracks(withMediaType: .video).first,
              let mTrack = try? await mAsset.loadTracks(withMediaType: .audio).first,
              let vDur = try? await vAsset.load(.duration),
              let mDur = try? await mAsset.load(.duration) else { return nil }
        let comp = AVMutableComposition()
        guard let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
              (try? cv.insertTimeRange(CMTimeRange(start: .zero, duration: vDur), of: vTrack, at: .zero)) != nil
        else { return nil }
        // Müzik videodan kısaysa başa sarıp doldur; uzunsa video süresinde kes.
        var at = CMTime.zero
        while at < vDur {
            let kalan = CMTimeSubtract(vDur, at)
            let parca = CMTimeCompare(mDur, kalan) < 0 ? mDur : kalan
            guard (try? ca.insertTimeRange(CMTimeRange(start: .zero, duration: parca), of: mTrack, at: at)) != nil else { break }
            at = CMTimeAdd(at, parca)
            if CMTimeCompare(parca, mDur) < 0 { break }
        }
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("route_m_\(Int(Date().timeIntervalSince1970)).mp4")
        try? FileManager.default.removeItem(at: out)
        guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else { return nil }
        ex.outputURL = out; ex.outputFileType = .mp4
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            ex.exportAsynchronously { c.resume() }
        }
        if ex.status == .completed { try? FileManager.default.removeItem(at: video); return out }
        return video   // miks olmadıysa sessiz videoyu geri ver (video kaybolmasın)
    }

    // MARK: - hex -> UIColor
    private static func color(_ hex: String, fallback: UIColor) -> UIColor {
        var h = hex.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("#") else { return fallback }
        h.removeFirst()
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return fallback }
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255,
                       green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    // MARK: - snapshot (async sarmalayıcı)
    private static func snapshot(_ opt: MKMapSnapshotter.Options) async -> MKMapSnapshotter.Snapshot? {
        await withCheckedContinuation { cont in
            MKMapSnapshotter(options: opt).start(with: .global(qos: .userInitiated)) { snap, _ in
                cont.resume(returning: snap)
            }
        }
    }

    // MARK: - kareyi bindirme ile çiz (çapa görüntüsü + ara-kare dönüşümü)
    private static func compose(snap: MKMapSnapshotter.Snapshot, pts: [Pt], idx: Int,
                                size: CGSize, spd: Double, cumKm: Double, uc: CLLocationCoordinate2D,
                                cam: CLLocationCoordinate2D, camHeading: Double, pitched: Bool,
                                merkezPx: CGPoint, donusRad: CGFloat, capaBoy: CGSize, olcek: CGFloat,
                                line: UIColor?, glass: Bool, dot: UIColor) -> UIImage {
        let r = UIGraphicsImageRenderer(size: size)
        let camLoc = CLLocation(latitude: cam.latitude, longitude: cam.longitude)
        // çapa pikseli -> çıktı pikseli: şu anki kamera merkezi çıktının ORTASINA gelir,
        // çapadan bu yana dönüş farkı kadar döndürülür — arka plan ve bindirme AYNI dönüşümle akar.
        let outC = CGPoint(x: size.width / 2, y: size.height / 2)
        let cosD = cos(-donusRad), sinD = sin(-donusRad)
        func proj(_ p: CGPoint) -> CGPoint {
            let dx = (p.x - merkezPx.x) * olcek, dy = (p.y - merkezPx.y) * olcek
            return CGPoint(x: outC.x + dx * cosD - dy * sinD,
                           y: outC.y + dx * sinD + dy * cosD)
        }
        return r.image { ctx in
            let g = ctx.cgContext
            // çapa görüntüsünü dönüşümle bas (arka plan her karede matematiksel olarak kayar/döner)
            g.saveGState()
            g.interpolationQuality = .high
            g.translateBy(x: outC.x, y: outC.y)
            g.rotate(by: -donusRad)
            g.scaleBy(x: olcek, y: olcek)
            g.translateBy(x: -merkezPx.x, y: -merkezPx.y)
            snap.image.draw(in: CGRect(origin: .zero, size: capaBoy))
            g.restoreGState()
            // ilerleyen rota çizgisi: köşelere ek olarak UCU tam enterpolasyon noktasına çizilir
            // -> çizgi ucu ve nokta kare kare KAYAR, köşeden köşeye zıplamaz.
            // KİRİŞ FİKSİ: veri boşluğunda (>80m) kalem kaldırılır, düz kiriş çizilmez.
            // HAYALET FİKSİ (Barış 2026-08-26 "çizgi tek seferde oluşuyor"): kameradan >1.5km uzak
            // köşeler ÇİZİLMEZ — eğik perspektifte kamera arkasındaki noktalar aynalanıp ekranın
            // içine düşüyor, ekran boyu sahte düz çizgiler doğuruyordu (bulut motoru bunları kırpar,
            // MKMapSnapshotter.point(for:) kırpmaz). 1.5km ötesi bu zoom'da zaten görünmez.
            if line != nil || glass {
                g.setLineCap(.round); g.setLineJoin(.round)
                let path = UIBezierPath()
                var started = false
                var onceki: CLLocationCoordinate2D?
                for i in 0...idx {
                    let c = pts[i].coord
                    let cl = CLLocation(latitude: c.latitude, longitude: c.longitude)
                    let uzak = camLoc.distance(from: cl)
                    if uzak > 1500 { onceki = nil; continue }
                    // ARKA-KAMERA AYNASI: eğik perspektifte kameranın arkasındaki noktalar ekrana
                    // AYNALANIP sahte paralel çizgi doğuruyor (az önce geçilen yol!). Kameranın
                    // arkasında (>100° açı farkı) ve >150m uzaktaki köşeler çizilmez.
                    if pitched, uzak > 150,
                       abs(angDiff(bearing(cam, c), camHeading)) > 100 { onceki = nil; continue }
                    let p = snap.point(for: c)
                    let kopuk = onceki.map {
                        CLLocation(latitude: $0.latitude, longitude: $0.longitude).distance(from: cl) > 80
                    } ?? true
                    let q = proj(p)
                    if !started || kopuk { path.move(to: q); started = true } else { path.addLine(to: q) }
                    onceki = c
                }
                if started, let son = onceki,
                   CLLocation(latitude: son.latitude, longitude: son.longitude)
                       .distance(from: CLLocation(latitude: uc.latitude, longitude: uc.longitude)) <= 80 {
                    path.addLine(to: proj(snap.point(for: uc)))
                }
                let w = size.width / 240                       // çözünürlükle ölçekli kalınlık
                if glass {
                    UIColor.white.withAlphaComponent(0.45).setStroke(); path.lineWidth = w * 2.0; path.stroke()
                } else {
                    UIColor.black.withAlphaComponent(0.55).setStroke(); path.lineWidth = w * 1.8; path.stroke()
                    line!.setStroke(); path.lineWidth = w; path.stroke()
                }
            }
            // konum işareti — tam enterpolasyon noktasında (kayarak ilerler)
            let mp = proj(snap.point(for: uc))
            let dr = size.width / 96
            let dotRect = CGRect(x: mp.x - dr, y: mp.y - dr, width: dr * 2, height: dr * 2)
            g.setShadow(offset: .zero, blur: 6, color: UIColor.black.withAlphaComponent(0.6).cgColor)
            UIColor.white.setFill(); g.fillEllipse(in: dotRect)
            g.setShadow(offset: .zero, blur: 0, color: nil)
            dot.setFill()
            g.fillEllipse(in: dotRect.insetBy(dx: dr * 0.46, dy: dr * 0.46))
            // stat şeridi
            let bar = "⚡ \(Int(spd)) km/s   ▸ \(String(format: "%.1f", cumKm)) km"
            let attr: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: size.width * 0.030, weight: .bold),
                .foregroundColor: UIColor.white,
                .strokeColor: UIColor.black, .strokeWidth: -3.0]
            bar.draw(at: CGPoint(x: 28, y: size.height - size.width * 0.030 - 34), withAttributes: attr)
        }
    }

    // MARK: - UIImage -> CVPixelBuffer
    private static func pixelBuffer(from img: UIImage, size: CGSize, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
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

    // MARK: - yardımcılar
    private static func densify(_ p: [Pt]) -> [Pt] {
        var out: [Pt] = []
        for i in 0..<p.count {
            out.append(p[i])
            if i < p.count - 1 {
                let a = p[i].coord, b = p[i + 1].coord
                let d = CLLocation(latitude: a.latitude, longitude: a.longitude)
                    .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
                // >80m = veri boşluğu: ARA NOKTA DOLDURMA — boşluk korunur ki çizim kalemi kaldırsın
                // (doldurulursa kiriş 25m'lik parçalara bölünüp çatıların üstünden çiziliyordu).
                let n = d > 80 ? 0 : min(8, Int(d / 25))
                if n > 1 {
                    for k in 1..<n {
                        let t = Double(k) / Double(n)
                        out.append(Pt(coord: CLLocationCoordinate2D(latitude: a.latitude + (b.latitude - a.latitude) * t,
                                                                    longitude: a.longitude + (b.longitude - a.longitude) * t),
                                      spd: p[i].spd + (p[i + 1].spd - p[i].spd) * t))
                    }
                }
            }
        }
        return out
    }
    private static func routeKm(_ p: [Pt]) -> Double { cumKm(p, upTo: p.count - 1) }
    private static func cumKm(_ p: [Pt], upTo idx: Int) -> Double {
        var m = 0.0
        for i in 1...max(1, idx) where i < p.count {
            m += CLLocation(latitude: p[i - 1].coord.latitude, longitude: p[i - 1].coord.longitude)
                .distance(from: CLLocation(latitude: p[i].coord.latitude, longitude: p[i].coord.longitude))
        }
        return m / 1000
    }
    private static func bearing(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let la1 = a.latitude * .pi / 180, la2 = b.latitude * .pi / 180
        let dl = (b.longitude - a.longitude) * .pi / 180
        let y = sin(dl) * cos(la2)
        let x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dl)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }
    private static func angDiff(_ t: Double, _ c: Double) -> Double {
        var d = (t - c).truncatingRemainder(dividingBy: 360)
        if d > 180 { d -= 360 }; if d < -180 { d += 360 }
        return d
    }
}
