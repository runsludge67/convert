import type { FileFormat, FileData, FormatHandler, ConvertPathNode } from "./FormatHandler.js";
import normalizeMimeType from "./normalizeMimeType.js";
import handlers from "./handlers";

/** Files currently selected for conversion */
let selectedFiles: File[] = [];

/**
 * Whether to use "simple" mode.
 * - In **simple** mode, the output list shows each format once.
 * - In **advanced** mode, the output list shows every handler separately.
 */
let simpleMode: boolean = true;

/** The input format option auto-detected from the selected file. */
let selectedInputOption: { format: FileFormat, handler: FormatHandler } | null = null;

/** The output format option the user picks from #to-list. */
let selectedOutputOption: { format: FileFormat, handler: FormatHandler } | null = null;

/** The currently active category filter. */
let currentCategory: string = "all";

/** Whether the format list is in grid view (true) or list view (false). */
let isGridView: boolean = false;

/** Handlers that support conversion from any input format. */
const conversionsFromAnyInput: ConvertPathNode[] = handlers
  .filter(h => h.supportAnyInput && h.supportedFormats)
  .flatMap(h => h.supportedFormats!
    .filter(f => f.to)
    .map(f => ({ handler: h, format: f })));

const ui = {
  fileInput:        document.querySelector("#file-input")         as HTMLInputElement,
  fileSelectArea:   document.querySelector("#file-area")          as HTMLDivElement,
  uploadState:      document.querySelector("#upload-state")       as HTMLElement,
  convertState:     document.querySelector("#convert-state")      as HTMLElement,
  fileNameEl:       document.querySelector("#file-name")          as HTMLSpanElement,
  fileSizeEl:       document.querySelector("#file-size")          as HTMLSpanElement,
  fromFormatSelect: document.querySelector("#from-format-select") as HTMLSelectElement,
  changeFileBtn:    document.querySelector("#change-file-btn")    as HTMLButtonElement,
  convertButton:    document.querySelector("#convert-button")     as HTMLButtonElement,
  modeToggleButton: document.querySelector("#mode-button")        as HTMLButtonElement,
  outputList:       document.querySelector("#to-list")            as HTMLDivElement,
  outputSearch:     document.querySelector("#search-to")          as HTMLInputElement,
  categoryButtons:  document.querySelectorAll(".category-btn")    as NodeListOf<HTMLButtonElement>,
  popupBox:         document.querySelector("#popup")              as HTMLDivElement,
  popupBackground:  document.querySelector("#popup-bg")          as HTMLDivElement,
};

// ─── Popup ────────────────────────────────────────────────────────────────────

window.showPopup = function (html: string) {
  ui.popupBox.innerHTML = html;
  ui.popupBox.classList.remove("hidden");
  ui.popupBackground.classList.remove("hidden");
};

window.hidePopup = function () {
  ui.popupBox.classList.add("hidden");
  ui.popupBackground.classList.add("hidden");
};

const popupClose = document.querySelector("#popup-close") as HTMLButtonElement | null;
if (popupClose) popupClose.onclick = () => window.hidePopup();

// ─── State transitions ────────────────────────────────────────────────────────

function showConvertState() {
  ui.uploadState.classList.add("fade-out");
  setTimeout(() => {
    ui.uploadState.classList.add("hidden");
    ui.uploadState.classList.remove("fade-out");
    ui.convertState.classList.remove("hidden");
    requestAnimationFrame(() => ui.convertState.classList.add("fade-in"));
    setTimeout(() => ui.convertState.classList.remove("fade-in"), 400);
  }, 250);
}

function showUploadState() {
  ui.convertState.classList.add("fade-out");
  setTimeout(() => {
    ui.convertState.classList.add("hidden");
    ui.convertState.classList.remove("fade-out");
    ui.uploadState.classList.remove("hidden");
    requestAnimationFrame(() => ui.uploadState.classList.add("fade-in"));
    setTimeout(() => ui.uploadState.classList.remove("fade-in"), 400);
  }, 250);
}

