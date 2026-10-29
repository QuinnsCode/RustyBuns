import SwiftUI
import RustyBunsKit

/// Pick a deployed app once, then it is the whole screen. The address is remembered across launches.
struct ContentView: View {
    @AppStorage("appURL") private var saved = ""
    @State private var typed = ""

    var body: some View {
        if let link = AppLink(saved) {
            AppWebView(link: link)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .topTrailing) {
                    Button { saved = "" } label: { Image(systemName: "arrow.left.circle.fill").font(.title2) }
                        .padding(8)
                        .accessibilityLabel("Change app")
                }
                .onOpenURL { saved = AppLink($0.absoluteString)?.url.absoluteString ?? saved }
        } else {
            VStack(spacing: 16) {
                Text("Rusty Buns").font(.largeTitle.bold())
                TextField("my-app.workers.dev", text: $typed)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(open)
                Button("Open", action: open).buttonStyle(.borderedProminent).disabled(AppLink(typed) == nil)
            }
            .padding(24)
            .onOpenURL { saved = AppLink($0.absoluteString)?.url.absoluteString ?? saved }
        }
    }

    private func open() { if let l = AppLink(typed) { saved = l.url.absoluteString } }
}
