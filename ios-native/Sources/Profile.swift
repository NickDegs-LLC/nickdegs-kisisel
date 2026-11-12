import SwiftUI
import PhotosUI
import UIKit

let EMOJIS = [
    "🙂","😎","😀","😍","🤩","😇","🤠","🥳","😴","🤓","🧐","🤔",
    "🧑","👩","🧔","👨","👵","👴","🧕","👮","🧑‍🚀","🦸","🧙","🧑‍🎤",
    "🦊","🦁","🐯","🐺","🐻","🐼","🐶","🐱","🦅","🦉","🐴","🦄",
    "🏍️","🚗","🚲","🛵","🚙","✈️","🚁","⛵️","🏎️","🛻","🚜","🛴",
    "🏃","🚶","🚴","🏔️","🌊","🏕️","🌅","🌍","🌙","☀️","🌈","🛣️",
    "⚡️","🔥","⭐️","🎯","🏆","💎","🎸","🎮","📷","🧭","🗺️","❤️",
]

struct FontChoice: Identifiable, Hashable {
    var id: String; var label: String; var design: Font.Design; var free: Bool
}
let FONT_CHOICES: [FontChoice] = [
    .init(id: "default", label: L("Varsayılan","Default"), design: .default, free: true),
    .init(id: "serif", label: "Editorial", design: .serif, free: false),
    .init(id: "rounded", label: "Rounded", design: .rounded, free: false),
    .init(id: "mono", label: "Mono", design: .monospaced, free: false),
]

