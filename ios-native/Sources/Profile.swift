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
    @AppStorage("nd_hrshare") var hrShare = true   // "Nabzımı arkadaşlarım görebilsin" (anlık nabız peek gizliliği)
    @State private var prof: Profile?
    @State private var friends: [Friend] = []
    @State private var incoming: [Friend] = []
    @State private var outgoing: [Friend] = []
    @State private var stats: Stats?
    @State private var showAvatar = false
    @State private var showAddFriend = false
    @State private var showHandle = false
    @State private var showFeedback = false
    @State private var showPaywall = false
    @State private var showDelete = false
    @State private var showRename = false
    @State private var newName = ""
    @State private var sumEnabled = true
    @State private var sumHour = 21
    @State private var sumVid = SummaryVid()
    @State private var showSumVid = false
    @State private var sumQueued = false
    @State private var groupPref = "both"   // grup sürüş video tercihi: both|group|solo
    @State private var showClubs = false
    @State private var showLeaders = false
    @State private var showSafety = false
    @State private var showBadges = false
    @State private var showWrapped = false
    @State private var showSharedRoutes = false
    // 05.09 — arkadaşlıktan çıkarma + davet akışı (ikisi de sunucuda vardı, istemcide yoktu)
    @State private var silinecekArkadas: Friend? = nil
    @State private var davetKod = ""
    @State private var davetPaylas = false
    @State private var davetGirisAcik = false
    @State private var davetGirisi = ""
    // 16.09: telsiz (bas-konuş, canlı telsiz daveti) durumları TELSİZ sekmesine taşındı.

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
                                    Text(ultraMember ? L("Taktik görevler açık · faydalarını gör","Tactical missions unlocked · see your perks")
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

                        // Gelen arkadaşlık istekleri — onayla/reddet
                        if !incoming.isEmpty {
                            section(L("Arkadaşlık istekleri","Friend requests"))
                            ForEach(incoming) { f in
                                HStack(spacing: 12) {
                                    AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold))
                                        if let h = f.handle, !h.isEmpty { Text("@\(h)").font(.caption).foregroundStyle(.secondary) }
                                    }
                                    Spacer()
                                    Button {
                                        Task { await store.respondFriend(f.username, accept: true); await reloadFriends() }
                                    } label: {
                                        Image(systemName: "checkmark").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                                            .frame(width: 38, height: 38).background(Brand.accent, in: Circle())
                                    }.buttonStyle(.plain)
                                    Button {
                                        Task { await store.respondFriend(f.username, accept: false); await reloadFriends() }
                                    } label: {
                                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.secondary)
                                            .frame(width: 38, height: 38).background(.white.opacity(0.08), in: Circle())
                                    }.buttonStyle(.plain)
                                }.padding(12).glassPanel(18).smoothAppear()
                            }
                        }

                        // 🔴 FİKS 05.09: /api/invite ve /api/invite/accept uçları sunucuda VARDI ama
                        // istemcide HİÇ kullanılmıyordu (ne link üretimi ne kabul) → davet akışı ölüydü.
                        section(L("Davet","Invite"))
                        HStack(spacing: 10) {
                            Button {
                                Task {
                                    davetKod = await store.invite()
                                    if !davetKod.isEmpty { davetPaylas = true }
                                }
                            } label: {
                                Label(L("Davet linki oluştur","Create invite link"), systemImage: "link")
                                    .font(.system(size: 14, weight: .semibold))
                            }.buttonStyle(.borderless)
                            Spacer()
                            Button(L("Kodum var","I have a code")) { davetGirisAcik = true }
                                .font(.system(size: 14, weight: .semibold))
                        }.padding(12).glassPanel(18)

                        section(L("Arkadaşlar","Friends"))
                        ForEach(friends) { f in
                            HStack(spacing: 12) {
                                AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold))
                                    if let h = f.handle, !h.isEmpty { Text("@\(h)").font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                // 16.09: telsiz (bas-konuş) + canlı telsiz butonları TELSİZ sekmesine taşındı,
                                // canlı takip tamamen kaldırıldı. Burada arkadaş YÖNETİMİ kalır (ekle/çıkar).
                            }.padding(12).glassPanel(18).smoothAppear()
                            // 🔴 FİKS 05.09: sunucudaki DELETE /api/friends/{uname} hiçbir yerden
                            // çağrılmıyordu — arkadaşlıktan çıkarma özelliği fiilen YOKTU.
                            .contextMenu {
                                Button(role: .destructive) { silinecekArkadas = f } label: {
                                    Label(L("Arkadaşlıktan çıkar","Remove friend"), systemImage: "person.badge.minus")
                                }
                            }
                        }
                        ForEach(outgoing) { f in
                            HStack(spacing: 12) {
                                AvatarView(name: f.name ?? f.username, avatar: f.avatar, size: 44).opacity(0.6)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name ?? f.username).font(.system(size: 16, weight: .semibold)).foregroundStyle(.secondary)
                                    Text(L("İstek gönderildi — onay bekleniyor","Request sent — awaiting approval")).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "hourglass").foregroundStyle(.secondary)
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

                        // GRUP SÜRÜŞ (1.7): arkadaşla birlikte sürüşte video tercihi
                        section(L("Grup sürüş","Group ride"))
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Label(L("Birlikte sürüş videosu","Ride-together video"), systemImage: "person.2.fill")
                                    .font(.system(size: 16, weight: .medium))
                                if !premium { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                                Spacer()
                                Picker("", selection: Binding(
                                    get: { groupPref },
                                    set: { v in
                                        if premium { groupPref = v; Task { await store.setGroupVideoPref(v) } }
                                        else { showPaywall = true }
                                    })) {
                                    Text(L("Ortak + kendi videom","Joint + my own")).tag("both")
                                    Text(L("Sadece ortak video","Joint video only")).tag("group")
                                    Text(L("Sadece kendi videom","My own video only")).tag("solo")
                                }.pickerStyle(.menu).tint(Brand.accent)
                            }
                            Text(L("Bir arkadaşınla birlikte sürünce ikinizin de yer aldığı TEK ortak video otomatik üretilir ve ikinize de gelir.",
                                   "When you ride with a friend, ONE shared video featuring both of you is created automatically and sent to you both."))
                                .font(.caption2).foregroundStyle(.secondary)
                        }.padding(14).glassPanel(18)
                        .onTapGesture { if !premium { showPaywall = true } }

                        // MOTORCU GRUPLARI (1.8): kulüp kur/katıl — arkadaşlık şartsız otomatik grup videosu
                        Button { showClubs = true } label: {
                            HStack(spacing: 12) {
                                Text("🏍️").font(.system(size: 26))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Motorcu grupların","Your rider groups")).font(.system(size: 16, weight: .semibold))
                                    Text(L("Grup kur, davet koduyla topla — birlikte sürünce video hepinizde",
                                           "Create a group, invite with a code — ride together, everyone gets the video"))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }.padding(14).contentShape(Rectangle())
                        }.buttonStyle(.plain).glassPanel(18)

                        // LİDERLİK (1.7): haftalık km yarışı — arkadaşlar + kulüp arkadaşları
                        Button { showLeaders = true } label: {
                            HStack(spacing: 12) {
                                Text("🏆").font(.system(size: 26))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Liderlik tablosu","Leaderboard")).font(.system(size: 16, weight: .semibold))
                                    Text(L("Bu hafta kim daha çok sürdü? Arkadaşlar + gruplar arası km yarışı",
                                           "Who rode the most this week? A km race among friends and groups"))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }.padding(14).contentShape(Rectangle())
                        }.buttonStyle(.plain).glassPanel(18)

                        // 1.8: güvenlik + rozet + wrapped + gelen rotalar
                        section(L("Sürüş dünyan","Your riding world"))
                        VStack(spacing: 0) {
                            Button { if ultraMember { showSafety = true } else { showPaywall = true } } label: {
                                HStack(spacing: 12) {
                                    Text("🛡️").font(.system(size: 22))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(L("Güvenli sürüş","Ride safety")).font(.system(size: 15, weight: .semibold))
                                        Text(L("'Sağ salim vardı' bildirimi sevdiğine gitsin","Auto 'safe and sound' note to your person"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.padding(.vertical, 10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                            Button { showBadges = true } label: {
                                HStack(spacing: 12) {
                                    Text("🏅").font(.system(size: 22))
                                    Text(L("Rozetlerim","My badges")).font(.system(size: 15, weight: .semibold))
                                    Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.padding(.vertical, 10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                            Button { showSharedRoutes = true } label: {
                                HStack(spacing: 12) {
                                    Text("🗺️").font(.system(size: 22))
                                    Text(L("Sana gelen rotalar","Routes shared with you")).font(.system(size: 15, weight: .semibold))
                                    Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.padding(.vertical, 10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                            Divider()
                            Toggle(isOn: Binding(
                                get: { ConvoyVoice.shared.enabled },
                                set: { v in if ultraMember { ConvoyVoice.shared.setEnabled(v) } else { showPaywall = true } })) {
                                HStack(spacing: 12) {
                                    Text("🔊").font(.system(size: 22))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(L("Sesli konvoy anonsları","Voice convoy announcements")).font(.system(size: 15, weight: .semibold))
                                        Text(L("Kulaklığına otomatik: 'Semra 400 metre geride'","Auto to your headset: 'Semra fell 400m behind'"))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }.tint(Brand.accent).padding(.vertical, 8)
                            Divider()
                            Toggle(isOn: Binding(
                                get: { hrShare },
                                set: { v in hrShare = v; Task { await store.hrShare(v) } })) {
                                HStack(spacing: 12) {
                                    Text("❤️").font(.system(size: 22))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(L("Nabzımı arkadaşlarım görebilsin","Let friends see my heart rate")).font(.system(size: 15, weight: .semibold))
                                        Text(L("Canlı takipte arkadaşın anlık nabzını görebilir (saat gerekir). Kapatırsan gizlenir.",
                                               "Friends can see your live heart rate on live-track (watch required). Turn off to hide."))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }.tint(Brand.accent).padding(.vertical, 8)
                            Divider()
                            Button { showWrapped = true } label: {
                                HStack(spacing: 12) {
                                    Text("🎁").font(.system(size: 22))
                                    Text(L("Yıl özetim","My year wrapped")).font(.system(size: 15, weight: .semibold))
                                    Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.padding(.vertical, 10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }.padding(.horizontal, 14).padding(.vertical, 4).glassPanel(18)

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
            prof = await store.profile(); await reloadFriends(); stats = await store.stats()
            if prof?.premium == true { UserDefaults.standard.set(true, forKey: "nd_gift"); premium = true }
            let s = await store.summarySettings(); sumEnabled = s.enabled; sumHour = s.hour; sumVid = s.video
            groupPref = await store.groupVideoPref()
            if AppEnv.demo {
                try? await Task.sleep(for: .milliseconds(450))
                if AppEnv.screen == "paywall" { showPaywall = true }
                if AppEnv.screen == "avatar" { showAvatar = true }
            }
        }
        .onChange(of: store.davetYenile) { _, _ in
            Task { await reloadFriends() }
        }
        .sheet(isPresented: $showAvatar) { AvatarSheet(onDone: { Task { prof = await store.profile() } }) }
        .sheet(isPresented: $showAddFriend) { AddFriendSheet(myHandle: prof?.handle ?? "", onDone: { Task { await reloadFriends() } }) }
        .sheet(isPresented: $showHandle) { HandleSheet(current: prof?.handle ?? "", onDone: { Task { prof = await store.profile() } }) }
        .sheet(isPresented: $showFeedback) { FeedbackSheet() }
        .sheet(isPresented: $showClubs) { ClubsSheet() }
        .sheet(isPresented: $showLeaders) { LeaderboardSheet() }
        .sheet(isPresented: $showSafety) { SafetySheet() }
        .sheet(isPresented: $showBadges) { BadgesSheet() }
        .sheet(isPresented: $showWrapped) { WrappedSheet() }
        .sheet(isPresented: $showSharedRoutes) { SharedRoutesSheet() }
        .confirmationDialog(
            L("Arkadaşlıktan çıkarılsın mı?","Remove this friend?"),
            isPresented: Binding(get: { silinecekArkadas != nil }, set: { if !$0 { silinecekArkadas = nil } }),
            titleVisibility: .visible
        ) {
            Button(L("Arkadaşlıktan çıkar","Remove friend"), role: .destructive) {
                if let f = silinecekArkadas {
                    Task { await store.removeFriend(f.username); await reloadFriends() }
                }
                silinecekArkadas = nil
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) { silinecekArkadas = nil }
        } message: {
            Text(silinecekArkadas.map { $0.name ?? $0.username } ?? "")
        }
        .sheet(isPresented: $davetPaylas) {
            if #available(iOS 16.0, *) {
                ShareLink(item: davetKod) { Text(L("Davet linkini paylaş","Share invite link")) }
                    .presentationDetents([.medium])
            }
        }
        .alert(L("Davet kodu","Invite code"), isPresented: $davetGirisAcik) {
            TextField(L("Kodu yapıştır","Paste the code"), text: $davetGirisi)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(L("Kabul et","Accept")) {
                let kod = DavetLink.ayikla(davetGirisi)
                davetGirisi = ""
                Task {
                    let ok = await store.acceptInvite(kod)
                    store.davetSonuc = ok ? L("Arkadaş eklendi 🤝","Friend added 🤝")
                                          : L("Kod geçersiz veya süresi dolmuş.","Invalid or expired code.")
                    if ok { store.davetYenile += 1; await reloadFriends() }
                }
            }
            Button(L("Vazgeç","Cancel"), role: .cancel) { davetGirisi = "" }
        }
        // 16.09: canlı telsiz daveti + PTT meşgul polling'i TELSİZ sekmesine taşındı.
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
        .init(icon: "dot.radiowaves.left.and.right", title: L("Canlı interkom & telsiz","Live intercom & radio"),
              sub: L("Kulübünle canlı sesli konuş — cihazsız, ücretsiz","Talk live with your club — no device needed")),
        .init(icon: "waveform", title: L("Sesli konvoy anonsları","Voice convoy announcements"),
              sub: L("Kulaklığına: 'Semra 400m geride'","To your headset: 'Semra 400m behind'")),
        // 16.09: "Canlı takip & konvoy haritası" perk'i KALDIRILDI — özellik uygulamadan çıktı,
        // olmayan bir şeyi paywall'da satmayalım (App Store incelemesi + kullanıcı güveni).
        .init(icon: "shield.lefthalf.filled", title: L("Güvenli sürüş","Ride safety"),
              sub: L("Sevdiğine otomatik 'sağ salim vardım'","Auto 'safe and sound' to your person")),
        .init(icon: "rosette", title: L("Rozetler, liderlik & meydan okuma","Badges, leaderboard & challenges"),
              sub: L("Toplulukla yarış, rota gönder","Compete, share routes")),
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
        // 16.09: "Uydu haritası" perk'i KALDIRILDI — uydu görünümü canlı konum haritasının
        // özelliğiydi, harita sekmesiyle birlikte çıktı.
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
                        Text(L("Taktik görev videoları, 3B binalı en yüksek çözünürlüklü harita ve tüm kamera açıları dahil her şey açık:","Tactical mission videos, highest-resolution map with 3D buildings and every camera angle — all unlocked:"))
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
                            // APPLE RESMİ KOD EKRANI (2026-08-26, Barış: "Apple'ın resmi kodunu gir").
                            // App Store Connect'te tanımlı Teklif Kodu / Promosyon Kodu buradan kullanılır.
                            // ⚠️ Kendi sunucu kodumuzla premium açan alan KALDIRILDI: App Store dışı bir
                            // mekanizmayla ücretli özellik açmak App Review 3.1.1 riskiydi. Artık abonelik
                            // gerçekten StoreKit üzerinden başlar (yenilenir, iptal edilir, Aile Paylaşımı çalışır).
                            Button {
                                redeeming = true
                                Task {
                                    await iap.redeemOfferCode()
                                    redeeming = false
                                    await iap.load(); await store.syncPremium()
                                    premium = iap.purchased || premium
                                }
                            } label: {
                                if redeeming { ProgressView() }
                                else { Text(L("Kodu kullan","Redeem code")) }
                            }.buttonStyle(.glassy).disabled(redeeming)
                            Text(L("App Store hediye/teklif kodunu buraya girebilirsin.",
                                   "Redeem your App Store gift or offer code."))
                                .font(.caption2).foregroundStyle(.secondary)
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
        // ÜCRETSİZ DENEME rozeti: StoreKit intro offer'dan canlı okunur (yıllıkta 7 gün FREE_TRIAL var,
        // ASC'den kaldırılırsa rozet kendiliğinden kaybolur — app güncellemesi gerekmez).
        let trial: String? = {
            guard let intro = p.subscription?.introductoryOffer, intro.paymentMode == .freeTrial else { return nil }
            let v = intro.period.value
            let unit: String
            switch intro.period.unit {
            case .day:   unit = v == 7 ? L("7 gün","7 days") : "\(v) " + L("gün","days")
            case .week:  unit = v == 1 ? L("7 gün","7 days") : "\(v) " + L("hafta","weeks")
            case .month: unit = "\(v) " + L("ay","mo")
            default:     unit = "\(v)"
            }
            return unit
        }()
        return Button {
            // 17.09 gece (Cursor e2e-2 #1): başarısızlıkta `premium`'a DOKUNMA — `apply` yerel bayrağı rapordan önce
            // açıyor, `premium = iap.purchased` yazınca görünüm "Premium aktif" dalına geçip lastError'ı gizliyordu.
            Task { let ok = await iap.buy(p); if ok { premium = iap.purchased; dismiss() } else { failed = true } }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.displayName).font(.system(size: 16, weight: .semibold))
                    if let trial {
                        Text(trial + " " + L("ücretsiz dene, sonra","free trial, then") + " \(p.displayPrice) / \(period)")
                            .font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        Text("\(p.displayPrice) / \(period)").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if iap.working { ProgressView() }
                else if trial != nil {
                    Text(L("ÜCRETSİZ DENE","FREE TRIAL")).font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 9).padding(.vertical, 5).background(Brand.gradient, in: Capsule())
                } else if let badge {
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
                    // 2026-08-10: Google Photorealistic 3D + Street View ARTIK YOK — GCP faturası askıya
                    // alındı, 3D Tiles API 404 (ölçüldü). Kullanılamayan özellik SATILMAZ (Barış kuralı).
                    // Metin Ultra'nın GERÇEK ayrıcalıklarına çevrildi: taktik görev videoları + 3B binalı
                    // en yüksek çözünürlüklü harita + kamera açıları + 4 kat aylık kota.
                    Text(L("Ultra — Taktik görev videoları","Ultra — Tactical mission videos")).font(.subheadline.bold())
                }.padding(.top, 8)
                Text(L("Askeri tarzda taktik görev videoları, 3B binalı en yüksek çözünürlüklü harita katmanı, sinematik kamera açıları (Arkadan) ve 4 kat aylık video hakkı.",
                       "Military-style tactical mission videos, highest-resolution map layer with 3D buildings, cinematic camera angles (Chase) and 4x monthly video quota."))
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
                    Text("🎖️ Tactical (Ultra)").tag("tactical")
                }
                if video.mode == "tactical" {
                    Text(L("Askeri uydu görevi: günün tüm hareketi tek operasyonda. 9:16 sabit, süre 60sn altı (Reels uyumlu).",
                           "Military satellite op: your whole day in one mission. Fixed 9:16, under 60s (Reels-ready)."))
                        .font(.caption2).foregroundStyle(.secondary)
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
