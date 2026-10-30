// Remembered workspace view per planet (WorkspaceFrame). Kept free of other imports: WorkspaceFrame ships in every planet's bundle.
export const viewKey = (planet: string) => `orbit.view.${planet}`;
/** The saved view if it's still one of this planet's views, else the first. */
export const pickView = <V extends string>(saved: unknown, views: readonly V[]): V => (views.includes(saved as V) ? (saved as V) : views[0]);
