/**
 * NotesApp — a single persistent scratchpad.
 * Autosaves to the worker after a debounce.
 */
export class NotesApp {
  constructor(container, { workerUrl, namespace, headers = () => ({}) } = {}) {
    this._workerUrl = workerUrl.replace(/\/$/, '');
    this._namespace = namespace;
    this._userHeaders = headers;
    this._saveTimer = null;
    this._saving = false;
    this._dirty = false;
    this._lastSaved = null;

    this.el = document.createElement('div');
    this.el.className = 'notes-app';
    container.appendChild(this.el);

    this._build();
    this._load();
  }

  _url(path) {
    return `${this._workerUrl}${path}`;
  }

  _headers() {
    const h = this._userHeaders();
    if (this._namespace) h['X-Notes-Namespace'] = this._namespace;
    return h;
  }

  _build() {
    this.el.innerHTML = `
      <div class="notes-app-header">
        <h2 class="notes-app-title">Notes</h2>
        <span class="notes-app-status"></span>
      </div>
      <textarea class="notes-app-editor" placeholder="Write something..." spellcheck="false"></textarea>
    `;

    this._statusEl = this.el.querySelector('.notes-app-status');
    this._editor = this.el.querySelector('.notes-app-editor');

    this._editor.addEventListener('input', () => {
      this._scheduleSave();
    });

    // Save on blur (immediate)
    this._editor.addEventListener('blur', () => {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        this._save();
      }
    });

    this._beforeUnload = () => {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        const body = JSON.stringify({ content: this._editor.value });
        const headers = this._headers();
        // sendBeacon doesn't support custom headers, fall back to sync XHR
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', this._url('/note'), false);
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(body);
      }
    };
    window.addEventListener('beforeunload', this._beforeUnload);
  }

  async _load() {
    this._statusEl.textContent = 'Loading…';
    this._statusEl.className = 'notes-app-status';
    try {
      const res = await fetch(this._url('/note'), { headers: this._headers() });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      this._editor.value = data.content || '';
      this._lastSaved = data.updated_at;
      this._statusEl.textContent = '';
      this._editor.focus();
    } catch (e) {
      this._statusEl.textContent = `Failed to load: ${e.message}`;
      this._statusEl.className = 'notes-app-status notes-app-status--error';
    }
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._statusEl.textContent = 'Unsaved';
    this._statusEl.className = 'notes-app-status notes-app-status--unsaved';
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 800);
  }

  async _save() {
    // A save landing while another is in flight must not be DROPPED. This
    // used to `return` here, which silently lost every keystroke typed during
    // a PUT — the note looked saved (the status said so) and the edit was
    // gone on next load. Mark it dirty instead and re-run on completion, with
    // the editor's CURRENT value.
    if (this._saving) {
      this._dirty = true;
      return;
    }
    this._saving = true;
    this._statusEl.textContent = 'Saving…';
    this._statusEl.className = 'notes-app-status';
    try {
      const res = await fetch(this._url('/note'), {
        method: 'PUT',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: this._editor.value }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      this._lastSaved = data.updated_at;
      this._statusEl.textContent = 'Saved';
      this._statusEl.className = 'notes-app-status notes-app-status--saved';
      setTimeout(() => {
        if (this._statusEl.textContent === 'Saved') {
          this._statusEl.textContent = '';
        }
      }, 2000);
    } catch {
      this._statusEl.textContent = 'Save failed';
      this._statusEl.className = 'notes-app-status notes-app-status--error';
    } finally {
      this._saving = false;
      if (this._dirty) {
        this._dirty = false;
        await this._save();
      }
    }
  }

  destroy() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._save();
    }
    window.removeEventListener('beforeunload', this._beforeUnload);
    this.el.remove();
  }
}