struct ProfileView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var cloud: CloudSync
    @EnvironmentObject var tracker: Tracker
    @AppStorage("nd_font") var fontId = "default"
    @AppStorage("nd_scheme") var scheme = "dark"
    @AppStorage("nd_sensitivity") var sensitivity = "dengeli"   // algılama hassasiyeti (03.11.2026: herkes seçer)
    @State private var prof: Profile?
    @State private var friends: [Friend] = []
    @State private var incoming: [Friend] = []
    @State private var outgoing: [Friend] = []
    @State private var stats: Stats?
    @AppStorage("nd_lang") private var dilKayit = ""   // 10.11: Profil > Dil
    @State private var showAvatar = false
    @State private var showAddFriend = false
    @State private var showHandle = false
    @State private var showFeedback = false
    @State private var showDelete = false
    @State private var showRename = false
    @State private var newName = ""
    @State private var sumEnabled = true
    @State private var sumHour = 21
    @State private var sumVid = SummaryVid()
    @State private var showSumVid = false
    @State private var sumQueued = false
    // 05.09 — arkadaşlıktan çıkarma + davet akışı (ikisi de sunucuda vardı, istemcide yoktu)
    @State private var silinecekArkadas: Friend? = nil
    @State private var davetKod = ""
    @State private var davetPaylas = false
    @State private var davetGirisAcik = false
    @State private var davetGirisi = ""
    // 16.09: telsiz (bas-konuş, canlı telsiz daveti) durumları TELSİZ sekmesine taşındı.

    /// Dil seç: kaydet → App kökü .id ile yeniden kurulur; sunucuya yeni dili bildir (profil GET Accept-Language ile yazar)
    private func dilSec(_ k: String) {
        dilKayit = k
        Task { _ = await store.profile() }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(spacing: 16) {
                        // künye
                        VStack(spacing: 8) {
                            Button { showAvatar = true } label: {
                                AvatarView(name: prof?.name ?? store.me, avatar: prof?.avatar, size: 96)
                                    .overlay(alignment: .bottomTrailing) {
                                        Image(systemName: "pencil").font(.caption.bold()).foregroundStyle(.white)
                                            .frame(width: 30, height: 30).background(Brand.accent, in: Circle())
                                            .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2))
                                    }
                            }
                            Button {
                                newName = prof?.name ?? ""; showRename = true
                            } label: {
                                HStack(spacing: 5) {
                                    Text(prof?.name ?? store.me).font(.system(size: 25, weight: .bold))
                                    Image(systemName: "pencil").font(.caption).foregroundStyle(.secondary)
                                }
                            }.buttonStyle(.plain)
                            // @kullanıcıadı — arkadaşların seni bununla bulur
                            Button { showHandle = true } label: {
                                HStack(spacing: 5) {
                                    if let h = prof?.handle, !h.isEmpty {
                                        Text("@\(h)").font(.system(size: 15, weight: .semibold)).foregroundStyle(Brand.accent)
                                        Image(systemName: "pencil").font(.caption2).foregroundStyle(.secondary)
                                    } else {
                                        Image(systemName: "at").font(.caption.bold())
                                        Text(L("Kullanıcı adı seç","Pick a username")).font(.system(size: 14, weight: .semibold))
                                    }
                                }
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background((prof?.handle ?? "").isEmpty ? AnyShapeStyle(Brand.accent.opacity(0.18)) : AnyShapeStyle(.clear), in: Capsule())
                            }.buttonStyle(.plain)
                            Text(L("İsmin video başında görünür","Your name appears at the start of videos")).font(.caption).foregroundStyle(.secondary)
                        }.padding(.top, 8)

                        HStack(spacing: 12) {
                            stat("\(stats?.totalRides ?? 0)", L("Rota","Routes"))
                            stat("\(friends.count)", L("Arkadaş","Friends"))
                        }

                        // 05.11.2026: arkadaşlar / davet / kulüpler / grup sürüş → SOSYAL sekmesi (Social.swift)
                        section(L("Tipografi","Typography"))
                        ForEach(FONT_CHOICES) { f in
                            Button {
                                fontId = f.id
                            } label: {
                                HStack {
                                    Text(f.label).fontDesign(f.design)
                                    Spacer()
                                    if fontId == f.id { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
                                }.padding(.horizontal, 16).padding(.vertical, 14).contentShape(Rectangle())
                            }.buttonStyle(.borderless).glassPanel(16)
                            .animation(.snappy(duration: 0.3), value: fontId)
                        }

                        section(L("Rota kaydı","Ride tracking"))
                        Toggle(isOn: Binding(
                            get: { tracker.active },
                            set: { on in
                                if on { Task { if let t = await store.trackerInfo() { tracker.start(deviceId: t.id, url: t.url) } } }
                                else { tracker.stop() }
                            })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(L("Rotamı kaydet","Track my ride"), systemImage: "location.fill.viewfinder")
                                    .font(.system(size: 16, weight: .medium))
                                Text(L("Açıkken konumun arka planda kaydedilir; gezilerin otomatik rota olur.",
                                       "While on, your location is recorded in the background to auto-create your routes."))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }.padding(14).glassPanel(18).tint(Brand.accent)

                        // TEŞHİS: takip çalışıyor mu, en son ne zaman nokta gönderildi (kullanıcı gözüyle görür).
                        if tracker.active {
                            HStack(spacing: 10) {
                                Circle().fill(tracker.idleMode ? Color.blue : (tracker.lastSentAt != nil ? Color.green : Color.orange))
                                    .frame(width: 9, height: 9)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(tracker.idleMode
                                         ? L("Beklemede — hareket edince otomatik devam eder","Standby — resumes automatically when you move")
                                         : L("Arka plan takibi açık","Background tracking on"))
                                        .font(.system(size: 13, weight: .medium))
                                    if let ts = tracker.lastSentAt {
                                        Text(L("Son konum: ","Last location: ") + ts.formatted(date: .omitted, time: .standard)
                                             + "  ·  \(tracker.sentCount)/\(tracker.recvCount) " + L("nokta","points"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    } else if tracker.recvCount > 0 {
                                        Text(L("GPS alınıyor ({n}) ama gönderilemiyor",
                                               "GPS received ({n}) but not sending").replacingOccurrences(of: "{n}", with: "\(tracker.recvCount)")
                                             + (tracker.lastError.map { " — " + $0 } ?? ""))
                                            .font(.caption2).foregroundStyle(.orange)
                                    } else {
                                        Text(L("Henüz konum gönderilmedi — birkaç saniye hareket et.",
                                               "No location sent yet — move for a few seconds."))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                            }.padding(.horizontal, 14).padding(.vertical, 10).glassPanel(14)

                            // KRİTİK UYARILAR: Tam Konum kapalı / izin "Her Zaman" değil → rota kaydı ÇALIŞMAZ.
                            if tracker.preciseOff || !tracker.authAlways {
                                Button {
                                    if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(tracker.preciseOff
                                                 ? L("Tam Konum kapalı — rota kaydı çalışmaz","Precise Location is off — tracking won't work")
                                                 : L("Konum izni 'Her Zaman' değil","Location permission isn't 'Always'"))
                                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(.orange)
                                            Text(L("Dokun: Ayarlar → Konum → Her Zaman + Tam Konum",
                                                   "Tap: Settings → Location → Always + Precise"))
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                    }.padding(.horizontal, 14).padding(.vertical, 10).contentShape(Rectangle())
                                }.buttonStyle(.borderless).glassPanel(14)
                            }
                        }

                        // ÇEVRİMDIŞI KUYRUK (22.09 otobüs vakası): şebeke yokken noktalar telefonda
                        // birikir, bağlantı gelince otomatik gönderilir. 🔴 BİLEREK `if tracker.active`
                        // bloğunun DIŞINDA: takip kapatılsa bile tamponda bekleyen veri var olabilir
                        // (stop() tamponu silmez) ve kullanıcı onu görebilmeli.
                        if tracker.bekleyenNokta > 0 {
                            HStack(spacing: 10) {
                                Image(systemName: "arrow.up.circle.dotted").foregroundStyle(.orange)
                                // 🔴 Sayı L()'in DIŞINDA: L() çeviriyi İNGİLİZCE metne göre arar,
                                // interpolasyonlu dize sözlükte ASLA eşleşmez (10 dil İngilizce'ye düşerdi).
                                Text("\(tracker.bekleyenNokta) "
                                     + L("nokta çevrimdışı bekliyor — bağlantı gelince otomatik gönderilir",
                                         "points waiting offline — they'll upload automatically when you reconnect"))
                                    .font(.caption2).foregroundStyle(.orange)
                                Spacer()
                            }.padding(.horizontal, 14).padding(.vertical, 10).glassPanel(14)
                        }

                        // ALGILAMA HASSASİYETİ: Traccar sinyal aralığını kullanıcı dostu gizler.
                        // 03.11.2026: herkes Hassas/Dengeli/Basit seçer (kilit yok).
                        section(L("Algılama hassasiyeti","Detection sensitivity"))
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 6) {
                                Label(L("Algılama hassasiyeti","Detection sensitivity"), systemImage: "dot.radiowaves.left.and.right")
                                    .font(.system(size: 16, weight: .medium))
                                Spacer()
                            }
                            Picker("", selection: Binding(
                                get: { sensitivity },
                                set: { v in sensitivity = v; tracker.applySensitivity(v) })) {
                                Text(L("Hassas","High")).tag("hassas")
                                Text(L("Dengeli","Balanced")).tag("dengeli")
                                Text(L("Basit","Simple")).tag("basit")
                            }.pickerStyle(.segmented)
                            Text(sensDesc(sensitivity))
                                .font(.caption2).foregroundStyle(.secondary)
                        }.padding(14).glassPanel(18).tint(Brand.accent)

                        section(L("Günlük özet","Daily summary"))
                        VStack(spacing: 0) {
                            Toggle(isOn: Binding(
                                get: { sumEnabled },
                                set: { on in
                                    sumEnabled = on
                                    Task { await store.setSummarySettings(SummaryCfg(enabled: on, hour: sumHour, video: sumVid)) }
                                })) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Label(L("Günlük özet","Daily summary"), systemImage: "doc.text.magnifyingglass")
                                            .font(.system(size: 16, weight: .medium))
                                    }
                                    Text(L("Her gün seçtiğin saatte günün detaylı aktivite özeti.",
                                           "A detailed summary of your day at the time you choose."))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }.tint(Brand.accent)

                            if sumEnabled {
                                Divider().padding(.vertical, 10)
                                HStack {
                                    Label(L("Özet saati","Summary time"), systemImage: "clock")
                                        .font(.system(size: 15))
                                    Spacer()
                                    Picker("", selection: Binding(
                                        get: { sumHour },
                                        set: { h in sumHour = h; Task { await store.setSummarySettings(SummaryCfg(enabled: sumEnabled, hour: h, video: sumVid)) } })) {
                                        ForEach(0..<24, id: \.self) { h in Text(String(format: "%02d:00", h)).tag(h) }
                                    }.pickerStyle(.menu).tint(Brand.accent)
                                }
                                Divider().padding(.vertical, 10)
                                Button { showSumVid = true } label: {
                                    HStack {
                                        Label(L("Özet videosu ayarları","Summary video settings"), systemImage: "film")
                                            .font(.system(size: 15))
                                        Spacer()
                                        Text("\(sumVid.mode) · \(sumVid.aspect)").font(.caption).foregroundStyle(.secondary)
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                    }
                                }.tint(.primary)
                            }
                        }.padding(14).glassPanel(18)

                        Button {
                            Task { if await store.summaryNow(premium: true) { sumQueued = true } }
                        } label: {
                            Label(sumQueued ? L("Özet hazırlanıyor…","Preparing summary…")
                                            : L("Şimdi özet çıkar","Summarize now"),
                                  systemImage: sumQueued ? "checkmark.circle.fill" : "sparkles")
                                .frame(maxWidth: .infinity)
                        }.buttonStyle(.glassy).tint(Brand.accent).disabled(sumQueued)
                        Text(L("Şimdiye kadarki günü detaylıca özetler; hazır olunca bildirim gelir.",
                               "Summarizes your day so far; you'll get a notification when it's ready."))
                            .font(.caption2).foregroundStyle(.secondary).padding(.top, 2)

                        section(L("Görünüm","Appearance"))
                        Picker("", selection: $scheme) {
                            Text(L("Açık","Light")).tag("light")
                            Text(L("Koyu","Dark")).tag("dark")
                        }.pickerStyle(.segmented)

                        Toggle(isOn: $cloud.enabled) {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(L("iCloud yedekleme","iCloud backup"), systemImage: "icloud")
                                    .font(.system(size: 16, weight: .medium))
                                Text(L("Ayarların giriş gerekmeden cihazlarında saklanır","Your settings are kept across devices, no sign-in needed"))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }.padding(14).glassPanel(18).tint(Brand.accent)

                        // FİKİR KUTUSU (1.7): motorcular uygulamayı birlikte şekillendirir
                        // 10.11.2026: DİL SEÇİMİ (Barış) — boş = telefon dili; seçilince uygulama hemen o dile geçer,
                        // sunucu da bildirimleri bu dilde gönderir (Accept-Language → users.lang)
                        Menu {
                            Button { dilSec("") } label: {
                                if dilKayit.isEmpty { Label(L("Telefon dili","Phone language"), systemImage: "checkmark") }
                                else { Text(L("Telefon dili","Phone language")) }
                            }
                            ForEach(SUPPORTED, id: \.self) { k in
                                Button { dilSec(k) } label: {
                                    if dilKayit == k { Label(DIL_ADI[k] ?? k, systemImage: "checkmark") } else { Text(DIL_ADI[k] ?? k) }
                                }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "globe").font(.system(size: 22)).foregroundStyle(Brand.accent).frame(width: 30)
                                Text(L("Dil","Language")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                                Spacer()
                                Text(dilKayit.isEmpty ? L("Telefon dili","Phone language") : (DIL_ADI[dilKayit] ?? dilKayit))
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
                            }.padding(14).contentShape(Rectangle())
                        }.glassPanel(18)

                        Button { showFeedback = true } label: {
                            HStack(spacing: 12) {
                                Text("💡").font(.system(size: 26))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Fikrini söyle","Share your idea")).font(.system(size: 16, weight: .semibold))
                                    Text(L("Bu uygulama motorcuların — fikrin doğrudan geliştiriciye ulaşır",
                                           "This app belongs to riders — your idea goes straight to the developer"))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }.padding(14).contentShape(Rectangle())
                        }.buttonStyle(.plain).glassPanel(18)

                        // 10.11.2026: "Destek ol" bağış satırı KALDIRILDI (Barış) — uygulamada satın alma yok.


                        Button(L("Hesabı sil","Delete account")) { showDelete = true }
                            .font(.footnote).foregroundStyle(.red).padding(.top, 2)
                    }.padding(16)
                }
            }
            .navigationTitle(L("Profil","Profile"))
        }
        .task {
            prof = await store.profile(); await reloadFriends(); stats = await store.stats()
            let s = await store.summarySettings(); sumEnabled = s.enabled; sumHour = s.hour; sumVid = s.video
            if AppEnv.demo {
                try? await Task.sleep(for: .milliseconds(450))
                if AppEnv.screen == "avatar" { showAvatar = true }
            }
        }
        .onChange(of: store.davetYenile) { _, _ in
            Task { await reloadFriends() }
        }
        .sheet(isPresented: $showAvatar) { AvatarSheet(onDone: { Task { prof = await store.profile() } }) }
        .sheet(isPresented: $showHandle) { HandleSheet(current: prof?.handle ?? "", onDone: { Task { prof = await store.profile() } }) }
        .sheet(isPresented: $showFeedback) { FeedbackSheet() }
        // 16.09: canlı telsiz daveti + PTT meşgul polling'i TELSİZ sekmesine taşındı.
        .sheet(isPresented: $showSumVid) {
            SummaryVideoSheet(video: $sumVid) {
                Task { await store.setSummarySettings(SummaryCfg(enabled: sumEnabled, hour: sumHour, video: sumVid)) }
            }
        }
        .confirmationDialog(L("Hesabını kalıcı olarak silmek istiyor musun? Tüm rota, sohbet ve profil verin silinir.",
                              "Permanently delete your account? All your routes, chats and profile data will be removed."),
                            isPresented: $showDelete, titleVisibility: .visible) {
            Button(L("Hesabı sil","Delete account"), role: .destructive) { Task { await store.deleteAccount() } }
            Button(L("Vazgeç","Cancel"), role: .cancel) {}
        }
        .alert(L("İsmin","Your name"), isPresented: $showRename) {
            TextField(L("Ad Soyad","Full name"), text: $newName)
            Button(L("Kaydet","Save")) {
                let n = newName.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { Task { await store.setName(n); prof = await store.profile() } }
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) {}
        }
    }

    func reloadFriends() async {
        friends = await store.friends()
        let r = await store.friendRequests()
        incoming = r.incoming; outgoing = r.outgoing
    }
    func stat(_ v: String, _ k: String) -> some View {
        VStack(spacing: 4) {
            Text(v).font(.system(size: 27, weight: .bold)).foregroundStyle(Brand.gradient)
            Text(k).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).padding(.vertical, 16).glassPanel(20)
    }
    func section(_ t: String) -> some View {
        Text(t.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
    }
    func sensDesc(_ s: String) -> String {
        switch s {
        case "hassas":  return L("5 sn'de bir konum — en hassas algılama, en yoğun ve akıcı rota videosu (pil biraz daha çok).",
                                 "Location every 5s — highest detection, densest/smoothest route (a bit more battery).")
        case "dengeli": return L("~15 sn'de bir — dengeli: iyi algılama, makul pil.",
                                 "~Every 15s — balanced: good detection, reasonable battery.")
        default:        return L("~45 sn'de bir — en performanslı ve pil dostu, daha kaba algılama.",
                                 "~Every 45s — most efficient/battery-friendly, coarser detection.")
        }
    }
}

