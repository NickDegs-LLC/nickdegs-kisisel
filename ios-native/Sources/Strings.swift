import SwiftUI

// MARK: - Launch ortamı (ekran görüntüsü/demo için)
enum AppEnv {
    static let args = CommandLine.arguments
    static var demo: Bool { args.contains("DEMO") }
    static var screen: String? { args.first(where: { $0.hasPrefix("SCREEN=") })?.replacingOccurrences(of: "SCREEN=", with: "") }
    static var langOverride: String? { args.first(where: { $0.hasPrefix("LANG=") })?.replacingOccurrences(of: "LANG=", with: "") }
    // Yalnızca otomasyon/CI doğrulaması için (App Store kullanıcıları launch-arg geçmez): AUTOLOGIN=kullanıcı:parola
    static var autoLogin: (user: String, pass: String)? {
        guard let raw = args.first(where: { $0.hasPrefix("AUTOLOGIN=") })?.replacingOccurrences(of: "AUTOLOGIN=", with: ""),
              raw.contains(":") else { return nil }
        let p = raw.split(separator: ":", maxSplits: 1).map(String.init)
        return (p[0], p.count > 1 ? p[1] : "")
    }
}

let SUPPORTED = ["en","tr","de","fr","es","it","pt","ru","ja","zh","ko","ar"]
func currentLang() -> String {
    if let o = AppEnv.langOverride, SUPPORTED.contains(o) { return o }
    let code = Locale.preferredLanguages.first?.split(separator: "-").first.map(String.init) ?? "en"
    return SUPPORTED.contains(code) ? code : "en"
}

