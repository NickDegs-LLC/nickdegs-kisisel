import SwiftUI
import StoreKit

// 10.11.2026 MOVE LOG TAM SÜRÜM (Barış): "İlk 3 sürüş, video, her şey açık. 3.'den sonrası ücretli.
// Tek seferlik." 4,99 $, abonelik YOK. Barış: "Sen bir şey yazma, Apple'ın StoreKit'i yapsın" →
// satın alma, doğrulama, hak ve satın alma ekranı TAMAMEN StoreKit'te. Sunucuya hiçbir şey gitmez.
//
// Kimler tam:
//   · ürünü alan (Transaction.currentEntitlements — StoreKit'in kendi imza doğrulaması)
//   · ESKİ KULLANICI: uygulamayı ücretli sürümden önce indiren (AppTransaction.originalAppVersion =
//     ilk indirilen derleme numarası; derlemeler UTC zaman damgası, ör. 20261105083000). Yalnız
//     üretim ortamında sayılır — sandbox/TestFlight/inceleme "1.0" döner, onlar ödeme ekranını görür.
//   · admin (sunucu profili) ve DEMO (ekran görüntüsü) modu
// Tam değilse: kullanıcının ilk 3 sürüşü (örnek içerik hariç, başlangıç saatine göre) her şeyiyle açık;
// 3. sürüşün BİTİŞİNDEN sonra başlayan sürüşler kilitli (video üretilmez). Konum kaydı sürer —
// satın alınca hepsi açılır ve bekleyen otomatik videolar üretilir.
@MainActor
final class TamSurum: ObservableObject {
    static let shared = TamSurum()
    static let urun = "com.nickdegs.kisisel.tamsurum"
    static let ucretsizSurus = 3
    /// Bu derlemeden ÖNCE indirilen uygulama = eski kullanıcı (ücretli ilk derleme bu andan sonra).
    static let kesimDerleme: Int64 = 20261110000000

    @Published private(set) var satinAlindi = UserDefaults.standard.bool(forKey: "nd_tam")
    @Published private(set) var eskiKullanici = UserDefaults.standard.bool(forKey: "nd_tam_eski")
    @Published var admin = false
    /// 3. ücretsiz sürüşün bitişi (epoch). nil = henüz 3 sürüş yok ya da bilinmiyor → kilit yok.
    @Published private(set) var sinir: Double? = nil
    @Published private(set) var surusSayisi = 0

    var tam: Bool { satinAlindi || eskiKullanici || admin || AppEnv.demo }
    /// En az bir sürüş kilitli mi (bant + profil metni için)
    var kilitVar: Bool { !tam && surusSayisi > Self.ucretsizSurus }
    /// Ücretsiz hakkı dolu mu (yeni GPX yükleme vb. için)
    var hakDoldu: Bool { !tam && surusSayisi >= Self.ucretsizSurus }

    private var basladi = false

    /// Açılışta bir kez: StoreKit güncellemelerini dinle + hakları yenile.
    func baslat() {
        guard !basladi else { return }
        basladi = true
        Task.detached {
            for await sonuc in Transaction.updates {
                if case .verified(let t) = sonuc { await t.finish() }   // eski bağış işlemleri dahil — kuyrukta kalmasın
                await TamSurum.shared.yenile()
            }
        }
        Task { await yenile() }
    }

    /// Hak durumunu StoreKit'ten yeniden oku.
    func yenile() async {
        var var_ = false
        for await sonuc in Transaction.currentEntitlements {
            if case .verified(let t) = sonuc, t.productID == Self.urun, t.revocationDate == nil { var_ = true }
        }
        satinAlindi = var_
        UserDefaults.standard.set(var_, forKey: "nd_tam")
        if !eskiKullanici, let sonuc = try? await AppTransaction.shared, case .verified(let a) = sonuc,
           a.environment == .production {
            let ilk = Int64(a.originalAppVersion.trimmingCharacters(in: .whitespaces)) ?? 0   // eski "1.0" biçimi → 0 → eski
            if ilk < Self.kesimDerleme {
                eskiKullanici = true                                   // bir kez eski, hep eski
                UserDefaults.standard.set(true, forKey: "nd_tam_eski")
            }
        }
    }

    /// Sürüş listesinden ücretsiz sınırı hesapla (Rotalar her yenilemede çağırır).
    func guncelle(_ rides: [Ride]) {
        var gorulen = Set<String>()
        var kendi: [(ts: Double, son: Double)] = []
        for r in rides where r.sample != true {
            guard let ts = r.ts, ts > 0 else { continue }
            if gorulen.insert("\(r.date)_\(Int(ts))").inserted { kendi.append((ts, max(r.to ?? ts, ts))) }
        }
        kendi.sort { $0.ts < $1.ts }
        surusSayisi = kendi.count
        sinir = kendi.count >= Self.ucretsizSurus ? kendi[Self.ucretsizSurus - 1].son : nil
    }

    /// Bu başlangıç zamanındaki sürüş kilitli mi?
    func kilitli(from: Double) -> Bool {
        guard !tam, let s = sinir else { return false }
        return from > s + 1
    }
}

