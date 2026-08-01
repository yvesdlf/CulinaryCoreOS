/**
 * A named set of dishes printed and handed out together — a prep pack for a
 * section, a tasting menu for a briefing, the sheets a new commis needs.
 *
 * Holds references, not copies. Copying a recipe into a folder is how a
 * kitchen ends up with two versions of a dish and no idea which is cooked;
 * the point of costing software is that there is one dish and everything
 * points at it.
 */
export interface Collection {
  id: string;
  name: string;
  description: string | null;
  /** Recipe ids, in the order they should be read and printed. */
  recipeIds: string[];
  createdAt: string;
  updatedAt: string;
}
