import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var baseURL = ""
    @State private var secret = ""
    @State private var outcome: ProbeOutcome?
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(ServerConfig.defaultDeviceURL, text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .accessibilityIdentifier("serverURLField")
                } header: {
                    Text("Server")
                } footer: {
                    Text("On a phone the app reaches the Mac over the tailnet at a "
                         + "stable DNS name, which serves a real certificate and "
                         + "proxies straight to the service. Nothing to keep current.")
                }

                Section {
                    SecureField("BARRY_SECRET", text: $secret)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("secretField")
                } header: {
                    Text("Secret")
                } footer: {
                    Text("Stored in this app's keychain. Required on a device; on the simulator the service answers on loopback without one.")
                }

                Section {
                    Button(testing ? "Testing…" : "Test connection") {
                        Task { await probe() }
                    }
                    .disabled(testing)
                    .accessibilityIdentifier("testConnectionButton")

                    if let outcome {
                        Label {
                            Text(outcome.message)
                        } icon: {
                            Image(systemName: icon(for: outcome))
                        }
                        .foregroundStyle(tint(for: outcome))
                        .font(.footnote)
                        .accessibilityIdentifier("probeResult")
                    }
                } footer: {
                    Text("Makes a real request. It tells apart a server that is not "
                         + "reachable from one that is reachable but refused the secret.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        save()
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            baseURL = store.config.baseURL
            secret = store.config.secret
        }
    }

    private func save() {
        store.updateConfig(currentConfig())
    }

    private func currentConfig() -> ServerConfig {
        ServerConfig(
            baseURL: baseURL.trimmingCharacters(in: .whitespaces),
            secret: secret
        )
    }

    /// Three states, not two: a refused credential proved the network path
    /// works, so it must not wear the same red X as a host that never answered.
    private func icon(for outcome: ProbeOutcome) -> String {
        if outcome.isFullyWorking { return "checkmark.circle" }
        return outcome.isReachable ? "exclamationmark.triangle" : "xmark.circle"
    }

    private func tint(for outcome: ProbeOutcome) -> Color {
        if outcome.isFullyWorking { return .green }
        return outcome.isReachable ? .orange : .red
    }

    private func probe() async {
        testing = true
        defer { testing = false }
        save()
        outcome = await ConnectionProbe(config: currentConfig()).run()
    }
}
