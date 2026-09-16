export interface Env {
  NOTES: DurableObjectNamespace;
}

export interface Note {
  id: string;
  content: string;
  /**
   * Null for a scratchpad that has never been written: the read path returns
   * `{ id: 'default', content: '', updated_at: null }` rather than 404, and
   * typing this as `string` denied the one case a consumer is most likely to
   * hit first.
   */
  updated_at: string | null;
}
