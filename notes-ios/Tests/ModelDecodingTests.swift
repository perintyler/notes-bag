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
    /// The Host header is what makes the device path work: Caddy selects the
    /// vhost from it. Without one the request reaches Caddy's default site.
    func testAppliesHostHeaderAndBearerSecret() throws {
        let config = ServerConfig(
            baseURL: "http://100.97.236.110",
            hostHeader: "notes.barry.lan",
            secret: "s3cr3t"
        )
        let req = try XCTUnwrap(config.request(path: "/api/notes"))

        XCTAssertEqual(req.value(forHTTPHeaderField: "Host"), "notes.barry.lan")
        XCTAssertEqual(req.value(forHTTPHeaderField: "authorization"), "Bearer s3cr3t")
    }

    /// On the simulator there is no secret. Sending an empty bearer is worse
    /// than sending none: the service compares it to BARRY_SECRET and 401s.
    func testOmitsEmptyHeaders() throws {
        let config = ServerConfig(baseURL: "http://127.0.0.1:3870", hostHeader: "", secret: "")
        let req = try XCTUnwrap(config.request(path: "/health"))

        XCTAssertNil(req.value(forHTTPHeaderField: "Host"))
        XCTAssertNil(req.value(forHTTPHeaderField: "authorization"))
    }

    /// A typo in Settings must fail here, not as a baffling transport error
    /// later: URLComponents accepts most of these as RELATIVE paths.
    func testRejectsAMalformedBaseURL() {
        for bad in ["not a url", "", "notes.barry.lan", "/api", "ftp://host"] {
            let config = ServerConfig(baseURL: bad, hostHeader: "", secret: "")
            XCTAssertNil(config.request(path: "/api/notes"), "should reject \(bad)")
        }
    }
}
