import {
  blankProfile,
  findProfile,
  getActiveProfileId,
  getPrefsPrefix,
  listProfiles,
  newProfileId,
  Profile,
  removeProfile,
  setActiveProfileId,
  upsertProfile,
} from "../ai/providers";
import { testConnection } from "../ai/client";
import { testAllModels } from "../ai/modelTest";
import {
  fetchModelList,
  loadCandidates,
  loadModels,
  ModelEntry,
  removeModel,
  prettyName,
  renameModel,
  saveModels,
  upsertModel,
} from "../services/modelRegistry";
import { getString } from "../utils/locale";
import {
  DEFAULT_CONTEXT_CHARS,
  DEFAULT_MAX_PDF_CHARS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  getPref,
  setPref,
} from "../utils/prefs";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const ID_PREFIX = "zai-";
const STYLE_ID = "zai-pref-style";

const PREF_STYLE = `
.zai-pref-section {
  font-weight: 600;
  margin: 14px 0 6px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--fill-quinary, #ddd);
  opacity: .9;
}
.zai-pref-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 8px 0;
}
.zai-pref-label {
  flex: 0 0 148px;
  padding-top: 5px;
  font-size: 12.5px;
}
.zai-pref-control {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zai-pref-control > input[type="text"],
.zai-pref-control > input[type="password"],
.zai-pref-control > input[type="number"],
.zai-pref-control > select {
  width: 100%;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  border-radius: 5px;
  padding: 5px 7px;
  font: inherit;
  font-size: 12.5px;
  background: var(--material-background, #fff);
  color: inherit;
  box-sizing: border-box;
}
.zai-pref-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.zai-pref-inline > input[type="text"],
.zai-pref-inline > input[type="password"],
.zai-pref-inline > select {
  flex: 1 1 200px;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  border-radius: 5px;
  padding: 5px 7px;
  font: inherit;
  font-size: 12.5px;
  background: var(--material-background, #fff);
  color: inherit;
  box-sizing: border-box;
}
.zai-pref-inline > input[type="number"] { width: 96px; flex: 0 0 96px; }
.zai-pref-check-inline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  white-space: nowrap;
}
.zai-pref-hint {
  font-size: 11px;
  opacity: .62;
  line-height: 1.45;
}
.zai-pref-hint.ok { color: #1c7a35; opacity: .95; }
.zai-pref-hint.fail { color: #b3261e; opacity: .95; }
.zai-pref-btn {
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  background: var(--material-button, #f5f5f5);
  color: inherit;
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.zai-pref-btn.primary {
  background: #2f6fdf;
  border-color: #2f6fdf;
  color: #fff;
}
.zai-pref-btn:disabled { opacity: .5; cursor: default; }
.zai-pref-footer { margin-top: 18px; display: flex; flex-direction: column; gap: 3px; }

/* ---- model table ---- */
.zai-model-row {
  border: 1px solid var(--fill-quinary, #ddd);
  border-radius: 6px;
  margin-top: 6px;
  background: var(--material-background, #fff);
}
.zai-model-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
}
.zai-model-toggle {
  flex: 0 0 22px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: inherit;
  padding: 0;
}
/* Native select: the arrow signals the value comes from a list. */
/* ---- searchable model combobox ---- */
.zai-combobox { position: relative; flex: 1 1 40%; min-width: 0; }
.zai-combobox .zai-model-id { width: 100%; box-sizing: border-box; }
.zai-combobox-panel {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  border-radius: 6px;
  background: var(--material-background, #fff);
  box-shadow: 0 8px 24px rgba(15, 23, 42, .18);
}
.zai-combobox-row {
  padding: 5px 9px;
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zai-combobox-row:hover { background: rgba(47, 111, 223, .08); }
.zai-combobox-active { font-weight: 600; color: #2f6fdf; }
.zai-combobox-empty { padding: 8px 9px; font-size: 11.5px; opacity: .6; }
@media (prefers-color-scheme: dark) {
  .zai-combobox-panel { background: #1a1d26; border-color: #2c3242; }
}
.zai-model-id {
  flex: 1 1 40%;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  border-radius: 5px;
  padding: 4px 22px 4px 8px;
  font: inherit;
  font-size: 12px;
  background: var(--material-background, #fff)
    url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="%236b7280" stroke-width="1.5" stroke-linecap="round"/></svg>')
    no-repeat right 8px center;
  color: inherit;
  appearance: none;
  -moz-appearance: none;
  cursor: pointer;
  max-width: 100%;
}
.zai-model-id:focus {
  outline: none;
  border-color: #2f6fdf;
  box-shadow: 0 0 0 3px rgba(47, 111, 223, .15);
}
.zai-model-name {
  flex: 1 1 40%;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  border-radius: 4px;
  padding: 4px 6px;
  font: inherit;
  font-size: 12px;
  background: transparent;
  color: inherit;
}
.zai-model-pick {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  background: var(--material-button, #f5f5f5);
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.zai-model-pick:hover { background: #e5e7eb; }
.zai-model-badge {
  flex: 0 0 auto;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  border: none;
  background: rgba(47, 111, 223, .12);
  color: #2f6fdf;
  cursor: default;
  white-space: nowrap;
}
.zai-model-delete {
  flex: 0 0 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  opacity: .6;
  padding: 0;
}
.zai-model-delete:hover { opacity: 1; }
.zai-model-body {
  display: none;
  gap: 14px;
  padding: 4px 7px 7px 32px;
}
.zai-model-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  opacity: .8;
}
.zai-model-number {
  width: 120px;
  border: 1px solid var(--fill-quaternary, #c9c9c9);
  border-radius: 4px;
  padding: 4px 6px;
  font: inherit;
  font-size: 12px;
  background: transparent;
  color: inherit;
}
@media (prefers-color-scheme: dark) {
  .zai-model-id, .zai-model-name, .zai-model-number {
    background: rgba(255,255,255,.05);
  }
}
`;

