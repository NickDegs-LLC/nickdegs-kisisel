import StoreKit
import UIKit

// Gerçek StoreKit 2 — premium abonelik (aylık / yıllık otomatik yenilenen)
// iPad / "Designed for iPhone" race düzeltmesi: satın alma sonrası premium'u
// doğrulanmış transaction'dan DİREKT açarız; currentEntitlements cache'ini
// (iPad'de geç dolar) BEKLEMEYİZ. refresh() yalnızca ek güvence / restore.
@MainActor final class IAP: ObservableObject {
    static let monthlyID = "com.nickdegs.kisisel.premium.monthly"
    static let yearlyID = "com.nickdegs.kisisel.premium.yearly"
    static let ultraMonthlyID = "com.nickdegs.kisisel.ultra.monthly"   // ULTRA: Google 3D + kamera modları + Street View
    static let ultraYearlyID = "com.nickdegs.kisisel.ultra.yearly"
    static let boostID = "com.nickdegs.kisisel.boost.daily2x"   // consumable: o gün limitleri 2x
    static var ultraIDs: [String] { [ultraMonthlyID, ultraYearlyID] }
    static var ids: [String] { [monthlyID, yearlyID, ultraMonthlyID, ultraYearlyID] }   // TÜM abonelikler premium/purchased sağlar
    static var allIDs: [String] { ids + [boostID] }

    @Published var monthly: Product?
    @Published var yearly: Product?
    @Published var ultraMonthly: Product?
    @Published var ultraYearly: Product?
    @Published var boost: Product?
    @Published var purchased = UserDefaults.standard.bool(forKey: "nd_premium")
    @Published var ultra = UserDefaults.standard.bool(forKey: "nd_ultra")   // Ultra katman (Google 3D + kameralar + Street View)
    @Published var working = false
    @Published var boostWorking = false
    @Published var lastError: String?      // satın alma hatasını arayüze göster
    @Published var boostMsg: String?       // boost satın alma sonucu (arayüze)
    @Published var loadMsg: String?        // ürün yükleme durumu
    private var updates: Task<Void, Never>?

    init() {
        updates = listenForTransactions()
        Task {
            await load()
            // Uçuş sonrası / Ask to Buy / Family Sharing: bitmemiş işlemleri yakala
            for await result in Transaction.unfinished {
                if case .verified(let t) = result {
                    apply(t, jws: result.jwsRepresentation)
                    await t.finish()
                }
            }
            await refresh()
        }
    }
    deinit { updates?.cancel() }

    // Doğrulanmış transaction'dan premium'u HEMEN aç (cache bekleme) + backend'e bildir.
    // jws = VerificationResult.jwsRepresentation (Transaction'da yok, sonuç sarmalayıcısında).
    private func apply(_ t: Transaction, jws: String) {
        if Self.ids.contains(t.productID), t.revocationDate == nil {
            setPurchased(true)
            if Self.ultraIDs.contains(t.productID) { setUltra(true) }   // ultra abonelik -> ultra + premium
            Task { await Self.report(jws) }   // backend premium/ultra (sunucu render kilidi açılır)
        }
    }

    func load() async {
        do {
            let prods = try await Product.products(for: Self.allIDs)
            monthly = prods.first { $0.id == Self.monthlyID }
            yearly = prods.first { $0.id == Self.yearlyID }
            ultraMonthly = prods.first { $0.id == Self.ultraMonthlyID }
            ultraYearly = prods.first { $0.id == Self.ultraYearlyID }
            boost = prods.first { $0.id == Self.boostID }
            loadMsg = prods.isEmpty
                ? "Ürünler mağazadan gelmedi. App Store Connect → Business → Paid Apps anlaşması + banka/vergi tamamlanmalı (birkaç saat sürebilir)."
                : nil
        } catch {
            loadMsg = "Ürünler yüklenemedi: \(error.localizedDescription)"
        }
    }