struct AvatarSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var onDone: () -> Void
    @State private var showPicker = false
    @State private var uploading = false

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(spacing: 14) {
                    Text(L("Profil resmi","Profile picture")).font(.title2.bold())

                    Button { showPicker = true } label: {
                        if uploading { ProgressView() }
                        else { Label(L("Fotoğraf seç ve kırp","Choose & crop photo"), systemImage: "crop") }
                    }.buttonStyle(.glassyProminent()).disabled(uploading)

                    Button(role: .destructive) {
                        Task { await store.setAvatar(Avatar(type: "initials")); onDone(); dismiss() }
                    } label: {
                        Label(L("Fotoğrafı kaldır","Remove photo"), systemImage: "trash").font(.subheadline)
                    }.foregroundStyle(.red)

                    Text(L("VEYA EMOJİ SEÇ","OR PICK AN EMOJI")).font(.caption).foregroundStyle(.secondary).padding(.top, 4)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 12) {
                        ForEach(EMOJIS, id: \.self) { e in
                            Button(e) {
                                Task { await store.setAvatar(Avatar(type: "emoji", value: e)); onDone(); dismiss() }
                            }.font(.system(size: 30)).frame(width: 46, height: 46).glassPanel(14)
                        }
                    }
                }.padding(24)
            }
        }
        .presentationDetents([.medium, .large])
        .sheet(isPresented: $showPicker) {
            ImageCropPicker(onImage: { img in
                showPicker = false; uploading = true
                Task {
                    defer { uploading = false }
                    if let jpeg = img.scaled(maxDim: 512).jpegData(compressionQuality: 0.85) {
                        _ = await store.uploadPhoto(jpeg); onDone(); dismiss()
                    }
                }
            }, onCancel: { showPicker = false })
            .ignoresSafeArea()
        }
    }
}