function byId<T extends Element = HTMLElement>(
  doc: Document,
  id: string,
): T | null {
  return doc.getElementById(`${ID_PREFIX}${id}`) as T | null;
}

function injectStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElementNS(XHTML_NS, "style") as HTMLStyleElement;
  style.id = STYLE_ID;
  style.textContent = PREF_STYLE;
  (doc.head || doc.documentElement)!.appendChild(style);
}

function option(doc: Document, value: string, label: string) {
  const el = doc.createElementNS(XHTML_NS, "option") as HTMLOptionElement;
  el.value = value;
  el.textContent = label;
  return el;
}


let doc!: Document;
/** The profile's model-id field, kept here so row click handlers can sync it. */
let modelInputRef: HTMLInputElement | null = null;

/**
 * A searchable model picker that looks like a native dropdown.
 *
 * A plain <select> cannot filter its options, so this renders an input plus a
 * pop-up list. Typing filters by id or display name.
 */
function buildModelCombobox(
  model: ModelEntry,
  candidates: ModelEntry[],
  onPick: (id: string) => void,
): HTMLElement {
  const wrap = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  wrap.className = "zai-combobox";

  const input = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
  input.className = "zai-model-id";
  input.value = prettyName(model.id, model.name);
  input.dataset.modelId = model.id;

  const panel = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  panel.className = "zai-combobox-panel";
  panel.style.display = "none";

  const render = (filter: string) => {
    const query = filter.trim().toLowerCase();
    panel.replaceChildren();
    const seen = new Set<string>();
    let shown = 0;
    // Read the list now rather than trusting the snapshot taken at build
    // time: fetching models can happen after this row was created.
    const live = candidates.length ? candidates : loadCandidates();
    for (const candidate of live) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const haystack = `${candidate.id} ${candidate.name}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      const row = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
      row.className = "zai-combobox-row";
      if (candidate.id === model.id) row.classList.add("zai-combobox-active");
      row.textContent = prettyName(candidate.id, candidate.name);
      row.title = candidate.id;
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onPick(candidate.id);
      });
      panel.appendChild(row);
      shown++;
      if (shown >= 200) break;
    }
    if (!shown) {
      const empty = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
      empty.className = "zai-combobox-empty";
      empty.textContent = getString("combobox-empty");
      panel.appendChild(empty);
    }
  };

  let open = false;
  const show = () => {
    open = true;
    panel.style.display = "block";
    render("");
  };
  const hide = () => {
    open = false;
    panel.style.display = "none";
  };

  input.addEventListener("focus", show);
  input.addEventListener("input", () => {
    if (!open) show();
    render(input.value);
  });
  input.addEventListener("blur", () => {
    // Delay so the row's mousedown can run first.
    Zotero.getMainWindow().setTimeout(hide, 150);
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      hide();
      input.value = prettyName(model.id, model.name);
    }
  });

  wrap.append(input, panel);
  return wrap;
}

/** Render one model row: expand toggle, id, name, use button, delete. */
function renderModelRow(
  model: ModelEntry,
  activeId: string,
  onChange: () => void,
): HTMLElement {
  const row = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  row.className = "zai-model-row";
  row.dataset.modelId = model.id;

  const head = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  head.className = "zai-model-head";

  const toggle = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  toggle.className = "zai-model-toggle";
  toggle.textContent = "›";
  toggle.title = "展开 / 收起";
  toggle.addEventListener("click", () => {
    const expanded = row.classList.toggle("expanded");
    toggle.textContent = expanded ? "⌄" : "›";
    const body = row.querySelector(".zai-model-body") as HTMLElement | null;
    if (body) body.style.display = expanded ? "flex" : "none";
  });

  // Model ID is a searchable combobox: a native <select> cannot filter, and
  // providers return hundreds of models.
  const idInput = buildModelCombobox(
    model,
    loadCandidates(),
    (nextId: string) => {
      // One atomic rename: no window in which the old row survives.
      renameModel(currentProfileId(), model.id, { ...model, id: nextId });
      refreshModelTable();
      onChange();
    },
  );
  const nameInput = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
  nameInput.className = "zai-model-name";
  nameInput.value = model.name;
  nameInput.placeholder = getString("pref-model-name");
  nameInput.addEventListener("change", () => {
    upsertModel(currentProfileId(), { ...model, name: nameInput.value.trim() });
    refreshModelTable();
    onChange();
  });

  // Clicking a row makes it the profile's current model, so the user never
  // has to type an id into the field above.
  const badge = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  badge.className = model.id === activeId ? "zai-model-badge" : "zai-model-pick";
  badge.textContent =
    model.id === activeId ? getString("pref-model-active") : getString("pref-model-use");
  badge.disabled = model.id === activeId;
  badge.addEventListener("click", () => {
    const profile = findProfile(currentProfileId());
    if (!profile) return;
    upsertProfile({ ...profile, defaultModel: model.id });
    modelInputRef!.value = model.id;
    refreshModelTable();
    onChange();
  });

  const del = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  del.className = "zai-model-delete";
  del.textContent = "🗑";
  del.title = "删除";
  del.addEventListener("click", () => {
    removeModel(currentProfileId(), model.id);
    refreshModelTable();
    onChange();
  });

  head.append(toggle, idInput, nameInput, badge, del);

  const body = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  body.className = "zai-model-body";
  body.style.display = "none";
  body.append(
    numberField("contextWindow", model.contextWindow, getString("pref-model-context")),
    numberField("maxOutputTokens", model.maxOutputTokens, getString("pref-model-maxout")),
  );

  row.append(head, body);
  return row;

  function numberField(
    key: "contextWindow" | "maxOutputTokens",
    value: number | undefined,
    label: string,
  ): HTMLElement {
    const wrap = doc.createElementNS(XHTML_NS, "label") as HTMLLabelElement;
    wrap.className = "zai-model-field";
    wrap.append(doc.createTextNode(label));
    const input = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
    input.type = "number";
    input.className = "zai-model-number";
    input.value = value === undefined ? "" : String(value);
    input.min = "0";
    input.step = "1024";
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      const next: ModelEntry = {
        ...model,
        [key]: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      };
      upsertModel(currentProfileId(), next);
      refreshModelTable();
    });
    wrap.appendChild(input);
    return wrap;
  }
}

/**
 * Read the current model id from the field.
 *
 * The combobox displays a readable name but stores the id in a data
 * attribute, so read that rather than the visible text.
 */
function currentModelId(): string {
  const wrap = doc.getElementById(`${ID_PREFIX}model`);
  if (!wrap) return "";
  const input = wrap.querySelector<HTMLInputElement>(".zai-model-id");
  if (!input) return "";
  return (input.dataset.modelId || input.value || "").trim();
}
/**
 * Replace the free-text model field with a searchable combobox.
 *
 * A free-text box lets the user type a name the provider does not accept, which
 * surfaces later as a confusing HTTP 400. Picking from the list is safer.
 */
function refreshModelField(profileId: string) {
  // The field starts as an <input> but becomes a .zai-combobox wrapper after
  // the first render, so locate it by id and unwrap when needed.
  const existing = doc.getElementById(`${ID_PREFIX}model`);
  if (!existing) return;

  // Only the models the user actually added are offered here. Listing every
  // fetched candidate would bury the three or four they care about.
  const models = loadModels(profileId);
  const active = findProfile(profileId)?.defaultModel || "";

  const options = new Map<string, string>();
  for (const model of models) options.set(model.id, prettyName(model.id, model.name));
  // Keep the active value selectable even if it is not in the registry.
  if (active && !options.has(active)) options.set(active, prettyName(active, ""));

  const wrap = buildModelCombobox(
    { id: active, name: options.get(active) || prettyName(active, "") },
    [...options.entries()].map(([id, name]) => ({ id, name })),
    (nextId: string) => {
      const profile = findProfile(profileId);
      if (!profile) return;
      upsertProfile({ ...profile, defaultModel: nextId });
      setActiveProfileId(profileId);
      refreshModelTable();
      refreshModelField(profileId);
    },
  );
  wrap.id = `${ID_PREFIX}model`;
  existing.replaceWith(wrap);
}
/**
 * Populate the shared candidate datalist used by every row's ID field.
 * Filled from the last successful fetch.
 */
function refreshCandidateList() {
  let list = doc.getElementById("zai-model-candidates");
  if (!list) {
    list = doc.createElementNS(XHTML_NS, "datalist");
    list.id = "zai-model-candidates";
    (doc.body || doc.documentElement)!.appendChild(list);
  }
  const candidates = loadCandidates();
  list.replaceChildren(
    ...candidates.map((model) => option(doc, model.id, model.name || model.id)),
  );
}

function refreshModelTable() {
  modelInputRef = byId<HTMLInputElement>(doc, "model");
  const container = byId<HTMLDivElement>(doc, "models-table");
  const profileId = currentProfileId();
  const models = loadModels(profileId);
  const activeId = findProfile(profileId)?.defaultModel || "";

  refreshModelField(profileId);

  if (!container) return;
  container.replaceChildren();

  if (!models.length) {
    const empty = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
    empty.className = "zai-pref-hint";
    empty.textContent = getString("pref-models-empty");
    container.appendChild(empty);
    return;
  }

  // The active model floats to the top so it is easy to spot.
  const sorted = [...models].sort((a, b) =>
    a.id === activeId ? -1 : b.id === activeId ? 1 : 0,
  );
  for (const model of sorted) {
    container.appendChild(
      renderModelRow(model, activeId, () => {
        // Keep the profile selector and the model field in sync with the row.
        const select = byId<HTMLSelectElement>(doc, "profile");
        if (select) select.value = profileId;
        refreshModelField(profileId);
      }),
    );
  }
}

function currentProfileId(): string {
  return byId<HTMLElement>(doc, "profile-hint")!.dataset.profileId || "openai";
}

function rebuildProfileSelect(select: HTMLSelectElement, activeId: string) {
  select.replaceChildren();
  const profiles = listProfiles();
  for (const profile of profiles) {
    select.appendChild(
      option(
        doc,
        profile.id,
        profile.builtin ? profile.name : `${profile.name}（自定义）`,
      ),
    );
  }
  select.value = profiles.some((profile) => profile.id === activeId)
    ? activeId
    : profiles[0]?.id || "";
}

/** Persist whatever is currently in the form, under the current profile id. */
function saveCurrentForm(): Profile {
  const id = currentProfileId();
  const existing = findProfile(id) || blankProfile();
  const updated: Profile = {
    ...existing,
    id,
    name: byId<HTMLInputElement>(doc, "name")!.value.trim() || existing.name,
    style: byId<HTMLSelectElement>(doc, "style")!.value as Profile["style"],
    baseURL: byId<HTMLInputElement>(doc, "baseurl")!.value.trim(),
    apiKey: byId<HTMLInputElement>(doc, "apikey")!.value.trim(),
    defaultModel: currentModelId(),
    builtin: existing.builtin,
  };
  upsertProfile(updated);
  setActiveProfileId(id);
  return updated;
}

function selectProfile(id: string) {
  setActiveProfileId(id);
  populateForm(findProfile(id) || blankProfile());
}

function populateForm(profile: Profile) {
  byId<HTMLInputElement>(doc, "name")!.value = profile.name;
  byId<HTMLSelectElement>(doc, "style")!.value = profile.style;
  byId<HTMLInputElement>(doc, "apikey")!.value = profile.apiKey;
  byId<HTMLInputElement>(doc, "baseurl")!.value = profile.baseURL;
  refreshModelField(profile.id);

  byId<HTMLInputElement>(doc, "apikey")!.placeholder = profile.apiKeyOptional
    ? getString("pref-apikey-optional")
    : getString("pref-apikey-placeholder");


  byId<HTMLInputElement>(doc, "baseurl")!.placeholder =
    profile.baseURL || "https://example.com/v1";

  const hint = byId<HTMLElement>(doc, "profile-hint");
  if (hint) {
    hint.textContent = profile.hint || "";
    hint.dataset.profileId = profile.id;
  }

  // Built-in presets are not removable, and their fields stay editable so a
  // user can point a preset at a proxy.
  byId<HTMLButtonElement>(doc, "profile-delete")!.disabled = Boolean(
    profile.builtin,
  );
}

export function registerPrefsScripts(win: Window): void {
  doc = win.document;
  injectStyle(doc);

  const profileSelect = byId<HTMLSelectElement>(doc, "profile");
  const nameInput = byId<HTMLInputElement>(doc, "name");
  const styleSelect = byId<HTMLSelectElement>(doc, "style");
  const apiKeyInput = byId<HTMLInputElement>(doc, "apikey");
  const apiKeyToggle = byId<HTMLInputElement>(doc, "apikey-toggle");
  const baseURLInput = byId<HTMLInputElement>(doc, "baseurl");
  const baseURLReset = byId<HTMLButtonElement>(doc, "baseurl-reset");
  const modelInput = byId<HTMLInputElement>(doc, "model");
  const modelSet = byId<HTMLButtonElement>(doc, "model-set");
  const modelsFetch = byId<HTMLButtonElement>(doc, "models-fetch");
  const modelsAdd = byId<HTMLButtonElement>(doc, "models-add");
  const modelsClear = byId<HTMLButtonElement>(doc, "models-clear");
  const modelsTest = byId<HTMLButtonElement>(doc, "models-test");
  const profileDelete = byId<HTMLButtonElement>(doc, "profile-delete");
  const profileDuplicate = byId<HTMLButtonElement>(doc, "profile-duplicate");
  const profileAdd = byId<HTMLButtonElement>(doc, "profile-add");
  const testButton = byId<HTMLButtonElement>(doc, "test");
  const testResult = byId<HTMLElement>(doc, "test-result");
  const summaryAction = byId<HTMLSelectElement>(doc, "summary-action");
  const summaryLanguage = byId<HTMLSelectElement>(doc, "summary-language");
  const summaryLength = byId<HTMLSelectElement>(doc, "summary-length");
  const translateTarget = byId<HTMLSelectElement>(doc, "translate-target");
  const translateExtra = byId<HTMLInputElement>(doc, "translate-extra");
  const maxPdfChars = byId<HTMLInputElement>(doc, "maxpdfchars");
  const contextChars = byId<HTMLInputElement>(doc, "contextchars");
  const enableCheckbox = byId<HTMLInputElement>(doc, "enable");
  const temperatureInput = byId<HTMLInputElement>(doc, "temperature");
  const maxTokensInput = byId<HTMLInputElement>(doc, "maxtokens");

  if (!profileSelect) {
    ztoolkit.log("AI preferences pane: required elements not found");
    return;
  }

  const activeId = getActiveProfileId();
  rebuildProfileSelect(profileSelect, activeId);
  populateForm(findProfile(activeId) || listProfiles()[0] || blankProfile());
  refreshCandidateList();
  refreshModelTable();

  // ---- profile selection -----------------------------------------------
  profileSelect.addEventListener("change", () => {
    selectProfile(profileSelect.value);
    refreshModelTable();
  });

  profileAdd?.addEventListener("click", () => {
    const profile = blankProfile();
    profile.id = newProfileId(profile.name);
    upsertProfile(profile);
    rebuildProfileSelect(profileSelect, profile.id);
    populateForm(profile);
    refreshModelTable();
    nameInput?.focus();
    nameInput?.select();
  });

  profileDuplicate?.addEventListener("click", () => {
    const source = findProfile(currentProfileId());
    if (!source) return;
    const copy: Profile = {
      ...source,
      id: newProfileId(`${source.name} copy`),
      name: `${source.name}（副本）`,
      builtin: false,
    };
    upsertProfile(copy);
    rebuildProfileSelect(profileSelect, copy.id);
    populateForm(copy);
    refreshModelTable();
  });

  profileDelete?.addEventListener("click", () => {
    const id = currentProfileId();
    const profile = findProfile(id);
    if (!profile || profile.builtin) return;
    const win2 = Zotero.getMainWindow();
    if (!win2?.confirm?.(`确定删除配置「${profile.name}」吗？`)) return;
    removeProfile(id);
    const next = getActiveProfileId();
    rebuildProfileSelect(profileSelect, next);
    populateForm(findProfile(next) || listProfiles()[0]);
    refreshModelTable();
  });

  // ---- profile fields (saved on change) --------------------------------
  nameInput?.addEventListener("change", () => {
    const saved = saveCurrentForm();
    rebuildProfileSelect(profileSelect, saved.id);
  });
  styleSelect?.addEventListener("change", () => saveCurrentForm());

  // Save the key as the user types, not only on blur. The old change-only
  // handler lost the key when the user clicked another button without tabbing.
  apiKeyInput?.addEventListener("change", () => saveCurrentForm());
  let keyTimer: ReturnType<typeof setTimeout> | undefined;
  apiKeyInput?.addEventListener("input", () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => saveCurrentForm(), 400);
  });
  apiKeyInput?.addEventListener("blur", () => {
    clearTimeout(keyTimer);
    saveCurrentForm();
  });

  baseURLInput?.addEventListener("change", () => saveCurrentForm());
  // Keep the model field in sync: persist on change and refresh its
  // datalist so the picker reflects the current value.
  let modelTimer: ReturnType<typeof setTimeout> | undefined;
  const syncModelField = () => {
    saveCurrentForm();
    refreshModelField(currentProfileId());
  };
  modelInput?.addEventListener("change", syncModelField);
  modelInput?.addEventListener("input", () => {
    clearTimeout(modelTimer);
    modelTimer = setTimeout(syncModelField, 500);
  });

  apiKeyToggle?.addEventListener("change", () => {
    if (apiKeyInput) {
      apiKeyInput.type = apiKeyToggle.checked ? "text" : "password";
    }
  });

  // Remind about Coding Plan's dedicated endpoint when it is selected.
  const baseURLHint = byId<HTMLElement>(doc, "baseurl-hint");
  const showBaseURLHint = () => {
    if (!baseURLHint) return;
    const profile = findProfile(currentProfileId());
    baseURLHint.textContent =
      profile?.id === "volcengine" ? getString("pref-volcengine-hint") : "";
  };
  showBaseURLHint();

  baseURLReset?.addEventListener("click", () => {
    const profile = findProfile(currentProfileId());
    if (!profile) return;
    const preset = listProfiles().find((p) => p.id === profile.id);
    baseURLInput!.value = preset?.baseURL || "";
    saveCurrentForm();
  });

  modelSet?.addEventListener("click", () => {
    const id = modelInput!.value.trim();
    if (!id) {
      win.alert("请先填写模型 ID。");
      return;
    }
    upsertModel(currentProfileId(), { id, name: id });
    saveCurrentForm();
    refreshCandidateList();
    refreshModelTable();
    modelInput!.focus();
    win.alert(`已设为当前模型：${id}`);
  });

  // Fetching stores every candidate; the table's dropdowns are the picker.
  modelsFetch?.addEventListener("click", async () => {
    saveCurrentForm();
    modelsFetch.disabled = true;
    modelsFetch.textContent = "获取中…";
    try {
      const result = await fetchModelList();
      // Candidates first: the table's comboboxes are built from that list.
      refreshCandidateList();
      refreshModelTable();
      modelsFetch.textContent = `已获取 ${result.models.length} 个模型`;
      win.setTimeout(() => {
        modelsFetch.textContent = getString("pref-models-fetch");
        modelsFetch.disabled = false;
      }, 2000);
    } catch (error: any) {
      modelsFetch.textContent = getString("pref-models-fetch");
      modelsFetch.disabled = false;
      win.alert(error?.message || String(error));
    }
  });
  modelsAdd?.addEventListener("click", () => {
    saveCurrentForm();
    const profileId = currentProfileId();
    const models = loadModels(profileId);

    // The first candidate not already registered becomes the new row, so the
    // user never has to type an id. Falls back to a blank placeholder when no
    // candidates have been fetched yet.
    const registered = new Set(models.map((m) => m.id));
    const next = loadCandidates().find((c) => !registered.has(c.id));

    if (next) {
      upsertModel(profileId, {
        id: next.id,
        name: prettyName(next.id, next.name),
        contextWindow: next.contextWindow,
      });
    } else {
      const base = "new-model";
      let id = base;
      let n = 2;
      while (registered.has(id)) {
        id = `${base}-${n}`;
        n++;
      }
      upsertModel(profileId, { id, name: prettyName(id, "") });
    }

    refreshCandidateList();
    refreshModelTable();

    const row = doc.querySelector(
      `#zai-models-table [data-model-id="${CSS.escape(next?.id || "")}"] .zai-model-id`,
    ) as HTMLInputElement | null;
    row?.focus();
    row?.select();
  });
  modelsClear?.addEventListener("click", () => {
    const models = loadModels(currentProfileId());
    if (!models.length) return;
    if (!win.confirm(`确定清空该配置下的 ${models.length} 个模型吗？`)) return;
    saveModels(currentProfileId(), []);
    refreshCandidateList();
    refreshModelTable();
  });

  modelsTest?.addEventListener("click", async () => {
    const models = loadModels(currentProfileId());
    if (!models.length) {
      win.alert("请先添加模型。");
      return;
    }

    modelsTest.disabled = true;
    modelsTest.textContent = getString("pref-models-testing");

    const marks = new Map<string, HTMLElement>();
    for (const model of models) {
      const row = doc.querySelector(
        `#zai-models-table [data-model-id="${CSS.escape(model.id)}"]`,
      );
      const mark = doc.createElementNS(XHTML_NS, "span") as HTMLSpanElement;
      mark.className = "zai-model-status";
      mark.textContent = "…";
      row?.querySelector(".zai-model-head")?.appendChild(mark);
      marks.set(model.id, mark);
    }

    let ok = 0;
    let fail = 0;
    await testAllModels((_done, _total, result) => {
      const mark = marks.get(result.id);
      if (mark) {
        mark.className = `zai-model-status ${result.ok ? "ok" : "fail"}`;
        mark.textContent = result.ok ? "✓" : "✗";
        mark.title = result.message;
      }
      if (result.ok) ok++;
      else fail++;
    });

    modelsTest.disabled = false;
    modelsTest.textContent = getString("pref-models-test");
    win.alert(
      getString("pref-models-test-done")
        .replace("{ok}", String(ok))
        .replace("{fail}", String(fail)),
    );
  });

  // ---- global generation settings --------------------------------------
  if (temperatureInput) {
    temperatureInput.value = String(
      getPref<number>("temperature", DEFAULT_TEMPERATURE),
    );
  }
  if (maxTokensInput) {
    maxTokensInput.value = String(
      getPref<number>("maxTokens", DEFAULT_MAX_TOKENS),
    );
  }
  if (summaryAction) summaryAction.value = getPref<string>("summaryAction", "note");
  if (summaryLanguage) {
    summaryLanguage.value = getPref<string>("summaryLanguage", "zh");
  }
  if (summaryLength) {
    summaryLength.value = getPref<string>("summaryLength", "standard");
  }
  if (translateTarget) {
    translateTarget.value = getPref<string>("translateTarget", "auto");
  }
  if (translateExtra) {
    translateExtra.checked = getPref<boolean>("translateToExtra", true);
  }
  if (maxPdfChars) {
    maxPdfChars.value = String(
      getPref<number>("maxPdfChars", DEFAULT_MAX_PDF_CHARS),
    );
  }
  if (contextChars) {
    contextChars.value = String(
      getPref<number>("contextChars", DEFAULT_CONTEXT_CHARS),
    );
  }
  if (enableCheckbox) {
    enableCheckbox.checked = getPref<boolean>("enable", true) !== false;
  }

  const clampNumber = (
    input: HTMLInputElement,
    min: number,
    max: number,
    fallback: number,
    key: string,
  ) => {
    let value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0) value = fallback;
    value = Math.min(max, Math.max(min, Math.floor(value)));
    input.value = String(value);
    setPref(key, value);
  };

  temperatureInput?.addEventListener("change", () => {
    let value = Number(temperatureInput.value);
    if (!Number.isFinite(value)) value = DEFAULT_TEMPERATURE;
    value = Math.min(2, Math.max(0, value));
    temperatureInput.value = String(value);
    setPref("temperature", value);
  });
  maxTokensInput?.addEventListener("change", () =>
    clampNumber(maxTokensInput, 256, 64000, DEFAULT_MAX_TOKENS, "maxTokens"),
  );
  maxPdfChars?.addEventListener("change", () =>
    clampNumber(maxPdfChars, 5000, 400000, DEFAULT_MAX_PDF_CHARS, "maxPdfChars"),
  );
  contextChars?.addEventListener("change", () =>
    clampNumber(contextChars, 2000, 60000, DEFAULT_CONTEXT_CHARS, "contextChars"),
  );

  summaryAction?.addEventListener("change", () =>
    setPref("summaryAction", summaryAction.value),
  );
  summaryLanguage?.addEventListener("change", () =>
    setPref("summaryLanguage", summaryLanguage.value),
  );
  summaryLength?.addEventListener("change", () =>
    setPref("summaryLength", summaryLength.value),
  );
  translateTarget?.addEventListener("change", () =>
    setPref("translateTarget", translateTarget.value),
  );
  translateExtra?.addEventListener("change", () =>
    setPref("translateToExtra", translateExtra.checked),
  );
  enableCheckbox?.addEventListener("change", () =>
    setPref("enable", enableCheckbox.checked),
  );

  testButton?.addEventListener("click", async () => {
    if (!testResult) return;
    testButton.disabled = true;
    testResult.className = "zai-pref-hint";
    testResult.textContent = getString("pref-testing");
    try {
      const reply = await testConnection();
      testResult.className = "zai-pref-hint ok";
      testResult.textContent = `${getString("pref-test-ok")} ${reply.replace(/\n/g, " ")}`;
    } catch (error: any) {
      testResult.className = "zai-pref-hint fail";
      testResult.textContent = `${getString("pref-test-fail")} ${error?.message || error}`;
    } finally {
      testButton.disabled = false;
    }
  });

  void getPrefsPrefix();
}
