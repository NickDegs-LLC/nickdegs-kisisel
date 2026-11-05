import SwiftUI
import StoreKit

// 05.11.2026 MOVE LOG PRO (Barış): TEK SEFERLİK satın alma, abonelik YOK, 9,99 $.
// Açtığı tek şey: ORTAK SÜRÜŞ videoları (arkadaş + kulüp). Bireysel her şey ücretsiz.
// Akış: StoreKit 2 satın al → imzalı işlem (JWS) sunucuya (/api/pro/apple; zincir Apple Root G3'e
// pinli doğrulanır) → users.pro=1 → cron ortak videoyu yalnız Pro sahibinin kuyruğuna yazar.
// İşlem SUNUCU ONAYLAYINCA bitirilir; onaylanamazsa açık kalır, Transaction.updates / açılış eşitlemesi yeniden dener.
enum Pro {
    static let urun = "com.nickdegs.kisisel.pro"
    @MainActor private static var basladi = false

    /// Açılışta bir kez: yarım kalan işlemleri dinle + mevcut hakkı sunucuyla eşitle.
    @MainActor static func baslat(_ store: Store) {
        guard !basladi else { return }
        basladi = true
        Task.detached {
            for await sonuc in Transaction.updates {
                guard case .verified(let t) = sonuc else { continue }
                if t.productID == urun {
                    if await store.proBildir(sonuc.jwsRepresentation) { await t.finish() }
                } else {
                    await t.finish()   // eski/bilinmeyen ürün (ör. kaldırılan bahşiş) — kuyrukta kalmasın
                }
            }
        }
        Task { await esitle(store) }
    }

    /// Cihazdaki Pro hakkını sunucuya bildirir (geri yükleme ve hesap değişikliği için).
    @discardableResult
    static func esitle(_ store: Store) async -> Bool {
        var bulundu = false
        for await sonuc in Transaction.currentEntitlements {
            guard case .verified(let t) = sonuc, t.productID == urun, t.revocationDate == nil else { continue }
            bulundu = true
            if await store.proBildir(sonuc.jwsRepresentation) { await t.finish() }
        }
        return bulundu
    }
}

struct ProSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var urun: Product? = nil
    @State private var yukleniyor = true
    @State private var meshgul = false
    @State private var hata: String? = nil

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 10) {
                        Text("🏍️🏍️").font(.system(size: 34))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Move Log Pro").font(.title.bold())
                            Text(L("Tek seferlik · abonelik yok","One-time · no subscription"))
                                .font(.subheadline).foregroundStyle(Brand.accent)
                        }
                    }.padding(.top, 8)

                    VStack(alignment: .leading, spacing: 12) {
                        ozellik("person.2.fill", L("Arkadaşlarınla ortak 3D sürüş videoları","Joint 3D ride videos with your friends"))
                        ozellik("person.3.fill", L("Kulüp üyeleriyle grup videoları","Group videos with your club members"))
                        ozellik("iphone", L("Hepsi telefonunda üretilir, bulut yok","All made on your phone, no cloud"))
                        ozellik("infinity", L("Bir kez al, hep senin","Buy once, yours forever"))
                    }.padding(16).glassPanel(18)

                    Text(L("Rota kaydı, kendi videoların, özetler ve paylaşım kartları herkese ücretsiz kalır.",
                           "Ride tracking, your own videos, summaries and share cards stay free for everyone."))
                        .font(.footnote).foregroundStyle(.secondary)

                    if store.pro {
                        Label(L("Pro aktif — teşekkürler! 🧡","Pro is active — thank you! 🧡"), systemImage: "checkmark.seal.fill")
                            .font(.headline).foregroundStyle(Brand.accent)
                            .frame(maxWidth: .infinity).padding(.vertical, 14).glassPanel(18)
                    } else if yukleniyor {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 10)
                    } else if let u = urun {
                        Button { Task { await al(u) } } label: {
                            HStack {
                                if meshgul { ProgressView().tint(.white) }
                                Text(L("Pro'yu al","Get Pro") + " · " + u.displayPrice).font(.headline)
                            }.frame(maxWidth: .infinity).padding(.vertical, 6)
                        }.buttonStyle(.glassy).tint(Brand.accent).disabled(meshgul)
                    } else if AppEnv.demo {
                        // Yalnız DEMO/ekran görüntüsü (simülatörde mağaza yok): gerçek düğmenin görünümü
                        Text(L("Pro'yu al","Get Pro") + " · $9.99").font(.headline)
                            .frame(maxWidth: .infinity).padding(.vertical, 14).glassPanel(18)
                    } else {
                        Text(L("Şu an mağazaya ulaşılamıyor, biraz sonra tekrar dene.",
                               "Can't reach the store right now, try again later."))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let h = hata { Text(h).font(.caption).foregroundStyle(.red) }

                    if !store.pro {
                        Button(L("Satın alımları geri yükle","Restore purchases")) { Task { await geriYukle() } }
                            .font(.footnote.weight(.semibold)).frame(maxWidth: .infinity).disabled(meshgul)
                    }
                    Button(L("Kapat","Close")) { dismiss() }
                        .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 4)
                }.padding(20)
            }
        }
        .presentationDetents([.large])
        .task {
            urun = (try? await Product.products(for: [Pro.urun]))?.first
            yukleniyor = false
        }
    }

    private func ozellik(_ ikon: String, _ metin: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: ikon).foregroundStyle(Brand.accent).frame(width: 26)
            Text(metin).font(.system(size: 15, weight: .medium))
        }
    }

    private func al(_ u: Product) async {
        meshgul = true; hata = nil
        defer { meshgul = false }
        do {
            switch try await u.purchase() {
            case .success(let s):
                guard case .verified(let t) = s else { hata = L("Satın alma doğrulanamadı.","The purchase couldn't be verified."); return }
                if await store.proBildir(s.jwsRepresentation) { await t.finish() }
                else { hata = L("Satın alma alındı ama sunucuya ulaşılamadı; uygulama yeniden açılınca otomatik tamamlanır.",
                                "Purchase received but the server couldn't be reached; it completes automatically next time you open the app.") }
            case .pending: hata = L("Onay bekleniyor.","Waiting for approval.")
            default: break
            }
        } catch {
            hata = L("Satın alma tamamlanamadı.","The purchase couldn't be completed.")
        }
    }

    private func geriYukle() async {
        meshgul = true; hata = nil
        defer { meshgul = false }
        try? await AppStore.sync()
        if !(await Pro.esitle(store)) {
            hata = L("Bu Apple hesabında Pro satın alımı bulunamadı.","No Pro purchase found on this Apple account.")
        }
    }
}
