import Foundation

/// A note as it appears in the index: no body, just a derived preview.
///
/// The service omits `content` here deliberately — a list of long notes would
/// otherwise ship the whole store on every refresh.
struct NoteSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let preview: String
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case preview
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// What the row shows. A note may have neither a title nor any text yet,
    /// and an empty row is unclickable-looking, so fall back to a label.
    var label: String {
        if !title.isEmpty { return title }
        if !preview.isEmpty { return preview }
        return "Untitled"
    }
}

/// A full note, from `GET /api/notes/:id`.
struct Note: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var title: String
    var content: String
    let createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum LoadState<Value: Equatable>: Equatable {
    case idle
    case loading
    case loaded(Value)
    case failed(String)
}
