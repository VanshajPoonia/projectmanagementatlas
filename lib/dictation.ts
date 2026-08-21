/**
 * Composing dictated speech into a text field.
 *
 * The Web Speech API delivers two kinds of result. An **interim** result is the engine's current
 * best guess at the phrase still being spoken; it is re-sent and revised on every event until the
 * engine commits. A **final** result is that commitment, and it never changes afterwards.
 *
 * That is why a dictation button cannot simply append what it receives. Appending an interim
 * result writes the same half-heard phrase into the field over and over. The field's value has to
 * be *recomputed* from three parts each time: the text that was already there when dictation
 * started, everything finalized since, and the one live guess currently in flight.
 */

/**
 * Rebuild a field's full value from the text that was in it when dictation started, the phrases
 * finalized since, and the interim phrase currently being spoken.
 *
 * Pass an empty `interimText` to settle the field on finalized speech only, which is what should
 * be stored when dictation ends.
 */
export function composeDictation(base: string, finalText: string, interimText: string): string {
  const spoken = [finalText, interimText]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')

  if (!spoken) return base
  if (!base) return spoken
  // Respect a trailing space the user already typed rather than doubling it.
  return /\s$/.test(base) ? base + spoken : `${base} ${spoken}`
}

/**
 * Fold one `onresult` event into the running transcript.
 *
 * `resultIndex` is where the engine says this event's news begins; everything before it was
 * already reported and is not re-read. Finalized phrases are accumulated by the caller and passed
 * back in as `finalSoFar`, because the engine stops resending them once they are committed.
 */
export function foldSpeechResults(
  finalSoFar: string,
  results: { isFinal: boolean; transcript: string }[],
  resultIndex: number,
): { finalText: string; interimText: string } {
  let finalText = finalSoFar
  let interimText = ''

  for (let i = Math.max(0, resultIndex); i < results.length; i++) {
    const chunk = (results[i]?.transcript ?? '').trim()
    if (!chunk) continue
    if (results[i].isFinal) {
      finalText = finalText ? `${finalText} ${chunk}` : chunk
    } else {
      interimText = interimText ? `${interimText} ${chunk}` : chunk
    }
  }

  return { finalText, interimText }
}