    // Satın almayı backend'e bildir (StoreKit2 jwsRepresentation). Abonelik->premium, boost->günlük 2x.
    static func report(_ jws: String) async {
        guard let url = URL(string: API + "/api/iap/verify") else { return }
        let token = UserDefaults.standard.string(forKey: "nd_token") ?? ""
        var r = URLRequest(url: url); r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["jws": jws])
        _ = try? await URLSession.shared.data(for: r)
    }

    // BOOST satın al (consumable): o gün limitleri 2x. Her alım +1 kat (üst üste alınabilir).
    @discardableResult
    func buyBoost() async -> Bool {
        guard let product = boost else { boostMsg = "Boost ürünü yüklenmedi."; return false }
        boostWorking = true; boostMsg = nil; defer { boostWorking = false }
        do {
            switch try await product.purchase() {
            case .success(let v):
                if case .verified(let t) = v {
                    await Self.report(v.jwsRepresentation)   // backend o günün limitini 2x yapar
                    await t.finish()
                    boostMsg = "Bugünkü limitin 2 katına çıktı 🚀"
                    return true
                }
                boostMsg = "Satın alma doğrulanamadı."; return false
            case .pending: boostMsg = "Onay bekleniyor."; return false
            case .userCancelled: return false
            @unknown default: boostMsg = "Bilinmeyen durum."; return false
            }
        } catch {
            boostMsg = "Boost hatası: \(error.localizedDescription)"; return false
        }
    }

    // Sahiplik/expiry tespiti (launch + restore). Yalnızca YÜKSELTİR ya da
    // gerçekten hiç entitlement yoksa düşürür; taze satın almayı ezmez.
    func refresh() async {
        var owned = false, ultraOwned = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, Self.ids.contains(t.productID), t.revocationDate == nil {
                owned = true
                if Self.ultraIDs.contains(t.productID) { ultraOwned = true }
            }
        }
        setPurchased(owned); setUltra(ultraOwned)
    }

    @discardableResult
    func buy(_ product: Product) async -> Bool {
        working = true; lastError = nil; defer { working = false }
        do {
            switch try await product.purchase() {
            case .success(let v):
                if case .verified(let t) = v {
                    apply(t, jws: v.jwsRepresentation)   // ← premium'u HEMEN aç + backend'e bildir
                    await t.finish()
                    return purchased
                }
                lastError = "Satın alma doğrulanamadı."; return false
            case .pending:
                lastError = "Onay bekleniyor (Aile Onayı / ödeme yöntemi)."; return false
            case .userCancelled:
                return false   // sessiz iptal
            @unknown default:
                lastError = "Bilinmeyen durum."; return false
            }
        } catch {
            lastError = "Satın alma hatası: \(error.localizedDescription)"
            return false
        }
    }

    func restore() async {
        try? await AppStore.sync()
        await refresh()
    }

    /// APPLE RESMİ KOD EKRANI (2026-08-26): App Store Connect'te tanımlı Teklif Kodu (offer code)
    /// veya Promosyon Kodu bu sistem ekranıyla kullanılır. Apple'ın kendi API'si — App Review
    /// açısından tamamen kurallara uygun; abonelik GERÇEK abonelik olarak başlar.
    func redeemOfferCode() async {
        guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
                ?? UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        do {
            try await AppStore.presentOfferCodeRedeemSheet(in: scene)
            // Kullanıcı kodu girdiyse işlem Transaction.updates'ten düşer; yine de tazele.
            try? await Task.sleep(for: .seconds(1.5))
            await refresh()
        } catch {
            lastError = L("Kod ekranı açılamadı.", "Couldn't open the redeem sheet.")
        }
    }

    private func setPurchased(_ v: Bool) {
        let gift = UserDefaults.standard.bool(forKey: "nd_gift")   // hediye kodu kalıcı
        purchased = v || gift
        UserDefaults.standard.set(v || gift, forKey: "nd_premium")
    }

    private func setUltra(_ v: Bool) {
        let gift = UserDefaults.standard.bool(forKey: "nd_gift_ultra")
        ultra = v || gift
        UserDefaults.standard.set(v || gift, forKey: "nd_ultra")
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let t) = update {
                    self?.apply(t, jws: update.jwsRepresentation)   // ← cache'e güvenme, direkt aç
                    await t.finish()
                }
            }
        }
    }
}
