# Bookwright

A standalone app for making books and publishing them as real files. Two kinds:
a **novel** — chapters of prose, exported as PDF, Word, EPUB, or Markdown — or a
**graphic novel** — pages of panels, artwork, and lettering, exported as a print
PDF, a CBZ comic archive, or a lettering script.

Everything runs in the browser: books are stored locally (IndexedDB), there is
no account, and the only server-side piece is a small function that holds the
image-generation key.

```bash
npm install
npm run dev        # http://localhost:5180
```

Deployed on Vercel from the `main` branch; pushes to other branches get their
own preview URL.

## Installing it as an app

Bookwright is a progressive web app: open the link on a phone or laptop and add
it to the home screen or dock, and it launches fullscreen with its own icon, no
browser chrome, and no app store.

- **iPhone / iPad** — open in Safari, tap Share, then *Add to Home Screen*.
- **Android** — open in Chrome, tap the ⋮ menu, then *Install app*.
- **Desktop** — Chrome or Edge show an install icon in the address bar.

A service worker caches the app shell, so once it has been opened it keeps
working with no connection — everything except generating pictures runs in the
browser. Fingerprinted assets are cached indefinitely; the page itself is
fetched fresh when online, so a new deploy is picked up as soon as it can be.

The workspace adapts to a phone: the page list and the panel inspector move
into drawers, and tapping a panel opens its controls.

## What it does

**Write.** A book is a list of chapters you write in a rich-text editor — bold,
italic, underline, strikethrough, three heading levels, block quotes, bulleted
and numbered lists, and scene breaks. Chapters can be renamed, reordered, and
split into front matter (a preface), body chapters, and back matter (an
appendix). Only body chapters are numbered, the way a printed book does it.
Everything autosaves.

**Or have it written for you.** *Write me a story* on the library screen asks
what the book is about — "a fox who runs a lost property office at the bottom of
the sea" — and writes it: a novel with chapters and pages, or a graphic novel
laid out as pages of panels with the dialogue already in balloons. Pick how long
it should be — about 50, 100 or 200 pages — and who it is for; the audience
shapes the vocabulary, not just the subject matter. The result is an ordinary
book in your library, yours to rewrite.

The book is planned first and then written a chapter at a time, so there is a
real progress bar rather than a spinner, and a long book cannot be cut off
halfway by a single call running out of time. Two hundred pages is forty calls
and the better part of half an hour, so **each chapter is saved as it lands**:
stopping early, closing the tab, or losing the connection leaves a shorter book
in the library rather than nothing at all.

**From a show or a film.** Instead of your own idea you can name something you
love — "How to Train Your Dragon" — and get a book set there, with its real
characters and places: either a new adventure of theirs or its own story told
again, whichever you pick.

The pictures cannot simply be asked for, because an image model refuses or
mangles a character named outright. So the drawings are made from description
instead: the plan comes back with a **cast**, each character described as they
actually look — age, build, hair, clothes, markings — closely enough to be
recognised, and every panel's brief carries that description rather than the
name. They will be close rather than exact, and the form says so where you type
the title rather than leaving you to find out after fifty pages.

That same cast is what makes any generated comic hold together. Each panel is
drawn on its own with no memory of the one before, so a brief saying only "Rell
looks up" draws a different Rell every time; repeating the description in every
panel is what keeps a character the same on page forty as on page one.

For a graphic novel there is also **Draw the pictures too**, which fills in every
panel from the brief the story wrote for it. A book this long is hundreds of
pictures and an image allowance runs out long before that, so it stops at the
first sign of a spent quota and keeps everything drawn up to that point — the
rest can be drawn panel by panel whenever you like.

Both need the same API key as picture-making, below.

**Say it instead of typing it.** A microphone sits beside the chapter editor,
the story idea, each panel's picture description, and each balloon. Speaking
fills the box as typing would. This is the browser's own speech recognition
rather than the image key's provider, so nothing is sent to the deployment and
no allowance is spent — and it needs no setting up. Firefox has never shipped
it, so there the button is simply not offered.