// Yerleşik kare kırpma (UIImagePickerController allowsEditing)
struct ImageCropPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    var onCancel: () -> Void
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .photoLibrary
        p.allowsEditing = true
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage, onCancel: onCancel) }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImage: (UIImage) -> Void; let onCancel: () -> Void
        init(onImage: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) { self.onImage = onImage; self.onCancel = onCancel }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
            let img = (info[.editedImage] as? UIImage) ?? (info[.originalImage] as? UIImage)
            if let img { onImage(img) } else { onCancel() }
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onCancel() }
    }
}

extension UIImage {
    // Yükleme öncesi küçült (backend 3MB sınırı + hız)
    func scaled(maxDim: CGFloat) -> UIImage {
        let f = min(maxDim / size.width, maxDim / size.height, 1)
        if f >= 1 { return self }
        let sz = CGSize(width: size.width * f, height: size.height * f)
        return UIGraphicsImageRenderer(size: sz).image { _ in draw(in: CGRect(origin: .zero, size: sz)) }
    }
}

// FİKİR KUTUSU: kullanıcının özellik fikri doğrudan geliştiriciye gider (Telegram/WhatsApp'a anında)
struct FeedbackSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var done = false
    @State private var failed = false
    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(alignment: .leading, spacing: 14) {
                if done {
                    VStack(spacing: 12) {
                        Text("🙌").font(.system(size: 52))
                        Text(L("Fikrin bana ulaştı — teşekkürler!","Got your idea — thank you!"))
                            .font(.title3.bold()).multilineTextAlignment(.center)
                        Text(L("Mantıklı bulursam bir sonraki güncellemede görebilirsin.",
                               "If it makes sense, you might see it in the next update."))
                            .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button(L("Kapat","Close")) { dismiss() }.buttonStyle(.glassy).padding(.top, 8)
                    }.frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    Text("💡 " + L("Fikrini söyle","Share your idea")).font(.title2.bold())
                    Text(L("Aklındaki özelliği, öneriyi veya derdini yaz — doğrudan geliştiriciye ulaşır. Samimi ol, biz de öyleyiz. 🏍️",
                           "Write the feature, suggestion or gripe on your mind — it goes straight to the developer. Be real, we are too. 🏍️"))
                        .font(.footnote).foregroundStyle(.secondary)
                    TextEditor(text: $text)
                        .frame(minHeight: 130).padding(10).scrollContentBackground(.hidden)
                        .glassPanel(16)
                    HStack {
                        Text("\(text.count)/1000").font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        if failed { Text(L("Gönderilemedi — tekrar dene","Couldn't send — try again")).font(.caption2).foregroundStyle(.red) }
                    }
                    Button {
                        sending = true; failed = false
                        Task {
                            let ok = await store.sendFeedback(String(text.prefix(1000)))
                            sending = false
                            if ok { withAnimation { done = true } } else { failed = true }
                        }
                    } label: {
                        HStack { if sending { ProgressView().tint(.white) }
                            Text(L("Gönder","Send")) }.frame(maxWidth: .infinity)
                    }.buttonStyle(.glassyProminent())
                    .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                    Spacer()
                }
            }.padding(24)
        }
        .presentationDetents([.medium, .large])
    }
}

