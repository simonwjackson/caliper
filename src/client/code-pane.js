// @ts-check
import { h } from "./dom.js"

/**
 * The code pane: the files behind what the stage shows, in a code editor.
 *
 * The pane follows the stage. For the real part it shows the real files, and
 * edits save to them, as in any editor; the frames reload through Vite. For a
 * take it shows the take's files against the real ones, and edits save to the
 * take (decision 21).
 *
 * CodeMirror loads the first time the pane opens, so a chrome that never
 * opens it never loads it.
 *
 * @typedef {import("../types").Part} Part
 * @typedef {import("../types").TakeView} TakeView
 * @typedef {import("../types").CodeFile} CodeFile
 * @typedef {import("../types").CodeDocument} CodeDocument
 * @typedef {import("../types").CodeChange} CodeChange
 * @typedef {import("./code-editor.js").Mode} Mode
 * @typedef {typeof import("./code-editor.js")} EditorModule
 * @typedef {ReturnType<EditorModule["createEditor"]>} Editor
 * @typedef {{ part: Part, take: TakeView | null, state: string | null }} Subject
 *   The part you edit, as the real files or as one take. `state` is null
 *   when the stage shows every state.
 * @typedef {{
 *   selectState: (exportName: string) => void,
 *   stopTake: (take: string) => void,
 * }} PaneHooks
 * @typedef {{ file: string, take: string | null, saved: string, local: string, sending: string | null, original: string | null | undefined, inflight: Promise<void> | null }} Doc
 *   One open file. `saved` is the file on disk as the pane last knew it,
 *   `local` the text in the editor, `sending` the text of a save on its way.
 *   `original` is the real file a take is compared with, null when the take
 *   adds the file, undefined for a real file.
 * @typedef {{ _tag: "Idle" } | { _tag: "Edited" } | { _tag: "Saving" } | { _tag: "Saved" } | { _tag: "Failed", reason: string }} SaveState
 * @typedef {{ _tag: "Closed" } | { _tag: "Loading" } | { _tag: "Ready", editor: Editor, module: EditorModule } | { _tag: "Failed", reason: string }} Load
 */

/** Saving waits for a pause in typing this long. */
const SAVE_DELAY_MS = 350
/** File events come in bursts; the file list refreshes once per burst. */
const FILES_DELAY_MS = 150
/** Past this many files, the Files menu offers a filter. */
const MENU_FILTER_FROM = 10

/**
 * @param {HTMLElement} host the pane's element, laid out by the chrome
 * @param {PaneHooks} hooks
 */
