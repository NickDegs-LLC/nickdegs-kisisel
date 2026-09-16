import XCTest

// MAGAZA EKRAN GORUNTULERI (16.09): launch argumanlari simctl ile uygulamaya ULASMIYOR;
// XCUIApplication.launchArguments ise garanti ulasir (depodaki VideoShots/PromoCapture ayni kalibi kullanir).
// Ingilizce, izin penceresi YOK (DEMO modunda bildirim+konum izni hic istenmez), satin alma ekrani YOK.
final class StoreShots: XCTestCase {
    func testMagazaKareleri() {
        let app = XCUIApplication()
        app.launchArguments = ["DEMO", "LANG=en", "SCREEN=rides",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-nd_qa_demo", "YES", "-nd_premium", "NO", "-nd_ultra", "NO"]
        app.launch()
        sleep(6)

        func kare(_ ad: String) {
            let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            s.name = ad; s.lifetime = .keepAlways; add(s)
        }
        // Once acilis karesi (gate gecti mi gorelim)
        kare("00-acilis")

        let tabs = app.tabBars.firstMatch
        if tabs.waitForExistence(timeout: 10) {
            let n = tabs.buttons.count
            kare("01-sekme-sayisi-\(n)")
            let adlar = ["Routes", "My Videos", "Summary", "Radio", "Profile"]
            for (i, ad) in adlar.enumerated() where i < n {
                let b = tabs.buttons.element(boundBy: i)
                if b.exists { b.tap(); sleep(4); kare("1\(i)-\(ad.replacingOccurrences(of: " ", with: "-"))") }
            }
        } else {
            kare("99-sekme-cubugu-YOK")
        }
    }
}
