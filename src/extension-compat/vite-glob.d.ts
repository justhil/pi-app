export {}

declare global {
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string | string[],
      options?: { eager?: boolean; import?: string },
    ): Record<string, T>
  }
}
