import logo from '../../../../logo.svg'

export function BrandLogo({ className = '' }: { className?: string }): React.JSX.Element {
  return <img className={`brand-logo ${className}`} src={logo} alt="Conlaude" draggable={false} />
}
