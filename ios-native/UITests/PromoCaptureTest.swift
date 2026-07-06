import XCTest

// TANITIM ÇEKİMİ: simülatörde demo hesapla giriş yapıp sekmelerde yavaşça gezinir;
// dışarıda `simctl io recordVideo` ekranı kaydeder (promo-capture.yml). Her adım İSTEĞE BAĞLI
// (element yoksa atlar) — kısmi tur bile kullanılabilir görüntü üretir.
final class PromoCaptureTest: XCTestCase {
    func testPromoTour() throws {
        let app = XCUIApplication()
        // izin diyalogları (bildirim vs.) otomatik "İzin Ver/Allow"
        addUIInterruptionMonitor(withDescription: "perm") { alert in
            for t in ["İzin Ver", "Allow", "İzin Verme Sor", "OK", "Tamam"] {
                if alert.buttons[t].exists { alert.buttons[t].tap(); return true }
            }
            return false
        }
        app.launch()
        sleep(3); app.tap()   // interruption monitor tetiklensin

        // --- GİRİŞ (demo hesap) ---
        let phone = app.textFields["Telefon numarası"]
        if phone.waitForExistence(timeout: 8) {
            phone.tap(); phone.typeText("5000000000")
            let send = app.buttons["Kod gönder"]
            if send.waitForExistence(timeout: 3) { send.tap() }
            let code = app.textFields["6 haneli kod"]
            if code.waitForExistence(timeout: 8) {
                code.tap(); code.typeText("314159")
                let verify = app.buttons["Doğrula ve gir"]
                if verify.waitForExistence(timeout: 3) { verify.tap() }
            }
        }
        sleep(5); app.tap()

        func tab(_ name: String) {
            let b = app.tabBars.buttons[name]
            if b.waitForExistence(timeout: 6) { b.tap() }
            sleep(2)
        }
        // --- ROTALAR: yavaş kaydır ---
        tab("Rotalar"); sleep(2)
        app.swipeUp(velocity: .slow); sleep(2)
        app.swipeUp(velocity: .slow); sleep(2)
        app.swipeDown(velocity: .fast); sleep(1)

        // --- VIDEOLARIM: gezin ---
        tab("Videolarım"); sleep(3)
        app.swipeUp(velocity: .slow); sleep(3)
        app.swipeDown(velocity: .fast); sleep(1)

        // --- HARİTA (canlı konum + sohbet) ---
        tab("Harita"); sleep(5)
        let chat = app.buttons["Sohbet"]
        if chat.waitForExistence(timeout: 3) {
            chat.tap(); sleep(2)
            let first = app.cells.firstMatch
            if first.waitForExistence(timeout: 4) { first.tap(); sleep(3); app.swipeDown(); sleep(1) }
        }

        // --- ÖZET ---
        tab("Özet"); sleep(3)

        // --- PROFİL: altın Ultra kartı ---
        tab("Profil"); sleep(3)
        app.swipeUp(velocity: .slow); sleep(2)
        app.swipeDown(velocity: .fast); sleep(2)
    }
}
