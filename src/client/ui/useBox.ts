import { useLayoutEffect, useState } from "react"
import type { RefObject } from "react"

export type Box = { readonly width: number; readonly height: number }
const ZERO: Box = { width: 0, height: 0 }

/**
 * The content box of an element, in CSS px, kept current by a ResizeObserver.
 * The state changes only when a size changes, so a render never loops on it.
 */
export function useBox(ref: RefObject<HTMLElement | null>): Box {
  const [box, setBox] = useState<Box>(ZERO)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const width = node.clientWidth
      const height = node.clientHeight
      setBox(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return box
}