**As many pages in a chapter as you want.** A chapter is written as a run of
pages, listed above the editor — add one and keep writing, reorder them, delete
one. Each page starts a fresh sheet in the PDF and the `.docx`, so you decide
where the breaks fall instead of leaving it to the typesetter. A chapter written
before pages existed opens as a single page, with nothing to convert.

**See it as a book.** Preview shows the jacket, title page, table of contents,
and every chapter typeset as pages. The jacket itself is generated from a
palette and a layout, so a book always has a presentable cover without you
sourcing artwork.

**Publish.** Five export formats, each built from the same parsed document:

| Format | What you get |
| --- | --- |
| **PDF** | Typeset for print: title page, contents with dot leaders and real page numbers, chapters and their pages opening on fresh sheets, justified body text, running heads and folios. Choose 6×9 in, A5, or US Letter, and the body text size. |
| **Word** | A `.docx` with genuine heading styles and page breaks between chapters and between the pages within them — editable in Word, Pages, or Google Docs. |
| **EPUB** | A valid EPUB 3 package with navigation, metadata, and a stylesheet, for Kindle, Apple Books, or Kobo. |
| **Markdown** | Plain text with formatting preserved and punctuation escaped. |
| **Backup** | The whole project as JSON, re-importable from the library screen. |

**Print it.** *Print* hands the whole book to a printer, one page of the book
per sheet of paper: a title page, then every written page, or every drawn comic
page as artwork. It goes through the browser rather than the PDF writer, which
is what reaches a printer from a phone as well as a laptop — and what lets you
print a few pages instead of all of them, or choose *Save as PDF* in the
printer dialog. The content comes from the same parsed model the exporters use,
so the printout and the PDF are the same book.

Keyboard: `⌘/Ctrl+P` prints, `⇧⌘/Ctrl+P` previews, `⌘/Ctrl+E` exports.

## Graphic novels

Choosing **Graphic novel** when you start a book swaps the chapter editor for a
page-and-panel one.

**Lettering that fits.** A panel is clipped when it is drawn, so a balloon that
outgrows it does not merely look wrong — the words vanish. Long lettering widens
toward the panel first, the way a letterer reaches for more width before
touching the type size, then shrinks the type only once there is no width left,
and the balloon is held inside the panel rather than cut in half by the edge. A
sound effect too long for its balloon shrinks instead of splitting across lines.
So you can write as much as you like in a balloon and still read it back.

**Group pages into chapters.** Add a chapter from the page list and pages file
under it; add as many pages to each chapter as the story needs. The arrows on a
page move it through the book and, at a chapter's edge, into the chapter next
door — or use the *Chapter* picker above the page. Pages added before there were
any chapters stay where they are, ahead of the first one. Page numbers run
straight through the book, chapters and all, and the exported script announces
each chapter before its pages. Deleting a chapter keeps its pages; only the
heading goes.

**Lay out a page.** Eight layouts — splash, two or three rows, three columns,
four or six up, and a hero panel over or under a pair. Changing a page's layout
keeps the artwork already placed; only panels the new layout has no room for are
dropped, along with their images.

**Type a thing and get a picture.** Describe what should be in the panel — "a
red fox on a night bus" — pick an art style, and the panel is filled with a
generated image. What you typed stays on the panel, so it survives a reload and
turns up in the exported script where the artwork is still to come. A story
written for you arrives with that brief already filled in for every panel, so
drawing the book is one press per panel. The prompt is shaped for comics (it names the medium and asks
for no lettering, since balloons are added afterwards) and the output size is
matched to the panel's shape so the artwork is barely cropped.

Picture-making and story-writing are the two features that need setting up,
because the key cannot live in — anyone could read it out of the bundle and spend your credit.
`api/generate-image.ts` is a serverless function that holds it server-side.

