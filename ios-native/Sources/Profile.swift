import SwiftUI
import PhotosUI
import UIKit
import StoreKit

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
    @AppStorage("nd_premium") var premium = false
    @AppStorage("nd_ultra") var ultraMember = false   // Ultra rozeti (IAP.setUltra yazar) — altın kart
    @AppStorage("nd_sensitivity") var sensitivity = "dengeli"   // algılama hassasiyeti (premium seçer; free=basit)
    @State private var prof: Profile?
    @State private var friends: [Friend] = []
    @State private var stats: Stats?
    @State private var showAvatar = false
    @State private var showAddFriend = false
    @State private var showPaywall = false
    @State private var showDelete = false
    @State private var showRename = false
    @State private var newName = ""
    @State private var sumEnabled = true
    @State private var sumHour = 21
    @State private var sumVid = SummaryVid()
    @State private var showSumVid = false
    @State private var sumQueued = false

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
                            Text(L("İsmin video başında görünür","Your name appears at the start of videos")).font(.caption).foregroundStyle(.secondary)
                        }.padding(.top, 8)

                        HStack(spacing: 12) {
                            stat("\(stats?.totalRides ?? 0)", L("Rota","Routes"))
                            stat("\(friends.count)", L("Arkadaş","Friends"))
                        }

                        // Premium/Ultra kartı (şık, gradyan; Ultra = altın)
                        Button { showPaywall = true } label: {
                            HStack(spacing: 14) {
                                Image(systemName: (premium || ultraMember) ? "crown.fill" : "star.fill")
                                    .font(.system(size: 23, weight: .semibold)).foregroundStyle(.white)
                                    .frame(width: 50, height: 50).background(.white.opacity(0.22), in: Circle())
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(ultraMember ? L("Ultra üyesin","You're Ultra")
                                         : premium ? L("Premium üyesin","You're Premium")
                                                   : L("Move Log Premium","Move Log Premium"))
                                        .font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                                    Text(ultraMember ? L("Google 3D + Street View açık · faydalarını gör","Google 3D + Street View unlocked · see your perks")
                                         : premium ? L("Tüm özellikler açık · faydalarını gör","All features unlocked · see your perks")
                                                   : L("3B videolar, filigransız, müzik ve dahası","3D videos, no watermark, music & more"))
                                        .font(.caption).foregroundStyle(.white.opacity(0.9)).lineLimit(2)
                                }
                                Spacer()
                                if premium || ultraMember {
                                    Image(systemName: "checkmark.seal.fill").foregroundStyle(.white)
                                } else {
                                    Image(systemName: "chevron.right").foregroundStyle(.white.opacity(0.8))
                                }
                            }
                            .padding(16)
                            .background(ultraMember ? AnyShapeStyle(Brand.goldGradient) : AnyShapeStyle(Brand.gradient),
                                        in: RoundedRectangle(cornerRadius: 22))
                            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(.white.opacity(ultraMember ? 0.45 : 0.25), lineWidth: 1))
                            .shadow(color: (ultraMember ? Brand.gold : Brand.accent).opacity(0.38), radius: 14, y: 6)
                        }.buttonStyle(.plain).smoothAppear()

                        section(L("Arkadaşlar","Friends"))
                        ForEach(friends) { f in
                            HStack(spacing: 12) {
                                AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold))
                                    Text("@\(f.username)").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                            }.padding(12).glassPanel(18).smoothAppear()
                        }
                        Button { showAddFriend = true } label: {
                            Label(L("Arkadaş ekle","Add friend"), systemImage: "person.badge.plus")
                        }.buttonStyle(.glassy)

                        section(L("Tipografi","Typography"))
                        ForEach(FONT_CHOICES) { f in
                            Button {
                                if f.free || premium { fontId = f.id } else { showPaywall = true }
                            } label: {
                                HStack {
                                    Text(f.label).fontDesign(f.design)
                                    Spacer()
                                    if fontId == f.id { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
                                    else if !f.free && !premium { Image(systemName: "lock.fill").foregroundStyle(.secondary) }
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
                                Circle().fill(tracker.lastSentAt != nil ? Color.green : Color.orange)
                                    .frame(width: 9, height: 9)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Arka plan takibi açık","Background tracking on"))
                                        .font(.system(size: 13, weight: .medium))
                                    if let ts = tracker.lastSentAt {
                                        Text(L("Son konum: ","Last location: ") + ts.formatted(date: .omitted, time: .standard)
                                             + "  ·  \(tracker.sentCount)/\(tracker.recvCount) " + L("nokta","points"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    } else if tracker.recvCount > 0 {
                                        Text(L("GPS alınıyor (\(tracker.recvCount)) ama gönderilemiyor",
                                               "GPS received (\(tracker.recvCount)) but not sending")
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

                        // ALGILAMA HASSASİYETİ: Traccar sinyal aralığını kullanıcı dostu gizler.
                        // Free=basit (kilitli); premium Hassas/Dengeli/Basit seçer.
                        section(L("Algılama hassasiyeti","Detection sensitivity"))
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 6) {
                                Label(L("Algılama hassasiyeti","Detection sensitivity"), systemImage: "dot.radiowaves.left.and.right")
                                    .font(.system(size: 16, weight: .medium))
                                if !premium { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                                Spacer()
                            }
                            Picker("", selection: Binding(
                                get: { premium ? sensitivity : "basit" },
                                set: { v in
                                    if premium { sensitivity = v; tracker.applySensitivity(v) }
                                    else { showPaywall = true }
                                })) {
                                Text(L("Hassas","High")).tag("hassas")
                                Text(L("Dengeli","Balanced")).tag("dengeli")
                                Text(L("Basit","Simple")).tag("basit")
                            }.pickerStyle(.segmented).disabled(!premium)
                            Text(sensDesc(premium ? sensitivity : "basit"))
                                .font(.caption2).foregroundStyle(.secondary)
                            if !premium {
                                Text(L("Hassas ve Dengeli için Premium gerekir — daha hassas algılama + daha akıcı video.",
                                       "High & Balanced need Premium — finer detection + smoother video."))
                                    .font(.caption2).foregroundStyle(Brand.accent)
                            }
                        }.padding(14).glassPanel(18).tint(Brand.accent)
                        .onTapGesture { if !premium { showPaywall = true } }

                        section(L("Günlük özet","Daily summary"))
                        VStack(spacing: 0) {
                            Toggle(isOn: Binding(
                                get: { sumEnabled && premium },
                                set: { on in
                                    if premium {
                                        sumEnabled = on
                                        Task { await store.setSummarySettings(SummaryCfg(enabled: on, hour: sumHour, video: sumVid)) }
                                    } else { showPaywall = true }
                                })) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Label(L("Günlük özet","Daily summary"), systemImage: "doc.text.magnifyingglass")
                                            .font(.system(size: 16, weight: .medium))
                                        if !premium { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                                    }
                                    Text(L("Her gün seçtiğin saatte günün detaylı aktivite özeti.",
                                           "A detailed summary of your day at the time you choose."))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }.tint(Brand.accent)

                            if premium && sumEnabled {
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
                        .onTapGesture { if !premium { showPaywall = true } }

                        Button {
                            if premium {
                                Task { if await store.summaryNow(premium: true) { sumQueued = true } }
                            } else { showPaywall = true }
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

                        Button(L("Çıkış","Sign out")) { store.logout() }
                            .buttonStyle(.glassy).padding(.top, 8).tint(.red)

                        Button(L("Hesabı sil","Delete account")) { showDelete = true }
                            .font(.footnote).foregroundStyle(.red).padding(.top, 2)
                    }.padding(16)
                }
            }
            .navigationTitle(L("Profil","Profile"))
        }
        .task {
            prof = await store.profile(); friends = await store.friends(); stats = await store.stats()
            if prof?.premium == true { UserDefaults.standard.set(true, forKey: "nd_gift"); premium = true }
            let s = await store.summarySettings(); sumEnabled = s.enabled; sumHour = s.hour; sumVid = s.video
            if AppEnv.demo {
                try? await Task.sleep(for: .milliseconds(450))
                if AppEnv.screen == "paywall" { showPaywall = true }
                if AppEnv.screen == "avatar" { showAvatar = true }
            }
        }
        .sheet(isPresented: $showAvatar) { AvatarSheet(onDone: { Task { prof = await store.profile() } }) }
        .sheet(isPresented: $showAddFriend) { AddFriendSheet(onDone: { Task { friends = await store.friends() } }) }
        .sheet(isPresented: $showPaywall) { PaywallSheet(premium: $premium) }
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

struct AddFriendSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    var onDone: () -> Void
    @State private var uname = ""; @State private var link = ""; @State private var err = false
    var body: some View {
        ZStack {
            AuroraBackground()
            VStack(alignment: .leading, spacing: 16) {
                Text(L("Arkadaş ekle","Add friend")).font(.title2.bold())
                Text(L("KULLANICI ADIYLA","BY USERNAME")).font(.caption).foregroundStyle(.secondary)
                HStack {
                    TextField("@" + L("kullanıcı","username"), text: $uname)
                        .textInputAutocapitalization(.never).padding(12).glassPanel(14)
                    Button(L("Ekle","Add")) {
                        Task { if await store.addFriend(uname.trimmingCharacters(in: CharacterSet(charactersIn: " @"))) { onDone(); dismiss() } else { err = true } }
                    }.buttonStyle(.glassy).fixedSize()
                }
                if err { Text(L("Kullanıcı bulunamadı","User not found")).font(.footnote).foregroundStyle(.red) }
                Divider().padding(.vertical, 8)
                Text(L("DAVET BAĞLANTISI","INVITE LINK")).font(.caption).foregroundStyle(.secondary)
                HStack {
                    Text(link.isEmpty ? "…" : link).font(.footnote).lineLimit(1).padding(12).glassPanel(14)
                    ShareLink(item: link) { Image(systemName: "square.and.arrow.up") }.disabled(link.isEmpty)
                }
                Spacer()
            }.padding(24)
        }
        .task { link = await store.invite() }
        .presentationDetents([.medium])
    }
}

struct PaywallSheet: View {
    @Binding var premium: Bool
    @EnvironmentObject var iap: IAP
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var failed = false
    @State private var triedLoad = false
    @State private var code = ""
    @State private var codeErr = false
    @State private var redeeming = false

    struct Perk: Identifiable { let id = UUID(); let icon: String; let title: String; let sub: String }
    var perks: [Perk] {[
        .init(icon: "video.fill", title: L("3B flyover videolar","3D flyover videos"),
              sub: L("Arazi yüksekliğiyle sinematik rota videoları","Cinematic 3D terrain route videos")),
        .init(icon: "drop.fill", title: L("Filigransız & 1080p","No watermark & 1080p"),
              sub: L("Yüksek çözünürlük, logo yok","High resolution, no logo")),
        .init(icon: "music.note", title: L("Videoya müzik","Music on videos"),
              sub: L("Kendi müziğini ekle","Add your own soundtrack")),
        .init(icon: "camera.fill", title: L("Anı fotoğrafları","Memory photos"),
              sub: L("Rota üzerine fotoğraf yerleştir","Pin photos along the route")),
        .init(icon: "bolt.fill", title: L("En hızlı an & özet sahneleri","Peak moment & recap"),
              sub: L("Zirve hız etiketi, giriş & kapanış","Top-speed label, intro & outro")),
        .init(icon: "wand.and.stars", title: L("Otomatik video","Automatic video"),
              sub: L("Gezi bitince otomatik üretilir","Auto-made after each trip")),
        .init(icon: "doc.text.magnifyingglass", title: L("Günlük özet","Daily summary"),
              sub: L("Saat ayarı + anında özet","Custom time + on-demand")),
        .init(icon: "globe.americas.fill", title: L("Uydu haritası","Satellite map"),
              sub: L("Sevdiklerini uydu görünümünde izle","See your people on satellite view")),
    ]}

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(spacing: 14) {
                    Image(systemName: premium ? "crown.fill" : "star.fill").font(.system(size: 34))
                        .foregroundStyle(iap.ultra ? AnyShapeStyle(Brand.goldGradient) : AnyShapeStyle(Brand.gradient))
                        .frame(width: 72, height: 72).glassPanel(36)
                    if iap.ultra {
                        Text(L("Ultra üyesin 👑","You're Ultra 👑")).font(.title2.bold())
                            .foregroundStyle(Brand.goldGradient)
                        Text(L("Google 3D, tüm kamera açıları ve Street View dahil her şey açık:","Google 3D, every camera angle and Street View — all unlocked:"))
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    } else if premium {
                        Text(L("Premium üyesin ✨","You're Premium ✨")).font(.title2.bold())
                        Text(L("Şu an tüm bu özelliklerin keyfini çıkarıyorsun:","You're currently enjoying all of these:"))
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    } else {
                        Text("Move Log Premium").font(.title2.bold())
                        Text(L("Rotalarını bambaşka bir seviyeye taşı.","Take your routes to a whole new level."))
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }

                    VStack(spacing: 9) { ForEach(perks) { perkRow($0) } }.padding(.vertical, 4)

                    if premium {
                        Text(iap.ultra ? L("Ultra aktif","Ultra active") : L("Premium aktif","Premium active"))
                            .font(.caption.bold()).foregroundStyle(iap.ultra ? .black : .white)
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(iap.ultra ? AnyShapeStyle(Brand.goldGradient) : AnyShapeStyle(Brand.gradient), in: Capsule())
                            .padding(.top, 2)

                        // Günlük 2x Boost (consumable) — premium üyeye, rotasız erişilebilir satın alma
                        if let b = iap.boost {
                            Button {
                                Task { _ = await iap.buyBoost() }
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "bolt.fill").foregroundStyle(.yellow)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(L("Günlük 2× Boost","Daily 2× Boost")).font(.subheadline.weight(.semibold))
                                        Text(L("Bugünün video limitini 2 katına çıkar","Double today's video limit"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if iap.boostWorking { ProgressView() } else { Text(b.displayPrice).font(.subheadline.bold()) }
                                }.padding(.horizontal, 14).padding(.vertical, 12)
                            }.buttonStyle(.plain).glassPanel(14).tint(.primary).disabled(iap.boostWorking).padding(.top, 6)
                            if let m = iap.boostMsg {
                                Text(m).font(.caption2).foregroundStyle(Brand.accent)
                            }
                        }

                        ultraBlock()   // premium üye -> Ultra'ya yükselt

                        Link(L("Aboneliği yönet","Manage subscription"),
                             destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                            .font(.footnote).tint(Brand.accent).padding(.top, 6)
                        Button(L("Kapat","Close")) { dismiss() }.foregroundStyle(.secondary).padding(.top, 4)
                    } else {
                        if let y = iap.yearly { planButton(y, period: L("yıl","yr"), badge: L("EN AVANTAJLI","BEST VALUE")) }
                        if let m = iap.monthly { planButton(m, period: L("ay","mo"), badge: nil) }
                        ultraBlock()
                        if iap.monthly == nil, iap.yearly == nil {
                            if AppEnv.demo {
                                staticRow(L("Premium Yıllık","Premium Yearly"), "$29.99", L("yıl","yr"), L("EN AVANTAJLI","BEST VALUE"))
                                staticRow(L("Premium Aylık","Premium Monthly"), "$4.99", L("ay","mo"), nil)
                            } else if triedLoad {
                                Button(L("Planları yükle","Load plans")) { Task { await iap.load() } }.buttonStyle(.glassy)
                                Text(L("Bağlantını kontrol et.","Check your connection.")).font(.caption2).foregroundStyle(.secondary)
                            } else {
                                ProgressView().padding(.vertical, 8)
                            }
                        }
                        Button(L("Satın alımları geri yükle","Restore purchases")) {
                            Task { await iap.restore(); premium = iap.purchased; if iap.purchased { dismiss() } }
                        }.font(.footnote).foregroundStyle(.secondary).padding(.top, 2)

                        // Hediye kodu
                        VStack(spacing: 8) {
                            Label(L("Hediye kodun mu var?","Have a gift code?"), systemImage: "gift.fill")
                                .font(.system(size: 14, weight: .medium)).foregroundStyle(Brand.gradient)
                            HStack(spacing: 10) {
                                TextField(L("KOD","CODE"), text: $code)
                                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                                    .multilineTextAlignment(.center)
                                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                                Button {
                                    redeeming = true; codeErr = false
                                    Task {
                                        let ok = await store.redeem(code.trimmingCharacters(in: .whitespaces))
                                        redeeming = false
                                        if ok { premium = true; dismiss() } else { codeErr = true }
                                    }
                                } label: {
                                    if redeeming { ProgressView() } else { Text(L("Kullan","Redeem")) }
                                }.buttonStyle(.glassy).disabled(redeeming || code.count < 6)
                            }
                            if codeErr {
                                Text(L("Kod geçersiz veya kullanılmış.","Invalid or already used code."))
                                    .font(.caption2).foregroundStyle(.red)
                            }
                        }.padding(14).glassPanel(16).padding(.top, 8)
                        if let e = iap.lastError {
                            Text(e).font(.footnote).foregroundStyle(.red)
                                .multilineTextAlignment(.center).padding(.horizontal, 8)
                        } else if failed {
                            Text(L("Satın alma tamamlanmadı.","Purchase didn’t complete."))
                                .font(.footnote).foregroundStyle(.red)
                        }
                        if let m = iap.loadMsg {
                            Text(m).font(.caption2).foregroundStyle(.orange)
                                .multilineTextAlignment(.center).padding(.horizontal, 8)
                        }
                        Text(L("Abonelik otomatik yenilenir; dönem sonundan en az 24 saat önce iptal etmezsen ücretlendirilirsin. Ayarlar’dan istediğin zaman iptal edebilirsin.",
                               "Subscription auto-renews unless canceled at least 24h before the period ends. Manage or cancel anytime in Settings."))
                            .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.top, 6)
                        HStack(spacing: 18) {
                            Link(L("Kullanım Şartları","Terms of Use"), destination: URL(string: "https://app.nickdegs.com/terms.html")!)
                            Link(L("Gizlilik","Privacy"), destination: URL(string: "https://app.nickdegs.com/privacy.html")!)
                        }.font(.caption2).tint(Brand.accent)
                        Button(L("Belki sonra","Maybe later")) { dismiss() }.foregroundStyle(.secondary).padding(.top, 2)
                    }
                }.padding(26)
            }
        }
        .presentationDetents([.large])
        .task { if iap.monthly == nil && iap.yearly == nil { await iap.load() }; triedLoad = true }
    }

    func perkRow(_ p: Perk) -> some View {
        HStack(spacing: 13) {
            Image(systemName: p.icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(Brand.gradient)
                .frame(width: 38, height: 38).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title).font(.system(size: 15, weight: .semibold))
                Text(p.sub).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            if premium { Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.accent) }
        }.frame(maxWidth: .infinity).padding(12).glassPanel(16)
    }

    func staticRow(_ name: String, _ price: String, _ period: String, _ badge: String?) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.system(size: 16, weight: .semibold))
                Text("\(price) / \(period)").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if let badge {
                Text(badge).font(.caption2.bold()).foregroundStyle(.white)
                    .padding(.horizontal, 9).padding(.vertical, 5).background(Brand.gradient, in: Capsule())
            }
        }.frame(maxWidth: .infinity).padding(16).glassPanel(20)
    }

    func planButton(_ p: Product, period: String, badge: String?) -> some View {
        Button {
            Task { let ok = await iap.buy(p); premium = iap.purchased; if ok { dismiss() } else { failed = true } }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.displayName).font(.system(size: 16, weight: .semibold))
                    Text("\(p.displayPrice) / \(period)").font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                if iap.working { ProgressView() }
                else if let badge {
                    Text(badge).font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 9).padding(.vertical, 5).background(Brand.gradient, in: Capsule())
                }
            }.frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain).padding(16).glassPanel(20).disabled(iap.working)
    }

    // ULTRA yükseltme bloğu: Google 3D + kamera modları + Street View (ultra değilse göster)
    @ViewBuilder func ultraBlock() -> some View {
        if !iap.ultra, iap.ultraMonthly != nil || iap.ultraYearly != nil {
            VStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").foregroundStyle(Brand.gradient)
                    Text(L("Ultra — Google 3D + Street View","Ultra — Google 3D + Street View")).font(.subheadline.bold())
                }.padding(.top, 8)
                Text(L("Foto-gerçekçi Google 3D harita, tüm kamera açıları (Arkadan) ve gerçek Street View sokak sürüşü.",
                       "Photorealistic Google 3D map, all camera angles (Chase) and real first-person Street View driving."))
                    .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 8)
                if let uy = iap.ultraYearly { planButton(uy, period: L("yıl","yr"), badge: "ULTRA") }
                if let um = iap.ultraMonthly { planButton(um, period: L("ay","mo"), badge: nil) }
            }
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