ui.changeFileBtn.addEventListener("click", () => {
  selectedFiles = [];
  selectedInputOption = null;
  selectedOutputOption = null;
  ui.convertButton.classList.add("disabled");
  showUploadState();
});

// ─── Format list helpers ──────────────────────────────────────────────────────

/**
 * Filters visible format buttons in a list by a search string and current category.
 */
function filterButtonList(list: HTMLDivElement, string: string) {
  for (const button of Array.from(list.children)) {
    if (!(button instanceof HTMLButtonElement)) continue;

    const formatIndex = button.getAttribute("format-index");
    let matchesSearch = !string; // empty search matches everything
    if (!matchesSearch && formatIndex) {
      const opt = allOptions[parseInt(formatIndex)];
      matchesSearch =
        (opt?.format.extension?.toLowerCase().includes(string) ?? false) ||
        (button.textContent?.toLowerCase().includes(string) ?? false);
    } else if (!matchesSearch) {
      matchesSearch = button.textContent?.toLowerCase().includes(string) ?? false;
    }

    const matchesCat =
      currentCategory === "all" ||
      button.getAttribute("data-cat") === currentCategory;

    button.style.display = (matchesSearch && matchesCat) ? "" : "none";
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

ui.outputSearch.addEventListener("input", () => {
  filterButtonList(ui.outputList, ui.outputSearch.value.toLowerCase());
});

// ─── Category filter ──────────────────────────────────────────────────────────

ui.categoryButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    ui.categoryButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentCategory = btn.getAttribute("data-cat") ?? "all";
    filterButtonList(ui.outputList, ui.outputSearch.value.toLowerCase());
  });
});

// ─── File selection ───────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024)    return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
  return (bytes / 1048576).toFixed(2) + " MB";
}

/**
 * Detects the input format from the file and updates the file info bar.
 */
function handleFileSelected(files: File[]) {
  if (files.length === 0) return;

  if (files.some(c => c.type !== files[0].type)) {
    return alert("All input files must be of the same type.");
  }

  files.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
  selectedFiles = files;

  // Update file info bar
  ui.fileNameEl.textContent = files.length > 1
    ? `${files[0].name} (+${files.length - 1} more)`
    : files[0].name;
  ui.fileSizeEl.textContent = formatFileSize(files[0].size);

  // Detect input format
  const mimeType = normalizeMimeType(files[0].type);
  const fileExtension = files[0].name.split(".").pop()?.toLowerCase() ?? "";

  const match = allOptions.find(opt =>
    (mimeType && opt.format.mime === mimeType) ||
    opt.format.extension?.toLowerCase() === fileExtension
  );

  selectedInputOption = match ?? null;

  // Populate the "from" select with detected format
  ui.fromFormatSelect.innerHTML = "";
  if (match) {
    const opt = document.createElement("option");
    opt.textContent = match.format.format.toUpperCase();
    ui.fromFormatSelect.appendChild(opt);
  } else {
    const opt = document.createElement("option");
    opt.textContent = fileExtension.toUpperCase() || "Unknown";
    ui.fromFormatSelect.appendChild(opt);
  }

  // Reset output selection
  selectedOutputOption = null;
  ui.convertButton.classList.add("disabled");
  Array.from(ui.outputList.querySelectorAll(".selected"))
    .forEach(el => el.classList.remove("selected"));

  showConvertState();
}

const fileSelectHandler = (event: Event) => {
  let inputFiles: FileList | null | undefined;

  if (event instanceof DragEvent) {
    inputFiles = event.dataTransfer?.files;
    if (inputFiles) event.preventDefault();
  } else if (event instanceof ClipboardEvent) {
    inputFiles = event.clipboardData?.files;
  } else {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    inputFiles = target.files;
  }

  if (!inputFiles) return;
  const files = Array.from(inputFiles);
  if (files.length === 0) return;
  handleFileSelected(files);
};

ui.fileInput.addEventListener("change", fileSelectHandler);
ui.fileSelectArea.addEventListener("click", () => ui.fileInput.click());
ui.fileSelectArea.addEventListener("keydown", e => {
  if (e.key === "Enter") ui.fileInput.click();
});