// Kullanıcı adı seçme/değiştirme — benzersiz @handle (arkadaşların seni bununla bulur)
struct HandleSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var current: String
    var onDone: () -> Void
    @State private var text = ""
    @State private var err: String? = nil
    @State private var saving = false
    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(alignment: .leading, spacing: 16) {
                Text(L("Kullanıcı adın","Your username")).font(.title2.bold())
                Text(L("Benzersiz @kullanıcıadın — arkadaşların seni bununla bulup ekler.",
                       "Your unique @username — friends find and add you with it."))
                    .font(.footnote).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text("@").font(.title3.bold()).foregroundStyle(Brand.accent)
                    TextField(L("kullaniciadi","username"), text: $text)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .onChange(of: text) { _, v in
                            text = String(v.lowercased().filter { "abcdefghijklmnopqrstuvwxyz0123456789_.".contains($0) }.prefix(20))
                        }
                }.padding(14).glassPanel(16)
                Text(L("3–20 karakter: küçük harf, rakam, _ ve .","3–20 chars: lowercase letters, numbers, _ and ."))
                    .font(.caption2).foregroundStyle(.secondary)
                if let e = err {
                    Text(e == "taken" ? L("Bu kullanıcı adı alınmış — başka bir tane dene","This username is taken — try another")
                         : e == "invalid" ? L("Geçersiz kullanıcı adı","Invalid username")
                         : L("Bağlantı hatası — tekrar dene","Connection error — try again"))
                        .font(.footnote).foregroundStyle(.red)
                }
                Button {
                    saving = true
                    Task {
                        err = await store.setHandle(text)
                        saving = false
                        if err == nil { onDone(); dismiss() }
                    }
                } label: {
                    Text(saving ? "…" : L("Kaydet","Save")).frame(maxWidth: .infinity)
                }.buttonStyle(.glassy).disabled(text.count < 3 || saving)
                Spacer()
            }.padding(24)
        }
        .task { text = current }
        .presentationDetents([.medium])
    }
}

