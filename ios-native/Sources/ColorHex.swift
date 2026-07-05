import SwiftUI

// Rota çizgisi renk paleti — GenerateSheet (Record) + SummaryVideoSheet (Profil) ortak kullanır.
let ROUTE_LINE_COLORS = ["#00E5FF","#FF3B30","#39FF14","#FFD60A","#FF7AB6","#FFFFFF","#7C4DFF","#FF8C00",
                         "#0A84FF","#FF00E5","#00FFB2","#FFB300","#FF5C8A","#8FE3FF","#C9FF3B","#C0C0C0"]

// "#RRGGBB" / "RGB" hex → Color (rota rengi swatch'ları için).
extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).uppercased()
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self = Color(.sRGB,
                     red: Double((v >> 16) & 0xFF) / 255.0,
                     green: Double((v >> 8) & 0xFF) / 255.0,
                     blue: Double(v & 0xFF) / 255.0,
                     opacity: 1.0)
    }
}