Set **one** of these environment variables on the Vercel project and redeploy:

| Variable | Provider | Notes |
| --- | --- | --- |
| `GOOGLE_API_KEY` | Google AI Studio (`aistudio.google.com`) | Has a free allowance, so you can start without paying. `GEMINI_API_KEY` works too. |
| `OPENAI_API_KEY` | OpenAI (`platform.openai.com`) | Needs credit on the account; roughly 2–10¢ an image. |

Google is used when both are present. Note that a Claude subscription cannot be
used here: the Anthropic API generates text, not images.

Rather than hardcode a Google model name that will age, the functions read
Google's own model list and pick from it — a dedicated Imagen model for
pictures, a Flash model for writing, since a chapter does not need the heaviest
model and a slow call is one that times out. A model is taken only when the
list says it supports the call being made, and settled names are preferred over
previews and moving aliases: the list carries models that cannot serve these
endpoints at all, and one of them answers `This model only supports
Interactions API`. If the chosen model turns out not to write, the endpoint
falls back to one that does rather than waiting for a redeploy. Pin either with `GOOGLE_IMAGE_MODEL`
or `GOOGLE_TEXT_MODEL` (`OPENAI_TEXT_MODEL` for OpenAI) to override that.

Without any key the app says so plainly and everything else still works. Both
endpoints answer a `GET` with whether a key reached them, which is the quickest
way to tell a missing key from a bug: setting the variable on the wrong project,
or on one that has not been rebuilt since, looks identical from the outside.

> The endpoint is public once deployed — anyone with the URL can generate images
> on your account. Vercel's deployment protection (Project → Settings →
> Deployment Protection) is the simplest way to lock it to you.

**Draw the panels.** Every panel opens a drawing board: brush, straight line,
flood fill, and eraser, with a palette plus a custom colour, six brush sizes,
undo/redo (`⌘Z` / `⇧⌘Z`), and clear. The sheet is shaped to the panel it belongs
to, so a drawing lands in its frame uncropped, and reopening loads what is
already there — so you can pick a drawing back up, or ink over a photo.

**Or bring in a picture.** A panel takes a photo or scan instead. Images are
downscaled on import (a phone photo is far larger than a panel needs) and
cover-fitted to the frame, with zoom and pan to choose the crop.

**Balloons point at whoever is speaking.** A written comic says who says each
line and where they are standing — left, middle or right — so the balloon leans
toward them and its tail reaches down to their head and shoulders. Two people
talking end up on their own sides of the panel rather than stacked in a corner
with tails aimed at nothing, which is the single thing that makes a drawn page
look wrong even when everything else is right. A caption, a sound effect or a
voice from off-panel has nobody to point at, and is drawn without a tail.

**Letter it.** Five kinds of balloon — speech, thought, caption, shout, and
sound effect — each drawn properly: a tapered tail off the balloon's own
outline, a scalloped cloud with a bubble trail for thoughts, a starburst for a
shout, and outlined display type for sound effects. Drag one handle to move a
balloon and another to aim its tail.

**Publish it.** A print **PDF** (each page rendered and embedded at your chosen
trim and resolution), a **CBZ** archive of page images with a `ComicInfo.xml`
sidecar that comic readers use for metadata, or a plain-text **script** listing
every page, panel, and line of lettering in order — the format a letterer or
collaborator expects. Trim sizes: 6.625 × 10.25 in, A4, or square; 150, 200, or
300 dpi.

Artwork is held in its own IndexedDB store rather than on the book record, so
autosaving a page never rewrites megabytes of images. Replacing or removing a
panel's artwork collects the image nothing references any more. A graphic
novel's JSON backup embeds its artwork as base64, so the file is portable on its
own.

## How it fits together

