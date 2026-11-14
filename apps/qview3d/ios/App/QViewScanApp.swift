// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// QView3D Scan: the shop walks round its own product with an iPhone (LiDAR, iOS 17) and gets a true model of it,
// made on the phone by Apple's Object Capture, free. The app turns it into a GLB and files it with the shop's
// QView3D as a sample product, ready for the widget. Four steps on one screen: set up, scan, build, send.
import QViewKit
import RealityKit
import SwiftUI

@main
struct QViewScanApp: App {
    var body: some SwiftUI.Scene {
        WindowGroup { ScanFlow() }
    }
}

@MainActor
final class Flow: ObservableObject {
    enum Step: Equatable { case setup, scanning, building(Double), naming, sending, done(String), trouble(String) }
    @Published var step: Step = .setup
    @Published var session: ObjectCaptureSession?
    var glb: Data?

    let folder = FileManager.default.temporaryDirectory.appending(path: "scan", directoryHint: .isDirectory)
    var images: URL { folder.appending(path: "images", directoryHint: .isDirectory) }

    func startScan() {
        guard ObjectCaptureSession.isSupported else {
            step = .trouble("Scanning needs an iPhone or iPad with LiDAR (Pro models from 2020 on).")
            return
        }
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
        let s = ObjectCaptureSession()
        var c = ObjectCaptureSession.Configuration()
        c.checkpointDirectory = folder.appending(path: "checkpoint", directoryHint: .isDirectory)
        s.start(imagesDirectory: images, configuration: c)
        session = s
        step = .scanning
    }

    /// Object Capture's photos into a model, on the phone (`.reduced` is the detail iOS makes), then into a GLB.
    func build() async {
        session = nil
        step = .building(0)
        let usdz = folder.appending(path: "model.usdz")
        do {
            let p = try PhotogrammetrySession(input: images, configuration: PhotogrammetrySession.Configuration())
            try p.process(requests: [.modelFile(url: usdz, detail: .reduced)])
            for try await out in p.outputs {
                switch out {
                case let .requestProgress(_, fraction): step = .building(fraction)
                case let .requestError(_, e): throw e
                case .processingComplete:
                    glb = try ScanExport.glb(fromUSDZ: usdz)
                    step = .naming
                    return
                default: break
                }
            }
        } catch {
            step = .trouble("The model didn't come together: \(error.localizedDescription). Try again with more light and a slower lap.")
        }
    }

    func send(_ shop: Shop, name: String) async {
        guard let glb else { return }
        step = .sending
        do {
            let s = try await shop.send(glb: glb, name: name)
            step = .done(s.product ?? s.id)
        } catch {
            step = .trouble(error.localizedDescription)
        }
    }
}

struct ScanFlow: View {
    @StateObject private var flow = Flow()
    /// Where the shop's QView3D runs (qview3d.<subdomain>.workers.dev once deployed), the same as the admin page's.
    @AppStorage("host") private var host = ""
    @AppStorage("org") private var org = ""
    @State private var adminKey = Keychain.read() ?? ""
    @State private var name = ""

    var shop: Shop? {
        guard let url = URL(string: host), !org.isEmpty, adminKey.count >= 8 else { return nil }
        return Shop(host: url, org: org, adminKey: adminKey)
    }

    var body: some View {
        switch flow.step {
        case .setup:
            Form {
                Section("Your shop") {
                    TextField("QView3D address", text: $host).textInputAutocapitalization(.never).keyboardType(.URL)
                    TextField("Shop id", text: $org).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Admin key", text: $adminKey)
                }
                Section {
                    Button("Scan a product") { Keychain.save(adminKey); flow.startScan() }.disabled(shop == nil)
                } footer: {
                    Text("Put the product on a plain table in good light, with room to walk all the way round it.")
                }
            }
        case .scanning:
            if let session = flow.session { CaptureScreen(session: session) { Task { await flow.build() } } }
        case let .building(f):
            VStack(spacing: 16) {
                ProgressView(value: f)
                Text("Making the model on this phone. Keep the app open: a few minutes.")
            }.padding(32)
        case .naming:
            Form {
                TextField("Product name", text: $name)
                Button("Send to my shop") { if let shop { Task { await flow.send(shop, name: name) } } }.disabled(name.isEmpty)
            }
        case .sending:
            ProgressView("Sending")
        case let .done(product):
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle").font(.largeTitle)
                Text("\(name) is a product in your shop: \(product). It's in the widget now.")
                Button("Scan another") { name = ""; flow.step = .setup }
            }.padding(32)
        case let .trouble(why):
            VStack(spacing: 16) {
                Text(why)
                Button("Back") { flow.step = .setup }
            }.padding(32)
        }
    }
}

/// Apple's own capture screen: it finds the product, shows the dots still to fill, and says when a lap is done.
struct CaptureScreen: View {
    /// `@Observable` in the SDK: reading `state` in `body` is enough for SwiftUI to follow it.
    let session: ObjectCaptureSession
    let finished: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            ObjectCaptureView(session: session)
            Group {
                switch session.state {
                case .ready: Button("Find the product") { _ = session.startDetecting() }
                case .detecting: Button("Start the lap") { session.startCapturing() }
                case .capturing where session.userCompletedScanPass: Button("Done") { session.finish() }
                case .capturing: Text("Walk slowly all the way round.")
                case .completed: Color.clear.onAppear(perform: finished)
                case let .failed(e): Text(e.localizedDescription)
                default: ProgressView()
                }
            }
            .buttonStyle(.borderedProminent)
            .padding(.bottom, 48)
        }
    }
}

/// The admin key, kept in the Keychain rather than the app's settings.
enum Keychain {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "qview3d-admin-key"]

    static func read() -> String? {
        var out: AnyObject?
        let q = query.merging([kSecReturnData as String: true]) { $1 }
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func save(_ key: String) {
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query.merging([kSecValueData as String: Data(key.utf8)]) { $1 } as CFDictionary, nil)
    }
}