// Arkadaş ekle: @kullanıcıadıyla ARA -> istek gönder (onaylanınca arkadaş olunur)
struct AddFriendSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var myHandle: String
    var onDone: () -> Void
    @State private var q = ""
    @State private var results: [FoundUser] = []
    @State private var localStatus: [String:String] = [:]   // yereldeki anlık durum (istek attı/onayladı)
    @State private var searched = false
    var shareText: String {
        L("Move Log'da beni ekle","Add me on Move Log") + ": @\(myHandle) · https://apps.apple.com/app/id6780779399"
    }
    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(alignment: .leading, spacing: 14) {
                Text(L("Arkadaş ekle","Add friend")).font(.title2.bold())
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField(L("@kullanıcıadı ile ara","Search by @username"), text: $q)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: q) { _, v in
                            Task {
                                let t = v.trimmingCharacters(in: CharacterSet(charactersIn: " @"))
                                guard t.count >= 2 else { results = []; searched = false; return }
                                try? await Task.sleep(for: .milliseconds(350))   // debounce
                                guard q.trimmingCharacters(in: CharacterSet(charactersIn: " @")) == t else { return }
                                results = await store.findUsers(t); searched = true
                            }
                        }
                }.padding(12).glassPanel(14)
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(results) { u in
                            HStack(spacing: 12) {
                                AvatarView(name: u.name, avatar: u.avatar, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(u.name).font(.system(size: 16, weight: .semibold))
                                    if !u.handle.isEmpty { Text("@\(u.handle)").font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                statusButton(u)
                            }.padding(12).glassPanel(18)
                        }
                        if searched && results.isEmpty {
                            Text(L("Sonuç yok — kullanıcı adını kontrol et","No results — check the username"))
                                .font(.footnote).foregroundStyle(.secondary).padding(.top, 12)
                        }
                    }
                }
                if !myHandle.isEmpty {
                    Divider().padding(.vertical, 2)
                    Text(L("ARKADAŞINI DAVET ET","INVITE A FRIEND")).font(.caption).foregroundStyle(.secondary)
                    ShareLink(item: shareText) {
                        Label(L("Kullanıcı adımı paylaş","Share my username") + " (@\(myHandle))",
                              systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }.buttonStyle(.glassy)
                }
            }.padding(24)
        }
        .presentationDetents([.large])
    }
    @ViewBuilder func statusButton(_ u: FoundUser) -> some View {
        let st = localStatus[u.username] ?? u.status
        switch st {
        case "friend":
            Label(L("Arkadaş","Friend"), systemImage: "checkmark").font(.caption.bold()).foregroundStyle(.secondary)
        case "outgoing":
            Text(L("İstek gönderildi","Request sent")).font(.caption.bold()).foregroundStyle(.secondary)
        case "incoming":
            Button(L("Onayla","Accept")) {
                Task { await store.respondFriend(u.username, accept: true); localStatus[u.username] = "friend"; onDone() }
            }.buttonStyle(.glassy).fixedSize()
        default:
            Button(L("Ekle","Add")) {
                Task {
                    if let s = await store.friendRequest(u.username) {
                        localStatus[u.username] = (s == "friends") ? "friend" : "outgoing"; onDone()
                    }
                }
            }.buttonStyle(.glassy).fixedSize()
        }
    }
}

