import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor as TipTapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import type { ProsePage } from '@/types'

interface ToolbarButton {
  icon: (props: { className?: string }) => JSX.Element
  label: string
  run: (editor: TipTapEditor) => void
  active?: (editor: TipTapEditor) => boolean
  disabled?: (editor: TipTapEditor) => boolean
}

const GROUPS: ToolbarButton[][] = [
  [
    { icon: Icons.Bold, label: 'Bold', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
    { icon: Icons.Italic, label: 'Italic', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
    { icon: Icons.Underline, label: 'Underline', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
    { icon: Icons.Strike, label: 'Strikethrough', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  ],
  [
    { icon: Icons.Quote, label: 'Block quote', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
    { icon: Icons.ListBullet, label: 'Bulleted list', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
    { icon: Icons.ListOrdered, label: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
    { icon: Icons.Rule, label: 'Scene break', run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
  [
    { icon: Icons.Undo, label: 'Undo', run: (e) => e.chain().focus().undo().run(), disabled: (e) => !e.can().undo() },
    { icon: Icons.Redo, label: 'Redo', run: (e) => e.chain().focus().redo().run(), disabled: (e) => !e.can().redo() },
  ],
]

const HEADINGS: { level: 1 | 2 | 3 | null; label: string }[] = [
  { level: null, label: 'Body text' },
  { level: 1, label: 'Section' },
  { level: 2, label: 'Subsection' },
  { level: 3, label: 'Minor heading' },
]

function Toolbar({ editor }: { editor: TipTapEditor }) {
  const activeHeading = HEADINGS.find((h) => h.level && editor.isActive('heading', { level: h.level }))?.level ?? null

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-rule bg-paper-raised/95 px-4 py-2 backdrop-blur">
      <select
        className="mr-1 rounded-md border border-rule-strong bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
        value={activeHeading ?? 'body'}
        aria-label="Paragraph style"
        onChange={(e) => {
          const value = e.target.value
          if (value === 'body') editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run()
        }}
      >
        {HEADINGS.map((h) => (
          <option key={h.label} value={h.level ?? 'body'}>{h.label}</option>
        ))}
      </select>

      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5 border-l border-rule pl-1 first-of-type:border-l-0 first-of-type:pl-0">
          {group.map((button) => {
            const Icon = button.icon
            const active = button.active?.(editor) ?? false
            return (
              <button
                key={button.label}
                type="button"
                title={button.label}
                aria-label={button.label}
                aria-pressed={active}
                disabled={button.disabled?.(editor) ?? false}
                className={clsx(
                  'rounded-md p-1.5 transition-colors disabled:opacity-30',
                  active ? 'bg-accent-soft text-accent-deep' : 'text-ink-soft hover:bg-paper-sunk hover:text-ink',
                )}
                // A toolbar button must never take focus: the browser would pull the
                // caret out of the document, and keystrokes typed straight after
                // the click would land on the button instead of the text.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => button.run(editor)}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * Mounted with `key={page.id}` by the workspace, so turning to another page —
 * or another chapter — builds a fresh editor rather than trying to swap
 * document state underneath an existing one.
 */
export function Editor({ page, placeholder, onChange }: {
  page: ProsePage
  placeholder?: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: placeholder ?? 'Start writing this chapter…' }),
    ],
    content: page.content,
    editorProps: { attributes: { class: 'tiptap min-h-[60vh] focus:outline-none' } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  })

  // Flush the final keystrokes when the page unmounts mid-edit.
  useEffect(() => () => { if (editor) onChange(editor.getHTML()) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor])

  if (!editor) return null

  return (
    <div className="manuscript flex h-full flex-col">
      <Toolbar editor={editor} />
      <div className="flex-1 overflow-y-auto scrollbar-slim">
        <div className="mx-auto w-full max-w-[38rem] px-6 py-10">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
