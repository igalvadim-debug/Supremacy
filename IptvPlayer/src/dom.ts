/** Required markup belongs to the corresponding HTML entry point. Optional elements use getElementById directly. */
export function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing element #' + id);
  // The caller's element type is tied to the static entry-point markup.
  return element as T;
}
