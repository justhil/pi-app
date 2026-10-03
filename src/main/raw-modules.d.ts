// Vite `?raw` imports (bundled text assets) used by the main process.
declare module '*.md?raw' {
  const text: string
  export default text
}