// İngilizce anahtara göre 12-dil çeviri (eksikse İngilizce'ye düşer)
private let TRANS: [String: [String:String]] = [
 "Tracking dot": ["tr":"Takip noktası","de":"Positionspunkt","fr":"Point de suivi","es":"Punto de seguimiento","it":"Punto di tracciamento","pt":"Ponto de rastreio","ru":"Точка позиции","ja":"トラッキングドット","zh":"跟踪圆点","ko":"추적 점","ar":"نقطة التتبع"],
 "Match line": ["tr":"Çizgiyle aynı","de":"Wie die Linie","fr":"Comme la ligne","es":"Igual que la línea","it":"Come la linea","pt":"Igual à linha","ru":"Как линия","ja":"線と同じ","zh":"与线条一致","ko":"선과 동일","ar":"مطابق للخط"],
 "Routes · Activity · Live location": ["tr":"Rotalar · Aktivite · Canlı konum","de":"Routen · Aktivität · Live-Standort","fr":"Itinéraires · Activité · Position en direct","es":"Rutas · Actividad · Ubicación en vivo","it":"Percorsi · Attività · Posizione live","pt":"Rotas · Atividade · Localização ao vivo","ru":"Маршруты · Активность · Геопозиция","ja":"ルート · アクティビティ · 現在地","zh":"路线 · 活动 · 实时位置","ko":"경로 · 활동 · 실시간 위치","ar":"المسارات · النشاط · الموقع المباشر"],
 "Username": ["tr":"Kullanıcı","de":"Benutzer","fr":"Identifiant","es":"Usuario","it":"Utente","pt":"Usuário","ru":"Пользователь","ja":"ユーザー名","zh":"用户名","ko":"사용자 이름","ar":"اسم المستخدم"],
 "Password": ["tr":"Parola","de":"Passwort","fr":"Mot de passe","es":"Contraseña","it":"Password","pt":"Senha","ru":"Пароль","ja":"パスワード","zh":"密码","ko":"비밀번호","ar":"كلمة المرور"],
 "Sign in": ["tr":"Giriş yap","de":"Anmelden","fr":"Se connecter","es":"Iniciar sesión","it":"Accedi","pt":"Entrar","ru":"Войти","ja":"サインイン","zh":"登录","ko":"로그인","ar":"تسجيل الدخول"],
 "Routes": ["tr":"Rotalar","de":"Routen","fr":"Itinéraires","es":"Rutas","it":"Percorsi","pt":"Rotas","ru":"Маршруты","ja":"ルート","zh":"路线","ko":"경로","ar":"المسارات"],
 "Chat": ["tr":"Sohbet","de":"Chat","fr":"Discussion","es":"Chat","it":"Chat","pt":"Conversa","ru":"Чат","ja":"チャット","zh":"聊天","ko":"채팅","ar":"الدردشة"],
 "Map": ["tr":"Harita","de":"Karte","fr":"Carte","es":"Mapa","it":"Mappa","pt":"Mapa","ru":"Карта","ja":"マップ","zh":"地图","ko":"지도","ar":"الخريطة"],
 "Stats": ["tr":"İstatistik","de":"Statistik","fr":"Stats","es":"Stats","it":"Statistiche","pt":"Estatísticas","ru":"Статистика","ja":"統計","zh":"统计","ko":"통계","ar":"الإحصاءات"],
 "Profile": ["tr":"Profil","de":"Profil","fr":"Profil","es":"Perfil","it":"Profilo","pt":"Perfil","ru":"Профиль","ja":"プロフィール","zh":"个人资料","ko":"프로필","ar":"الملف"],
 "Live GPS": ["tr":"Canlı GPS","de":"Live-GPS","fr":"GPS en direct","es":"GPS en vivo","it":"GPS live","pt":"GPS ao vivo","ru":"GPS вживую","ja":"ライブGPS","zh":"实时 GPS","ko":"실시간 GPS","ar":"GPS مباشر"],
 "Play": ["tr":"İzle","de":"Ansehen","fr":"Lire","es":"Ver","it":"Guarda","pt":"Assistir","ru":"Смотреть","ja":"再生","zh":"播放","ko":"재생","ar":"تشغيل"],
 "Motorcycle": ["tr":"Motosiklet","de":"Motorrad","fr":"Moto","es":"Motocicleta","it":"Moto","pt":"Motocicleta","ru":"Мотоцикл","ja":"バイク","zh":"摩托车","ko":"오토바이","ar":"دراجة نارية"],
 "Cycling": ["tr":"Bisiklet","de":"Radfahren","fr":"Vélo","es":"Ciclismo","it":"Ciclismo","pt":"Ciclismo","ru":"Велосипед","ja":"サイクリング","zh":"骑行","ko":"자전거","ar":"دراجة"],
 "Running": ["tr":"Koşu","de":"Laufen","fr":"Course","es":"Correr","it":"Corsa","pt":"Corrida","ru":"Бег","ja":"ランニング","zh":"跑步","ko":"달리기","ar":"الجري"],
 "Walking": ["tr":"Yürüyüş","de":"Gehen","fr":"Marche","es":"Caminar","it":"Camminata","pt":"Caminhada","ru":"Ходьба","ja":"ウォーキング","zh":"步行","ko":"걷기","ar":"المشي"],
 "Other": ["tr":"Diğer","de":"Sonstige","fr":"Autre","es":"Otro","it":"Altro","pt":"Outro","ru":"Другое","ja":"その他","zh":"其他","ko":"기타","ar":"أخرى"],
 "Total routes": ["tr":"Toplam rota","de":"Routen gesamt","fr":"Itinéraires au total","es":"Rutas totales","it":"Percorsi totali","pt":"Total de rotas","ru":"Всего маршрутов","ja":"ルート合計","zh":"路线总数","ko":"총 경로","ar":"إجمالي المسارات"],
 "Latest route": ["tr":"Son rota","de":"Letzte Route","fr":"Dernier itinéraire","es":"Última ruta","it":"Ultimo percorso","pt":"Última rota","ru":"Последний маршрут","ja":"最新のルート","zh":"最新路线","ko":"최근 경로","ar":"أحدث مسار"],
 "Move Log member": ["tr":"Move Log üyesi","de":"Move Log-Mitglied","fr":"Membre Move Log","es":"Miembro de Move Log","it":"Membro Move Log","pt":"Membro Move Log","ru":"Участник Move Log","ja":"Move Log メンバー","zh":"Move Log 会员","ko":"Move Log 회원","ar":"عضو في Move Log"],
 "Friends": ["tr":"Arkadaşlar","de":"Freunde","fr":"Amis","es":"Amigos","it":"Amici","pt":"Amigos","ru":"Друзья","ja":"友だち","zh":"好友","ko":"친구","ar":"الأصدقاء"],
 "Add friend": ["tr":"Arkadaş ekle","de":"Freund hinzufügen","fr":"Ajouter un ami","es":"Añadir amigo","it":"Aggiungi amico","pt":"Adicionar amigo","ru":"Добавить друга","ja":"友だちを追加","zh":"添加好友","ko":"친구 추가","ar":"إضافة صديق"],
 "Typography": ["tr":"Tipografi","de":"Typografie","fr":"Typographie","es":"Tipografía","it":"Tipografia","pt":"Tipografia","ru":"Типографика","ja":"書体","zh":"字体","ko":"서체","ar":"الخطوط"],
 "Default": ["tr":"Varsayılan","de":"Standard","fr":"Par défaut","es":"Predeterminado","it":"Predefinito","pt":"Padrão","ru":"По умолчанию","ja":"デフォルト","zh":"默认","ko":"기본","ar":"افتراضي"],
 "Appearance": ["tr":"Görünüm","de":"Darstellung","fr":"Apparence","es":"Apariencia","it":"Aspetto","pt":"Aparência","ru":"Оформление","ja":"外観","zh":"外观","ko":"화면 모드","ar":"المظهر"],
 "Light": ["tr":"Açık","de":"Hell","fr":"Clair","es":"Claro","it":"Chiaro","pt":"Claro","ru":"Светлая","ja":"ライト","zh":"浅色","ko":"라이트","ar":"فاتح"],
 "Dark": ["tr":"Koyu","de":"Dunkel","fr":"Sombre","es":"Oscuro","it":"Scuro","pt":"Escuro","ru":"Тёмная","ja":"ダーク","zh":"深色","ko":"다크","ar":"داكن"],
 "Sign out": ["tr":"Çıkış","de":"Abmelden","fr":"Déconnexion","es":"Cerrar sesión","it":"Esci","pt":"Sair","ru":"Выйти","ja":"サインアウト","zh":"退出","ko":"로그아웃","ar":"تسجيل الخروج"],
 "Message": ["tr":"Mesaj","de":"Nachricht","fr":"Message","es":"Mensaje","it":"Messaggio","pt":"Mensagem","ru":"Сообщение","ja":"メッセージ","zh":"消息","ko":"메시지","ar":"رسالة"],
 "Online": ["tr":"Çevrimiçi","de":"Online","fr":"En ligne","es":"En línea","it":"Online","pt":"Online","ru":"В сети","ja":"オンライン","zh":"在线","ko":"온라인","ar":"متصل"],
 "Offline": ["tr":"Çevrimdışı","de":"Offline","fr":"Hors ligne","es":"Sin conexión","it":"Offline","pt":"Offline","ru":"Не в сети","ja":"オフライン","zh":"离线","ko":"오프라인","ar":"غير متصل"],
 "Friend": ["tr":"Arkadaş","de":"Freund","fr":"Ami","es":"Amigo","it":"Amico","pt":"Amigo","ru":"Друг","ja":"友だち","zh":"好友","ko":"친구","ar":"صديق"],
 "Route": ["tr":"Rota","de":"Route","fr":"Itinéraire","es":"Ruta","it":"Percorso","pt":"Rota","ru":"Маршрут","ja":"ルート","zh":"路线","ko":"경로","ar":"مسار"],
 // --- Videolarım / süre / Otonom / hassasiyet (2026-06-29) ---
 "My Videos": ["tr":"Videolarım","de":"Meine Videos","fr":"Mes vidéos","es":"Mis vídeos","it":"I miei video","pt":"Meus vídeos","ru":"Мои видео","ja":"マイビデオ","zh":"我的视频","ko":"내 동영상","ar":"مقاطعي"],
 "No videos yet": ["tr":"Henüz video yok","de":"Noch keine Videos","fr":"Aucune vidéo","es":"Aún no hay vídeos","it":"Ancora nessun video","pt":"Ainda sem vídeos","ru":"Видео пока нет","ja":"動画はまだありません","zh":"还没有视频","ko":"아직 동영상이 없습니다","ar":"لا توجد مقاطع بعد"],
 "Rendering…": ["tr":"Hazırlanıyor…","de":"Wird erstellt…","fr":"Création…","es":"Generando…","it":"Generazione…","pt":"Gerando…","ru":"Создание…","ja":"作成中…","zh":"生成中…","ko":"생성 중…","ar":"جارٍ الإنشاء…"],
 "Rendering, playable when done": ["tr":"Video hazırlanıyor, bitince izlenebilir","de":"Wird erstellt – nach Fertigstellung abspielbar","fr":"Création en cours – lisible une fois terminé","es":"Generando, se podrá ver al terminar","it":"Generazione, riproducibile al termine","pt":"Gerando, reproduzível quando concluir","ru":"Создаётся, можно посмотреть после готовности","ja":"作成中。完了後に再生できます","zh":"生成中，完成后即可播放","ko":"생성 중, 완료되면 재생 가능","ar":"جارٍ الإنشاء، يمكن تشغيله عند الانتهاء"],
 "Created: ": ["tr":"Üretildi: ","de":"Erstellt: ","fr":"Créé : ","es":"Creado: ","it":"Creato: ","pt":"Criado: ","ru":"Создано: ","ja":"作成: ","zh":"生成于：","ko":"생성: ","ar":"أُنشئ: "],
 "Auto": ["tr":"Otonom","de":"Automatisch","fr":"Auto","es":"Auto","it":"Auto","pt":"Auto","ru":"Авто","ja":"オート","zh":"自动","ko":"자동","ar":"تلقائي"],
 "Auto 🔒": ["tr":"Otonom 🔒","de":"Automatisch 🔒","fr":"Auto 🔒","es":"Auto 🔒","it":"Auto 🔒","pt":"Auto 🔒","ru":"Авто 🔒","ja":"オート 🔒","zh":"自动 🔒","ko":"자동 🔒","ar":"تلقائي 🔒"],
 "Short ≈15s, Medium ≈30s, Long scales with distance (max 60s).": ["tr":"Kısa ≈15sn, Orta ≈30sn, Uzun rotaya göre (max 60sn). Süre rota uzunluğuna göre ölçeklenir.","de":"Kurz ≈15 Sek., Mittel ≈30 Sek., Lang skaliert mit der Distanz (max. 60 Sek.).","fr":"Court ≈15 s, Moyen ≈30 s, Long selon la distance (max 60 s).","es":"Corto ≈15 s, Medio ≈30 s, Largo según la distancia (máx. 60 s).","it":"Breve ≈15 s, Medio ≈30 s, Lungo in base alla distanza (max 60 s).","pt":"Curto ≈15 s, Médio ≈30 s, Longo conforme a distância (máx. 60 s).","ru":"Короткое ≈15 с, Среднее ≈30 с, Длинное зависит от дистанции (макс. 60 с).","ja":"短い ≈15秒、中 ≈30秒、長いは距離に応じて（最大60秒）。","zh":"短 ≈15秒，中 ≈30秒，长随距离变化（最长60秒）。","ko":"짧게 ≈15초, 보통 ≈30초, 길게 거리에 따라(최대 60초).","ar":"قصير ≈15 ث، متوسط ≈30 ث، طويل حسب المسافة (بحد أقصى 60 ث)."],
 "Auto: length fully scales with your route (max 3 min). Great for city trips. Premium, once a day.": ["tr":"Otonom: süre TAMAMEN rotaya göre ayarlanır (max 3 dk). Şehir yolculukları için ideal. Premium, günde 1.","de":"Automatisch: Länge richtet sich ganz nach deiner Route (max. 3 Min.). Ideal für Stadtfahrten. Premium, einmal täglich.","fr":"Auto : la durée s'adapte entièrement à votre itinéraire (max 3 min). Idéal en ville. Premium, une fois par jour.","es":"Auto: la duración se ajusta totalmente a tu ruta (máx. 3 min). Ideal para ciudad. Premium, una vez al día.","it":"Auto: la durata si adatta totalmente al percorso (max 3 min). Perfetto in città. Premium, una volta al giorno.","pt":"Auto: a duração se ajusta totalmente à sua rota (máx. 3 min). Ótimo para a cidade. Premium, uma vez por dia.","ru":"Авто: длительность полностью зависит от маршрута (до 3 мин). Отлично для города. Premium, раз в день.","ja":"オート：長さはルートに完全に合わせて調整（最大3分）。街乗りに最適。Premium、1日1回。","zh":"自动：时长完全根据路线调整（最长3分钟）。适合城市出行。会员专享，每天1次。","ko":"자동: 길이가 경로에 완전히 맞춰집니다(최대 3분). 도심 이동에 적합. 프리미엄, 하루 1회.","ar":"تلقائي: تتكيّف المدة بالكامل مع مسارك (بحد أقصى 3 دقائق). مثالي لرحلات المدينة. مميّز، مرة واحدة يوميًا."],
 "Detection sensitivity": ["tr":"Algılama hassasiyeti","de":"Erkennungsgenauigkeit","fr":"Précision de détection","es":"Precisión de detección","it":"Precisione di rilevamento","pt":"Precisão de detecção","ru":"Точность отслеживания","ja":"検出感度","zh":"检测精度","ko":"감지 정밀도","ar":"دقة التتبّع"],
 "High": ["tr":"Hassas","de":"Hoch","fr":"Élevée","es":"Alta","it":"Alta","pt":"Alta","ru":"Высокая","ja":"高","zh":"高","ko":"높음","ar":"عالية"],
 "Balanced": ["tr":"Dengeli","de":"Ausgewogen","fr":"Équilibrée","es":"Equilibrada","it":"Bilanciata","pt":"Equilibrada","ru":"Сбаланс.","ja":"バランス","zh":"均衡","ko":"균형","ar":"متوازنة"],
 "Simple": ["tr":"Basit","de":"Einfach","fr":"Simple","es":"Simple","it":"Semplice","pt":"Simples","ru":"Простая","ja":"シンプル","zh":"简单","ko":"간단","ar":"بسيطة"],
 "Location every 5s — highest detection, densest/smoothest route (a bit more battery).": ["tr":"5 sn'de bir konum — en hassas algılama, en yoğun ve akıcı rota videosu (pil biraz daha çok).","de":"Standort alle 5 Sek. – beste Erkennung, dichteste/flüssigste Route (etwas mehr Akku).","fr":"Position toutes les 5 s – détection maximale, itinéraire le plus fluide (un peu plus de batterie).","es":"Ubicación cada 5 s: máxima detección, ruta más fluida (algo más de batería).","it":"Posizione ogni 5 s – rilevamento massimo, percorso più fluido (un po' più batteria).","pt":"Localização a cada 5 s — detecção máxima, rota mais fluida (um pouco mais de bateria).","ru":"Геопозиция каждые 5 с — макс. точность, самый плавный маршрут (чуть больше расхода батареи).","ja":"5秒ごとに位置取得 — 最高の検出、最も滑らかなルート（電池をやや多く消費）。","zh":"每5秒定位 — 检测最精准、路线最流畅（耗电略多）。","ko":"5초마다 위치 — 최고 감지, 가장 부드러운 경로(배터리 약간 더 사용).","ar":"تحديد الموقع كل 5 ث — أعلى دقة وأكثر مسار سلاسة (استهلاك بطارية أكبر قليلًا)."],
 "~Every 15s — balanced: good detection, reasonable battery.": ["tr":"~15 sn'de bir — dengeli: iyi algılama, makul pil.","de":"~Alle 15 Sek. – ausgewogen: gute Erkennung, vertretbarer Akku.","fr":"~Toutes les 15 s – équilibré : bonne détection, batterie raisonnable.","es":"~Cada 15 s: equilibrado, buena detección y batería razonable.","it":"~Ogni 15 s – bilanciato: buon rilevamento, batteria ragionevole.","pt":"~A cada 15 s — equilibrado: boa detecção, bateria razoável.","ru":"~Каждые 15 с — баланс: хорошая точность, умеренный расход.","ja":"~15秒ごと — バランス：良好な検出、適度な電池消費。","zh":"~每15秒 — 均衡：检测良好，耗电适中。","ko":"~15초마다 — 균형: 좋은 감지, 적당한 배터리.","ar":"~كل 15 ث — متوازن: كشف جيد واستهلاك معقول للبطارية."],
 "~Every 45s — most efficient/battery-friendly, coarser detection.": ["tr":"~45 sn'de bir — en performanslı ve pil dostu, daha kaba algılama.","de":"~Alle 45 Sek. – am effizientesten/akkuschonend, gröbere Erkennung.","fr":"~Toutes les 45 s – le plus économe en batterie, détection plus grossière.","es":"~Cada 45 s: lo más eficiente para la batería, detección más básica.","it":"~Ogni 45 s – il più efficiente per la batteria, rilevamento più grossolano.","pt":"~A cada 45 s — mais eficiente/poupa bateria, detecção mais básica.","ru":"~Каждые 45 с — экономнее всего для батареи, грубее точность.","ja":"~45秒ごと — 最も省電力、検出は粗め。","zh":"~每45秒 — 最省电，检测较粗略。","ko":"~45초마다 — 가장 효율적/배터리 절약, 감지는 거침.","ar":"~كل 45 ث — الأوفر للبطارية، كشف أقل دقة."],
 "High & Balanced need Premium — finer detection + smoother video.": ["tr":"Hassas ve Dengeli için Premium gerekir — daha hassas algılama + daha akıcı video.","de":"Hoch & Ausgewogen erfordern Premium – feinere Erkennung + flüssigeres Video.","fr":"Élevée et Équilibrée nécessitent Premium – détection plus fine + vidéo plus fluide.","es":"Alta y Equilibrada requieren Premium: detección más fina y vídeo más fluido.","it":"Alta ed Equilibrata richiedono Premium – rilevamento più preciso + video più fluido.","pt":"Alta e Equilibrada exigem Premium — detecção mais precisa + vídeo mais fluido.","ru":"Высокая и Сбалансированная требуют Premium — точнее отслеживание и плавнее видео.","ja":"「高」と「バランス」はPremiumが必要 — より精密な検出と滑らかな動画。","zh":"「高」和「均衡」需会员 — 更精准检测 + 更流畅视频。","ko":"높음·균형은 프리미엄 필요 — 더 정밀한 감지 + 더 부드러운 영상.","ar":"تتطلب «عالية» و«متوازنة» الاشتراك المميّز — كشف أدق وفيديو أكثر سلاسة."],
 "Rendering in cloud": ["tr":"Bulutta hazırlanıyor 🎬","de":"Wird in der Cloud erstellt 🎬","fr":"Création dans le cloud 🎬","es":"Generando en la nube 🎬","it":"Creazione nel cloud 🎬","pt":"Gerando na nuvem 🎬","ru":"Создаётся в облаке 🎬","ja":"クラウドで作成中 🎬","zh":"正在云端生成 🎬","ko":"클라우드에서 생성 중 🎬","ar":"جارٍ الإنشاء في السحابة 🎬"],
 "Automatic video": ["tr":"Otomatik video","de":"Automatisches Video","fr":"Vidéo automatique","es":"Vídeo automático","it":"Video automatico","pt":"Vídeo automático","ru":"Автоматическое видео","ja":"自動ビデオ","zh":"自动视频","ko":"자동 동영상","ar":"فيديو تلقائي"],
 "Auto-made after each trip": ["tr":"Gezi bitince otomatik üretilir","de":"Wird nach jeder Fahrt automatisch erstellt","fr":"Créée automatiquement après chaque sortie","es":"Se crea automáticamente tras cada viaje","it":"Creato automaticamente dopo ogni giro","pt":"Criado automaticamente após cada viagem","ru":"Создаётся автоматически после каждой поездки","ja":"移動のたびに自動作成","zh":"每次出行后自动生成","ko":"이동할 때마다 자동 생성","ar":"يُنشأ تلقائيًا بعد كل رحلة"],
 "High resolution, no logo": ["tr":"Yüksek çözünürlük, logo yok","de":"Hohe Auflösung, kein Logo","fr":"Haute résolution, sans logo","es":"Alta resolución, sin logo","it":"Alta risoluzione, senza logo","pt":"Alta resolução, sem logo","ru":"Высокое разрешение, без логотипа","ja":"高解像度・ロゴなし","zh":"高分辨率，无标志","ko":"고해상도, 로고 없음","ar":"دقة عالية، بدون شعار"],
 // --- Kamera mesafesi (2026-06-29) ---
 "Camera distance": ["tr":"Kamera mesafesi","de":"Kameradistanz","fr":"Distance caméra","es":"Distancia de cámara","it":"Distanza camera","pt":"Distância da câmera","ru":"Дистанция камеры","ja":"カメラ距離","zh":"镜头距离","ko":"카메라 거리","ar":"مسافة الكاميرا"],
 "Near": ["tr":"Yakın","de":"Nah","fr":"Proche","es":"Cerca","it":"Vicino","pt":"Perto","ru":"Близко","ja":"近い","zh":"近","ko":"가까이","ar":"قريب"],
 "Medium": ["tr":"Orta","de":"Mittel","fr":"Moyen","es":"Medio","it":"Medio","pt":"Médio","ru":"Средне","ja":"中","zh":"中","ko":"중간","ar":"متوسط"],
 "Far": ["tr":"Uzak","de":"Fern","fr":"Loin","es":"Lejos","it":"Lontano","pt":"Longe","ru":"Далеко","ja":"遠い","zh":"远","ko":"멀리","ar":"بعيد"],
 "How close the camera follows: Near = tighter shot, Far = wider framing.": ["tr":"Kameranın rotaya yakınlığı: Yakın daha yakın çekim, Uzak daha geniş kadraj.","de":"Wie nah die Kamera folgt: Nah = engerer Ausschnitt, Fern = weiteres Bild.","fr":"Distance de suivi de la caméra : Proche = plan serré, Loin = cadrage large.","es":"Qué tan cerca sigue la cámara: Cerca = plano cerrado, Lejos = encuadre amplio.","it":"Quanto vicino segue la camera: Vicino = inquadratura stretta, Lontano = campo ampio.","pt":"Quão perto a câmera segue: Perto = plano fechado, Longe = enquadramento amplo.","ru":"Насколько близко следует камера: Близко = крупнее план, Далеко = шире кадр.","ja":"カメラの追従距離：近い=寄りの画、遠い=広い画。","zh":"镜头跟随距离：近=更紧凑画面，远=更宽广取景。","ko":"카메라 추적 거리: 가까이=타이트한 화면, 멀리=넓은 화면.","ar":"مدى قرب الكاميرا: قريب = لقطة أضيق، بعيد = إطار أوسع."],
 "Camera distance is a Premium option.": ["tr":"Kamera mesafesi Premium ile seçilebilir.","de":"Kameradistanz ist eine Premium-Option.","fr":"La distance caméra est une option Premium.","es":"La distancia de cámara es una opción Premium.","it":"La distanza camera è un'opzione Premium.","pt":"A distância da câmera é uma opção Premium.","ru":"Дистанция камеры — опция Premium.","ja":"カメラ距離はPremiumオプションです。","zh":"镜头距离为会员选项。","ko":"카메라 거리는 프리미엄 옵션입니다.","ar":"مسافة الكاميرا خيار مميّز."],
 // --- Araba tipi + videosuz rota (2026-06-29) ---
 "Car": ["tr":"Araba","de":"Auto","fr":"Voiture","es":"Coche","it":"Auto","pt":"Carro","ru":"Машина","ja":"車","zh":"汽车","ko":"자동차","ar":"سيارة"],
 "Create video": ["tr":"Video oluştur","de":"Video erstellen","fr":"Créer une vidéo","es":"Crear vídeo","it":"Crea video","pt":"Criar vídeo","ru":"Создать видео","ja":"ビデオを作成","zh":"生成视频","ko":"동영상 만들기","ar":"إنشاء فيديو"],
 // --- GPX/TCX yükleme (2026-06-30) ---
 "Couldn't read the file": ["tr":"Dosya okunamadı","de":"Datei konnte nicht gelesen werden","fr":"Impossible de lire le fichier","es":"No se pudo leer el archivo","it":"Impossibile leggere il file","pt":"Não foi possível ler o arquivo","ru":"Не удалось прочитать файл","ja":"ファイルを読み込めませんでした","zh":"无法读取文件","ko":"파일을 읽을 수 없습니다","ar":"تعذّر قراءة الملف"],
 "Upload failed — pick a valid GPX/TCX file": ["tr":"Yükleme başarısız — geçerli bir GPX/TCX dosyası seç","de":"Upload fehlgeschlagen – wähle eine gültige GPX/TCX-Datei","fr":"Échec de l'import — choisis un fichier GPX/TCX valide","es":"Error al subir — elige un archivo GPX/TCX válido","it":"Caricamento fallito — scegli un file GPX/TCX valido","pt":"Falha no envio — escolha um arquivo GPX/TCX válido","ru":"Ошибка загрузки — выберите корректный файл GPX/TCX","ja":"アップロード失敗 — 有効なGPX/TCXファイルを選んでください","zh":"上传失败 — 请选择有效的 GPX/TCX 文件","ko":"업로드 실패 — 올바른 GPX/TCX 파일을 선택하세요","ar":"فشل الرفع — اختر ملف GPX/TCX صالح"],
]

