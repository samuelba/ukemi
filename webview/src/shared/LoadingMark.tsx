interface LoadingMarkProps {
  spinning?: boolean
}

export function LoadingMark({ spinning = false }: LoadingMarkProps) {
  const className = spinning ? 'empty-mark spinning' : 'empty-mark'
  return <div className={className} aria-hidden="true" />
}

export function LoadingScreen({ heading }: { heading: string }) {
  return (
    <div className="empty" role="status">
      <LoadingMark spinning />
      <div className="empty-heading">{heading}</div>
    </div>
  )
}
