import XCTest
@testable import Notes

/// Decoding tests against the service's REAL response shapes, copied from its
/// actual output rather than invented.
final class ModelDecodingTests: XCTestCase {
    func testDecodesNoteSummary() throws {
        let json = """
        {"id":"n1","title":"Ideas","preview":"the first line",
         "created_at":"2026-09-17T00:00:00.000Z","updated_at":"2026-09-17T01:00:00.000Z"}
        """.data(using: .utf8)!

        let note = try JSONDecoder().decode(NoteSummary.self, from: json)
        XCTAssertEqual(note.title, "Ideas")
        XCTAssertEqual(note.preview, "the first line")
    }

    /// The index carries no `content`. A model expecting it would fail to
    /// decode every row the list endpoint returns.
    func testSummaryDecodesWithoutContent() throws {
        let json = """
        {"id":"n1","title":"","preview":"","created_at":"a","updated_at":"b"}
        """.data(using: .utf8)!
        XCTAssertNoThrow(try JSONDecoder().decode(NoteSummary.self, from: json))
    }

    func testDecodesFullNote() throws {
        let json = """
        {"id":"n1","title":"Ideas","content":"line one\\nline two",
         "created_at":"2026-09-17T00:00:00.000Z","updated_at":"2026-09-17T01:00:00.000Z"}
        """.data(using: .utf8)!

        let note = try JSONDecoder().decode(Note.self, from: json)
        XCTAssertEqual(note.content, "line one\nline two")
    }

    /// A brand-new note is empty on both fields; the row must still render.
    func testLabelFallsBackWhenTitleAndPreviewAreEmpty() {
        let empty = NoteSummary(
            id: "n1", title: "", preview: "", createdAt: "a", updatedAt: "b"
        )
        XCTAssertEqual(empty.label, "Untitled")

        let titled = NoteSummary(
            id: "n2", title: "T", preview: "p", createdAt: "a", updatedAt: "b"
        )
        XCTAssertEqual(titled.label, "T")

        let previewOnly = NoteSummary(
            id: "n3", title: "", preview: "body text", createdAt: "a", updatedAt: "b"
        )
        XCTAssertEqual(previewOnly.label, "body text")
    }
}

final class ServerConfigTests: XCTestCase {
    /// The device path carries the secret and NOTHING else. The Host header
    /// this used to send selected a Caddy vhost; the tailnet endpoint proxies
    /// to this service alone, so sending one now would only be a way to
    /// misroute a request.
    func testAppliesBearerSecretAndNoHostHeader() throws {
        let config = ServerConfig(
            baseURL: ServerConfig.defaultDeviceURL,
            secret: "s3cr3t"
        )
        let req = try XCTUnwrap(config.request(path: "/api/notes"))

        XCTAssertEqual(req.value(forHTTPHeaderField: "authorization"), "Bearer s3cr3t")
        XCTAssertNil(req.value(forHTTPHeaderField: "Host"),
                     "the vhost-selecting Host header is gone and must not come back")
        XCTAssertEqual(req.url?.absoluteString,
                       "https://barry-mac.tail5cb2f2.ts.net:8449/api/notes")
    }

    /// The device default must be HTTPS at the tailnet name. A plain-http
    /// default would now be blocked by ATS rather than silently downgraded,
    /// and a hardcoded IP is the exact thing that went stale before.
    func testDeviceDefaultIsHTTPSAtAStableName() {
        XCTAssertTrue(ServerConfig.defaultDeviceURL.hasPrefix("https://"),
                      "ATS permits only loopback cleartext; the device path must be TLS")
        XCTAssertTrue(ServerConfig.defaultDeviceURL.contains("ts.net"),
                      "the device host must be the stable tailnet name, not an address")
    }

    func testOmitsEmptyHeaders() throws {
        let config = ServerConfig(baseURL: ServerConfig.simulatorURL, secret: "")
        let req = try XCTUnwrap(config.request(path: "/health"))

        XCTAssertNil(req.value(forHTTPHeaderField: "Host"))
        XCTAssertNil(req.value(forHTTPHeaderField: "authorization"))
    }

    /// A typo in Settings must fail here, not as a baffling transport error
    /// later: URLComponents accepts most of these as RELATIVE paths.
    func testRejectsAMalformedBaseURL() {
        for bad in ["not a url", "", "notes.barry.lan", "/api", "ftp://host"] {
            let config = ServerConfig(baseURL: bad, secret: "")
            XCTAssertNil(config.request(path: "/api/notes"), "should reject \(bad)")
        }
    }
}