func L(_ tr: String, _ en: String) -> String {
    let lang = currentLang()
    if lang == "tr" { return tr }
    if lang == "en" { return en }
    return TRANS[en]?[lang] ?? en
}

// MARK: - Demo veri (native ekran görüntüleri — kişisel veri YOK)
enum Demo {
    static let names: [String:[String]] = [
     "en":["James Carter","Emma Hughes","Liam Foster","Olivia Reed"],"tr":["Mehmet Demir","Elif Kaya","Ahmet Yıldız","Zeynep Şahin"],
     "de":["Lukas Müller","Anna Schmidt","Jonas Weber","Lea Fischer"],"fr":["Hugo Martin","Léa Dubois","Louis Bernard","Emma Laurent"],
     "es":["Hugo García","Lucía Martín","Mateo López","Sofía Ruiz"],"it":["Marco Rossi","Giulia Bianchi","Luca Romano","Sara Conti"],
     "pt":["João Silva","Maria Souza","Pedro Costa","Ana Oliveira"],"ru":["Иван Смирнов","Анна Иванова","Дмитрий Кузнецов","Мария Попова"],
     "ja":["田中 健","佐藤 美咲","鈴木 大輔","高橋 結衣"],"zh":["王伟","李娜","张强","刘洋"],
     "ko":["김민준","이서연","박지훈","최수아"],"ar":["أحمد محمد","سارة علي","خالد حسن","نور عبدالله"]]
    static let city: [String:(Double,Double)] = [
     "en":(51.5074,-0.1278),"tr":(41.0082,28.9784),"de":(52.52,13.405),"fr":(48.8566,2.3522),"es":(40.4168,-3.7038),
     "it":(41.9028,12.4964),"pt":(-23.55,-46.633),"ru":(55.7558,37.6173),"ja":(35.6762,139.6503),"zh":(31.2304,121.4737),"ko":(37.5665,126.978),"ar":(24.7136,46.6753)]
    static let thread: [String:[String]] = [
     "en":["Morning! Ready for the ride?","Almost, leaving in 5","Perfect, I'll wait at the bridge","On my way","See you there!"],
     "tr":["Günaydın! Sürüşe hazır mısın?","Az kaldı, 5 dakikaya çıkıyorum","Süper, köprüde beklerim","Yoldayım","Orada görüşürüz!"],
     "de":["Morgen! Bereit für die Tour?","Fast, fahre in 5 los","Super, warte an der Brücke","Bin unterwegs","Bis gleich!"],
     "fr":["Salut ! Prêt pour la sortie ?","Presque, je pars dans 5 min","Parfait, j'attends au pont","En route","À tout de suite !"],
     "es":["¡Buenos días! ¿Listo?","Casi, salgo en 5","Perfecto, te espero en el puente","En camino","¡Nos vemos!"],
     "it":["Buongiorno! Pronto?","Quasi, parto tra 5","Perfetto, ti aspetto al ponte","Sto arrivando","Ci vediamo lì!"],
     "pt":["Bom dia! Pronto?","Quase, saio em 5","Perfeito, espero na ponte","A caminho","Até já!"],
     "ru":["Доброе утро! Готов?","Почти, выезжаю через 5","Отлично, жду у моста","Уже еду","До встречи!"],
     "ja":["おはよう！準備できた？","もうすぐ、5分で出る","了解、橋で待ってる","向かってるよ","じゃあそこで！"],
     "zh":["早上好！准备好了吗？","快了，5分钟后出发","好的，我在桥边等你","在路上了","到那儿见！"],
     "ko":["좋은 아침! 준비됐어?","거의, 5분 뒤 출발","좋아, 다리에서 기다릴게","가는 중","거기서 봐!"],
     "ar":["صباح الخير! جاهز؟","تقريبًا، سأخرج خلال 5","ممتاز، سأنتظرك عند الجسر","في الطريق","نراك هناك!"]]
    static var nm: [String] { names[currentLang()] ?? names["en"]! }
    static var user: String { nm[0] }
}
