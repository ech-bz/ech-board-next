export interface OperationsState {
  posting: boolean
  uploadProgress: number | null
  moderating: boolean
  reacting: Record<string, boolean>
  selectionProgress: { done: number; total: number } | null
}

