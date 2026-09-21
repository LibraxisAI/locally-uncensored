
import { useEffect, useRef } from 'react'
import { cn } from './cn'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onSubmit?: () => void
  maxHeight?: number
  autoFocus?: boolean
  className?: string
}

// Auto-grow textarea — grow logic ported from PromptInput.tsx:46-51.
export function PromptField({ value, onChange, placeholder, onSubmit, maxHeight = 220, autoFocus, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }, [value, maxHeight])

  return (
    <textarea
      // `data-lu-quiet-focus`: um ein Promptfeld liegt kein lila Rechteck
      // (Eigner, 21.09.2026: "der lila balken um das prompt fenster geht
      // garnicht", danach "nirgends"). Der Kasten um dieses Feld zeigt den
      // Fokus selbst, mit `focus-within:border-*` (Composer.tsx, beide
      // Einbindungen). Die Regel dazu steht in index.css.
      data-lu-quiet-focus
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit() }
      }}
      placeholder={placeholder}
      rows={1}
      className={cn(
        't-body w-full resize-none bg-transparent outline-none text-gray-100 placeholder-gray-600 scrollbar-thin leading-relaxed',
        className,
      )}
      style={{ maxHeight }}
    />
  )
}