ui.fileSelectArea.addEventListener("dragover", e => {
  e.preventDefault();
  ui.fileSelectArea.classList.add("drag-over");
});
ui.fileSelectArea.addEventListener("dragleave", e => {
  if (!ui.fileSelectArea.contains(e.relatedTarget as Node))
    ui.fileSelectArea.classList.remove("drag-over");
});
ui.fileSelectArea.addEventListener("drop", e => {
  e.preventDefault();
  ui.fileSelectArea.classList.remove("drag-over");
  fileSelectHandler(e);
});

window.addEventListener("paste", fileSelectHandler);

// ─── Format cache & list building ────────────────────────────────────────────

const allOptions: Array<{ format: FileFormat, handler: FormatHandler }> = [];

window.supportedFormatCache = new Map();

window.printSupportedFormatCache = () => {
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
};

/**
 * Returns the category string for a given MIME type.
 */
function mimeToCategory(mime: string): string {
  if (mime.startsWith("image/"))       return "image";
  if (mime.startsWith("video/"))       return "video";
  if (mime.startsWith("audio/"))       return "audio";
  if (mime.startsWith("application/") || mime.startsWith("text/")) {
    if (["application/zip", "application/x-tar", "application/x-7z-compressed",
         "application/gzip", "application/x-rar-compressed"].includes(mime))
      return "archive";
    return "document";
  }
  return "other";
}

