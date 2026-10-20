import * as Dialog from '@radix-ui/react-dialog'
import { useState, type ReactNode } from 'react'

interface Props {
  label: string
  className?: string
  onClose: () => void
  dismissible?: boolean
  children: ReactNode
  embedded?: boolean
}

export function Modal({
  label,
  className = '',
  onClose,
  dismissible = true,
  children,
  embedded = false
}: Props): React.JSX.Element {
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  if (embedded)
    return (
      <section className={`settings-embedded ${className}`} aria-label={label}>
        {children}
      </section>
    )
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && dismissible) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop">
          <Dialog.Content
            className={`modal ${className}`}
            aria-describedby={undefined}
            onPointerDownOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              event.preventDefault()
              if (dismissible) onClose()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (returnFocus?.isConnected) returnFocus.focus()
            }}
          >
            <Dialog.Title asChild>
              <span className="sr-only">{label}</span>
            </Dialog.Title>
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
