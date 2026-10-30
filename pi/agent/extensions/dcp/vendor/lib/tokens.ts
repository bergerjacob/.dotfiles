/** Local model-neutral estimate: UTF-8 bytes / 3 (rather than chars / 4).
 * Conservative for ordinary code/prose; NOT a tokenizer or a hard bound.
 * Images are budgeted separately. No external tokenizer resolution needed.
 * AGPL-3.0-or-later; derived from @davecodes/pi-dcp 0.2.0.
 */
export function countTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, "utf8") / 3);
}
export const approxTokens = countTokens;
export function estimateTokensBatch(texts: string[]): number { return countTokens(texts.join(" ")); }
