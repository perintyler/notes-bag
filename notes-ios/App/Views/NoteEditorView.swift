import SwiftUI

struct NoteEditorView: View {
    let note: Note

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var content = ""
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Title", text: $title)
                .font(.title3.weight(.semibold))
                .textInputAutocapitalization(.sentences)
                .onChange(of: title) { _, _ in scheduleSave() }

            Divider()

            TextEditor(text: $content)
                .font(.body)
                .scrollContentBackground(.hidden)
                .onChange(of: content) { _, _ in scheduleSave() }
                .accessibilityLabel("Note body")

            if !store.saveStatus.isEmpty {
                Text(store.saveStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    Task {
                        await store.deleteNote(id: note.id)
                        dismiss()
                    }
                } label: {
                    Image(systemName: "trash")
                }
                .accessibilityLabel("Delete note")
            }
        }
        .onAppear {
            // Guard the first assignment: onAppear can run again when the view
            // returns from a sheet, and re-seeding would clobber unsaved edits.
            guard !loaded else { return }
            title = note.title
            content = note.content
            loaded = true
        }
        .onDisappear {
            // Commit immediately rather than waiting out the debounce, which
            // would be cancelled with the view.
            Task { await store.flushSave(id: note.id, title: title, content: content) }
        }
    }

    private func scheduleSave() {
        guard loaded else { return }
        store.scheduleSave(id: note.id, title: title, content: content)
    }
}
