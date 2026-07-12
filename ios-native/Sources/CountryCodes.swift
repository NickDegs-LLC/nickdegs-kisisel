import SwiftUI

// Ülke kodu seçici (WhatsApp tarzı): bayrak + yerelleştirilmiş ülke adı + arama kodu.
// Ülke adları iOS'tan otomatik yerelleşir (Locale); bayrak bölge kodundan üretilir.
// Varsayılan: cihazın bölgesi (ABD'li kullanıcıya +1 hazır gelir) — uluslararası kayıt engeli kalkar.
enum CountryDial {
    // ITU arama kodları (bölge kodu -> kod). Paylaşılan kodlar (+1, +7, +44 vb.) bölge bazında ayrı satır.
    static let dial: [String: String] = [
        "AF":"93","AL":"355","DZ":"213","AS":"1","AD":"376","AO":"244","AI":"1","AG":"1","AR":"54","AM":"374",
        "AW":"297","AU":"61","AT":"43","AZ":"994","BS":"1","BH":"973","BD":"880","BB":"1","BY":"375","BE":"32",
        "BZ":"501","BJ":"229","BM":"1","BT":"975","BO":"591","BA":"387","BW":"267","BR":"55","BN":"673","BG":"359",
        "BF":"226","BI":"257","KH":"855","CM":"237","CA":"1","CV":"238","KY":"1","CF":"236","TD":"235","CL":"56",
        "CN":"86","CO":"57","KM":"269","CG":"242","CD":"243","CR":"506","CI":"225","HR":"385","CU":"53","CY":"357",
        "CZ":"420","DK":"45","DJ":"253","DM":"1","DO":"1","EC":"593","EG":"20","SV":"503","GQ":"240","ER":"291",
        "EE":"372","SZ":"268","ET":"251","FJ":"679","FI":"358","FR":"33","GF":"594","PF":"689","GA":"241","GM":"220",
        "GE":"995","DE":"49","GH":"233","GI":"350","GR":"30","GL":"299","GD":"1","GP":"590","GU":"1","GT":"502",
        "GN":"224","GW":"245","GY":"592","HT":"509","HN":"504","HK":"852","HU":"36","IS":"354","IN":"91","ID":"62",
        "IR":"98","IQ":"964","IE":"353","IL":"972","IT":"39","JM":"1","JP":"81","JO":"962","KZ":"7","KE":"254",
        "KI":"686","KW":"965","KG":"996","LA":"856","LV":"371","LB":"961","LS":"266","LR":"231","LY":"218","LI":"423",
        "LT":"370","LU":"352","MO":"853","MG":"261","MW":"265","MY":"60","MV":"960","ML":"223","MT":"356","MH":"692",
        "MQ":"596","MR":"222","MU":"230","MX":"52","FM":"691","MD":"373","MC":"377","MN":"976","ME":"382","MS":"1",
        "MA":"212","MZ":"258","MM":"95","NA":"264","NR":"674","NP":"977","NL":"31","NC":"687","NZ":"64","NI":"505",
        "NE":"227","NG":"234","MK":"389","NO":"47","OM":"968","PK":"92","PW":"680","PS":"970","PA":"507","PG":"675",
        "PY":"595","PE":"51","PH":"63","PL":"48","PT":"351","PR":"1","QA":"974","RE":"262","RO":"40","RU":"7",
        "RW":"250","KN":"1","LC":"1","VC":"1","WS":"685","SM":"378","ST":"239","SA":"966","SN":"221","RS":"381",
        "SC":"248","SL":"232","SG":"65","SK":"421","SI":"386","SB":"677","SO":"252","ZA":"27","KR":"82","SS":"211",
        "ES":"34","LK":"94","SD":"249","SR":"597","SE":"46","CH":"41","SY":"963","TW":"886","TJ":"992","TZ":"255",
        "TH":"66","TL":"670","TG":"228","TO":"676","TT":"1","TN":"216","TR":"90","TM":"993","TC":"1","TV":"688",
        "UG":"256","UA":"380","AE":"971","GB":"44","US":"1","UY":"598","UZ":"998","VU":"678","VE":"58","VN":"84",
        "VG":"1","VI":"1","YE":"967","ZM":"260","ZW":"263","XK":"383","BQ":"599","CW":"599","SX":"1","FO":"298",
        "IM":"44","JE":"44","GG":"44","MF":"590","BL":"590","AX":"358","NU":"683","CK":"682","FK":"500","SH":"290",
        "PM":"508","WF":"681","YT":"262","EH":"212","VA":"39","MP":"1",
    ]
    static func flag(_ region: String) -> String {
        region.uppercased().unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value).map(String.init) }.joined()
    }
    static func name(_ region: String) -> String {
        Locale.current.localizedString(forRegionCode: region) ?? region
    }
    // Cihazın bölgesinden varsayılan (listede yoksa TR)
    static var defaultRegion: String {
        let r = Locale.current.region?.identifier ?? "TR"
        return dial[r] != nil ? r : "TR"
    }
    // Ad'a göre sıralı tam liste
    static var all: [String] {
        dial.keys.sorted { name($0).localizedCaseInsensitiveCompare(name($1)) == .orderedAscending }
    }
}

// WhatsApp tarzı seçici sayfası: arama (ülke adı VEYA kod) + bayraklı liste
struct CountryPickerSheet: View {
    @Binding var region: String
    @Environment(\.dismiss) var dismiss
    @State private var q = ""
    var filtered: [String] {
        let t = q.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return CountryDial.all }
        let digits = t.filter(\.isNumber)
        return CountryDial.all.filter {
            CountryDial.name($0).localizedCaseInsensitiveContains(t) ||
            (!digits.isEmpty && (CountryDial.dial[$0] ?? "").hasPrefix(digits)) ||
            $0.localizedCaseInsensitiveContains(t)
        }
    }
    var body: some View {
        NavigationStack {
            List(filtered, id: \.self) { r in
                Button {
                    region = r; dismiss()
                } label: {
                    HStack(spacing: 12) {
                        Text(CountryDial.flag(r)).font(.title3)
                        Text(CountryDial.name(r)).foregroundStyle(.primary)
                        Spacer()
                        Text("+" + (CountryDial.dial[r] ?? "")).foregroundStyle(.secondary)
                            .font(.system(.body, design: .monospaced))
                        if r == region { Image(systemName: "checkmark").foregroundStyle(Brand.accent) }
                    }
                }
            }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: L("Ülke veya kod ara","Search country or code"))
            .navigationTitle(L("Ülke seç","Choose country"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button(L("Vazgeç","Cancel")) { dismiss() }
            } }
        }
    }
}