// Gün özeti videosu render ayarları (rotalardaki GenerateSheet'in karşılığı)
struct SummaryVideoSheet: View {
    @Binding var video: SummaryVid
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    private let colors = ROUTE_LINE_COLORS   // ortak palet (rotalardaki GenerateSheet ile aynı)
    var body: some View {
        NavigationStack {
            Form {
                Picker(L("Görünüm","Mode"), selection: $video.mode) {
                    Text(L("Düz","Flat")).tag("flat"); Text("Flyover").tag("flyover"); Text(L("3B","3D")).tag("3d")
                }
                Picker(L("Süre","Duration"), selection: $video.speed) {
                    Text(L("Kısa","Short")).tag("fast"); Text(L("Orta","Medium")).tag("medium")
                    Text(L("Uzun","Long")).tag("slow"); Text(L("Otonom","Auto")).tag("auto")
                }
                Picker(L("En-boy","Aspect"), selection: $video.aspect) {
                    Text("16:9").tag("16:9"); Text("9:16").tag("9:16")
                }
                Picker(L("Kamera","Camera"), selection: $video.cam) {
                    Text(L("Yakın","Near")).tag("yakin"); Text(L("Orta","Medium")).tag("orta"); Text(L("Uzak","Far")).tag("uzak")
                }
                Picker(L("Müzik","Music"), selection: $video.music) {
                    Text(L("Yok","None")).tag(""); Text("Chill").tag("stock:chill"); Text("Epic").tag("stock:epic")
                    Text("Upbeat").tag("stock:upbeat"); Text("Lo-Fi").tag("stock:lofi"); Text("Cinematic").tag("stock:cinematic")
                }
                Section(L("Rota çizgisi","Route line")) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            // Çizgisiz (sadece nokta)
                            ZStack {
                                Circle().fill(Color(.systemGray4)).frame(width: 32, height: 32)
                                Image(systemName: "line.diagonal").font(.system(size: 14)).foregroundStyle(.secondary)
                            }
                            .overlay(Circle().strokeBorder(.white, lineWidth: video.line == "none" ? 3 : 0))
                            .onTapGesture { video.line = "none" }
                            // Liquid glass (şeffaf frosted çizgi)
                            ZStack {
                                Circle().fill(LinearGradient(colors: [.white.opacity(0.45), Color(hex: "#AEE6FF").opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 32, height: 32)
                                Image(systemName: "drop.fill").font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                            }
                            .overlay(Circle().strokeBorder(.white.opacity(video.line == "glass" ? 1 : 0.5), lineWidth: video.line == "glass" ? 3 : 1))
                            .onTapGesture { video.line = "glass" }
                            // Renksiz tam şeffaf (en minimal cam)
                            ZStack {
                                Circle().fill(Color.white.opacity(0.06)).frame(width: 32, height: 32)
                                Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1).frame(width: 24, height: 24)
                            }
                            .overlay(Circle().strokeBorder(.white.opacity(video.line == "clear" ? 1 : 0.5), lineWidth: video.line == "clear" ? 3 : 1))
                            .onTapGesture { video.line = "clear" }
                            ForEach(colors, id: \.self) { hex in
                                Circle().fill(Color(hex: hex)).frame(width: 32, height: 32)
                                    .overlay(Circle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
                                    .overlay(Circle().strokeBorder(.white, lineWidth: video.line.caseInsensitiveCompare(hex) == .orderedSame ? 3 : 0))
                                    .onTapGesture { video.line = hex }
                            }
                        }.padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle(L("Özet videosu","Summary video"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Tamam","Done")) { onDone(); dismiss() } } }
        }
    }
}