```
src/
├── lib/
│   ├── blocks.ts        HTML → structured blocks (the shared document model)
│   ├── book.ts          ids, chapter numbering, page grouping, reordering, slugs
│   ├── db.ts            IndexedDB persistence (books + artwork assets)
│   ├── store.ts         Zustand state + debounced autosave
│   ├── stats.ts         word counts, reading time, panel counts
│   ├── cover.ts         jacket palettes and layouts
│   ├── graphic/         layouts · pages · assets · drawing · generation · renderer
│   ├── printing.ts      what goes on each sheet of paper
│   ├── story/           written-story requests, and turning one into a book
│   ├── useSpeech.ts     dictation through the browser's own recogniser
│   └── export/          markdown · docx · epub · pdf · comic (+ shared options)
└── components/
    ├── graphic/         PageCanvas, PageList, PanelInspector, DrawingBoard
    └── ...              Library, Workspace, Editor, ChapterList, PageStrip, Preview,
                          PrintView, MicButton, dialogs
```

A comic page records which chapter it belongs to, and the book keeps its pages
stored in reading order, grouped by chapter — every edit re-groups them, so the
stored order and the chapter each page claims can never disagree. That is what
lets page numbers, the exported script, and the preview all read straight down
the one array.

The editor stores chapter bodies as TipTap HTML. Rather than have four
exporters each re-interpret markup, `blocks.ts` parses that HTML once into a
small block model — headings, paragraphs, quotes, lists, code, rules, and
formatted runs — and every writer renders from it. The on-screen preview renders
from the same model, so what you see matches what gets exported, and an imported
project file never reaches the DOM as markup.

The PDF writer is the one non-obvious piece. jsPDF draws a single font at a
time, so mixed-format text is laid out by hand: each word is measured in its own
style, wrapped greedily into lines, and justified by distributing the leftover
width across the spaces. The table of contents needs page numbers that only
exist after layout, so the book is rendered twice — the first pass discovers
where each chapter lands, the second prints those numbers. Front matter is a
fixed length, which is what makes the two passes agree.

Lettering goes through the renderer too. `layoutBalloon` decides where a balloon
lands and how its text is set, and the editor asks it where the balloon actually
ended up so the drag handle stays on the thing it moves — rather than keeping a
second, slightly different idea of the same geometry.

Comic pages take the same approach one level up. `graphic/render.ts` draws a
page to a canvas, and that single renderer backs the editor, the preview, and
both exports — the CBZ zips its output as page images, and the PDF embeds them.
So the preview of a comic page is not an approximation of the export; it is the
export. The editor draws through it too, with DOM overlays for panel selection
and balloon dragging positioned from the same geometry.

Exporters are loaded on demand: jsPDF and docx together outweigh the rest of the
app, and most sessions are spent writing rather than exporting.

## Checks

```bash
npm test          # unit tests (vitest)
npm run lint
npm run typecheck
npm run build
```

The unit tests cover the parts worth pinning down — the HTML parser, chapter
numbering, the page grouping and the rule for stepping a page between chapters,
migrating a chapter written before pages existed, word counts, Markdown generation, backup import validation, panel
layout geometry, the artwork crop maths, the drawing board's flood fill and
colour parsing, the page counts each length promises, what lands on each printed sheet, that a
story set in a show asks for its cast by how they really look and keeps names
out of the drawing briefs, that a balloon's tail reaches toward the speaker and
that a caption never grows one, the drawing pass (that it
stops dead on a spent allowance, skips a single refused picture, and keeps what
it drew), balloon fitting (that a long speech stays inside the panel it is
drawn in, and a sound effect shrinks rather than splitting), reading a written
story back from whatever shape the model replied in, that a page break the
writer made really opens a new sheet, and both generators' prompt shaping, size and model
selection, and every failure path (run against a stubbed provider, so no API key
or spend is needed). The two endpoints must each be self-contained to deploy, so
what they duplicate — the style table, the limits the forms enforce, the way a
provider failure is classified — is held in step by tests rather than by hope.