export function createCodePane(host, hooks) {
  /** @type {Subject | null} */
  let subject = null
  let isOpen = false
  /** The subject changed while the pane was closed. */
  let stale = true
  /** @type {Load} */
  let load = { _tag: "Closed" }
  /** @type {CodeFile[]} */
  let files = []
  /** @type {string | null} */
  let file = null
  /** The doc in the editor. @type {Doc | null} */
  let current = null
  /** @type {Map<string, Doc>} */
  const docs = new Map()
  /** Lines each changed file adds and removes. @type {Map<string, { added: number, removed: number }>} */
  let stats = new Map()
  /** @type {SaveState} */
  let save = { _tag: "Idle" }
  let changes = 0
  /** @type {string | null} */
  let notice = null
  /** Each subject or file change starts a new generation; replies for an older one are dropped. */
  let generation = 0
  /** The file last open in each part. @type {Map<string, string>} */
  const lastFile = new Map()
  /**
   * Whether the pane moves to each file the take's agent changes. It stops
   * when you pick a file, and starts again with the next subject.
   */
  let following = true
  /** A file asked for by `reveal` before the pane could open it. @type {string | null} */
  let requested = null
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let filesTimer

  const tabs = h("nav", { class: "cal-code-tabs", "aria-label": "Open files" })
  // The browser toggles the menu from the button and closes it on Escape or an outside click.
  const filesButton = h("button", { type: "button", class: "cal-code-files", popovertarget: "cal-code-menu" })
  const menu = h("div", { class: "cal-code-menu", id: "cal-code-menu", popover: "auto", role: "dialog", "aria-label": "Files of this part" })
  menu.addEventListener("beforetoggle", event => {
    if (/** @type {ToggleEvent} */ (event).newState !== "open") return
    renderMenu()
    placeMenu()
  })
  menu.addEventListener("toggle", event => {
    if (/** @type {ToggleEvent} */ (event).newState !== "open") return
    /** @type {HTMLElement | null} */ (menu.querySelector("input, [aria-current='true'], button"))?.focus()
  })
  /** The tab last scrolled into view. @type {string | null} */
  let scrolledTo = null
  const path = h("p", { class: "cal-code-path" })
  const mode = h("div", { class: "cal-code-mode" })
  const status = h("p", { class: "cal-code-status", role: "status" })
  const surface = h("div", { class: "cal-code-editor" })
  const message = h("p", { class: "cal-code-message" })
  host.replaceChildren(
    h("header", { class: "cal-code-head" }, tabs, filesButton),
    h("div", { class: "cal-code-context" }, path, mode, status),
    h("div", { class: "cal-code-body" }, surface, message),
    menu,
  )
  window.addEventListener("beforeunload", event => {
    if (current && (current.local !== current.saved || current.inflight)) event.preventDefault()
  })

  // ------------------------------------------------------------- following

  /**
   * Follow the stage. Cheap when nothing the pane shows changed.
   *
   * @param {Subject | null} next
   */
  const show = next => {
    const before = subject
    subject = next
    if (!isOpen || load._tag !== "Ready") {
      stale = true
      return render()
    }
    if (next === null) {
      void flush()
      file = null
      files = []
      return render()
    }
    if (before === null || listKey(before) !== listKey(next)) {
      // Leaving a take for the real files of the same part keeps the file open.
      const carried = before?.part.file === next.part.file && next.take === null
      void flush()
      return void openSubject(carried ? file : null)
    }
    if (before.take?.run._tag !== next.take?.run._tag && current) load.editor.setMode(modeFor(current))
    if ((before.take?.files ?? []).join("\n") !== (next.take?.files ?? []).join("\n")) scheduleFiles()
    if (before.state !== next.state) {
      load.editor.setLenses(lensesFor(file))
      if (file === next.part.file && next.state) load.editor.revealState(next.state)
    }
    render()
  }

  /**
   * Open or close the pane. Opening it the first time loads the editor.
   *
   * @param {boolean} open
   */
  const setOpen = open => {
    isOpen = open
    if (!open) return void flush()
    if (load._tag === "Closed" || load._tag === "Failed") return void loadEditor()
    if (load._tag === "Ready" && stale) {
      stale = false
      void openSubject(file)
    }
  }

  const loadEditor = async () => {
    load = { _tag: "Loading" }
    render()
    try {
      const module = /** @type {EditorModule} */ (await import("./code-editor.js"))
      const editor = module.createEditor(surface, {
        onEdit,
        onSave: () => void flush(),
        onSelectState: exportName => hooks.selectState(exportName),
        onChanges: count => {
          changes = count
          renderMode()
        },
      })
      load = { _tag: "Ready", editor, module }
      stale = false
      if (isOpen && subject) await openSubject(null)
    } catch (error) {
      load = { _tag: "Failed", reason: reason(error) }
    }
    render()
  }

  /**
   * List the subject's files, choose one, and open it.
   *
   * @param {string | null} keep a file to keep open if the subject has it
   */
  const openSubject = async keep => {
    const target = subject
    if (!target) return render()
    const run = ++generation
    notice = null
    render()
    try {
      const list = await fetchFiles(target)
      if (run !== generation) return
      files = list
      void refreshStats(target)
      const wanted = requested !== null && list.some(entry => entry.file === requested) ? requested : null
      requested = null
      // A file you asked for stays open while an agent works; otherwise follow the agent.
      following = wanted === null
      await openFile(chooseFile(target, list, wanted ?? keep))
    } catch (error) {
      if (run === generation) {
        notice = reason(error)
        render()
      }
    }
  }

  /** @param {string} next */
  const openFile = async next => {
    const target = subject
    if (!target || load._tag !== "Ready") return
    const editor = load.editor
    const run = ++generation
    if (file !== next) void flush()
    file = next
    lastFile.set(target.part.file, next)
    notice = null
    render()
    try {
      const fresh = await fetchDoc(target.take, next)
      if (run !== generation) return
      const key = docKey(target.take, next)
      const known = docs.get(key)
      // Text you typed that did not save stays; the file on disk does not replace it.
      const dirty = known !== undefined && known.local !== known.saved
      /** @type {Doc} */
      const doc = known ?? { file: next, take: target.take?.take ?? null, saved: fresh.content, local: fresh.content, sending: null, original: fresh.original, inflight: null }
      doc.saved = fresh.content
      if (!dirty) doc.local = fresh.content
      doc.original = fresh.original
      docs.set(key, doc)
      // The same doc again, for example when the take it belongs to changes, keeps its save status.
      if (doc !== current) save = dirty ? { _tag: "Edited" } : { _tag: "Idle" }
      current = doc
      editor.open({ key, file: next, content: doc.local, mode: modeFor(doc), lenses: lensesFor(next) })
      if (next === target.part.file && target.state) editor.revealState(target.state)
      if (dirty) scheduleSave()
    } catch (error) {
      if (run === generation) notice = reason(error)
    }
    render()
  }

  // ----------------------------------------------------------------- saving

  /** @param {string} content */
  const onEdit = content => {
    const target = subject
    const doc = current
    if (!target || !doc) return
    doc.local = content
    save = { _tag: "Edited" }
    scheduleSave()
    renderStatus()
  }

  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  /**
   * Save the open file now: a real file to the project, a take's file to the
   * take. Resolves when the file on disk has your text.
   */
  const flush = async () => {
    clearTimeout(saveTimer)
    const doc = current
    if (!doc) return
    if (doc.inflight) await doc.inflight
    if (doc.local === doc.saved) return
    const content = doc.local
    save = { _tag: "Saving" }
    renderStatus()
    doc.sending = content
    doc.inflight = (async () => {
      try {
        await postJson(doc.take === null ? "code/file" : `takes/${doc.take}/file`, { file: doc.file, content })
        doc.saved = content
        save = doc.local === doc.saved ? { _tag: "Saved" } : { _tag: "Edited" }
        if (load._tag === "Ready" && doc.original !== undefined) stats.set(doc.file, load.module.lineChanges(doc.original, content))
      } catch (error) {
        save = { _tag: "Failed", reason: reason(error) }
      } finally {
        doc.inflight = null
        doc.sending = null
        render()
      }
    })()
    await doc.inflight
    // Text typed while the file saved goes out after the next pause.
    if (/** @type {SaveState} */ (save)._tag === "Edited") scheduleSave()
  }

  // ------------------------------------------------------------ disk changes

  /**
   * A file changed on disk: an agent's edit, your own save, or an edit in
   * another editor.
   *
   * @param {CodeChange} change
   */
  const diskChanged = change => {
    const target = subject
    if (!isOpen || !target || load._tag !== "Ready") return
    const take = target.take?.take ?? null
    // A take sees a real file wherever it has no copy of its own.
    const seen = change.take === take || (change.take === null && take !== null)
    if (!seen) return
    // A take's own file can join or leave the list; any listed file can change what the part imports.
    if ((change.take !== null && change.take === take) || files.some(entry => entry.file === change.file)) scheduleFiles()
    if (change.file === file) void reconcile(target)
  }

  /** @param {Subject} target */
  const reconcile = async target => {
    const doc = current
    if (!doc || load._tag !== "Ready") return
    const editor = load.editor
    const run = generation
    const fresh = await fetchDoc(target.take, doc.file).catch(() => null)
    if (fresh === null || run !== generation || current !== doc) return
    if (doc.original !== undefined && fresh.original !== doc.original) {
      doc.original = fresh.original
      editor.setMode(modeFor(doc))
    }
    // Your own save arriving back from disk, or text the editor already shows.
    if (fresh.content === doc.saved || fresh.content === doc.sending) return render()
    if (fresh.content === doc.local) {
      doc.saved = fresh.content
      return render()
    }
    if (doc.local !== doc.saved || doc.inflight) {
      notice = "The file changed on disk while you typed. Caliper keeps your text, and saves it over the file on disk."
      return render()
    }
    doc.saved = fresh.content
    doc.local = fresh.content
    editor.replaceFromDisk(fresh.content, true)
    render()
  }

  const scheduleFiles = () => {
    clearTimeout(filesTimer)
    filesTimer = setTimeout(async () => {
      const target = subject
      if (!target) return
      const list = await fetchFiles(target).catch(() => null)
      if (list === null || subject === null || listKey(subject) !== listKey(target)) return
      const known = new Set(files.filter(entry => entry.changed).map(entry => entry.file))
      files = list
      await refreshStats(target)
      render()
      // Follow the agent: open the file it just started to change.
      const fresh = list.find(entry => entry.changed && !known.has(entry.file))
      if (following && target.take?.run._tag === "Running" && fresh && fresh.file !== file) void openFile(fresh.file)
    }, FILES_DELAY_MS)
  }

  /** You chose a file: the pane stops following the agent. @param {string} next */
  const pick = next => {
    following = false
    void openFile(next)
  }

  /** @param {Subject} target */
  const refreshStats = async target => {
    if (load._tag !== "Ready") return
    const module = load.module
    const changed = target.take ? files.filter(entry => entry.changed) : []
    const next = new Map()
    await Promise.all(changed.map(async entry => {
      const fresh = await fetchDoc(target.take, entry.file).catch(() => null)
      if (fresh !== null) next.set(entry.file, module.lineChanges(fresh.original ?? null, fresh.content))
    }))
    if (subject === null || listKey(subject) !== listKey(target)) return
    stats = next
    render()
  }

  // ----------------------------------------------------------------- choice

  /**
   * The file to open for a subject. A take opens the file it changes; the
   * real part keeps the file you had open, or opens the part's own component.
   *
   * @param {Subject} target
   * @param {CodeFile[]} list
   * @param {string | null} keep
   */
  const chooseFile = (target, list, keep) => {
    /** @param {string | null | undefined} candidate */
    const listed = candidate => candidate != null && list.some(entry => entry.file === candidate)
    if (listed(keep)) return /** @type {string} */ (keep)
    const previous = lastFile.get(target.part.file)
    const changed = list.filter(entry => entry.changed)
    if (target.take && changed.length > 0) {
      if (changed.some(entry => entry.file === previous)) return /** @type {string} */ (previous)
      return (changed.find(entry => entry.depth !== null) ?? /** @type {CodeFile} */ (changed[0])).file
    }
    if (listed(previous)) return /** @type {string} */ (previous)
    return mainFile(target.part.file, list)
  }

  /** @param {Doc} doc @returns {Mode} */
  const modeFor = doc => {
    const take = subject?.take
    if (doc.take === null || !take) return { _tag: "Real" }
    const original = doc.original ?? null
    return take.run._tag === "Running" ? { _tag: "Watching", original } : { _tag: "Take", original }
  }

  /** @param {string | null} open */
  const lensesFor = open => {
    const target = subject
    if (!target || open !== target.part.file || target.part.states.length < 2) return []
    return target.part.states.map(partState => ({ export: partState.export, label: partState.label, current: partState.export === target.state }))
  }

  // ----------------------------------------------------------------- render

  const render = () => {
    host.dataset.load = load._tag
    renderTabs()
    renderContext()
    renderMessage()
  }

  const renderTabs = () => {
    const shown = files.filter(entry => (entry.depth !== null && entry.depth <= 1) || entry.changed || entry.file === file)
    const labels = fileLabels(shown.map(entry => entry.file))
    tabs.replaceChildren(...shown.map((entry, index) => h("button", {
      type: "button",
      class: "cal-code-tab",
      title: entry.depth === null ? `${entry.file}\nThis take changes it, but this part does not import it.` : entry.file,
      "aria-current": entry.file === file ? "true" : false,
      "data-changed": entry.changed ? "true" : false,
      onClick: () => pick(entry.file),
    }, h("span", { class: "cal-code-tab-name" }, labels[index] ?? entry.file), entry.changed ? statBadge(entry.file) : null)))
    if (scrolledTo !== file) {
      scrolledTo = file
      tabs.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
    filesButton.textContent = files.length ? `Files · ${files.length}` : "Files"
    filesButton.disabled = files.length === 0
  }

  /** @param {string} name */
  const statBadge = name => {
    const stat = stats.get(name)
    if (!stat) return h("span", { class: "cal-code-stat" }, "changed")
    return h("span", { class: "cal-code-stat", "aria-label": `${stat.added} lines added, ${stat.removed} removed` },
      h("span", { class: "cal-code-added" }, `+${stat.added}`), " ", h("span", { class: "cal-code-removed" }, `−${stat.removed}`))
  }

  const renderContext = () => {
    const slash = file?.lastIndexOf("/") ?? -1
    path.replaceChildren(...(file === null ? [] : [
      h("span", { class: "cal-code-dir" }, slash >= 0 ? file.slice(0, slash + 1) : ""),
      h("span", { class: "cal-code-base" }, slash >= 0 ? file.slice(slash + 1) : file),
    ]))
    path.title = file ?? ""
    renderMode()
    renderStatus()
  }

  const renderMode = () => {
    const target = subject
    if (!target || file === null || load._tag !== "Ready") return mode.replaceChildren()
    const take = target.take
    if (!take || current?.take === null) return mode.replaceChildren(chip("Real file", "real"))
    if (take.run._tag === "Running") {
      return mode.replaceChildren(
        chip(`Take ${take.take}`, "take"),
        h("span", { class: "cal-code-hint" }, "Its agent is editing"),
        h("button", { type: "button", class: "cal-code-action", onClick: () => hooks.stopTake(take.take) }, "Stop"))
    }
    const original = current?.original
    mode.replaceChildren(
      chip(`Take ${take.take}`, "take"),
      original === null
        ? h("span", { class: "cal-code-hint" }, "New file in this take")
        : changes === 0
          ? h("span", { class: "cal-code-hint" }, "Same as the real file")
          : h("span", { class: "cal-code-changes", role: "group", "aria-label": "Changes" },
            h("button", { type: "button", class: "cal-code-step", title: "Previous change (Alt+↑)", "aria-label": "Previous change", onClick: () => load._tag === "Ready" && load.editor.previousChange() }, "↑"),
            h("span", {}, `${changes} ${changes === 1 ? "change" : "changes"}`),
            h("button", { type: "button", class: "cal-code-step", title: "Next change (Alt+↓)", "aria-label": "Next change", onClick: () => load._tag === "Ready" && load.editor.nextChange() }, "↓")))
  }

  const renderStatus = () => {
    status.className = `cal-code-status cal-code-status-${save._tag.toLowerCase()}`
    status.textContent = save._tag === "Edited" ? "Edited"
      : save._tag === "Saving" ? "Saving…"
      : save._tag === "Saved" ? (current?.take ? "Saved to the take" : "Saved")
      : save._tag === "Failed" ? `Not saved: ${save.reason}`
      : ""
    status.title = save._tag === "Failed" ? save.reason : ""
  }

  const renderMessage = () => {
    const text = load._tag === "Loading" ? "Loading the editor…"
      : load._tag === "Failed" ? `Caliper could not load its code editor: ${load.reason} Caliper serves CodeMirror from its own node_modules; install Caliper's dependencies and restart Vite.`
      : subject === null ? "Pick a part to see its code."
      : notice
    message.textContent = text ?? ""
    message.hidden = text === null || text === ""
    message.dataset.kind = load._tag === "Failed" || (notice !== null && load._tag === "Ready") ? "problem" : "note"
    surface.hidden = load._tag !== "Ready" || subject === null || file === null
  }

  // ------------------------------------------------------------------- menu

  /** The menu escapes the pane (it lives in the top layer) and opens under the Files button. */
  const placeMenu = () => {
    const anchor = filesButton.getBoundingClientRect()
    const width = Math.min(28 * 16, window.innerWidth - 16)
    menu.style.width = `${width}px`
    menu.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`
    const below = window.innerHeight - anchor.bottom - 12
    const above = anchor.top - 12
    if (below >= 240 || below >= above) {
      menu.style.top = `${anchor.bottom + 4}px`
      menu.style.bottom = "auto"
      menu.style.maxHeight = `${below}px`
    } else {
      menu.style.top = "auto"
      menu.style.bottom = `${window.innerHeight - anchor.top + 4}px`
      menu.style.maxHeight = `${above}px`
    }
  }

  /** @param {string} [filter] */
  const renderMenu = (filter = "") => {
    const needle = filter.trim().toLowerCase()
    const matching = files.filter(entry => !needle || entry.file.toLowerCase().includes(needle))
    const take = subject?.take
    /** @type {Array<[string, CodeFile[]]>} */
    const groups = [
      [take ? `Changed in take ${take.take}` : "", take ? matching.filter(entry => entry.changed && entry.depth !== null) : []],
      ["Changed, not imported by this part", matching.filter(entry => entry.depth === null)],
      ["The part", matching.filter(entry => entry.depth === 0 && !entry.changed)],
      ["What it imports", matching.filter(entry => entry.depth === 1 && !entry.changed)],
      ["Deeper", matching.filter(entry => entry.depth !== null && entry.depth > 1 && !entry.changed)],
    ]
    const list = h("div", { class: "cal-code-menu-list" },
      ...groups.filter(([, entries]) => entries.length > 0).flatMap(([title, entries]) => [
        h("h3", { class: "cal-code-menu-group" }, title),
        ...entries.map(entry => h("button", {
          type: "button",
          class: "cal-code-menu-file",
          "aria-current": entry.file === file ? "true" : false,
          title: entry.file,
          onClick: () => {
            menu.hidePopover()
            pick(entry.file)
          },
        },
          h("span", { class: "cal-code-menu-name" }, entry.file.slice(entry.file.lastIndexOf("/") + 1)),
          h("span", { class: "cal-code-menu-dir" }, entry.file.slice(0, entry.file.lastIndexOf("/") + 1)),
          entry.changed ? statBadge(entry.file) : null)),
      ]),
      matching.length === 0 ? h("p", { class: "cal-note" }, `No file matches “${filter}”.`) : null)
    const existing = menu.querySelector(".cal-code-menu-list")
    if (existing) return existing.replaceWith(list)
    menu.replaceChildren(
      ...(files.length >= MENU_FILTER_FROM
        ? [h("input", {
          class: "cal-code-menu-filter",
          type: "search",
          placeholder: "Filter files",
          "aria-label": "Filter files",
          onInput: event => renderMenu(/** @type {HTMLInputElement} */ (event.target).value),
        })]
        : []),
      list)
  }

  /**
   * Open one file of the subject, for example from the alternate review.
   * Call it before the pane opens; the pane opens the file when it is ready.
   *
   * @param {string} target root-relative
   */
  const reveal = target => {
    const ready = isOpen && load._tag === "Ready" && !stale
    if (ready && files.some(entry => entry.file === target)) return pick(target)
    requested = target
    // The list may not have the file yet: read it again.
    if (ready) void openSubject(file)
  }

  return {
    show,
    setOpen,
    diskChanged,
    reveal,
    /** Save the open file before an action that reads it, such as a prompt or Accept. */
    flush,
  }
}

// ------------------------------------------------------------------- helpers

/** @param {{ take: string, created: number } | null} take */
function takeKey(take) {
  return take ? `${take.take}@${take.created}` : "real"
}

/** @param {{ take: string, created: number } | null} take @param {string} file */
function docKey(take, file) {
  return `${takeKey(take)}|${file}`
}

/** @param {Subject} subject */
function listKey(subject) {
  return `${subject.part.file}|${takeKey(subject.take)}`
}

/**
 * The part's own component: the file it imports whose name matches the
 * part's, for example `Cart.tsx` for `Cart.atom.part.tsx`. Else the part file.
 *
 * @param {string} partFile
 * @param {CodeFile[]} list
 */
function mainFile(partFile, list) {
  const stem = baseName(partFile).split(".")[0]
  const candidates = list.filter(entry => entry.depth === 1 && baseName(entry.file).split(".")[0] === stem)
  return (candidates.find(entry => /\.(m|c)?(t|j)sx?$/.test(entry.file)) ?? candidates[0])?.file ?? partFile
}

/** @param {string} file */
function baseName(file) {
  return file.slice(file.lastIndexOf("/") + 1)
}

/**
 * Short names for tabs: the file name, with its folder when two files share
 * a name.
 *
 * @param {string[]} names
 */
function fileLabels(names) {
  const counts = new Map()
  for (const name of names) counts.set(baseName(name), (counts.get(baseName(name)) ?? 0) + 1)
  return names.map(name => {
    if (counts.get(baseName(name)) === 1) return baseName(name)
    const parts = name.split("/")
    return parts.slice(-2).join("/")
  })
}

/** @param {string} text @param {"real" | "take"} kind */
function chip(text, kind) {
  return h("span", { class: `cal-code-chip cal-code-chip-${kind}` }, text)
}

/** @param {unknown} error */
function reason(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {Subject} subject
 * @returns {Promise<CodeFile[]>}
 */
async function fetchFiles(subject) {
  const query = new URLSearchParams({ part: subject.part.file })
  if (subject.take) query.set("take", subject.take.take)
  const { files } = await getJson(`code/files?${query}`)
  return files
}

/**
 * @param {TakeView | null} take
 * @param {string} file
 * @returns {Promise<CodeDocument>}
 */
function fetchDoc(take, file) {
  const query = new URLSearchParams({ file })
  if (take) query.set("take", take.take)
  return getJson(`code/file?${query}`)
}

/** @param {string} url */
async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" })
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

/** @param {string} url @param {object} body */
async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result
}
