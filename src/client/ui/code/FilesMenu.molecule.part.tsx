import { FilesMenu } from "./FilesMenu"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { codeView } from "../fixtures/views"

export const name = "Files menu"
export const note = "Every file of the editing subject, grouped by import depth, with a filter."

export default function Files() {
  const { view, actions } = useFixture(codeView)
  return <PartScope width="30rem" height="26rem"><div className="dr-code__tabs" style={{ justifyContent: "end" }}>{view.code._tag === "Ready" && <FilesMenu code={view.code} actions={actions} />}</div></PartScope>
}
