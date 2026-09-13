# Tactical Video Pipeline (Ultra özelliği)

CoD tarzı "askeri uydu görevi" rota videosu — 2026-07-19'da prototipten üretime alındı.

## Yapı: 70sn = İntro (31.7) + Taktik Rota (29.3) + Outro (9.0)
- **intro_gen.py** — login sekansı → telsiz brifingi (How copy?) → 3 yabancı şehir araması
  (CITY RECON kartı: landmark tarama + NO TARGET MATCH) → yanlış-bölge araması (uzak→orta→doğru)
  → Located + TARGET ID (profil foto, 4:5, operasyonel grade) → araç silüeti (sadece LOCK'ta)
  → z17'ye kademeli iniş → rotaya DALIŞ crossfade
- **route_gen.py** — çizgi YOK; gimbal reticle (halo'lu) + pusula bandı + olay günlüğü +
  punch-in ×2 + MGRS + gerçek hız/mesafe. Girdi: route.json (Traccar noktaları)
- **outro_gen.py** — nokta durur → konsol komutları → KESİNTİSİZ piramit zoom-out (z16→z7)
  → "Actual out" → temiz fade. Statik/CRT/mozaik YASAK (kullanıcı reddetti).

## SES (kritik kurallar)
- Mix: müzik SABİT (ducking YASAK — kullanıcı reddetti), konuşmalar +3dB üstte
- Müzik: music/ altındaki TÜM parçalar -16 LUFS'a normalize edilmiş; YENİ parça eklerken
  `loudnorm=I=-16:TP=-1.8:LRA=9` ŞART (seviye eşitliği kuralı)
- Bamgüm hattı: eq 100Hz +5dB + 210Hz +2.5dB + acompressor punch
- Final: pan=stereo (MONO YASAK — telefonda kısık çalıyor!) + dynaudnorm + hedef ~-7 LUFS
  (ölçüm bazlı düzeltici kazanç; alimiter 0.98)
- Klavye SFX: fx/typing_src.wav'dan tek vuruş çıkar, karakter başına 1 vuruş (0.030s/char senkron)
- Volatile_Reaction sadece 10-46sn gergin bölüm loop (duygusal tonaja girmez)

## RASTGELELİK (entegrasyonda ZORUNLU — kullanıcı şartı)
Her render %100 farklı: şehir havuzu (3 çekiliş) + Commons landmark otomatik çekimi +
auth kodu + rota-içi çağrılar + tarihler. "Kullanıcı aynı videoya abonelik satın almaz."

## Kişiselleştirme
- AVATAR env: profil foto yolu (yoksa silüet); VIDCODE: kod; ACTTYPE: moto/car (silüet seçimi)
- Callsign TTS: kullanıcı adıyla f_brief3 satırı Chatterbox'la kişi başına 1 kez üretilir
  (/opt/matrix/kokoro-tts + chatterbox kurulu; ref sesler cbx üretim geçmişinde)
- Kullanıcı müziği: Dosyalar + videodan ses ayıklama + DRM'siz medya (Apple Music DRM İMKANSIZ)

## Maliyet
GPU YOK (RunPod gerekmez). CPU ~10-15dk/video. Mapbox ~30 istek/video (50k/ay ücretsiz).
TTS/müzik yerel. Marjinal maliyet ≈ 0.

## Paketleme kararı (2026-07-19)
Rotalarım sekmesi → video stili "Tactical" seçeneği → ULTRA aboneliğine bağlı.
Fiyat ilk etapta SABİT (maliyet ~0; önce dönüşüm, zam sonra yeni-abonelere).

## 🔒 MÜHÜR (2026-07-19 gece) — DOKUNMA
Sistem TAM OTONOM ve uçtan uca doğrulandı (8-nokta kare denetimi + kalite kapıları).
Kullanıcı SADECE: crosshair rengi + müzik (kütüphane/sessiz/kendi dosya/rastgele) seçer.
Otonom hesaplananlar: dalış derinliği (z13-z17), rota irtifası, outro giriş irtifası (ışınlanma
imkansız), zaman bütçesi (59.6sn sabit), yanlış-bölge araması (rastgele yön/mesafe), ses yerleşimi
(süre-farkındalıklı, çakışma denetimli), TTS (insanımsı v6: exag .32 / cfg .8 / temp .62).
Değişiklik GEREKİRSE: önce bu dosyayı oku, statik denetim scriptini çalıştır, mühür testini tekrarla.
- KURAL: gen scriptlerine dokunan HER değişiklikten sonra teslim öncesi duman testi ZORUNLU (ön-uçuş py_compile otomatik; runtime dalları için mini render).
