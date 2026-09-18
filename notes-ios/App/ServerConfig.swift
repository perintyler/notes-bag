import Foundation

/// Where the app talks to the notes service, and how it authenticates.
///
/// The reachability recipe is the one `bags/barry-iphone` established and
/// `bags/questions/questions-ios` refined, reused rather than rediscovered:
///  - Simulator: straight to the service's loopback port.
///  - Device: over Tailscale to the Mac, with a Host header so Caddy routes to
///    the `notes.barry.lan` vhost the bag declares.
///
/// Every Barry service binds 127.0.0.1 ONLY. There is no route to a raw
/// service port from a phone — the tailnet address reaches Caddy on :80, and
/// the `Host` header selects the site block. `bags/point-guard-ios` points at
/// `100.x.x.x:3868` and its device path has never worked for exactly this
/// reason; do not copy that shape.
///
/// `defaultTailscaleHost` is a STARTING POINT, not a constant. A tailnet
/// address changes (this Mac moved from 100.101.38.91 to 100.97.236.110 in a
/// single day, and `bags/plans/plans-iphone` still ships the stale one). It is
/// overridable in Settings and persisted, so a moved Mac is a text-field edit
/// rather than a rebuild. Find the current value with `tailscale ip -4`.
struct ServerConfig: Equatable {
    var baseURL: String
    var hostHeader: String
    var secret: String

    static let defaultsKeyBase = "server.baseURL"
    static let defaultsKeyHost = "server.hostHeader"

    /// This app's OWN keychain item, never shared with the other Barry apps.
    /// Two apps sharing one item would mean signing out of either silently
    /// signs out the other, and the secret is cheap to enter twice.
    static let keychainSecretKey = "rocks.barry.notes.secret"

    static let defaultTailscaleHost = "100.97.236.110"
    static let defaultHostHeader = "notes.barry.lan"
    static let defaultPort = 3870

    static var platformDefault: ServerConfig {
        #if targetEnvironment(simulator)
        ServerConfig(baseURL: "http://127.0.0.1:\(defaultPort)", hostHeader: "", secret: "")
        #else
        ServerConfig(
            baseURL: "http://\(defaultTailscaleHost)",
            hostHeader: defaultHostHeader,
            secret: ""
        )
        #endif
    }

    static func load() -> ServerConfig {
        // UI/integration-test hook: `-notesBaseURL <url>` overrides everything
        // else and skips the keychain, so a test can point the app at an
        // unreachable server (to exercise the error state) without touching
        // real persisted settings. Never wired to anything but launch arguments.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-notesBaseURL"), args.count > i + 1 {
            var secret = ""
            if let s = args.firstIndex(of: "-notesSecret"), args.count > s + 1 {
                secret = args[s + 1]
            }
            return ServerConfig(baseURL: args[i + 1], hostHeader: "", secret: secret)
        }

        let d = UserDefaults.standard
        var c = platformDefault
        if let base = d.string(forKey: defaultsKeyBase), !base.isEmpty { c.baseURL = base }
        if let host = d.string(forKey: defaultsKeyHost) { c.hostHeader = host }
        c.secret = Keychain.read(key: keychainSecretKey) ?? ""
        return c
    }

    func save() {
        let d = UserDefaults.standard
        d.set(baseURL, forKey: Self.defaultsKeyBase)
        d.set(hostHeader, forKey: Self.defaultsKeyHost)
        if secret.isEmpty {
            Keychain.delete(key: Self.keychainSecretKey)
        } else {
            Keychain.write(key: Self.keychainSecretKey, value: secret)
        }
    }

    /// Build a request for an API path.
    ///
    /// Requires an absolute http(s) base. `URLComponents(string:)` accepts
    /// "not a url" happily — it parses as a relative path — so a typo in
    /// Settings would otherwise build a nonsense request and surface as a
    /// confusing transport error much later instead of a bad URL right here.
    func request(path: String, query: [URLQueryItem] = []) -> URLRequest? {
        guard var components = URLComponents(string: baseURL),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty
        else { return nil }
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { return nil }
        var req = URLRequest(url: url)
        apply(to: &req)
        return req
    }

    /// The service accepts either `Authorization: Bearer <secret>` or
    /// `x-barry-secret: <secret>`. Bearer is used here, the more standard
    /// spelling for a bearer token.
    func apply(to req: inout URLRequest) {
        if !hostHeader.isEmpty { req.setValue(hostHeader, forHTTPHeaderField: "Host") }
        if !secret.isEmpty { req.setValue("Bearer \(secret)", forHTTPHeaderField: "authorization") }
    }
}

/// Minimal keychain wrapper for the one secret the app stores.
///
/// No `kSecAttrAccessGroup`: that exists to share an item with a widget
/// extension, and this app has none. Requesting a group without the matching
/// entitlement fails with errSecMissingEntitlement.
enum Keychain {
    static func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(key: String, value: String) {
        delete(key: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
