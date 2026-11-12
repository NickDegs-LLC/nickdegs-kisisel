import Foundation
import Security

// 12.11.2026 (Barış: "giriş ekranını kaldıralım, giriş olmadan iCloud'a yedeklensin hesaplar").
// Hesap = cihazda üretilen 32 baytlık gizli anahtar. Anahtar iCloud Anahtar Zinciri'nde
// (synchronizable) + yedek olarak iCloud KV'de durur → aynı Apple kimliğindeki her cihaz ve
// yeniden kurulum AYNI hesabı açar. Sunucu anahtarın yalnız özetini görür (/auth/icloud).
enum ICloudHesap {
    private static let servis = "com.nickdegs.kisisel.icloud-hesap"
    private static let hesap = "anahtar"
    private static let kvAnahtar = "nd_icloud_hesap"

    static func gecerli(_ s: String?) -> Bool {
        guard let s, s.count == 64 else { return false }
        return s.allSatisfy { "0123456789abcdef".contains($0) }
    }

    /// Anahtar Zinciri (iCloud senkron) → yoksa iCloud KV. Hiçbiri yoksa nil.
    static func oku() -> String? {
        if let s = zincirOku(), gecerli(s) { return s }
        let kv = NSUbiquitousKeyValueStore.default.string(forKey: kvAnahtar)
        if gecerli(kv) { zincirYaz(kv!); return kv }
        return nil
    }

    static func yaz(_ s: String) {
        zincirYaz(s)
        let kv = NSUbiquitousKeyValueStore.default
        kv.set(s, forKey: kvAnahtar)
        kv.synchronize()
    }

    static func sil() {
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: servis,
                       kSecAttrSynchronizable: kSecAttrSynchronizableAny] as CFDictionary)
        let kv = NSUbiquitousKeyValueStore.default
        kv.removeObject(forKey: kvAnahtar)
        kv.synchronize()
    }

    static func uret() -> String {
        var b = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, b.count, &b) != errSecSuccess {
            b = (0..<32).map { _ in UInt8.random(in: 0...255) }
        }
        return b.map { String(format: "%02x", $0) }.joined()
    }

    private static func zincirOku() -> String? {
        var sonuc: CFTypeRef?
        let q: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: servis,
                                  kSecAttrAccount: hesap, kSecAttrSynchronizable: kSecAttrSynchronizableAny,
                                  kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
        guard SecItemCopyMatching(q as CFDictionary, &sonuc) == errSecSuccess,
              let d = sonuc as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    private static func zincirYaz(_ s: String) {
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: servis,
                       kSecAttrSynchronizable: kSecAttrSynchronizableAny] as CFDictionary)
        let a: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: servis,
                                  kSecAttrAccount: hesap, kSecAttrSynchronizable: true,
                                  kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
                                  kSecValueData: Data(s.utf8)]
        SecItemAdd(a as CFDictionary, nil)
    }
}
