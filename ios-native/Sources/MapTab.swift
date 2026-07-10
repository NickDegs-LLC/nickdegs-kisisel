import SwiftUI
import MapKit
import PhotosUI
import UIKit

struct MapTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var tracker: Tracker
    @StateObject private var loc = LocationManager()
    @State private var positions: [Position] = []
    @State private var centered = false
    @State private var showTypePicker = false
    @State private var genRange: GenRange?
    @State private var photoItem: PhotosPickerItem?
    @AppStorage("nd_premium") private var premium = false
    @AppStorage("nd_map_satellite") private var satellite = false
    @State private var showPaywall = false
    @AppStorage("nd_people_grid") private var peopleGrid = false
    @AppStorage("nd_people_hidden") private var peopleHidden = false   // arkadaş listesi alta indirildi mi
    @State private var cam: MapCameraPosition = .userLocation(fallback: .region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 41.0, longitude: 29.0),
        span: MKCoordinateSpan(latitudeDelta: 0.4, longitudeDelta: 0.4))))

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Map(position: $cam) {
                    UserAnnotation()
                    ForEach(positions) { p in
                        Annotation(p.device, coordinate: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon)) {
                            AvatarView(name: p.device, avatar: p.avatar, size: 42)
                                .overlay(Circle().strokeBorder(.white, lineWidth: 3))
                                .overlay(alignment: .bottom) {
                                    Triangle().fill(.white).frame(width: 16, height: 10).offset(y: 9)
                                }
                                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                        }
                    }
                }
                .mapStyle(satellite ? .hybrid(elevation: .realistic) : .standard)
                .ignoresSafeArea(edges: .top)

                // Sağ üst kontroller (güvenli alana sığar — status bar'a taşmaz)
                VStack {
                    HStack {
                        Spacer()
                        VStack(spacing: 10) {
                            // Uydu / standart geçişi (premium)
                            Button {
                                if premium { withAnimation { satellite.toggle() } }
                                else { showPaywall = true }
                            } label: {
                                Image(systemName: satellite ? "map.fill" : "globe.americas.fill")
                                    .font(.system(size: 17, weight: .semibold))
                                    .frame(width: 44, height: 44)
                                    .glassPanel(22)
                                    .overlay(alignment: .topTrailing) {
                                        if !premium {
                                            Image(systemName: "lock.fill").font(.system(size: 9, weight: .bold))
                                                .padding(4).background(.ultraThinMaterial, in: Circle()).offset(x: 4, y: -4)
                                        }
                                    }
                            }
                            // Konuma geri dön
                            Button {
                                if let c = loc.coordinate {
                                    withAnimation { cam = .region(MKCoordinateRegion(center: c,
                                        span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02))) }
                                }
                            } label: {
                                Image(systemName: "location.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                    .frame(width: 44, height: 44)
                                    .glassPanel(22)
                            }
                        }
                    }.padding(.horizontal, 16).padding(.top, 8)
                    Spacer()
                }

                VStack(spacing: 10) {
                    if !positions.isEmpty {
                        // TUTAMAÇ — aşağı kaydır/dokun: liste gizlenir, harita tamamen kontrol edilir
                        grabber
                        if !peopleHidden {
                            // Görünüm seçeneği (liste / ızgara)
                            Picker("", selection: $peopleGrid) {
                                Image(systemName: "list.bullet").tag(false)
                                Image(systemName: "square.grid.2x2").tag(true)
                            }
                            .pickerStyle(.segmented)
                            .frame(width: 132)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)

                            // Find My tarzı kişi listesi
                            ScrollView(showsIndicators: false) {
                                if peopleGrid {
                                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                                        ForEach(positions) { p in personCard(p, compact: true) }
                                    }.padding(.horizontal, 16)
                                } else {
                                    VStack(spacing: 10) {
                                        ForEach(positions) { p in personCard(p, compact: false) }
                                    }.padding(.horizontal, 16)
                                }
                            }
                            .frame(maxHeight: 260)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    recordBar.padding(.horizontal, 16).padding(.bottom, 6)
                }
                .animation(.snappy(duration: 0.28), value: peopleHidden)
            }
            .navigationTitle(L("Canlı GPS","Live GPS"))
        }
        .task {
            loc.request()
            positions = await store.positions()
        }
        .onChange(of: loc.coordinate?.latitude) { _, _ in
            if !centered, let c = loc.coordinate {
                centered = true
                withAnimation { cam = .region(MKCoordinateRegion(center: c,
                    span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05))) }
            }
        }
        .confirmationDialog(L("Ne kaydı?","What are you recording?"), isPresented: $showTypePicker, titleVisibility: .visible) {
            ForEach(RIDE_TYPES, id: \.id) { t in
                Button(rideLabel(t.id)) { startRide(t.id) }
            }
        }
        .sheet(item: $genRange) { r in
            GenerateSheet(from: r.from, to: r.to, type: r.type)
        }
        .sheet(isPresented: $showPaywall) { PaywallSheet(premium: $premium) }
        .onChange(of: premium) { _, v in if !v { satellite = false } }
    }

    // Arkadaş listesi tutamacı: aşağı kaydır -> gizle, yukarı kaydır/dokun -> geri getir.
    // Gizliyken küçük bir kapsül kalır (N arkadaş) — harita alt yarıda da tam kontrol edilebilir.
    var grabber: some View {
        VStack(spacing: 5) {
            Capsule().fill(.secondary.opacity(0.6)).frame(width: 42, height: 5)
            if peopleHidden {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.up").font(.system(size: 11, weight: .bold))
                    Text("\(positions.count) " + L("arkadaş","friends")).font(.system(size: 13, weight: .semibold))
                }.foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, peopleHidden ? 10 : 7)
        .padding(.horizontal, peopleHidden ? 18 : 0)
        .frame(maxWidth: peopleHidden ? nil : .infinity)
        .background { if peopleHidden { Capsule().fill(.ultraThinMaterial) } }
        .contentShape(Rectangle())
        .onTapGesture { peopleHidden.toggle() }
        .gesture(
            DragGesture(minimumDistance: 12).onEnded { v in
                if v.translation.height > 18 { peopleHidden = true }
                else if v.translation.height < -18 { peopleHidden = false }
            }
        )
    }

    @ViewBuilder var recordBar: some View {
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

    // Find My tarzı kişi kartı
    @ViewBuilder func personCard(_ p: Position, compact: Bool) -> some View {
        HStack(spacing: 12) {
            AvatarView(name: p.device, avatar: p.avatar, size: compact ? 38 : 46)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.device).font(.system(size: compact ? 14 : 16, weight: .semibold)).lineLimit(1)
                HStack(spacing: 6) {
                    Circle().fill(p.online ? .green : .gray).frame(width: 8, height: 8)
                    Text("\(String(format: "%.0f", p.speedKmh)) \(L("km/s","km/h"))")
                        .font(.system(size: compact ? 11 : 13)).foregroundStyle(.secondary)
                }
            }
            if !compact { Spacer() }
        }
        .padding(compact ? 11 : 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(18)
    }
}

struct GenRange: Identifiable {
    let id = UUID(); let from: Double; let to: Double; let type: String
}

// Pin ucu için basit üçgen
struct Triangle: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.closeSubpath()
        return p
    }
}
