import AuthenticationServices
import CryptoKit
import UIKit

// GOOGLE İLE GİRİŞ — SDK'SIZ (2026-08-09, Barış: "iOS'ta Apple VE Google, SMS bakiyem bitti").
// GoogleSignIn SDK'sı bilerek YOK: SPM bağımlılığı CI'yı kırılganlaştırır; iOS OAuth client'ları
// PKCE ile secret'sız token alabilir (Google installed-app akışı). ~80 satır saf sistem API'si.
// Client: move-log-500805 / com.nickdegs.kisisel (Firebase 2026-08-09'da eklendi, client oradan).
// Dönen id_token'ın aud'u bu client -> backend GOOGLE_AUDS listesinde.
enum GoogleOAuthError: Error { case cancelled, badCallback, exchange }

final class GoogleOAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleOAuth()
    private let clientID = "515832699888-6fr2fpkr1c1aq8th12jov28sav2h3lct.apps.googleusercontent.com"
    private var scheme: String { "com.googleusercontent.apps.515832699888-6fr2fpkr1c1aq8th12jov28sav2h3lct" }
    private var session: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }

    /// Google hesabı seçtirir, PKCE ile kod takası yapar, id_token döndürür.
    @MainActor
    func signIn() async throws -> String {
        let verifier = Self.randomURLSafe(64)
        let challenge = Self.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let redirect = scheme + ":/oauth2redirect"
        var comp = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comp.queryItems = [
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: "openid profile"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
        ]
        let code: String = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: comp.url!, callbackURLScheme: scheme) { url, err in
                if let err = err as? ASWebAuthenticationSessionError, err.code == .canceledLogin {
                    cont.resume(throwing: GoogleOAuthError.cancelled); return
                }
                guard let url,
                      let c = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "code" })?.value else {
                    cont.resume(throwing: GoogleOAuthError.badCallback); return
                }
                cont.resume(returning: c)
            }
            s.presentationContextProvider = self
            self.session = s
            s.start()
        }
        // kod -> token takası (iOS client'ta secret YOK, PKCE verifier yeter)
        var r = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        r.httpBody = [
            "code=\(code)", "client_id=\(clientID)",
            "redirect_uri=\(redirect.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? redirect)",
            "grant_type=authorization_code", "code_verifier=\(verifier)",
        ].joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: r)
        guard let h = resp as? HTTPURLResponse, h.statusCode < 300,
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idTok = o["id_token"] as? String else { throw GoogleOAuthError.exchange }
        return idTok
    }

    private static func randomURLSafe(_ n: Int) -> String {
        var b = [UInt8](repeating: 0, count: n); _ = SecRandomCopyBytes(kSecRandomDefault, n, &b)
        return b64url(Data(b))
    }
    private static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