async function buildOptionList() {
  allOptions.length = 0;
  ui.outputList.innerHTML = "";

  for (const handler of handlers) {
    if (!window.supportedFormatCache.has(handler.name)) {
      console.warn(`Cache miss for formats of handler "${handler.name}".`);
      try {
        await handler.init();
      } catch (_) { continue; }
      if (handler.supportedFormats) {
        window.supportedFormatCache.set(handler.name, handler.supportedFormats);
        console.info(`Updated supported format cache for "${handler.name}".`);
      }
    }

    const supportedFormats = window.supportedFormatCache.get(handler.name);
    if (!supportedFormats) {
      console.warn(`Handler "${handler.name}" doesn't support any formats.`);
      continue;
    }

    for (const format of supportedFormats) {
      if (!format.mime) continue;

      allOptions.push({ format, handler });

      if (!format.to) continue;

      // In simple mode show each output format only once
      if (simpleMode) {
        const alreadyListed = Array.from(ui.outputList.children).some(c => {
          const idx = c.getAttribute("format-index");
          if (!idx) return false;
          const opt = allOptions[parseInt(idx)];
          return opt?.format.mime === format.mime && opt?.format.format === format.format;
        });
        if (alreadyListed) continue;
      }

      const formatCode = format.format.toUpperCase();
      const cleanName = simpleMode
        ? format.name
            .split("(").join(")").split(")")
            .filter((_, i) => i % 2 === 0)
            .filter(c => c !== "")
            .join(" ")
        : `${format.name} — ${handler.name}`;

      const btn = document.createElement("button");
      btn.className = "format-btn";
      btn.setAttribute("format-index", (allOptions.length - 1).toString());
      btn.setAttribute("mime-type", format.mime);
      btn.setAttribute("data-cat", mimeToCategory(format.mime));

      if (isGridView) {
        btn.innerHTML =
          `<span class="fmt-code">${formatCode}</span>` +
          `<span class="fmt-mime-sm">${format.mime.split("/")[0]}</span>`;
      } else {
        btn.innerHTML =
          `<span class="fmt-code">${formatCode}</span>` +
          `<span class="fmt-desc">` +
            `<span class="fmt-name">${cleanName}</span>` +
            `<em class="fmt-mime">${format.mime}</em>` +
          `</span>`;
      }

      btn.addEventListener("click", () => {
        // Deselect previous
        Array.from(ui.outputList.querySelectorAll(".format-btn.selected"))
          .forEach(el => el.classList.remove("selected"));
        btn.classList.add("selected");

        selectedOutputOption = { format, handler };
        ui.convertButton.classList.toggle("disabled", selectedInputOption === null);
      });

      ui.outputList.appendChild(btn);
    }
  }

  filterButtonList(ui.outputList, ui.outputSearch.value.toLowerCase());
  window.hidePopup();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────

const modeBtnLabel  = ui.modeToggleButton.querySelector("span") as HTMLSpanElement;
const modeBtn2      = document.querySelector("#mode-button-2") as HTMLButtonElement | null;
const modeBtn2Label = modeBtn2?.querySelector("span") as HTMLSpanElement | null;

function syncModeButtons() {
  const label = simpleMode ? "Advanced mode" : "Simple mode";
  modeBtnLabel.textContent = label;
  if (modeBtn2Label) modeBtn2Label.textContent = label;
  ui.modeToggleButton.classList.toggle("active", !simpleMode);
  modeBtn2?.classList.toggle("active", !simpleMode);
  if (simpleMode) {
    document.documentElement.removeAttribute("data-mode");
  } else {
    document.documentElement.setAttribute("data-mode", "advanced");
  }
}

function onModeClick() {
  simpleMode = !simpleMode;
  syncModeButtons();
  buildOptionList();
}

ui.modeToggleButton.addEventListener("click", onModeClick);
modeBtn2?.addEventListener("click", onModeClick);

// ─── View toggle (list / grid) ────────────────────────────────────────────────

const listViewBtn = document.querySelector("#list-view-btn") as HTMLButtonElement;
const gridViewBtn = document.querySelector("#grid-view-btn") as HTMLButtonElement;

listViewBtn?.addEventListener("click", () => {
  if (!isGridView) return;
  isGridView = false;
  listViewBtn.classList.add("active");
  gridViewBtn.classList.remove("active");
  ui.outputList.classList.replace("grid-view", "list-view");
  rebuildVisibleButtons();
});

gridViewBtn?.addEventListener("click", () => {
  if (isGridView) return;
  isGridView = true;
  gridViewBtn.classList.add("active");
  listViewBtn.classList.remove("active");
  ui.outputList.classList.replace("list-view", "grid-view");
  rebuildVisibleButtons();
});

/**
 * Rebuilds button innerHTML for the current view mode, preserving selection state.
 */
function rebuildVisibleButtons() {
  for (const button of Array.from(ui.outputList.children)) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const idx = button.getAttribute("format-index");
    if (!idx) continue;
    const opt = allOptions[parseInt(idx)];
    if (!opt) continue;
    const { format } = opt;
    const isSelected = button.classList.contains("selected");
    const formatCode = format.format.toUpperCase();
    if (isGridView) {
      button.innerHTML =
        `<span class="fmt-code">${formatCode}</span>` +
        `<span class="fmt-mime-sm">${format.mime.split("/")[0]}</span>`;
    } else {
      const cleanName = simpleMode
        ? format.name.split("(").join(")").split(")")
            .filter((_, i) => i % 2 === 0).filter(c => c !== "").join(" ")
        : `${format.name} — ${allOptions[parseInt(idx)].handler.name}`;
      button.innerHTML =
        `<span class="fmt-code">${formatCode}</span>` +
        `<span class="fmt-desc">` +
          `<span class="fmt-name">${cleanName}</span>` +
          `<em class="fmt-mime">${format.mime}</em>` +
        `</span>`;
    }
    if (isSelected) button.classList.add("selected");
  }
}

// ─── Persistent path store ────────────────────────────────────────────────────

/**
 * Serializable representation of a single node in a conversion path.
 * We can't store live handler/format objects in localStorage, so we store
 * just the names and reconstruct from allOptions on lookup.
 */
interface StoredNode {
  handlerName: string;
  formatMime: string;
  formatFormat: string;
}

const PATH_STORE_KEY = "convertit:pathStore";

