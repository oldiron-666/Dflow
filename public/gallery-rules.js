// Shared display rules, also used by regression tests. Pending always follows
// the server's queue, never orientation or masonry-column height.
export function sortableTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
export function displayQueueOrder(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 1000000 ? number : null;
}
export const pendingQueueActive = item => item?.autoEnabled !== false;
export function comparePendingRows(a, b) {
  const activeA = pendingQueueActive(a.value), activeB = pendingQueueActive(b.value);
  return Number(!activeA) - Number(!activeB) ||
    (activeA ? (displayQueueOrder(a.value.queueOrder) ?? Infinity) - (displayQueueOrder(b.value.queueOrder) ?? Infinity) : 0) ||
    a.index - b.index;
}
export function galleryItemTime(item) {
  // Moving a card is NOT writing a prompt. Legacy cards fall back to the
  // earliest recorded prompt/card date, never to completedAt.
  return [item.promptWrittenAt, item.wordedAt, item.createdAt, item.created_at]
    .map(sortableTime).find(value => value > 0) || 0;
}
export function galleryOrientation(item) {
  return Number(item.image_width ?? item.width ?? 0) > Number(item.image_height ?? item.height ?? 0) ? 1 : 0;
}
export function compareGalleryItems(a, b, _folder, indexA = 0, indexB = 0) {
  return galleryOrientation(b) - galleryOrientation(a) || galleryItemTime(b) - galleryItemTime(a) || indexA - indexB;
}
export function responsiveColumnCount(width, preferred = 5) {
  const maximum = Math.max(1, Math.min(8, Number(preferred) || 5));
  return Math.max(1, Math.min(maximum, Math.floor((Math.max(0, width) + 8) / 228)));
}

// Small, explicit row spans pack variable-height cards without stretching a
// whole row to its tallest card. Non-dense placement preserves sorted starts.
export function compactRowSpan(height, rowHeight = 4, gap = 10) {
  return Math.max(1, Math.ceil((Math.max(0, Number(height) || 0) + Math.max(0, Number(gap) || 0)) / Math.max(1, Number(rowHeight) || 4)));
}

// Sorted cards are assigned in rounds to fixed columns, never to the shortest
// column. Each column stacks natural-height cards independently. This keeps
// 8/9/10 in columns 1/2/3 at seven columns, without changing card proportions.
export function queueGridPlacements(spans, columns) {
  const count = Math.max(1, Math.floor(Number(columns) || 1));
  const bottoms = Array(count).fill(1);
  return spans.map((span, index) => {
    const column = index % count;
    const placement = {column: column + 1, row: bottoms[column]};
    bottoms[column] += Math.max(1, Math.ceil(Number(span) || 1));
    return placement;
  });
}
