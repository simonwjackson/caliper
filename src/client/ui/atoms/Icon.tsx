import "../tokens.css"
import "./atoms.css"

export type IconName =
  | "mark" | "parts" | "preview" | "takes" | "code" | "knobs" | "checks" | "calibrate" | "more"
  | "clip" | "image" | "plus" | "close" | "chevron" | "chevron-down" | "stop" | "up" | "down" | "pin" | "area"

const PATHS: Record<Exclude<IconName, "chevron" | "chevron-down">, string> = {
  mark: "M4 7h18M4 7v13M9 7v4M14 7v6M19 7v4",
  parts: "M3 4h12M3 9h12M3 14h8",
  preview: "M3.5 4h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4z",
  takes: "M2 3h6v6H2zM10 3h6v6h-6zM2 11h6v4H2zM10 11h6v4h-6z",
  code: "M6 4 2 9l4 5M12 4l4 5-4 5",
  knobs: "M3 6h12M3 12h12",
  checks: "M3 9.5 7 13l8-8",
  calibrate: "M3.5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 12V6a1.5 1.5 0 0 1 1.5-1.5zM2 7.5h14",
  more: "M4 9h.01M9 9h.01M14 9h.01",
  clip: "M12.5 7 7.8 11.7a1.7 1.7 0 0 1-2.4-2.4L10.6 4a3 3 0 0 1 4.2 4.2l-5.6 5.6a4.2 4.2 0 0 1-6-6L8 3",
  image: "M3.5 3.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM2.5 11.5l3.5-3.5 3 3 2-2 4 4M11.5 6.5h.01",
  plus: "M9 4v10M4 9h10",
  close: "M5 5l8 8M13 5l-8 8",
  stop: "M5.5 5.5h7v7h-7z",
  up: "M9 14V4M5 8l4-4 4 4",
  down: "M9 4v10M5 10l4 4 4-4",
  pin: "M9 16s5-4.2 5-8.5A5 5 0 0 0 4 7.5C4 11.8 9 16 9 16z",
  area: "M3.5 3.5h11v11h-11z",
}

/** Line icons drawn in currentColor. The chevron is drawn in CSS so it sits on the x-height. */
export function Icon({ name }: { readonly name: IconName }) {
  if (name === "chevron" || name === "chevron-down") return <i className={`dr-chev${name === "chevron-down" ? " dr-chev--down" : ""}`} aria-hidden="true" />
  const size = name === "mark" ? 26 : 18
  return <svg className={`dr-icon dr-icon--${name}`} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor"
    strokeWidth={name === "more" ? 2.6 : name === "mark" ? 1.8 : 1.5} strokeLinecap={name === "more" ? "round" : undefined} strokeDasharray={name === "area" ? "2.5 2" : undefined} aria-hidden="true">
    <path d={PATHS[name]} />
    {name === "knobs" && <><circle cx="7" cy="6" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /></>}
    {name === "stop" && <rect x="5.5" y="5.5" width="7" height="7" fill="currentColor" stroke="none" />}
    {name === "pin" && <circle cx="9" cy="7.5" r="1.6" fill="currentColor" stroke="none" />}
  </svg>
}
