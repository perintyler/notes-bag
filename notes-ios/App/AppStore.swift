import Foundation
import SwiftUI

/// The app's state, and the only place that talks to the client.
@MainActor
final class AppStore: ObservableObject {
    @Published var config: ServerConfig
    @Published var notes: LoadState<[NoteSummary]> = .idle
    @Published var actionError: String?
    /// Shown under the editor: "Saving…", "Saved", or a failure.
    @Published var saveStatus: String = ""

    private var client: NotesClient

    // Autosave state for the open note.
    private var saveTask: Task<Void, Never>?
    private var saving = false
    private var dirty = false
    private static let debounce = Duration.milliseconds(700)

    init(config: ServerConfig = .load()) {
        self.config = config
        self.client = NotesClient(config: config)
    }

    func updateConfig(_ new: ServerConfig) {
        config = new
        config.save()
        client = NotesClient(config: new)
        Task { await loadNotes() }
    }

    func loadNotes() async {
        if case .loaded = notes {} else { notes = .loading }
        do {
            notes = .loaded(try await client.notes())
        } catch {
            notes = .failed(describe(error))
        }
    }

    func note(id: String) async -> Note? {
        do {
            return try await client.note(id: id)
        } catch {
            actionError = describe(error)
            return nil
        }
    }

    func createNote() async -> Note? {
        do {
            let note = try await client.createNote()
            await loadNotes()
            return note
        } catch {
            actionError = describe(error)
            return nil
        }
    }

    func deleteNote(id: String) async {
        // Cancel a pending autosave first: it would otherwise recreate nothing
        // but would report a confusing 404 after the row is gone.
        saveTask?.cancel()
        saveTask = nil
        do {
            try await client.deleteNote(id: id)
            saveStatus = ""
            await loadNotes()
        } catch {
            actionError = describe(error)
        }
    }

    /// Queue a save, replacing any pending one.
    func scheduleSave(id: String, title: String, content: String) {
        saveStatus = "Unsaved…"
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            await self?.save(id: id, title: title, content: content)
        }
    }

    /// Save now, skipping the debounce — used when the editor closes.
    func flushSave(id: String, title: String, content: String) async {
        saveTask?.cancel()
        saveTask = nil
        await save(id: id, title: title, content: content)
    }

    /**
     * Save, coalescing writes rather than dropping them.
     *
     * A keystroke landing mid-flight sets `dirty`; when the in-flight request
     * finishes, the save re-runs with the values captured then. Returning
     * early instead — the bug this bag's own NotesApp.js had — silently loses
     * that edit while the status still reads "Saved".
     */
    private func save(id: String, title: String, content: String) async {
        if saving {
            dirty = true
            pending = (id, title, content)
            return
        }
        saving = true
        saveStatus = "Saving…"
        do {
            _ = try await client.updateNote(id: id, title: title, content: content)
            saveStatus = "Saved"
            await loadNotes()
        } catch {
            saveStatus = describe(error)
        }
        saving = false

        if dirty, let next = pending {
            dirty = false
            pending = nil
            await save(id: next.id, title: next.title, content: next.content)
        }
    }

    private var pending: (id: String, title: String, content: String)?

    func testConnection() async -> String {
        do {
            return try await client.health() ? "Connected." : "Server answered, but not OK."
        } catch {
            return describe(error)
        }
    }

    /// Name the likely cause. "The operation couldn't be completed" tells the
    /// reader nothing about which of the two hosts is wrong.
    private func describe(_ error: Error) -> String {
        if let notesError = error as? NotesError {
            return notesError.errorDescription ?? String(describing: notesError)
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost:
                return "Can't reach \(config.baseURL). Is the Mac on the tailnet, and the notes service running?"
            default:
                return urlError.localizedDescription
            }
        }
        return error.localizedDescription
    }
}
