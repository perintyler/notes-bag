export interface Env {
  NOTES: DurableObjectNamespace;
}

export interface Note {
  id: string;
  content: string;
  updated_at: string;
}
