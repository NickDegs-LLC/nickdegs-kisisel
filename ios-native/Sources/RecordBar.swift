import SwiftUI
import PhotosUI
import UIKit

// GEZİ KAYDI ÇUBUĞU (16.09) — eskiden Harita sekmesinin (MapTab) içinde yaşıyordu.
// Canlı takip/harita sekmesi kaldırılınca kaydı BAŞLATMANIN TEK YOLU buydu; bu yüzden
// ayrı bileşene alınıp Rotalar sekmesinin altına sabitlendi. Davranış birebir aynı:
// tip seç -> kaydet -> (istersen fotoğraf ekle) -> bitir -> "Video oluştur" ekranı açılır.
struct RecordBar: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var tracker: Tracker
    @StateObject private var loc = LocationManager()
    @State private var showTypePicker = false
    @State private var genRange: GenRange?
    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        bar
            .task { loc.request() }
            .confirmationDialog(L("Ne kaydı?","What are you recording?"), isPresented: $showTypePicker, titleVisibility: .visible) {
                ForEach(RIDE_TYPES, id: \.id) { t in
                    Button(rideLabel(t.id)) { startRide(t.id) }
                }
            }
            .sheet(item: $genRange) { r in
                GenerateSheet(from: r.from, to: r.to, type: r.type)
            }
    }

    @ViewBuilder var bar: some View {
        if tracker.recording {
            HStack(spacing: 12) {
                Circle().fill(.red).frame(width: 11, height: 11)
                // tip menüsü (sonradan değiştirilebilir)
                Menu {
                    ForEach(RIDE_TYPES, id: \.id) { t in
                        Button(rideLabel(t.id)) { tracker.rideType = t.id }
                    }
                } label: {
                    Label(rideLabel(tracker.rideType), systemImage: "chevron.up.chevron.down").font(.system(size: 15, weight: .semibold))
                }
                Spacer()
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Image(systemName: "camera.fill").font(.system(size: 16, weight: .semibold))
                        .frame(width: 40, height: 40).glassPanel(20)
                }
                Button(L("Bitir","Finish")) {
                    if let r = tracker.endRide() { genRange = GenRange(from: r.from, to: r.to, type: r.type) }
                }.buttonStyle(.glassyProminent()).tint(.red)
            }.padding(14).glassPanel(22)
            .onChange(of: photoItem) { _, item in
                guard let item, let start = tracker.rideStart else { return }
                let session = start.timeIntervalSince1970
                let coord = loc.coordinate
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let img = UIImage(data: data),
                       let jpeg = img.scaled(maxDim: 1024).jpegData(compressionQuality: 0.8) {
                        await store.addRidePhoto(session: session, jpeg: jpeg,
                                                 lat: coord?.latitude ?? 0, lon: coord?.longitude ?? 0)
                    }
                    photoItem = nil
                }
            }
        } else {
            Button {
                showTypePicker = true
            } label: {
                Label(L("Gezi kaydı başlat","Start recording"), systemImage: "record.circle")
                    .font(.system(size: 16, weight: .semibold)).frame(maxWidth: .infinity)
            }.buttonStyle(.glassyProminent())
        }
    }

    func startRide(_ type: String) {
        Task {
            guard let t = await store.trackerInfo() else { return }
            tracker.startRide(type: type, deviceId: t.id, url: t.url)
        }
    }
}

struct GenRange: Identifiable {
    let id = UUID(); let from: Double; let to: Double; let type: String
}
