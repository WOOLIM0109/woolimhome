// Retire the home PC without rotating the office PC's write-only Vercel secret.
// Keep historical job ownership records intact.
export function isRetiredWorker(id: string) {
  return id === "becky-office-pc";
}
