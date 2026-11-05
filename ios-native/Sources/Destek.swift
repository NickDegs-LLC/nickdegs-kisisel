import SwiftUI
import StoreKit

// 05.11.2026 — "Destek ol" bahşiş kavanozu. Üç TÜKETİLEBİLİR ürün; HİÇBİR özellik açmaz
// (App Store 3.1.1 bahşiş istisnası). Sunucuya bir şey yazılmaz, işlem yalnız bitirilir.
enum Destek {
    // 05.11.2026 (2. tur): Barış "komple ücretsiz + bağışları geri ekle". destek.* kimlikleri ASC'de
    // silindi (Apple silinen productId'yi yeniden kullandırmaz) → yeni kimlikler bagis.*
    static let urunler = ["com.nickdegs.kisisel.bagis.kucuk",
                          "com.nickdegs.kisisel.bagis.orta",
                          "com.nickdegs.kisisel.bagis.buyuk"]
    static let emoji = ["☕","🍔","🏍️"]

    /// Uygulama açılışında çağrılır: yarım kalmış (Ask to Buy, ağ kopması) işlemleri bitirir.
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

struct DestekSheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var urunler: [Product] = []
    @State private var yukleniyor = true
    @State private var meshgul: String? = nil
    @State private var tesekkur = false
    @State private var hata: String? = nil

    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(alignment: .leading, spacing: 14) {
                if tesekkur {
                    VStack(spacing: 12) {
                        Text("🧡").font(.system(size: 56))
                        Text(L("Çok teşekkürler!","Thank you so much!"))
                            .font(.title2.bold()).multilineTextAlignment(.center)
                        Text(L("Desteğin Move Log'un ücretsiz kalmasına yardım ediyor. İyi yolculuklar! 🏍️",
                               "Your support helps keep Move Log free. Ride safe! 🏍️"))
                            .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button(L("Kapat","Close")) { dismiss() }.buttonStyle(.glassy).padding(.top, 8)
                    }.frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    Text("☕ " + L("Destek ol","Support us")).font(.title2.bold())
                    Text(L("Move Log ücretsiz ve reklamsız. Beğendiysen küçük bir destekle geliştiriciye kahve ısmarlayabilirsin. Hiçbir özellik kilitli değil — tamamen isteğe bağlı.",
                           "Move Log is free and ad-free. If you enjoy it, you can buy the developer a coffee. Nothing is locked — it's completely optional."))
                        .font(.footnote).foregroundStyle(.secondary)
                    if yukleniyor {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 20)
                    } else if urunler.isEmpty && AppEnv.demo {
                        // Yalnız DEMO/ekran görüntüsü modu (simülatörde mağaza yok): gerçek satırların görünümü
                        ForEach(Array([("Small coffee","$0.99"),("Coffee & snack","$2.99"),("Fuel for the ride","$9.99")].enumerated()), id: \.offset) { i, u in
                            HStack(spacing: 12) {
                                Text(Destek.emoji[i]).font(.system(size: 26))
                                Text(u.0).font(.system(size: 16, weight: .semibold))
                                Spacer()
                                Text(u.1).font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.accent)
                            }.padding(14).glassPanel(18)
                        }
                    } else if urunler.isEmpty {
                        Text(L("Şu an mağazaya ulaşılamıyor, biraz sonra tekrar dene.",
                               "Can't reach the store right now, try again later."))
                            .font(.footnote).foregroundStyle(.secondary).padding(.top, 10)
                    } else {
                        ForEach(Array(urunler.enumerated()), id: \.element.id) { i, u in
                            Button { Task { await al(u) } } label: {
                                HStack(spacing: 12) {
                                    Text(Destek.emoji[min(i, 2)]).font(.system(size: 26))
                                    Text(u.displayName).font(.system(size: 16, weight: .semibold))
                                    Spacer()
                                    if meshgul == u.id { ProgressView() }
                                    else { Text(u.displayPrice).font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.accent) }
                                }.padding(14).contentShape(Rectangle())
                            }.buttonStyle(.plain).glassPanel(18).disabled(meshgul != nil)
                        }
                    }
                    if let h = hata { Text(h).font(.caption).foregroundStyle(.red) }
                    // 05.11.2026 (Apple inceleme): satın alma ekranında Gizlilik + Kullanım Şartları
                    HStack(spacing: 18) {
                        Link(L("Gizlilik Politikası","Privacy Policy"), destination: URL(string: "https://realvirtuality.app/movelog/privacy.html")!)
                        Link(L("Kullanım Şartları","Terms of Use"), destination: URL(string: "https://realvirtuality.app/movelog/terms.html")!)
                    }.font(.footnote).frame(maxWidth: .infinity).padding(.top, 6)
                    Spacer()
                }
            }.padding(20)
        }
        .presentationDetents([.medium, .large])
        .task {
            let p = (try? await Product.products(for: Destek.urunler)) ?? []
            urunler = p.sorted { $0.price < $1.price }
            yukleniyor = false
        }
    }

    private func al(_ u: Product) async {
        meshgul = u.id; hata = nil
        defer { meshgul = nil }
        do {
            switch try await u.purchase() {
            case .success(let s):
                if case .verified(let t) = s { await t.finish(); tesekkur = true }
                else { hata = L("Satın alma doğrulanamadı.","The purchase couldn't be verified.") }
            case .pending: hata = L("Onay bekleniyor.","Waiting for approval.")
            default: break
            }
        } catch {
            hata = L("Satın alma tamamlanamadı.","The purchase couldn't be completed.")
        }
    }
}
