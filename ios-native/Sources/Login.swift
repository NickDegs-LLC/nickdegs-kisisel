import SwiftUI
import AuthenticationServices

// GİRİŞ EKRANI v2 (2026-08-08, Barış: "Google ve Apple ile girişi ekle, SMS'i kaldır"):
// Telefon/OTP arayüzü KALDIRILDI — backend SMS uçları sahadaki eski sürümler (<=1.57) için
// bilerek duruyor, yalnız bu ekrandan çıkarıldı.
// - Apple: SignInWithAppleButton (sistem butonu -> 12 dilde OTOMATİK yerelleşir, HIG uyumlu).
//   Backend /auth/apple hazırdı (JWKS doğrulamalı, aud=com.nickdegs.kisisel); entitlement eklendi.
// - Google: SDK'sız PKCE (GoogleOAuth.swift; client move-log-500805/com.nickdegs.kisisel).
//   Apple kuralı 4.8: üçüncü taraf giriş (Google) sunulduğu için Apple girişi ZORUNLU — ikisi de var.
// - CI otomatik-giriş (.task/AppEnv.autoLogin) AYNEN KORUNDU — iPad doğrulaması buna bağlı.
struct LoginView: View {
    @EnvironmentObject var store: Store
    @AppStorage("nd_scheme") var scheme = "dark"
    @Environment(\.colorScheme) private var sysScheme
    @State private var busy = false
    @State private var float = false
    @State private var shown = false

    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(spacing: 0) {
                Spacer(minLength: 60)
                Image(systemName: "point.topleft.down.curvedto.point.bottomright.up")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(Brand.gradient)
                    .frame(width: 84, height: 84)
                    .glassPanel(24)
                    .offset(y: float ? -7 : 0)
                    .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: float)
                    .padding(.bottom, 18)
                Text("Move Log").font(.system(size: 40, weight: .heavy))
                Text(L("Rotalar · Aktivite · Canlı konum", "Routes · Activity · Live location"))
                    .font(.subheadline).foregroundStyle(.secondary).padding(.top, 4)
                Spacer()

                VStack(spacing: 0) {
                    if store.loginError {
                        Text(L("Giriş yapılamadı, tekrar dene.", "Sign-in failed, please try again."))
                            .font(.footnote).foregroundStyle(.red).padding(.bottom, 12)
                    }

                    SignInWithAppleButton(.continue) { req in
                        req.requestedScopes = [.fullName]
                    } onCompletion: { result in
                        guard case .success(let auth) = result,
                              let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                              let data = cred.identityToken,
                              let tok = String(data: data, encoding: .utf8) else {
                            // kullanıcı iptal ettiyse hata gösterme; gerçek hatada göster
                            if case .failure(let e) = result,
                               (e as? ASAuthorizationError)?.code != .canceled { store.loginError = true }
                            return
                        }
                        // İsim yalnız İLK Apple girişinde gelir (Apple politikası) -> backend ilk gelişte saklar.
                        let name = [cred.fullName?.givenName, cred.fullName?.familyName]
                            .compactMap { $0 }.joined(separator: " ")
                        busy = true
                        Task { await store.appleLogin(identityToken: tok, name: name); busy = false }
                    }
                    .signInWithAppleButtonStyle(sysScheme == .dark ? .white : .black)
                    .frame(height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .disabled(busy)
                    .overlay { if busy { ProgressView() } }

                    // GOOGLE (2026-08-09): SDK'sız PKCE akışı (GoogleOAuth.swift). Kullanıcı iptali hata sayılmaz.
                    Button {
                        busy = true; store.loginError = false
                        Task {
                            do {
                                let idTok = try await GoogleOAuth.shared.signIn()
                                await store.googleLogin(idToken: idTok)
                            } catch GoogleOAuthError.cancelled {
                            } catch { store.loginError = true }
                            busy = false
                        }
                    } label: {
                        // RESMÎ GOOGLE MARKASI (2026-08-09, Barış: "orijinal buton istiyorum"):
                        // gerçek G logosu (developers.google.com/identity/images/g-logo.png,
                        // Assets/GoogleG) + Google spesifikasyonu: BEYAZ zemin, koyu gri metin.
                        HStack(spacing: 10) {
                            Image("GoogleG").resizable().scaledToFit().frame(width: 20, height: 20)
                            Text(L("Google ile devam et", "Continue with Google"))
                                .font(.system(size: 17, weight: .medium))
                                .foregroundStyle(Color(red: 0.24, green: 0.25, blue: 0.26))
                        }
                        .frame(maxWidth: .infinity).frame(height: 52)
                    }
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.black.opacity(sysScheme == .dark ? 0.0 : 0.12), lineWidth: 1))
                    .disabled(busy)
                    .padding(.top, 12)

                    Text(L("Hesabın yoksa otomatik oluşturulur.", "No account? One is created automatically."))
                        .font(.caption2).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.top, 14).padding(.bottom, 44)
                }
                .padding(.horizontal, 28).frame(maxWidth: 400)
                .scaleEffect(shown ? 1 : 0.96)
                .opacity(shown ? 1 : 0)
                .blur(radius: shown ? 0 : 6)
            }
        }
        .onAppear {
            float = true
            withAnimation(.smooth(duration: 0.6)) { shown = true }
        }
        .task {
            // CI/iPad doğrulaması: launch-arg ile gerçek giriş (kullanıcı bu yolu tetikleyemez)
            if let c = AppEnv.autoLogin, store.token.isEmpty { await store.login(c.user, c.pass) }
        }
    }
}
