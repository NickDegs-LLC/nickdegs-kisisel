import XCTest

// App Store INCELEME GORSELLERI (video paketi urunleri) — yalniz QA, uygulamaya dahil degil.
// "Video olustur" ekranini ucretsiz kullanici gibi acar; video paketi satin alma paneli gorunur.
final class VideoShots: XCTestCase {
    func testVideoPaketGorselleri() {
        let app = XCUIApplication()
        let tok = ProcessInfo.processInfo.environment["ND_TOKEN"] ?? ""
        let frm = ProcessInfo.processInfo.environment["ND_FROM"] ?? "0"
        let to  = ProcessInfo.processInfo.environment["ND_TO"] ?? "0"
        // DEMO: giris ekranini atlar (AppEnv.demo -> gate .valid). Ucretsiz katman varsayilan.
        // INGILIZCE (App Review Ingilizce yapilir) + otomatik giris (ucretsiz test hesabi)
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "LANG=en",
                               "AUTOLOGIN=" + (ProcessInfo.processInfo.environment["ND_QA"] ?? ""),
                               "-nd_premium", "NO", "-nd_ultra", "NO",   // UCRETSIZ katman zorla
                               "-qaVideoSheet", frm, to]
        addUIInterruptionMonitor(withDescription: "izinler") { alert in
            for t in ["Allow", "İzin Ver", "OK", "Tamam"] {
                if alert.buttons[t].exists { alert.buttons[t].tap(); return true }
            }
            return false
        }
        app.launch()
        app.tap()   // kesintiyi tetikle

        Thread.sleep(forTimeInterval: 12)          // giris + sheet acilsin
        // video paketi paneli sayfanin ALTINDA -> kaydir
        for _ in 0..<6 { app.swipeUp(); Thread.sleep(forTimeInterval: 0.5) }
        Thread.sleep(forTimeInterval: 3)

        let s1 = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        s1.name = "QA-VIDEO-PANEL"; s1.lifetime = .keepAlways
        add(s1)

        // 5'li pakete dokun -> Apple satin alma penceresi
        let besli = app.buttons.containing(NSPredicate(format: "label CONTAINS[c] '5'")).firstMatch
        if besli.exists { besli.tap(); Thread.sleep(forTimeInterval: 5) }
        let s2 = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        s2.name = "QA-VIDEO-ONAY"; s2.lifetime = .keepAlways
        add(s2)
    }
}
