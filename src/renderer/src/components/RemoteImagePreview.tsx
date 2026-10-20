import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { useRef, useState } from 'react'
import type { RemoteImageFile } from '../../../shared/remote-files'
import { useI18n } from '../i18n'

export function RemoteImagePreview({ file }: { file: RemoteImageFile }): React.JSX.Element {
  const { language } = useI18n()
  const label = (zh: string, en: string): string => (language === 'zh-CN' ? zh : en)
  const [zoom, setZoom] = useState<number>()
  const [size, setSize] = useState<{ width: number; height: number }>()
  const [failed, setFailed] = useState(false)
  const image = useRef<HTMLImageElement>(null)
  const changeZoom = (factor: number): void => {
    if (!size) return
    const current = zoom ?? (image.current?.clientWidth ?? size.width) / size.width
    setZoom(Math.max(0.05, Math.min(8, current * factor)))
  }
  return (
    <div className="remote-image-preview">
      <div
        className="remote-image-toolbar"
        role="group"
        aria-label={label('图片缩放', 'Image zoom')}
      >
        <button
          className="icon-button"
          disabled={!size || failed}
          aria-label={label('缩小', 'Zoom out')}
          title={label('缩小', 'Zoom out')}
          onClick={() => changeZoom(1 / 1.25)}
        >
          <ZoomOut size={16} />
        </button>
        <button
          className="quiet-button"
          disabled={failed}
          aria-pressed={zoom === undefined}
          onClick={() => setZoom(undefined)}
        >
          <Maximize size={14} />
          {label('适应窗口', 'Fit to window')}
        </button>
        <button
          className="quiet-button"
          disabled={!size || failed}
          aria-pressed={zoom === 1}
          onClick={() => setZoom(1)}
          title={label('原始尺寸', 'Actual size')}
        >
          100%
        </button>
        <button
          className="icon-button"
          disabled={!size || failed}
          aria-label={label('放大', 'Zoom in')}
          title={label('放大', 'Zoom in')}
          onClick={() => changeZoom(1.25)}
        >
          <ZoomIn size={16} />
        </button>
        {zoom !== undefined && <span>{Math.round(zoom * 100)}%</span>}
      </div>
      <div className="remote-image-viewport">
        {failed ? (
          <p role="alert">
            {label(
              '无法显示这张图片，文件可能已损坏。',
              'Unable to display this image. The file may be damaged.'
            )}
          </p>
        ) : (
          <img
            ref={image}
            src={file.dataUrl}
            alt={file.path.split('/').pop() ?? label('图片', 'Image')}
            draggable={false}
            className={zoom === undefined ? 'fit' : 'scaled'}
            style={zoom !== undefined && size ? { width: size.width * zoom } : undefined}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              })
            }
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <footer className="remote-file-editor-footer">
        <span>
          {file.mime.slice(6).toUpperCase()}
          {size && ` · ${size.width} × ${size.height}`}
        </span>
        <span>
          {file.bytes < 1024 * 1024
            ? `${(file.bytes / 1024).toFixed(1)} KB`
            : `${(file.bytes / 1024 / 1024).toFixed(1)} MB`}
        </span>
      </footer>
    </div>
  )
}
