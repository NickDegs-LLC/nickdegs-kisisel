package com.nickdegs.movelog.ui.screens

// GİRİŞ EKRANI v2 (2026-08-08, Barış: "Google ve Apple ile girişi ekle, SMS'i kaldır"):
// Telefon/OTP arayüzü KALDIRILDI. Google girişi Credential Manager + Sign in with Google
// (resmi buton akışı). serverClientId = film-ozet web client'ı -> backend /auth/google
// ID token'ın imzasını Google JWKS'iyle doğrular. Apple girişi Android'de sunulmuyor
// (Play politikası gerektirmez; Apple'ın Android akışı web tabanlı ve kırılgan).
// NOT: eski SMS çağrıları /api/auth/... yanlış yolundaydı (backend /auth/...) -> Android'de
// SMS girişi ÜRETIMDE ZATEN 404'TÜ; bu ekran o kırığı da kapatmış oluyor.

import android.app.Activity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import kotlinx.coroutines.launch

// 17.09: move-log-500805 projesindeki WEB OAuth client (iOS ile AYNI proje).
// NOT: FCM ve Play Integrity BILEREK film-ozet'te kaldi - Google girisi google-services.json
// kullanmaz, bu sabit yeter. Eski WEB OAuth client (google-services.json type-3) — backend GOOGLE_AUDS ile aynı.
private const val GOOGLE_WEB_CLIENT_ID =
    "515832699888-a021ep8nomkro6t8lpi31jmnttmksi2n.apps.googleusercontent.com"

@Composable
fun LoginScreen(store: Store) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var busy by remember { mutableStateOf(false) }
    var hataMetni by remember { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Move Log", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Brand.accent)
            Text(L("Rotalar · Aktivite · Telsiz", "Routes · Activity · Walkie-talkie"),
                color = Color(0xFF9AA4B2))
            Spacer(Modifier.height(6.dp))

            if (store.loginError) {
                Text(hataMetni ?: L("Giriş yapılamadı, tekrar dene.", "Sign-in failed, please try again."),
                    color = Color(0xFFE57373), fontSize = 13.sp)
            }

            // RESMÎ GOOGLE MARKASI (2026-08-09, Barış: "orijinal buton"): gerçek G logosu
            // (drawable/google_g) + Google spesifikasyonu: beyaz zemin, koyu gri metin.
            Button(
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.White, contentColor = Color(0xFF3C4043)),
                onClick = {
                    busy = true; store.loginError = false
                    scope.launch {
                        try {
                            val cm = CredentialManager.create(ctx)
                            val opt = GetSignInWithGoogleOption.Builder(GOOGLE_WEB_CLIENT_ID).build()
                            val res = cm.getCredential(
                                ctx as Activity,
                                GetCredentialRequest.Builder().addCredentialOption(opt).build()
                            )
                            val cred = res.credential
                            if (cred is CustomCredential &&
                                cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                                val idTok = GoogleIdTokenCredential.createFrom(cred.data).idToken
                                store.googleLogin(idTok)
                            } else store.loginError = true
                        } catch (e: GetCredentialCancellationException) {
                            // kullanıcı vazgeçti -> hata gösterme
                        } catch (e: NoCredentialException) {
                            // 17.09: cihazda Google hesabı yok. Eskiden jenerik "tekrar dene" yazıyordu ve
                            // Android'de BAŞKA giriş yolu olmadığı için kullanıcı tamamen kilitleniyordu.
                            hataMetni = L("Bu cihazda Google hesabı bulunamadı. Ayarlar > Hesaplar'dan bir Google hesabı ekleyip tekrar dene.",
                                "No Google account found on this device. Add one in Settings > Accounts, then try again.")
                            store.loginError = true
                        } catch (e: GetCredentialException) {
                            // Play Hizmetleri eski / cihaz sertifikasız / yapılandırma hatası -> sebebi GÖSTER
                            hataMetni = L("Google girişi başlatılamadı (" + e.type + "). Google Play Hizmetleri güncel mi?",
                                "Google sign-in could not start (" + e.type + "). Is Google Play services up to date?")
                            store.loginError = true
                        } catch (e: Exception) {
                            hataMetni = null
                            store.loginError = true
                        }
                        busy = false
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.foundation.Image(
                        painter = androidx.compose.ui.res.painterResource(com.nickdegs.movelog.R.drawable.google_g),
                        contentDescription = null,
                        modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(L("Google ile devam et", "Continue with Google"), fontSize = 16.sp)
                }
            }

            Text(L("Hesabın yoksa otomatik oluşturulur.", "No account? One is created automatically."),
                color = Color(0xFF9AA4B2), fontSize = 12.sp)
        }
    }
}