/** Load the raw store from localStorage. Returns a plain object map. */
function loadPathStore(): Record<string, StoredNode[]> {
  try {
    return JSON.parse(localStorage.getItem(PATH_STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Persist the store back to localStorage. */
function savePathStore(store: Record<string, StoredNode[]>): void {
  try {
    localStorage.setItem(PATH_STORE_KEY, JSON.stringify(store));
  } catch {
    console.warn("Could not save path store to localStorage.");
  }
}

/**
 * Build the localStorage key for a given conversion pair.
 * In advanced mode, the handler name is part of the key so simple/advanced
 * caches don't bleed into each other.
 */
function pathStoreKey(
  inputMime: string,
  outputMime: string,
  outputHandlerName?: string
): string {
  return outputHandlerName
    ? `${inputMime}→${outputMime}:${outputHandlerName}`
    : `${inputMime}→${outputMime}`;
}

/** Save a successful path to the store. */
function storePath(key: string, path: ConvertPathNode[]): void {
  const store = loadPathStore();
  store[key] = path.map(n => ({
    handlerName: n.handler.name,
    formatMime: n.format.mime,
    formatFormat: n.format.format,
  }));
  savePathStore(store);
}

/**
 * Try to reconstruct a live ConvertPathNode[] from stored data.
 * Returns null if any node can't be matched (e.g. handler was removed).
 */
function recallPath(key: string): ConvertPathNode[] | null {
  const store = loadPathStore();
  const stored = store[key];
  if (!stored || stored.length === 0) return null;

  const nodes: ConvertPathNode[] = [];
  for (const s of stored) {
    const match = allOptions.find(
      o => o.handler.name === s.handlerName &&
           o.format.mime === s.formatMime &&
           o.format.format === s.formatFormat
    );
    if (!match) return null; // handler/format no longer available
    nodes.push(match);
  }
  return nodes;
}

/** Remove a stored path (called when a cached path fails at runtime). */
function evictPath(key: string): void {
  const store = loadPathStore();
  delete store[key];
  savePathStore(store);
  console.info(`Evicted stale path cache for "${key}".`);
}

// ─── Convert path cache & routing ────────────────────────────────────────────

const convertPathCache: Array<{ files: FileData[], node: ConvertPathNode }> = [];

async function attemptConvertPath(
  files: FileData[],
  path: ConvertPathNode[],
  onStepStart?: (path: ConvertPathNode[], stepIndex: number) => Promise<void>
) {
  const cacheLast = convertPathCache.at(-1);
  if (cacheLast) files = cacheLast.files;

  const start = cacheLast ? convertPathCache.length : 0;
  for (let i = start; i < path.length - 1; i++) {
    // Tell the UI which step is active and wait for the browser to paint
    // before starting the (potentially blocking) conversion work.
    await onStepStart?.(path, i);

    const handler = path[i + 1].handler;
    try {
      let supportedFormats = window.supportedFormatCache.get(handler.name);
      if (!handler.ready) {
        try {
          await handler.init();
        } catch (_) { return null; }
        if (handler.supportedFormats) {
          window.supportedFormatCache.set(handler.name, handler.supportedFormats);
          supportedFormats = handler.supportedFormats;
        }
      }
      if (!supportedFormats) throw `Handler "${handler.name}" doesn't support any formats.`;
      const inputFormat = supportedFormats.find(c => c.mime === path[i].format.mime && c.from)!;
      files = await handler.doConvert(files, inputFormat, path[i + 1].format);
      if (files.some(c => !c.bytes.length)) throw "Output is empty.";
      convertPathCache.push({ files, node: path[i + 1] });
    } catch (e) {
      console.log(path.map(c => c.format.format));
      console.error(handler.name, `${path[i].format.format} → ${path[i + 1].format.format}`, e);
      return null;
    }
  }

  return { files, path };
}

/** Symbol used to signal a timeout from buildConvertPath. */
const TIMEOUT_RESULT = Symbol("timeout");

async function buildConvertPath(
  files: FileData[],
  target: ConvertPathNode,
  queue: ConvertPathNode[][],
  onPathAttempt?: (path: ConvertPathNode[]) => void,
  deadlineMs?: number
): Promise<{ files: FileData[], path: ConvertPathNode[] } | typeof TIMEOUT_RESULT | null> {
  convertPathCache.length = 0;
  let isNestedConversion = false;
  let bestPartialPath: ConvertPathNode[] | null = null;

  while (queue.length > 0) {

    // ── Timeout check ───────────────────────────────────────────────────────
    if (deadlineMs && Date.now() > deadlineMs) {
      console.warn("buildConvertPath: search deadline exceeded.");
      if (convertPathCache.length > 0) {
        const partialPath = convertPathCache.map(c => c.node);
        return { files: convertPathCache.at(-1)!.files, path: partialPath };
      }
      return TIMEOUT_RESULT;
    }

    const path = queue.shift();
    if (!path) continue;
    if (path.length > 5) continue;

    for (let i = 1; i < path.length; i++) {
      if (path[i] !== convertPathCache[i]?.node) {
        convertPathCache.length = i - 1;
        break;
      }
    }

    const previous = path[path.length - 1];

    const validHandlers = handlers.filter(handler =>
      window.supportedFormatCache.get(handler.name)?.some(format =>
        format.mime === previous.format.mime && format.from
      )
    );

    if (simpleMode) {
      const candidates = allOptions.filter(opt =>
        validHandlers.includes(opt.handler) &&
        opt.format.mime === target.format.mime && opt.format.to
      );
      for (const candidate of candidates) {
        const candidatePath = path.concat(candidate);
        onPathAttempt?.(candidatePath);
        const attempt = await attemptConvertPath(files, candidatePath);
        if (attempt) return attempt;
        if (convertPathCache.length > (bestPartialPath?.length ?? 0))
          bestPartialPath = candidatePath;
      }
    } else {
      if (validHandlers.includes(target.handler)) {
        const candidatePath = path.concat(target);
        onPathAttempt?.(candidatePath);
        const attempt = await attemptConvertPath(files, candidatePath);
        if (attempt) return attempt;
      }
    }

    if (!isNestedConversion) {
      const anyConversions = conversionsFromAnyInput.filter(c => c.format.mime === target.format.mime);
      for (const conversion of anyConversions) {
        const candidatePath = path.concat(conversion);
        onPathAttempt?.(candidatePath);
        const attempt = await attemptConvertPath(files, candidatePath);
        if (attempt) return attempt;
      }
      isNestedConversion = true;
    }

    for (const handler of validHandlers) {
      const supportedFormats = window.supportedFormatCache.get(handler.name);
      if (!supportedFormats) continue;
      for (const format of supportedFormats) {
        if (!format.to || !format.mime) continue;
        if (path.some(c => c.format === format)) continue;
        queue.push(path.concat({ format, handler }));
      }
    }
  }

  return null;
}

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadFile(bytes: Uint8Array, name: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}

/**
 * Yields back to the browser so it can commit a repaint before we
 * continue with CPU-heavy work. Double rAF is required — the first
 * fires before the paint, the second fires after it.
 */
function paint(): Promise<void> {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

// ─── Convert button ───────────────────────────────────────────────────────────

const SEARCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

ui.convertButton.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return alert("Select an input file.");
  if (!selectedInputOption)       return alert("Could not detect input file format.");
  if (!selectedOutputOption)      return alert("Select an output format.");

  const inputFormat  = selectedInputOption.format;
  const outputFormat = selectedOutputOption.format;

  const cacheKey = pathStoreKey(
    inputFormat.mime,
    outputFormat.mime,
    simpleMode ? undefined : selectedOutputOption.handler.name
  );

  const startTime = Date.now();
  const deadline  = startTime + SEARCH_TIMEOUT_MS;
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function elapsedSec() {
    return ((Date.now() - startTime) / 1000).toFixed(1);
  }

  /** Phase 1 — BFS is still running, show searching UI */
  function startSearchPhase(pathLabel: string) {
    stopTimer();

    // Make the popup visible
    ui.popupBox.classList.remove("hidden");
    ui.popupBackground.classList.remove("hidden");

    ui.popupBox.innerHTML =
      `<h2>Finding conversion route...</h2>` +
      `<p id="popup-path-label">Trying <b>${pathLabel}</b></p>` +
      `<p class="popup-timer" id="popup-elapsed">${elapsedSec()}s elapsed</p>` +
      `<p class="popup-timeout-warn" id="popup-timeout-warn"></p>`;

    // Tick the elapsed counter and warn when getting close
    timerInterval = setInterval(() => {
      const elapsedMs = Date.now() - startTime;
      const remaining = Math.max(0, SEARCH_TIMEOUT_MS - elapsedMs);
      const elEl = ui.popupBox.querySelector<HTMLElement>("#popup-elapsed");
      const warnEl = ui.popupBox.querySelector<HTMLElement>("#popup-timeout-warn");
      if (elEl) elEl.textContent = (elapsedMs / 1000).toFixed(1) + "s elapsed";
      if (warnEl) {
        if (remaining < 60_000) {
          warnEl.textContent = `⚠ Timing out in ${(remaining / 1000).toFixed(0)}s — will use best path found`;
        } else {
          warnEl.textContent = "";
        }
      }
    }, 100);
  }

  /** Update only the path label inside the search popup without re-rendering the timer */
  const onPathUpdate = (path: ConvertPathNode[]) => {
    const label = path.map(c => c.format.format).join(" → ");
    const el = ui.popupBox.querySelector<HTMLElement>("#popup-path-label");
    if (el) el.innerHTML = `Trying <b>${label}</b>`;
    else startSearchPhase(label);
  };

  /** Phase 2 — path found, actual conversion running.
   *  Async so callers can await the repaint before starting heavy work. */
  let convertPhaseBuilt = false;
  async function startConvertPhase(path: ConvertPathNode[], stepIndex: number): Promise<void> {
    const pathLabel = path.map(c => c.format.format).join(" → ");

    if (!convertPhaseBuilt) {
      convertPhaseBuilt = true;
      stopTimer();

      // Make the popup visible
      ui.popupBox.classList.remove("hidden");
      ui.popupBackground.classList.remove("hidden");

      ui.popupBox.innerHTML =
        `<h2>Converting...</h2>` +
        `<p class="popup-path-label">${pathLabel}</p>` +
        `<div class="popup-steps" id="popup-steps">` +
          path.slice(1).map((n, i) =>
            `<span class="popup-step" id="popup-step-${i}">○ ${n.format.format}</span>`
          ).join("") +
        `</div>` +
        `<p class="popup-timer popup-timer-big" id="popup-elapsed">0.0s</p>`;

      // Start the live timer — updates every 100ms
      timerInterval = setInterval(() => {
        const el = ui.popupBox.querySelector<HTMLElement>("#popup-elapsed");
        if (el) el.textContent = elapsedSec() + "s";
      }, 100);
    }

    // Surgically update just the step pills
    path.slice(1).forEach((n, i) => {
      const el = ui.popupBox.querySelector<HTMLElement>(`#popup-step-${i}`);
      if (!el) return;
      if (i < stepIndex) {
        el.className = "popup-step done";
        el.textContent = `✓ ${n.format.format}`;
      } else if (i === stepIndex) {
        el.className = "popup-step active";
        el.textContent = `⟳ ${n.format.format}`;
      } else {
        el.className = "popup-step";
        el.textContent = `○ ${n.format.format}`;
      }
    });

    // Yield to the browser so it commits the paint before we return.
    // Double rAF: first fires before paint, second fires after.
    await paint();
  }

  try {
    const inputFileData: FileData[] = [];
    for (const inputFile of selectedFiles) {
      const inputBuffer = await inputFile.arrayBuffer();
      const inputBytes  = new Uint8Array(inputBuffer);
      if (inputFormat.mime === outputFormat.mime) {
        downloadFile(inputBytes, inputFile.name, inputFormat.mime);
        continue;
      }
      inputFileData.push({ name: inputFile.name, bytes: inputBytes });
    }

    // ── Try the cached path first ────────────────────────────────────────────
    const cachedPath = recallPath(cacheKey);
    let output: { files: FileData[], path: ConvertPathNode[] } | null = null;
    let usedCache  = false;
    let timedOut   = false;

    if (cachedPath) {
      // IMPORTANT: Clear the conversion cache so we see all the progress UI updates
      convertPathCache.length = 0;
      convertPhaseBuilt = false;
      
      // Build the popup and wait for it to paint before starting conversion
      await startConvertPhase(cachedPath, 0);
      output = await attemptConvertPath(inputFileData, cachedPath, startConvertPhase);

      if (output) {
        usedCache = true;
      } else {
        evictPath(cacheKey);
        output = null;
      }
    }

    // ── Full BFS search if no cache hit ──────────────────────────────────────
    if (!output) {
      startSearchPhase("...");

      const rawResult = await buildConvertPath(
        inputFileData,
        selectedOutputOption,
        [[selectedInputOption]],
        onPathUpdate,
        deadline
      );

      stopTimer();

      if (rawResult === TIMEOUT_RESULT) {
        // Pure timeout — nothing was even partially converted
        timedOut = true;
        window.hidePopup();
        alert(
          `Search timed out after 10 minutes with no usable path found.\n` +
          `Try a different output format or enable Advanced mode.`
        );
        return;
      }

      if (rawResult && "path" in rawResult) {
        const isPartial = rawResult.path.length > 0 &&
          rawResult.path.at(-1)?.format.mime !== outputFormat.mime;

        if (isPartial) {
          // Timeout returned a partial result — warn the user
          timedOut = true;
          const partialLabel = rawResult.path.map(c => c.format.format).join(" → ");
          window.showPopup(
            `<h2>⚠ Search timed out</h2>` +
            `<p>Used best partial path found:<br><b>${partialLabel}</b></p>` +
            `<p class="popup-timer">Stopped at 10 min</p>` +
            `<button class="popup-btn-ok" onclick="window.hidePopup()">OK</button>`
          );
          // Save the partial path so future attempts skip the search
          storePath(cacheKey, rawResult.path);
          for (const file of rawResult.files) {
            downloadFile(file.bytes, file.name, rawResult.path.at(-1)!.format.mime);
          }
          return;
        }

        // IMPORTANT: Clear the cache before the final conversion so UI updates work
        convertPathCache.length = 0;
        
        // Extract to a typed local so TypeScript knows it's non-null
        const confirmedResult = rawResult as { files: FileData[], path: ConvertPathNode[] };
        const confirmedPath   = confirmedResult.path;

        // Switch to convert phase — await the paint before starting conversion
        convertPhaseBuilt = false;
        await startConvertPhase(confirmedPath, 0);
        output = await attemptConvertPath(inputFileData, confirmedPath, startConvertPhase);

        if (output) storePath(cacheKey, output.path);
      }
    }

    stopTimer();

    if (!output) {
      window.hidePopup();
      alert("Failed to find conversion route.");
      return;
    }

    for (const file of output.files) {
      downloadFile(file.bytes, file.name, outputFormat.mime);
    }

    const elapsed = elapsedSec();
    window.showPopup(
      `<h2>Converted ${inputFormat.format} to ${outputFormat.format}!</h2>` +
      `<p>Path: <b>${output.path.map(c => c.format.format).join(" → ")}</b></p>` +
      `<p class="popup-timer">${usedCache ? `⚡ Cached · ${elapsed}s` : `Completed in ${elapsed}s`}</p>` +
      `<button class="popup-btn-ok" onclick="window.hidePopup()">OK</button>`
    );

  } catch (e) {
    stopTimer();
    window.hidePopup();
    alert("Unexpected error while routing:\n" + e);
    console.error(e);
  }
});

// ─── Initialise ───────────────────────────────────────────────────────────────

(async () => {
  window.showPopup("<h2>Loading tools...</h2>");
  try {
    const cacheJSON = await fetch("cache.json").then(r => r.json());
    window.supportedFormatCache = new Map(cacheJSON);
  } catch {
    console.warn(
      "Missing supported format precache.\n\n" +
      "Consider saving the output of printSupportedFormatCache() to cache.json."
    );
  } finally {
    await buildOptionList();
    console.log("Built initial format list.");
  }
})();