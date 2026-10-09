/** Who is in the book, and what they look like. */
export interface CastMember {
  name: string
  look: string
}

/**
 * Turn a panel's note into something a picture service will actually draw.
 *
 * Image models refuse a named character outright — asked for Spider-Man they
 * answer PROHIBITED_CONTENT and draw nothing, however innocent the scene — and
 * a book made from a show is full of names. A name is no use to them anyway:
 * they cannot draw "Rell", only a small red fox in a yellow oilskin coat. So
 * the cast's names are swapped for what they look like before the brief is
 * ever sent.
 */
export function brief(note: string, cast: CastMember[] = []): string {
  let out = note
  for (const member of cast) {
    const name = (member.name ?? '').trim()
    const look = (member.look ?? '').trim()
    if (name.length < 2 || !look) continue
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s)?\\b`, 'gi')
    let first = true
    out = out.replace(pattern, () => {
      // Named once in full, then shortened, so a three-character panel does not
      // become three paragraphs of description.
      if (first) { first = false; return look }
      return look.split(/[,;]/)[0]
    })
  }
  return out
}

/** Words that start a sentence or stand for nobody in particular. */
const ORDINARY = new Set([
  'A', 'An', 'The', 'He', 'She', 'They', 'It', 'His', 'Her', 'Their', 'Its', 'This', 'That',
  'There', 'Then', 'Two', 'Three', 'Four', 'Five', 'One', 'In', 'On', 'At', 'Above', 'Below',
  'Behind', 'Beside', 'Inside', 'Outside', 'Over', 'Under', 'Close', 'Wide', 'Panel', 'Page',
  'Left', 'Right', 'Middle', 'Foreground', 'Background', 'Night', 'Day', 'Morning', 'Evening',
  'Winter', 'Summer', 'Autumn', 'Spring',
])

/**
 * A last-ditch brief with the names taken out altogether.
 *
 * Used only after a refusal, because it is blunt: anything capitalised that is
 * not an ordinary word goes, which costs a little colour but gets the panel
 * drawn. Better a picture of "a small red fox on a quay" than a hole in the
 * page where a named one would have been.
 */
export function withoutNames(note: string): string {
  const stripped = note.replace(/\b([A-Z][a-z]{2,})\b/g, (word, _w, index: number) => {
    if (ORDINARY.has(word)) return word
    // A word that opens a sentence is probably just a sentence opening.
    const before = note.slice(0, index).trimEnd()
    if (!before || /[.!?]$/.test(before)) return word
    return 'the character'
  })
  return `${stripped} Original character designs, not resembling any existing film, show or comic.`
}
