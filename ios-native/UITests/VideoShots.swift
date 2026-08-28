import XCTest
import StoreKitTest

// App Store INCELEME GORSELLERI (video paketi urunleri) — yalniz QA, uygulamaya dahil degil.
// "Video olustur" ekranini ucretsiz kullanici gibi acar; video paketi satin alma paneli gorunur.
final class VideoShots: XCTestCase {
    func testVideoPaketGorselleri() throws {
        let session = try SKTestSession(configurationFileNamed: "Products")
        session.disableDialogs = true
        session.clearTransactions()

        let app = XCUIApplication()
        let tok = ProcessInfo.processInfo.environment["ND_TOKEN"] ?? ""
        let frm = ProcessInfo.processInfo.environment["ND_FROM"] ?? "0"
        let to  = ProcessInfo.processInfo.environment["ND_TO"] ?? "0"
        app.launchArguments = ["-nd_token", tok,
                               "-nd_premium", "NO",          // UCRETSIZ katman -> paket paneli gorunur
                               "-qaVideoSheet", frm, to]
        app.launch()

        // panel yuklenene kadar bekle (StoreKit urun fiyatlari gelsin)
        let panel = app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'video'")).firstMatch
        _ = panel.waitForExistence(timeout: 25)
        Thread.sleep(forTimeInterval: 4)

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
