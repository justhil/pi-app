import { useEffect, useState } from 'react'
import { Globe } from '@renderer/components/icons'

/** Renders a site favicon with automatic fallback to Globe icon if the URL 404s or fails to load. */
export function FaviconImg({
  src,
  className = 'h-3.5 w-3.5 shrink-0',
}: {
  src?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])
  if (!src || failed) {
    return <Globe className={`${className} opacity-55`} />
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={`${className} rounded-xs object-contain`}
    />
  )
}
