import { MenuButton } from "./MenuButton"
import { Icon } from "./Icon"
import { PartScope } from "../fixtures/PartScope"

export const name = "Menu button"
export const note = "A button that opens a menu above it. Arrows move, Escape closes and returns focus."

export default function Closed() {
  return <PartScope><div style={{ paddingTop: "10rem", display: "flex", justifyContent: "end" }}>
    <MenuButton label="More tools" triggerClass="dr-btn" menuClass="dr-split__menu" trigger={<><Icon name="more" /> More</>}>
      <button type="button" role="menuitem" className="dr-split__item">Checks</button>
      <button type="button" role="menuitem" className="dr-split__item">Calibrate</button>
    </MenuButton>
  </div></PartScope>
}
