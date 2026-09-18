import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var baseURL = ""
    @State private var hostHeader = ""
    @State private var secret = ""
    @State private var testResult = ""
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Base URL", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Host header", text: $hostHeader)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Server")
                } footer: {
                    // The tailnet address moves; say so, and say where to look.
                    Text("On a device this is the Mac's Tailscale address, with the host header selecting the Caddy vhost. Find the current address with `tailscale ip -4`.")
                }

                Section {
                    SecureField("BARRY_SECRET", text: $secret)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Secret")
                } footer: {
                    Text("Stored in this app's keychain. Required on a device; on the simulator the service answers on loopback without one.")
                }

                Section {
                    Button(testing ? "Testing…" : "Test connection") {
                        Task {
                            testing = true
                            save()
                            testResult = await store.testConnection()
                            testing = false
                        }
                    }
                    .disabled(testing)
                    if !testResult.isEmpty {
                        Text(testResult).foregroundStyle(.secondary)
                    }
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
            hostHeader = store.config.hostHeader
            secret = store.config.secret
        }
    }

    private func save() {
        store.updateConfig(
            ServerConfig(
                baseURL: baseURL.trimmingCharacters(in: .whitespaces),
                hostHeader: hostHeader.trimmingCharacters(in: .whitespaces),
                secret: secret
            )
        )
    }
}