/// Satın alma ekranı — ürün kartı ve satın alma akışı StoreKit'in kendi görünümü (ProductView).
struct TamSurumSheet: View {
    @ObservedObject private var tam = TamSurum.shared
    @Environment(\.dismiss) var dismiss
    @State private var geriYukleniyor = false
    @State private var bulunamadi = false

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 10) {
                        Text("🏍️").font(.system(size: 34))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Move Log Tam Sürüm","Move Log Full Version")).font(.title.bold())
                            Text(L("Tek seferlik · abonelik yok","One-time · no subscription"))
                                .font(.subheadline).foregroundStyle(Brand.accent)
                        }
                    }.padding(.top, 8)

                    Text(L("İlk 3 sürüşün tamamen ücretsiz. Sonrası için bir kez al, hep senin.",
                           "Your first 3 rides are completely free. After that, buy once and it's yours forever."))
                        .font(.footnote).foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 12) {
                        ozellik("infinity", L("Sınırsız sürüş ve rota videosu","Unlimited rides and route videos"))
                        ozellik("person.2.fill", L("Arkadaş ve kulüple ortak sürüş videoları","Joint ride videos with friends and clubs"))
                        ozellik("iphone", L("Hepsi telefonunda üretilir","Everything is made on your phone"))
                        ozellik("checkmark.seal.fill", L("Bir kez al, hep senin","Buy once, yours forever"))
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(16).glassPanel(18)

                    if tam.tam && !AppEnv.demo {
                        Label(tam.satinAlindi ? L("Tam sürüm aktif — teşekkürler! 🧡","Full version is active — thank you! 🧡")
                                              : L("Erken kullanıcısın — her şey sana ücretsiz 🧡","You're an early rider — everything is free for you 🧡"),
                              systemImage: "checkmark.seal.fill")
                            .font(.headline).foregroundStyle(Brand.accent)
                            .frame(maxWidth: .infinity).padding(.vertical, 14).glassPanel(18)
                    }
                    if !tam.satinAlindi {
                        if AppEnv.demo {
                            // Yalnız DEMO/ekran görüntüsü (simülatörde mağaza yok): StoreKit kartının görünümü
                            HStack(spacing: 12) {
                                Text("🏍️").font(.system(size: 30))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Tam Sürüm","Full Version")).font(.headline)
                                    Text(L("Sınırsız sürüş ve video, tek seferlik","Unlimited rides & videos, one-time"))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("$4.99").font(.headline).foregroundStyle(.white)
                                    .padding(.horizontal, 16).padding(.vertical, 8).background(Brand.gradient, in: Capsule())
                            }.padding(16).glassPanel(18)
                        } else {
                        // StoreKit'in hazır ürün kartı: fiyat, satın alma, onay sayfası, Ask to Buy — hepsi Apple'da.
                        ProductView(id: TamSurum.urun) {
                            Text("🏍️").font(.system(size: 30))
                        }
                        .productViewStyle(.compact)
                        .padding(16).glassPanel(18)
                        .onInAppPurchaseCompletion { _, sonuc in
                            if case .success(.success(let dogrulama)) = sonuc, case .verified(let t) = dogrulama { await t.finish() }
                            await TamSurum.shared.yenile()
                        }
                        }

                        Button {
                            Task {
                                geriYukleniyor = true; bulunamadi = false
                                try? await AppStore.sync()
                                await TamSurum.shared.yenile()
                                geriYukleniyor = false
                                bulunamadi = !TamSurum.shared.satinAlindi
                            }
                        } label: {
                            HStack { if geriYukleniyor { ProgressView() }; Text(L("Satın alımları geri yükle","Restore purchases")) }
                        }
                        .font(.footnote.weight(.semibold)).frame(maxWidth: .infinity).disabled(geriYukleniyor)
                        if bulunamadi {
                            Text(L("Bu Apple hesabında satın alım bulunamadı.","No purchase found on this Apple account."))
                                .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                        }
                    }
                    HStack(spacing: 18) {
                        Link(L("Gizlilik Politikası","Privacy Policy"), destination: URL(string: "https://realvirtuality.app/movelog/privacy.html")!)
                        Link(L("Kullanım Şartları","Terms of Use"), destination: URL(string: "https://realvirtuality.app/movelog/terms.html")!)
                    }.font(.footnote).frame(maxWidth: .infinity)
                    Button(L("Kapat","Close")) { dismiss() }
                        .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 4)
                }.padding(20)
            }
        }
        .presentationDetents([.large])
    }

    private func ozellik(_ ikon: String, _ metin: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: ikon).foregroundStyle(Brand.accent).frame(width: 26)
            Text(metin).font(.system(size: 15, weight: .medium))
        }
    }
}

/// Rotalar'ın üstündeki bant: ücretsiz 3 sürüş dolunca.
struct TamSurumBandi: View {
    var ac: () -> Void
    var body: some View {
        Button(action: ac) {
            HStack(spacing: 12) {
                Image(systemName: "lock.open.fill").font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Brand.accent).frame(width: 44, height: 44).glassPanel(14)
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("3 ücretsiz sürüşün bitti","Your 3 free rides are used")).font(.system(size: 15, weight: .semibold))
                    Text(L("Sürüşlerin kaydedilmeye devam ediyor. Tam sürümü bir kez al, hepsi açılsın.",
                           "Your rides are still being recorded. Get the full version once to unlock them all."))
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
            }.padding(14).contentShape(Rectangle())
        }.buttonStyle(.plain).glassPanel(20)
    }
}
