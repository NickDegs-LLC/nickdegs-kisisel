import StoreKit

// 10.11.2026: "Destek ol" bağış ekranı KALDIRILDI (Barış). Yalnız bu dinleyici kaldı: eski sürümlerden
// yarım kalmış bir bağış işlemi varsa (Ask to Buy / ağ kopması) StoreKit kuyruğunda asılı kalmasın, bitirilsin.
enum Destek {
    @MainActor private static var basladi = false
    @MainActor static func dinle() {
        guard !basladi else { return }
        basladi = true
        Task.detached {
            for await sonuc in Transaction.updates {
                if case .verified(let t) = sonuc { await t.finish() }
            }
        }
    }
}
