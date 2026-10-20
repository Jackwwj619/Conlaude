import { useI18n } from '../i18n'
import { Modal } from './ui/Modal'

export function DiscardChangesDialog({
  onContinue,
  onDiscard,
  fileName,
  embedded
}: {
  onContinue: () => void
  onDiscard: () => void
  fileName?: string
  embedded?: boolean
}): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  return (
    <Modal
      embedded={embedded}
      label={zh ? '尚有未保存内容' : 'Unsaved changes'}
      className="small-modal"
      onClose={onContinue}
    >
      <div className="modal-content">
        <h2>{zh ? '尚有未保存内容' : 'Unsaved changes'}</h2>
        {fileName && <p className="discard-file-name">{fileName}</p>}
        <p>
          {zh
            ? '继续编辑，或明确放弃本次未保存的修改。已写入文件的内容不会撤回。'
            : 'Continue editing or discard unsaved changes. Previously saved files are not reverted.'}
        </p>
      </div>
      <footer className="modal-footer">
        <button autoFocus className="secondary-button" onClick={onContinue}>
          {zh ? '继续编辑' : 'Continue editing'}
        </button>
        <button className="danger-button" onClick={onDiscard}>
          {zh ? '放弃修改' : 'Discard changes'}
        </button>
      </footer>
    </Modal>
  )
}
