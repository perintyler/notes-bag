import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showingSettings = false
    @State private var openNote: Note?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Notes")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showingSettings = true } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel("Settings")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task {
                                if let created = await store.createNote() { openNote = created }
                            }
                        } label: {
                            Image(systemName: "square.and.pencil")
                        }
                        .accessibilityLabel("New note")
                    }
                }
                .navigationDestination(item: $openNote) { note in
                    NoteEditorView(note: note).environmentObject(store)
                }
                .sheet(isPresented: $showingSettings) {
                    SettingsView().environmentObject(store)
                }
                .alert(
                    "Something went wrong",
                    isPresented: Binding(
                        get: { store.actionError != nil },
                        set: { if !$0 { store.actionError = nil } }
                    )
                ) {
                    Button("OK", role: .cancel) { store.actionError = nil }
                } message: {
                    Text(store.actionError ?? "")
                }
        }
        .task { await store.loadNotes() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.notes {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)

        case .failed(let message):
            // A failure is not an empty state: say what broke and offer the
            // two things that fix it.
            VStack(spacing: 14) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Retry") { Task { await store.loadNotes() } }
                    Button("Settings") { showingSettings = true }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .loaded(let notes):
            if notes.isEmpty {
                VStack(spacing: 10) {
                    Text("No notes yet").font(.headline)
                    Text("Tap the pencil to write one.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(notes) { note in
                        Button {
                            Task {
                                if let full = await store.note(id: note.id) { openNote = full }
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(note.label).foregroundStyle(.primary)
                                if !note.title.isEmpty, !note.preview.isEmpty {
                                    Text(note.preview)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            let id = notes[index].id
                            Task { await store.deleteNote(id: id) }
                        }
                    }
                }
                .refreshable { await store.loadNotes() }
            }
        }
    }
}
