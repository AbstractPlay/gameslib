import { customAlphabet } from 'https://cdn.jsdelivr.net/npm/nanoid/+esm';
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 5);

function boardClick(row, col, piece) {
    console.log("Row: " + row + ", Col: " + col + ", Piece: " + piece);
    var state = window.sessionStorage.getItem("state");
    var gamename = window.sessionStorage.getItem("gamename");
    var game = APGames.GameFactory(gamename, state);
    if (game.gameover) {
        return;
    }
    var movebox = document.getElementById("moveEntry");
    var result = game.handleClick(movebox.value, row, col, piece);
    movebox.value = result.move;
    var colour = "#f00";
    if (result.valid) {
        if (result.complete === -1) {
            colour = "#ff9900";  // Orange for incomplete
        } else if (result.complete === 0) {
            colour = "#4caf50";  // Softer green for ready
        } else {
            colour = "#2196f3"; // Soft blue for auto-submit
        }
    }
    var resultStr = '<p style="color: '+ colour +'">' + result.message + '</p>';
    var statusbox = document.getElementById("clickstatus");
    statusbox.innerHTML = resultStr;
    movebox.classList.remove("move-incomplete", "move-ready");
    if (result.complete === -1) {
        movebox.classList.add("move-incomplete");
    } else if (result.complete === 0) {
        movebox.classList.add("move-ready");
    }
    if ( ( (result.hasOwnProperty("canrender")) && (result.canrender === true) ) || (result.complete >= 0) ) {
        let renderOpts = getRenderOptions({ perspective: game.currplayer });
        let selectedDisplay = window.localStorage.getItem("selectedDisplay") || "default";
        const checkedDisplayRadio = document.querySelector('input[name="displayOption"]:checked');
        if (checkedDisplayRadio) {
            selectedDisplay = checkedDisplayRadio.value;
        }
        if (selectedDisplay !== "default") {
            renderOpts.altDisplay = selectedDisplay;
        }
        game.move(result.move, {partial: true});
        let render = game.render(renderOpts);
        if (Array.isArray(render)) {
            render = render[render.length - 1];
        }
        var interim = JSON.stringify(render);
        window.localStorage.setItem("interim", interim);
    }
    renderGame();
    updateGameStatusPanel(game, gamename);
    if (result.complete === 1 && document.getElementById("autoSubmit").checked) {
        document.getElementById("moveBtn").click();
    }
}

function boardClickSimultaneous(row, col, piece) {
    console.log("Row: " + row + ", Col: " + col + ", Piece: " + piece);
    var state = window.localStorage.getItem("state");
    var gamename = window.localStorage.getItem("gamename");
    var game = APGames.GameFactory(gamename, state);
    var movebox = document.getElementById("moveEntry");
    var result = game.handleClickSimultaneous(movebox.value, row, col, 1, piece);
    movebox.value = result.move;
    var colour = "#f00";
    if (result.valid) {
        if (result.complete === -1) {
            colour = "#ff9900";  // Orange for incomplete
        } else if (result.complete === 0) {
            colour = "#4caf50";  // Softer green for ready
        } else {
            colour = "#2196f3"; // Soft blue for auto-submit
        }
    }
    var resultStr = '<p style="color: '+ colour +'">' + result.message + '</p>';
    var statusbox = document.getElementById("clickstatus");
    statusbox.innerHTML = resultStr;
    movebox.classList.remove("move-incomplete", "move-ready");
    if (result.complete === -1) {
        movebox.classList.add("move-incomplete");
    } else if (result.complete === 0) {
        movebox.classList.add("move-ready");
    }
    if ( ( (result.hasOwnProperty("canrender")) && (result.canrender === true) ) || (result.complete >= 0) ) {
        let renderOpts = getRenderOptions({ perspective: 1 });
        let selectedDisplay = window.localStorage.getItem("selectedDisplay") || "default";
        const checkedDisplayRadio = document.querySelector('input[name="displayOption"]:checked');
        if (checkedDisplayRadio) {
            selectedDisplay = checkedDisplayRadio.value;
        }
        if (selectedDisplay !== "default") {
            renderOpts.altDisplay = selectedDisplay;
        }
        game.move(result.move + ",", {partial: true});
        let render = game.render(renderOpts);
        if (Array.isArray(render)) {
            render = render[render.length - 1];
        }
        var interim = JSON.stringify(render);
        window.localStorage.setItem("interim", interim);
    } else {
        window.localStorage.removeItem("interim");
    }
    renderGame();
    updateGameStatusPanel(game, gamename);
    if (result.complete === 1 && document.getElementById("autoSubmit").checked) {
        document.getElementById("moveBtn").click();
    }
}

function boardClickVolcano(row, col, piece) {
    renderGame(col, row);
}

// --- Customization Management ---
const defaultCustomizationsLight = {
    colourContext: { background: "#fff", board: "#fff", strokes: "#000", borders: "#000", labels: "#000", annotations: "#000", fill: "#000" },
    palette: [],
    glyphmap: [],
};
const defaultCustomizationsDark = {
    colourContext: { background: "#222", board: "#222", strokes: "#6d6d6d", borders: "#000", labels: "#009fbf", annotations: "#99cccc", fill: "#e6f2f2" },
    palette: [],
    glyphmap: [],
};
let customizations = JSON.parse(JSON.stringify(defaultCustomizationsLight));
let draggedColor = null;
let settingsDirty = false;

function getRenderOptions(baseOpts = {}) {
    const opts = { ...baseOpts };
    opts.contextGlobal = false;
    opts.coloursGlobal = false;
    if (!opts.hasOwnProperty("colourContext")) {
        opts.colourContext = { ...customizations.colourContext };
    }
    if (customizations.palette && customizations.palette.length > 0) {
        if (!opts.hasOwnProperty("colours")) {
            opts.colours = [...customizations.palette];
        }
    }
    if (customizations.glyphmap && customizations.glyphmap.length > 0) {
        if (!opts.hasOwnProperty("glyphmap")) {
            opts.glyphmap = customizations.glyphmap;
        }
    }
    return opts;
}

function loadCustomizations() {
    const stored = window.localStorage.getItem("customizations");
    if (stored) {
        try {
            customizations = JSON.parse(stored);
        } catch (e) {
            console.error("Error loading customizations:", e);
            const isDark = window.localStorage.getItem("darkMode") === "true";
            customizations = JSON.parse(JSON.stringify(isDark ? defaultCustomizationsDark : defaultCustomizationsLight));
        }
    } else {
        const isDark = window.localStorage.getItem("darkMode") === "true";
        customizations = JSON.parse(JSON.stringify(isDark ? defaultCustomizationsDark : defaultCustomizationsLight));
    }
}

function saveCustomizations() {
    window.localStorage.setItem("customizations", JSON.stringify(customizations));
    settingsDirty = false;
}

function showCustomizeModal() {
    const modal = document.getElementById("customizeModal");
    if (modal) {
        updateCustomizeModalContents();
        modal.style.display = "block";
        document.body.style.overflow = 'hidden';
        renderCustomizePreview();
    }
}

function hideCustomizeModal() {
    const modal = document.getElementById("customizeModal");
    if (modal) {
        modal.style.display = "none";
        document.body.style.overflow = '';
    }
}

function updateCustomizeModalContents() {
    // This function would populate all the inputs in the modal
    // with current values from the `customizations` object by calling the sync function.
    syncCustomizeUI();
}

function syncCustomizeUI() {
    // Render the preview first, in case other updates are slow.
    renderCustomizePreview();
    // Then update all the individual UI controls.
    updatePaletteDisplay();
    updateContextDisplay();
    updateGlyphMapDisplay();
    updateSettingsJSON();
}

function renderCustomizePreview() {
    const previewDiv = document.getElementById("customizePreview");
    if (!previewDiv) return;
    previewDiv.innerHTML = "";

    var state = window.localStorage.getItem("state");
    if (!state) {
        previewDiv.innerHTML = "<p>No game loaded to preview.</p>";
        return;
    }
    var gamename = window.localStorage.getItem("gamename");
    var game = APGames.GameFactory(gamename, state);

    const renderOpts = getRenderOptions({ perspective: game.currplayer });
    const uniqueid = "customizePreviewSvg_" + Date.now();
    const options = { ...renderOpts,
        svgid: uniqueid,
        prefix: uniqueid, // Ensure internal IDs are unique to avoid conflicts with the main board
    };
    previewDiv.style.backgroundColor = options.colourContext.background;

    try {
        // Always re-render for the preview to ensure all options (including glyphmap) are applied
        let data = game.render(renderOpts);
        if (Array.isArray(data)) {
            data = data[data.length - 1];
        }
        const svgString = APRender.renderStatic(data, options);
        previewDiv.innerHTML = svgString;
    } catch (e) {
        previewDiv.innerHTML = `<div style="color: red; padding: 1em;">${e.message}</div>`;
    }
}

function updatePaletteDisplay() {
    const container = document.getElementById("customizePaletteColors");
    if (!container) return;
    container.innerHTML = "";
    customizations.palette.forEach((color, index) => {
        const swatch = document.createElement('span');
        swatch.className = 'color-swatch';
        swatch.draggable = true;
        swatch.style.cursor = "move";
        if (color === null) {
            swatch.style.background = "linear-gradient(to top right, transparent calc(50% - 1px), red, transparent calc(50% + 1px))";
            swatch.style.backgroundColor = "white";
            swatch.title = "Default (will use the renderer's default for this player number)";
        } else {
            swatch.style.backgroundColor = color;
            swatch.title = color;
        }

        swatch.addEventListener('click', (e) => { if (e.target.className === "remove-tag") return; const picker = document.getElementById("customizePaletteColor"); if (picker) { picker.color = color || "#ffffff"; } document.getElementById("customizePaletteHex").value = color || "#ffffff"; });
        swatch.addEventListener('dragstart', (e) => handleDragStart(e, index));
        swatch.addEventListener('dragover', handleDragOver);
        swatch.addEventListener('drop', (e) => handleDrop(e, index));

        const del = document.createElement("span");
        del.className = "remove-tag";
        del.innerHTML = "&times;";
        del.title = "Remove color";
        del.onclick = () => {
            customizations.palette.splice(index, 1);
            settingsDirty = true;
            syncCustomizeUI();
        };
        swatch.appendChild(del);
        container.appendChild(swatch);
    });
}

function handleDragStart(e, index) {
    e.dataTransfer.setData("text/plain", index);
    e.dataTransfer.effectAllowed = "move";
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e, index) {
    e.preventDefault();
    const draggedIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (draggedIndex !== index && !isNaN(draggedIndex)) {
        const [draggedItem] = customizations.palette.splice(draggedIndex, 1);
        customizations.palette.splice(index, 0, draggedItem);
        settingsDirty = true;
        syncCustomizeUI();
    }
}

function updateContextDisplay() {
    const prop = document.getElementById("customizeContextProp").value;
    const colorPicker = document.getElementById("customizeContextColor");
    const hexInput = document.getElementById("customizeContextHex");
    if (colorPicker && hexInput) {
        const val = customizations.colourContext[prop] || "#000000";
        colorPicker.color = val;
        hexInput.value = val;
    }
}

function updateGlyphMapDisplay() {
    const container = document.getElementById("customizeGlyphMapTags");
    if (!container) return;
    container.innerHTML = "";
    customizations.glyphmap.forEach((p, i) => {
        const tag = document.createElement('span');
        tag.className = "glyph-tag";
        let scaleTxt = "";
        if (p[2] !== undefined && p[2] !== 1) {
            scaleTxt = ` (@ ${p[2]}x)`;
        }
        tag.innerHTML = `${p[0]} &rarr; ${p[1]}${scaleTxt}`;
        const del = document.createElement("span");
        del.className = "remove-tag";
        del.innerHTML = "&times;";
        del.title = "Remove mapping";
        del.onclick = () => {
            customizations.glyphmap.splice(i, 1);
            settingsDirty = true;
            syncCustomizeUI();
        };
        tag.appendChild(del);
        container.appendChild(tag);
    });

    const glyphSelect = document.getElementById("customizeOriginalGlyph");
    if (glyphSelect) {
        const currentVal = glyphSelect.value;
        glyphSelect.innerHTML = `<option value="">-- Select Original --</option>`;
        const game = APGames.GameFactory(window.localStorage.getItem("gamename"), window.localStorage.getItem("state"));
        if (game) {
            const data = game.render();
            const names = new Set();
            const processGlyph = (g) => {
                if (typeof g === "string") {
                    names.add(g);
                } else if (typeof g === "object" && g !== null) {
                    if (g.name) names.add(g.name);
                }
            };
            Object.values(data.legend).forEach((val) => {
                if (Array.isArray(val)) {
                    val.forEach((v) => processGlyph(v));
                } else {
                    processGlyph(val);
                }
            });
            [...names].sort().forEach(g => {
                const opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                glyphSelect.appendChild(opt);
            });
            glyphSelect.value = currentVal;
        }
    }
}

function updateSettingsJSON() {
    const textarea = document.getElementById("customizeSettingsJson");
    if (textarea && document.activeElement !== textarea) {
        textarea.value = JSON.stringify(customizations, null, 2);
    }
}

function addCustomizeStyles() {
    if (document.getElementById("customize-styles")) return;
    const style = document.createElement('style');
    style.id = 'customize-styles';
    style.innerHTML = `
        .color-swatch .remove-tag, .glyph-tag .remove-tag {
            display: none;
            position: absolute;
            top: -7px;
            right: -7px;
            background: #c00;
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            line-height: 16px;
            text-align: center;
            font-size: 16px;
            cursor: pointer;
            font-weight: bold;
            border: 1px solid white;
        }
        .color-swatch:hover .remove-tag, .glyph-tag:hover .remove-tag {
            display: block;
        }
        .glyph-tag {
            position: relative;
            display: inline-block;
            background-color: #f5f5f5;
            padding: .35em .65em;
            font-size: .9em;
            font-weight: 700;
            line-height: 1;
            color: #4a4a4a;
            text-align: center;
            white-space: nowrap;
            vertical-align: baseline;
            border-radius: 4px;
            margin: 0.25rem;
        }
        .preset-swatch-container {
            display: flex; flex-wrap: wrap; gap: 5px; margin: 0.5em 0;
        }
        .preset-swatch {
            width: 22px; height: 22px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; padding: 0;
        }
        .preset-swatch:hover { border-color: #333; transform: scale(1.1); }
        .customize-button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5em;
            margin-top: 0.5em;
        }
        .customize-button-group button {
            flex-grow: 0;
        }
    `;
    document.head.appendChild(style);
}

function createCustomizeModal() {
    if (document.getElementById("customizeModal")) return;

    const modal = document.createElement("div");
    modal.id = "customizeModal";
    modal.className = "modal";
    modal.innerHTML = `
        <div class="modal-content" style="width: 90%; max-width: 1200px;">
            <div class="modal-header">
                <h2>Customize Renderer</h2>
                <span class="modal-close" id="customizeModalCloseBtn">&times;</span>
            </div>
            <div class="modal-body">
                <div class="palette-modal-layout">
                    <div class="palette-edit-section">
                        <h3>Player Colours</h3>
                        <div class="field">
                            <label for="customizePaletteColor">Add Colour</label>
                            <div class="control color-add-group">
                                <hex-color-picker id="customizePaletteColor"></hex-color-picker>
                                <input id="customizePaletteHex" type="text" style="margin: 0.5em 0;" placeholder="#RRGGBB">
                                <div class="preset-swatch-container" id="customizePresetSwatches"></div>
                                <div class="customize-button-group">
                                    <button id="customizeAddColor">Add Selected Colour</button>
                                    <button id="customizeDefaultPalette">Load Default Palette</button>
                                    <button id="customizeColorblindPalette">Load Colourblind Palette</button>
                                    <button id="customizeClearPalette" class="secondary">Clear Palette</button>
                                </div>
                        </div>
                        <div class="tags" id="customizePaletteColors" style="margin-top: 1em;"></div>
                        <hr>
                        <h3>Board Colours</h3>
                        <div class="field">
                            <label for="customizeContextProp">Select Property</label>
                            <div class="control">
                                <select id="customizeContextProp">
                                    <option value="background">Background</option>
                                    <option value="board">Board</option>
                                    <option value="strokes">Strokes</option>
                                    <option value="borders">Borders</option>
                                    <option value="labels">Labels</option>
                                    <option value="annotations">Annotations</option>
                                    <option value="fill">Fill</option>
                                </select>
                            </div>
                        </div>
                        <div class="field">
                            <div class="control color-add-group">
                                <hex-color-picker id="customizeContextColor"></hex-color-picker>
                                <input id="customizeContextHex" type="text" style="margin-top: 0.5em; margin-bottom: 0.5em;" placeholder="#RRGGBB">
                            </div>
                        </div>
                        <hr>
                        <h3>Glyph Replacements</h3>
                        <div class="field">
                            <label for="customizeOriginalGlyph">Add Replacement</label>
                            <div class="control" style="display: flex; flex-wrap: wrap; gap: 0.5em; align-items: center;">
                                <select id="customizeOriginalGlyph"><option value="">-- Select Original --</option></select>
                                <span>with</span>
                                <select id="customizeSheet"></select>
                                <select id="customizeReplacementGlyph"><option value="">-- Select Replacement --</option></select>
                                <span>at scale</span>
                                <input type="number" step="0.1" value="1" id="customizeScale" style="width: 5em;">
                                <button id="customizeAddGlyphMap">Add</button>
                            </div>
                        </div>
                        <div class="tags" id="customizeGlyphMapTags" style="margin-top: 1em;"></div>
                    </div>
                    <div class="palette-list-section">
                        <h3>Preview</h3>
                        <div id="customizePreview" style="border: 1px solid #ccc; min-height: 200px; padding: 10px;"></div>
                    </div>
                </div>
                <div style="margin-top: 1.5em;">
                    <h3>Settings JSON</h3>
                    <div class="field">
                        <div class="control">
                            <textarea rows="8" id="customizeSettingsJson" style="width: 100%;"></textarea>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="customizeReset" class="secondary">Reset to Defaults</button>
                <button id="customizeSave" class="primary">Save and Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    addCustomizeStyles();

    // Add event listeners
    document.getElementById("customizeModalCloseBtn").addEventListener("click", hideCustomizeModal);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            hideCustomizeModal();
        }
    });

    // Palette
    const paletteColorPicker = document.getElementById("customizePaletteColor");
    const paletteHexInput = document.getElementById("customizePaletteHex");
    paletteColorPicker.addEventListener('color-changed', e => {
        paletteHexInput.value = e.detail.value;
    });
    paletteHexInput.addEventListener('input', () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(paletteHexInput.value)) {
            paletteColorPicker.color = paletteHexInput.value;
        }
    });
    document.getElementById("customizeAddColor").addEventListener("click", (e) => { e.preventDefault();
        customizations.palette.push(paletteColorPicker.color);
        settingsDirty = true;
        syncCustomizeUI();
    });
    document.getElementById("customizeDefaultPalette").addEventListener("click", (e) => {
        e.preventDefault();
        customizations.palette = ["#e31a1c","#1f78b4","#33a02c","#ff7f00","#6a3d9a","#b15928","#ffff99","#fb9a99","#a6cee3","#b2df8a","#fdbf6f","#cab2d6"];
        settingsDirty = true;
        syncCustomizeUI();
    });
    document.getElementById("customizeColorblindPalette").addEventListener("click", (e) => {
        e.preventDefault();
        customizations.palette = ["#9f0162", "#8400cd", "#a40122", "#009f81", "#008df9", "#e20134", "#ff5aaf", "#00c2f9", "#ff6e3a", "#00fccf", "#ffb2fd", "#ffc33b"];
        settingsDirty = true;
        syncCustomizeUI();
    });
    document.getElementById("customizeClearPalette").addEventListener("click", (e) => {
        e.preventDefault();
        if (confirm("Are you sure you want to clear the palette?")) {
            customizations.palette = [];
            settingsDirty = true;
            syncCustomizeUI();
        }
    });

    // Context
    const contextProp = document.getElementById("customizeContextProp");
    const contextColorPicker = document.getElementById("customizeContextColor");
    const contextHexInput = document.getElementById("customizeContextHex");
    contextProp.addEventListener("change", updateContextDisplay);
    const contextUpdate = (val) => {
        customizations.colourContext[contextProp.value] = val;
        settingsDirty = true;
        syncCustomizeUI();
    };
    contextColorPicker.addEventListener('color-changed', e => {
        contextHexInput.value = e.detail.value;
        contextUpdate(e.detail.value);
    });
    contextHexInput.addEventListener('input', () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(contextHexInput.value)) {
            contextColorPicker.color = contextHexInput.value;
        }
    });

    // Preset swatches
    const presetContainer = document.getElementById("customizePresetSwatches");
    const allPresets = [
        ...["#e31a1c","#1f78b4","#33a02c","#ff7f00","#6a3d9a","#b15928","#ffff99","#fb9a99","#a6cee3","#b2df8a","#fdbf6f","#cab2d6"],
        null, "#000000", "#ffffff", "#808080"
    ];
    allPresets.forEach(c => {
        const swatchBtn = document.createElement("button");
        swatchBtn.className = "preset-swatch";
        if (c === null) {
            swatchBtn.style.background = "linear-gradient(to top right, transparent calc(50% - 1px), red, transparent calc(50% + 1px))";
            swatchBtn.style.backgroundColor = "white";
            swatchBtn.title = "Add default placeholder";
        } else {
            swatchBtn.style.backgroundColor = c;
            swatchBtn.title = `Add ${c}`;
        }
        swatchBtn.onclick = (e) => {
            e.preventDefault();
            customizations.palette.push(c);
            settingsDirty = true;
            syncCustomizeUI();
        };
        presetContainer.appendChild(swatchBtn);
    });

    // Glyphs
    const sheetSelect = document.getElementById("customizeSheet");
    const replacementSelect = document.getElementById("customizeReplacementGlyph");
    if (APRender.sheets) {
        [...APRender.sheets.keys()].sort().forEach(s => {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s;
            sheetSelect.appendChild(opt);
        });
    }
    sheetSelect.addEventListener("change", () => {
        replacementSelect.innerHTML = `<option value="">-- Select Replacement --</option>`;
        const sheet = APRender.sheets.get(sheetSelect.value);
        if (sheet) {
            [...sheet.glyphs.keys()].sort().forEach(g => {
                const opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                replacementSelect.appendChild(opt);
            });
        }
    });
    sheetSelect.dispatchEvent(new Event("change"));
    document.getElementById("customizeAddGlyphMap").addEventListener("click", () => {
        const original = document.getElementById("customizeOriginalGlyph").value;
        const replacement = document.getElementById("customizeReplacementGlyph").value;
        const scale = parseFloat(document.getElementById("customizeScale").value);
        if (original && replacement) {
            const newMap = customizations.glyphmap;
            const idx = newMap.findIndex((p) => p[0] === original);
            const finalScale = isNaN(scale) ? 1 : scale;
            if (idx >= 0) {
                newMap[idx] = [original, replacement, finalScale];
            } else {
                newMap.push([original, replacement, finalScale]);
            }
            customizations.glyphmap = newMap;
            settingsDirty = true;
            syncCustomizeUI();
        }
    });

    // Settings JSON
    document.getElementById("customizeSettingsJson").addEventListener("input", (e) => {
        try {
            const parsed = JSON.parse(e.target.value);
            customizations = parsed;
            settingsDirty = true;
            syncCustomizeUI();
        } catch (err) {
            // ignore parse errors while typing
        }
    });

    // Footer buttons
    document.getElementById("customizeSave").addEventListener("click", () => {
        saveCustomizations();
        hideCustomizeModal();
        renderGame();
    });
    document.getElementById("customizeReset").addEventListener("click", () => {
        const isDark = window.localStorage.getItem("darkMode") === "true";
        customizations = JSON.parse(JSON.stringify(isDark ? defaultCustomizationsDark : defaultCustomizationsLight));
        window.localStorage.removeItem("customizations");
        settingsDirty = false;
        syncCustomizeUI();
    });
}

// --- End Customization Management ---

const PREDEFINED_LOG_NAMES = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Judy"];

// Helper to get player names for status panel
function getPlayerNamesForStatus(game, gamename) {
    const gameMetaInfo = APGames.gameinfo.get(gamename);
    let playerNames = [];
    if (typeof game.getPlayerNames === "function") {
        playerNames = game.getPlayerNames();
    } else if (gameMetaInfo && gameMetaInfo.flags && gameMetaInfo.flags.includes("shared-pieces")) {
        if (typeof game.player2seat === 'function') {
            for (let i = 1; i <= game.numplayers; i++) playerNames.push(game.player2seat(i));
        } else {
            for (let i = 1; i <= game.numplayers; i++) playerNames.push(`Seat ${i}`);
        }
    } else {
        for (let i = 1; i <= game.numplayers; i++) {
            if (i - 1 < PREDEFINED_LOG_NAMES.length) {
                playerNames.push(PREDEFINED_LOG_NAMES[i - 1]);
            } else {
                playerNames.push(`Player ${i}`);
            }
        }
    }
    return playerNames;
}

// Helper to format score (can be simple string or object)
function formatScore(score) {
    if (typeof score === 'object' && score !== null) {
        return JSON.stringify(score); // Or a more sophisticated formatting
    }
    return String(score);
}

// Helper to create a unique ID for SVG elements
function generateUniqueSvgId(base = "") {
    return `${base}_${nanoid()}`;
}

// Helper to format the content of a single stash item that represents a piece/glyph
function formatSingleStashItemContent(item, glyphRenderOptions) {
    let content = "";
    try {
        const glyphName = (typeof item.glyph === 'object' && item.glyph !== null) ? item.glyph.name : String(item.glyph);
        const glyphColour = (typeof item.glyph === 'object' && item.glyph !== null && item.glyph.hasOwnProperty('colour')) ? item.glyph.colour : 1;
        const glyphSvgId = generateUniqueSvgId(); // This is for the outer <svg> id if APRender uses it, or for our uniqueness.

        const localGlyphOpts = {
            ...glyphRenderOptions,
            svgid: glyphSvgId, // Pass unique ID for the SVG element itself
            prefix: generateUniqueSvgId(),
        };
        let glyphSvg = APRender.renderglyph(glyphName, glyphColour, localGlyphOpts);
        content += `${item.count} &times; <span class="stash-glyph-wrapper">${glyphSvg}</span>`;
        if (item.movePart) {
            content += ` <span class="stash-movepart">(${item.movePart})</span>`;
        }
    } catch (e) {
        console.error("Error rendering stash glyph item:", e, item);
        const glyphIdentifier = (typeof item.glyph === 'object' && item.glyph !== null) ? item.glyph.name : String(item.glyph);
        content += `<span>${item.count} &times; [Error rendering ${glyphIdentifier}]</span>`;
        if (item.movePart) {
            content += ` (${item.movePart})`;
        }
    }
    return content;
}

// Helper to format stash (can be object or array)
function formatStash(stash, glyphRenderOptions) {
    let stashHTML = "";
    if (typeof stash === 'object' && stash !== null) {
        if (Array.isArray(stash)) { // Assumed to be an array of stashable items
            if (stash.length === 0) return "<p><em>Empty</em></p>";
            stashHTML += `<ul class="stash-list">`;
            stash.forEach(item => {
                if (typeof item === 'object' && item !== null && item.hasOwnProperty('glyph') && item.hasOwnProperty('count')) {
                    stashHTML += `<li class="stash-item">${formatSingleStashItemContent(item, glyphRenderOptions)}</li>`;
                } else if (typeof item === 'object' && item !== null) { // Fallback for other objects in array
                    stashHTML += `<li class="stash-item stash-item-json"><pre>${JSON.stringify(item, null, 2)}</pre></li>`;
                } else { // Primitive in array
                    stashHTML += `<li class="stash-item">${item}</li>`;
                }
            });
            stashHTML += `</ul>`;
        } else { // stash is an object but not an array (e.g., { "pieceA": 3, "pieceB": {...} })
            const keys = Object.keys(stash);
            if (keys.length === 0) return "<p><em>Empty</em></p>";

            // Check if the object itself is a single stashable item
            if (stash.hasOwnProperty('glyph') && stash.hasOwnProperty('count') && keys.filter(k => k !== 'glyph' && k !== 'count' && k !== 'movePart').length === 0) {
                 return `<div class="stash-item">${formatSingleStashItemContent(stash, glyphRenderOptions)}</div>`;
            }

            // Otherwise, treat as a map of piece types to counts or more complex definitions
            stashHTML += `<ul class="stash-map">`;
            for (const key in stash) {
                if (stash.hasOwnProperty(key)) {
                    const value = stash[key];
                    stashHTML += `<li class="stash-map-item"><strong>${key}:</strong> `;
                    if (typeof value === 'object' && value !== null && value.hasOwnProperty('glyph') && value.hasOwnProperty('count')) {
                        // Value is a stashable item definition
                        stashHTML += `<span class="stash-item-inline">${formatSingleStashItemContent(value, glyphRenderOptions)}</span>`;
                    } else if (typeof value === 'object' && value !== null) {
                        stashHTML += `<pre class="stash-item-json-inline">${JSON.stringify(value, null, 2)}</pre>`;
                    } else { // Primitive value (e.g., count)
                        stashHTML += value;
                    }
                    stashHTML += `</li>`;
                }
            }
            stashHTML += `</ul>`;
        }
    } else if (stash !== undefined && stash !== null && String(stash).trim() !== "") { // Primitive type stash
        stashHTML += `<p>${String(stash)}</p>`;
    }
    return stashHTML || "<p><em>Empty</em></p>";
}

// Helper function to render the "In Check" section
function _renderInCheckSection(game, playerNames) {
    let inCheckBlockHTML = "";
    const inCheckPlayerNumbers = game.inCheck(); // Assumed to return player numbers [1, 2, ...]
    if (Array.isArray(inCheckPlayerNumbers) && inCheckPlayerNumbers.length > 0) {
        const checkedPlayerNames = inCheckPlayerNumbers.map(pNum => playerNames[pNum - 1] || `Player ${pNum}`);
        inCheckBlockHTML += `<div class="in-check-section">`;
        inCheckBlockHTML += `<h3>In Check:</h3>`;
        inCheckBlockHTML += `<ul class="in-check-list">`;
        checkedPlayerNames.forEach(name => {
            inCheckBlockHTML += `<li>${name}</li>`;
        });
        inCheckBlockHTML += `</ul></div>`;
    }
    return inCheckBlockHTML;
}

// Helper function to render the general statuses section
function _renderStatusesSection(game, playerNames) {
    let statusBlockHTML = "";
    const statuses = game.sidebarStatuses();
    let actualStatusContent = "";

    if (statuses) {
        if (Array.isArray(statuses)) {
            if (statuses.length > 0) {
                if (statuses.length === game.numplayers && statuses.every(s => typeof s === 'string')) {
                    actualStatusContent += "<ul>";
                    statuses.forEach((s, idx) => {
                        actualStatusContent += `<li>${playerNames[idx] || `Player ${idx+1}`}: ${s}</li>`;
                    });
                    actualStatusContent += "</ul>";
                } else {
                    actualStatusContent += `<ul>${statuses.map(s => `<li>${s}</li>`).join("")}</ul>`;
                }
            }
        } else if (typeof statuses === 'string' && statuses.trim() !== "") {
            actualStatusContent += `<p>${statuses.trim()}</p>`;
        }
    }

    if (actualStatusContent !== "") {
        statusBlockHTML += "<h3>Current Status:</h3>";
        statusBlockHTML += actualStatusContent;
    }
    return statusBlockHTML;
}

// Helper function to render the scores/limited pieces section
function _renderScoresSection(game, gamename, playerNames, gameFlags, glyphRenderOptions, isDark) {
    let scoresBlockHTML = "";
    if (typeof game.sidebarScores === "function") {
        const metricsArray = game.sidebarScores();
        if (metricsArray !== undefined && metricsArray !== null && Array.isArray(metricsArray) && metricsArray.length > 0) {
            scoresBlockHTML += `<h3>Scores:</h3>`;

            metricsArray.forEach(metric => {
                if (typeof metric === 'object' && metric !== null && metric.hasOwnProperty('name') && typeof metric.name === 'string' && metric.hasOwnProperty('scores') && Array.isArray(metric.scores)) {
                    scoresBlockHTML += `<h4>${metric.name}:</h4>`;
                    metric.scores.forEach((playerScore, playerIndex) => {
                        const playerNum = playerIndex + 1;
                        const playerName = playerNames[playerIndex] || `Player ${playerNum}`;

                        const playerDiv = document.createElement('div');
                        playerDiv.style.display = 'flex';
                        playerDiv.style.alignItems = 'center';
                        playerDiv.style.marginBottom = '0.25em';

                        const swatch = document.createElement('span');
                        swatch.style.display = 'inline-flex';
                        swatch.style.alignItems = 'center';
                        swatch.style.justifyContent = 'center';
                        swatch.style.width = '20px';
                        swatch.style.height = '20px';
                        swatch.style.marginRight = '8px';
                        swatch.style.border = `1px solid ${isDark ? '#555' : '#ccc'}`;
                        swatch.style.borderRadius = '3px';
                        swatch.style.lineHeight = '0';
                        swatch.style.textAlign = 'center';
                        swatch.style.fontSize = '10px';

                        let gc = null;
                        if (gameFlags.includes("custom-colours") && typeof game.getPlayerColour === 'function') {
                            gc = game.getPlayerColour(playerNum);
                        }

                        const localGlyphOpts = {
                            ...glyphRenderOptions,
                            svgid: `scoreSwatchGlyph_${metric.name.replace(/\s+/g, '_')}_${playerNum}`,
                            prefix: generateUniqueSvgId(),
                        };

                        try {
                            let glyphSVG = APRender.renderglyph("piece", gc === null ? playerNum : gc, localGlyphOpts);
                            swatch.innerHTML = glyphSVG;
                            const svgElement = swatch.querySelector('svg');
                            if (svgElement) {
                                svgElement.style.width = '100%';
                                svgElement.style.height = '100%';
                                svgElement.style.display = 'block';
                            }
                            swatch.title = `${playerName}: P${playerNum}`;
                        } catch (e) {
                            console.error(`Error rendering glyph for player ${playerNum} in scores:`, e);
                            swatch.textContent = `P${playerNum}`;
                            swatch.style.lineHeight = '20px';
                            swatch.title = `${playerName}: P${playerNum} (render error)`;
                        }
                        playerDiv.appendChild(swatch);

                        const scoreTextSpan = document.createElement('span');
                        scoreTextSpan.textContent = `${playerName}: ${formatScore(playerScore)}`;
                        playerDiv.appendChild(scoreTextSpan);
                        scoresBlockHTML += playerDiv.outerHTML;
                    });
                } else {
                    console.warn("Unexpected score metric format in metricsArray:", metric);
                    scoresBlockHTML += `<p><em>Data for a metric is in an unexpected format.</em></p>`;
                }
            });
        } else if (metricsArray !== undefined && metricsArray !== null && !Array.isArray(metricsArray)) {
            scoresBlockHTML += `<h3>Scores:</h3>`;
            scoresBlockHTML += `<p><em>Scores data is in an unrecognized format. Expected an array of metrics. Displaying raw: ${formatScore(metricsArray)}</em></p>`;
        }
    }
    return scoresBlockHTML;
}

// Helper function to render player stashes section
function _renderPlayerStashesSection(game, playerNames, glyphRenderOptions) {
    let stashesCombined = "";
    for (let i = 1; i <= game.numplayers; i++) {
        const stash = game.getPlayerStash(i);
        const playerName = playerNames[i-1] || `Player ${i}`;
        let stashDisplay = "";
        if (typeof stash === 'object' && stash !== null) {
            if (Array.isArray(stash) && stash.length > 0) {
                stashDisplay = formatStash(stash, glyphRenderOptions);
            } else if (!Array.isArray(stash) && Object.keys(stash).length > 0) {
                stashDisplay = formatStash(stash, glyphRenderOptions);
            }
        } else if (stash) {
             stashDisplay = formatStash(stash, glyphRenderOptions);
        }

        if (stashDisplay !== "<p><em>Empty</em></p>" && stashDisplay !== "") {
            stashesCombined += `<h4>${playerName}:</h4>${stashDisplay}`;
        }
    }
    if (stashesCombined !== "") {
        return "<h3>Player Stashes:</h3>" + stashesCombined;
    }
    return "";
}

// Helper function to render shared stash section
function _renderSharedStashSection(game, glyphRenderOptions) {
    let sharedStashHTML = "";
    const sharedStash = game.getSharedStash();
    if (sharedStash) {
        const sharedStashDisplay = formatStash(sharedStash, glyphRenderOptions);
        if (sharedStashDisplay !== "<p><em>Empty</em></p>" && sharedStashDisplay !== "") {
            sharedStashHTML += "<h3>Shared Stash:</h3>";
            sharedStashHTML += sharedStashDisplay;
        }
    }
    return sharedStashHTML;
}

function updateGameStatusPanel(game, gamename) {
    const panel = document.getElementById("gameStatusPanel");
    const inCheckPanel = document.getElementById("inCheckPanel");
    if (!panel || !inCheckPanel) {
        return;
    }

    if (!game || !gamename) {
        panel.innerHTML = "";
        panel.style.display = 'none'; // Hide if no game/gamename
        inCheckPanel.innerHTML = ""; // Clear inCheckPanel
        inCheckPanel.style.display = 'none'; // Hide inCheckPanel
        return;
    }

    const gameMetaInfo = APGames.gameinfo.get(gamename);
    if (!gameMetaInfo) {
        panel.innerHTML = "";
        panel.style.display = 'none'; // Hide if no meta info
        inCheckPanel.innerHTML = ""; // Clear inCheckPanel
        inCheckPanel.style.display = 'none'; // Hide inCheckPanel
        return;
    }

    let content = "";
    let inCheckBlockHTML = "";

    const gameFlags = gameMetaInfo.flags || [];
    const playerNames = getPlayerNamesForStatus(game, gamename);

    const isDark = window.localStorage.getItem("darkMode") === "true";
    const glyphRenderOptions = getRenderOptions();

    // In Check Status
    if (gameFlags.includes("check") && typeof game.inCheck === "function") {
        inCheckBlockHTML = _renderInCheckSection(game, playerNames);
    }

    // Populate inCheckPanel
    if (inCheckBlockHTML !== "") {
        inCheckPanel.innerHTML = inCheckBlockHTML;
        inCheckPanel.style.display = 'block'; // Or its default display type
    } else {
        inCheckPanel.innerHTML = "";
        inCheckPanel.style.display = 'none';
    }

    // General Statuses from game.sidebarStatuses()
    if (typeof game.statuses === "function") {
        content += _renderStatusesSection(game, playerNames);
    }

    // Scores
    if (game.sidebarScores().length > 0) {
        content += _renderScoresSection(game, gamename, playerNames, gameFlags, glyphRenderOptions, isDark);
    }

    // Player Stashes
    if (gameFlags.includes("player-stashes")) {
        if (typeof game.getPlayerStash === "function") {
            content += _renderPlayerStashesSection(game, playerNames, glyphRenderOptions);
        }
    }

    // Shared Stash
    if (gameFlags.includes("shared-stash")) {
        if (typeof game.getSharedStash === "function") {
            content += _renderSharedStashSection(game, glyphRenderOptions);
        }
    }

    if (content.trim() === "") {
        panel.innerHTML = ""; // Ensure it's empty
        panel.style.display = 'none';
    } else {
        panel.innerHTML = content;
        panel.style.display = 'block'; // Or its default display type
    }
}

// Utility for showing a temporary status message in a modal
function showModalStatus(id, msg, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.remove('fade');
    setTimeout(() => { el.classList.add('fade'); }, 1800);
    setTimeout(() => { el.textContent = ""; el.classList.remove('error', 'fade'); }, 2400);
}

function renderGame(...args) {
    var myNode = document.getElementById("drawing");
    while (myNode.lastChild) {
        myNode.removeChild(myNode.lastChild);
    }
    var options = getRenderOptions(args[2] || {});
    options.divid = "drawing";
    myNode.style.backgroundColor = options.colourContext?.background || "#fff";

    var rotval = parseInt(document.getElementById("rotation").value, 10);
    if ( (rotval !== undefined) && (rotval !== null) && (!isNaN(rotval)) && (rotval !== 0) ) {
        options.rotate = rotval;
    }
    if (document.getElementById("annotate").checked) {
        options.showAnnotations = true;
    } else {
        options.showAnnotations = false;
    }
    options.boardClick = boardClick;
    options.height = "100%";
    options.width = "100%";
    options.preserveAspectRatio = "xMidYMid meet";
    var state = window.localStorage.getItem("state");
    const displayOptionsContainer = document.getElementById("displayOptionsContainer");
    const clickStatusBox = document.getElementById("clickstatus");
    const playerInfoDisplay = document.getElementById("playerInfoDisplay");

    let selectedDisplay = window.localStorage.getItem("selectedDisplay") || "default";
    const checkedDisplayRadio = document.querySelector('input[name="displayOption"]:checked');
    if (checkedDisplayRadio) {
        selectedDisplay = checkedDisplayRadio.value;
    }

    if (state !== null) {
        var gamename = window.localStorage.getItem("gamename");
        const isVolcanoFamily = (gamename === "volcano") || (gamename === "mvolcano");
        const isExpandingDisplay = selectedDisplay === "expanding";

        if (isVolcanoFamily && !isExpandingDisplay) {
            options.boardHover = boardClickVolcano;
        } else if (isVolcanoFamily && isExpandingDisplay) {
            const hoverWarning = document.createElement('p');
            hoverWarning.style.color = "#ff9900";
            hoverWarning.textContent = "Note: Hover effect is disabled for the 'expanding' view in Volcano games.";
            if (!clickStatusBox.querySelector('.volcano-hover-warning')) {
                hoverWarning.classList.add('volcano-hover-warning');
                clickStatusBox.insertBefore(hoverWarning, clickStatusBox.firstChild);
            }
        } else {
            const existingWarning = clickStatusBox.querySelector('.volcano-hover-warning');
            if (existingWarning) {
                clickStatusBox.removeChild(existingWarning);
            }
        }

        var game = APGames.GameFactory(gamename, state);
        const isDark = window.localStorage.getItem("darkMode") === "true";

        if (game.gameover && clickStatusBox) {
            var winnerStr = game.winner.length > 0 ? game.winner.join(", ") : "none";
            clickStatusBox.innerHTML = '<p style="color: #0a0; font-weight: bold;">Game Over! Winner: Player ' + winnerStr + '</p>';
        }

        if (playerInfoDisplay) {
            playerInfoDisplay.innerHTML = ""; // Clear previous content

            // Add the heading for player info
            const playerInfoHeading = document.createElement('h3');
            playerInfoHeading.textContent = "Players:";
            playerInfoDisplay.appendChild(playerInfoHeading);

            const numPlayers = game.numplayers;
            const gameMetaInfo = APGames.gameinfo.get(gamename);
            let playerNames = [];
            const hasSharedPieces = gameMetaInfo && gameMetaInfo.flags && gameMetaInfo.flags.includes("shared-pieces");
            const hasCustomColours = gameMetaInfo && gameMetaInfo.flags && gameMetaInfo.flags.includes("custom-colours");

            if (typeof game.getPlayerNames === "function") {
                playerNames = game.getPlayerNames();
            } else {
                // Fallback to predefined names or Player X, regardless of shared-pieces for naming
                for (let i = 1; i <= numPlayers; i++) {
                    if (i - 1 < PREDEFINED_LOG_NAMES.length) {
                        playerNames.push(`Player ${i}: ${PREDEFINED_LOG_NAMES[i - 1]}`);
                    } else {
                        playerNames.push(`Player ${i}`);
                    }
                }
            }

            for (let p = 1; p <= numPlayers; p++) {
                const playerName = playerNames[p-1] || `Player ${p}`;

                const playerDiv = document.createElement('div');
                playerDiv.style.display = 'flex';
                playerDiv.style.alignItems = 'center';
                playerDiv.style.marginBottom = '0.25em';

                const swatch = document.createElement('span');
                swatch.style.display = 'inline-flex'; // Use flex for centering content
                swatch.style.alignItems = 'center';
                swatch.style.justifyContent = 'center';
                swatch.style.width = '20px';
                swatch.style.height = '20px';
                swatch.style.marginRight = '8px';
                swatch.style.border = `1px solid ${isDark ? '#555' : '#ccc'}`;
                swatch.style.borderRadius = '3px';
                swatch.style.lineHeight = '0'; // Important for SVG alignment
                swatch.style.textAlign = 'center'; // For text fallback
                swatch.style.fontSize = '10px'; // For text fallback

                if (hasSharedPieces) {
                    swatch.textContent = `P${p}`;
                    swatch.title = `${playerName}: P${p} (shared pieces)`;
                    swatch.style.backgroundColor = 'transparent'; // Ensure no bg color from previous states
                    swatch.style.lineHeight = '20px'; // Vertically center text
                } else {
                    let gc = null;
                    if (hasCustomColours && typeof game.getPlayerColour === 'function') {
                        gc = game.getPlayerColour(p);
                    }

                    const glyphOpts = getRenderOptions({svgid: `playerSwatchGlyph_${p}`, prefix: generateUniqueSvgId()});
                    // The following properties are not used by renderglyph and should be removed to avoid confusion
                    delete glyphOpts.divid;
                    delete glyphOpts.divelem;
                    delete glyphOpts.target;
                    delete glyphOpts.width;
                    delete glyphOpts.height;
                    delete glyphOpts.boardClick;
                    delete glyphOpts.boardHover;

                    try {
                        let glyphSVG = APRender.renderglyph("piece", gc === null ? p : gc, glyphOpts);
                        swatch.innerHTML = glyphSVG;
                        // Ensure the SVG inside the swatch scales correctly
                        const svgElement = swatch.querySelector('svg');
                        if (svgElement) {
                            svgElement.style.width = '100%';
                            svgElement.style.height = '100%';
                            svgElement.style.display = 'block';
                        }
                        swatch.title = `${playerName}: P${p}`;
                    } catch (e) {
                        console.error(`Error rendering glyph for player ${p}:`, e);
                        swatch.textContent = `P${p}`;
                        swatch.style.lineHeight = '20px'; // Vertically center text
                        swatch.title = `${playerName}: P${p} (render error)`;
                    }
                }
                const nameSpan = document.createElement('span');
                nameSpan.textContent = playerName;

                playerDiv.appendChild(swatch);
                playerDiv.appendChild(nameSpan);
                playerInfoDisplay.appendChild(playerDiv);
            }
        }

        updateGameStatusPanel(game, gamename);

        if (displayOptionsContainer && displayOptionsContainer.children.length > 0) {
            displayOptionsContainer.style.display = 'block';
        }

        var data = JSON.parse(window.localStorage.getItem("interim"));

        let renderOpts = getRenderOptions({ perspective: game.currplayer });
        if (selectedDisplay !== "default") {
            renderOpts.altDisplay = selectedDisplay;
        }
        if (data === null) {
            data = game.render(renderOpts);
            if (Array.isArray(data)) {
                data = data[data.length - 1];
            }
        }
        var canvas;
        try {
            canvas = APRender.render(data, options);
        } catch (e) {
            console.error("Render error:", e);
            console.log("Render data:", data, "Options:", options);
            let errorMsg = "Error rendering game board. See console for details.";
            if (
                e &&
                typeof e.message === "string" &&
                e.message.match(/colou?rs? provided is not long enough/i)
            ) {
                errorMsg = `
                <div style="
                    background: #fff3f3;
                    border: 2px solid #e53935;
                    color: #b71c1c;
                    border-radius: 8px;
                    padding: 1.2em 1em 1em 3.2em;
                    margin: 2em 0 1em 0;
                    font-size: 1.08em;
                    font-weight: 500;
                    position: relative;
                    box-shadow: 0 2px 8px rgba(229,57,53,0.08);
                ">
                    <span style="
                        position: absolute;
                        left: 1em;
                        top: 1.1em;
                        font-size: 1.5em;
                        font-weight: bold;
                        color: #e53935;
                    ">!</span>
                    The selected palette does not have enough colours for this game.<br>
                    <span style="font-size:0.97em;font-weight:400;">
                        Please choose or create a palette with at least as many colours as there are players.
                    </span>
                </div>
                `;
            }
            myNode.innerHTML = errorMsg;
        }

        const movelst = game.moveHistory();
        const div = document.getElementById("moveHistory");
        if (Array.isArray(movelst) && movelst.length > 0) {
            let table = '<table class="striped hoverable"><thead><tr>';
            table += '<th>Move</th>';
            const playerNames = getPlayerNamesForStatus(game, gamename);
            for (let i = 0; i < game.numplayers; i++) {
                table += `<th>${playerNames[i] || `Player ${i + 1}`}</th>`;
            }
            table += '</tr></thead><tbody>';
            movelst.forEach((round, index) => {
                if (index === movelst.length - 1) {
                    table += '<tr id="lastMoveInHistory">';
                } else {
                    table += '<tr>';
                }
                table += `<td>${index + 1}</td>`;
                for (let i = 0; i < game.numplayers; i++) {
                    const move = round[i] || "";
                    table += `<td>${move}</td>`;
                }
                table += '</tr>';
            });
            table += '</tbody></table>';
            div.innerHTML = table;
            requestAnimationFrame(() => {
                const lastRow = document.getElementById("lastMoveInHistory");
                if (lastRow) {
                    lastRow.scrollIntoView({ behavior: "auto", block: "end" });
                }
            });
        } else if (Array.isArray(movelst)) {
            div.innerHTML = '<p>No moves have been made yet.</p>';
        } else {
            div.innerHTML = "[move history unavailable]";
        }

        var status = "";
        if (typeof game.chatLog === "function") {
            var results = game.chatLog(PREDEFINED_LOG_NAMES).reverse().map(e => e.join(" "));
            if (results.length > 0) {
                status += "\n\n* " + results.join("\n* ");
            }
        } else if (typeof game.resultsHistory === "function") {
            var results = game.resultsHistory().reverse();
            if (results.length > 0) {
                status += "\n\n* " + results.map((x) => { return JSON.stringify(x); }).join("\n* ");
            }
        }
        var statusbox = document.getElementById("status");
        var converter = new showdown.Converter();
        statusbox.innerHTML = converter.makeHtml(status);
    } else {
        if (displayOptionsContainer) {
            displayOptionsContainer.style.display = 'none';
        }
        if (playerInfoDisplay) {
            playerInfoDisplay.innerHTML = '<p style="font-style: italic; color: #888;">No game loaded.</p>';
        }
        updateGameStatusPanel(null, null);
    }

    return false;
}

// Redo stack management
function getRedoStack() {
    const stackJSON = window.localStorage.getItem("redoStack");
    return stackJSON ? JSON.parse(stackJSON) : [];
}

function setRedoStack(stack) {
    window.localStorage.setItem("redoStack", JSON.stringify(stack));
}

function clearRedoStack() {
    window.localStorage.removeItem("redoStack");
}

var textFile = null,
makeTextFile = function (text) {
    var data = new Blob([text], {type: 'text/plain'});
    if (textFile !== null) {
        window.URL.revokeObjectURL(textFile);
    }
    textFile = window.URL.createObjectURL(data);
    return textFile;
};

function setDarkMode(isDark) {
    const sidebar = document.querySelector('.sidebar');
    const scrollPosition = sidebar.scrollTop;

    window.localStorage.setItem("darkMode", isDark ? "true" : "false");
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    loadCustomizations();
    renderGame();
    document.getElementById("darkMode").textContent = isDark ? "Light Mode" : "Dark Mode";

    sidebar.scrollTop = scrollPosition;
}

// Global state for selected variants
let selectedGroupVariants = {};
let selectedNonGroupVariants = {};
let currentGameInfo = null;

// Tooltip for variant info
function showVariantTooltip(variantUid, anchorElem) {
    let tooltip = document.getElementById("variantTooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "variantTooltip";
        tooltip.style.position = "fixed";
        tooltip.style.zIndex = 2000;
        tooltip.style.pointerEvents = "none";
        tooltip.style.background = "rgba(30,30,30,0.97)";
        tooltip.style.color = "#fff";
        tooltip.style.borderRadius = "6px";
        tooltip.style.padding = "10px 14px";
        tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";
        tooltip.style.fontSize = "0.98em";
        tooltip.style.maxWidth = "320px";
        tooltip.style.lineHeight = "1.4";
        tooltip.style.display = "none";
        tooltip.style.transition = "opacity 0.1s";
        document.body.appendChild(tooltip);
    }

    if (!currentGameInfo || !variantUid) {
        tooltip.style.display = "none";
        return;
    }

    const gameUid = currentGameInfo.uid;
    const allVariants = currentGameInfo.variants || [];
    let variant = allVariants.find(v => v.uid === variantUid);
    if (!variant && variantUid.startsWith("#")) {
        const groupName = variantUid.substring(1);
        variant = {
            uid: variantUid,
            name: `Default ${groupName}`,
            group: groupName,
            description: ""
        };
    }

    if (variant) {
        const t = (APGames.i18n && typeof APGames.i18n.t === 'function')
            ? APGames.i18n.t
            : (key) => key;

        const nameKey = `variants.${gameUid}.${variantUid}.name`;
        const descriptionKey = `variants.${gameUid}.${variantUid}.description`;

        let vname = t(nameKey);
        if (vname === nameKey) vname = variant.name || variantUid;

        let vdesc = t(descriptionKey);
        if (vdesc === descriptionKey) vdesc = variant.description || "";

        let content = `<strong>${vname}</strong> <span style="color:#bbb;font-size:0.92em;">(${variantUid})</span>`;
        if (vdesc !== "") {
            content += `<br><span style="font-size:0.96em;">${vdesc}</span>`;
        }

        tooltip.innerHTML = content;

        const rect = anchorElem.getBoundingClientRect();
        let top = rect.top + window.scrollY;
        let left = rect.right + 12 + window.scrollX;
        tooltip.style.display = "block";
        tooltip.style.opacity = "1";
        setTimeout(() => {
            const tRect = tooltip.getBoundingClientRect();
            if (left + tRect.width > window.innerWidth - 10) {
                left = rect.left + window.scrollX - tRect.width - 12;
            }
            if (left < 4) left = 4;
            if (top + tRect.height > window.innerHeight - 8) {
                top = window.innerHeight - tRect.height - 8;
            }
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        }, 0);
    } else {
        tooltip.style.display = "none";
    }
}

function hideVariantTooltip() {
    const tooltip = document.getElementById("variantTooltip");
    if (tooltip) {
        tooltip.style.display = "none";
        tooltip.innerHTML = "";
    }
}

// Display options for alternative board renderings
function updateDisplayOptions(gameEngine) {
    const displayOptionsContainer = document.getElementById("displayOptionsContainer");
    displayOptionsContainer.innerHTML = "";
    displayOptionsContainer.style.display = 'none';

    if (typeof gameEngine?.alternativeDisplays === 'function') {
        const displays = gameEngine.alternativeDisplays();
        if (displays && displays.length > 0) {
            const fieldset = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = 'Display Options';
            fieldset.appendChild(legend);

            const defaultDiv = document.createElement('div');
            const defaultRadio = document.createElement('input');
            defaultRadio.type = 'radio';
            defaultRadio.name = 'displayOption';
            defaultRadio.value = 'default';
            defaultRadio.id = 'display_default';
            defaultRadio.checked = true;
            const defaultLabel = document.createElement('label');
            defaultLabel.htmlFor = defaultRadio.id;
            defaultLabel.textContent = ' Default Display';
            defaultDiv.appendChild(defaultRadio);
            defaultDiv.appendChild(defaultLabel);
            fieldset.appendChild(defaultDiv);

            displays.forEach(disp => {
                const div = document.createElement('div');
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'displayOption';
                radio.value = disp.uid;
                radio.id = `display_${disp.uid}`;
                const label = document.createElement('label');
                label.htmlFor = radio.id;
                label.textContent = ` ${disp.description}`;
                div.appendChild(radio);
                div.appendChild(label);
                fieldset.appendChild(div);
            });
            displayOptionsContainer.appendChild(fieldset);

            const savedDisplay = window.localStorage.getItem("selectedDisplay") || "default";
            const displayRadio = document.getElementById(`display_${savedDisplay}`);
            if (displayRadio) {
                displayRadio.checked = true;
            } else {
                const defaultDisplayRadio = document.getElementById('display_default');
                if (defaultDisplayRadio) {
                    defaultDisplayRadio.checked = true;
                    window.localStorage.setItem("selectedDisplay", "default");
                }
            }
            displayOptionsContainer.style.display = 'block';
        }
    }
}

document.addEventListener("DOMContentLoaded", function(event) {
    var i18n = APGames.addResource("en");
    var { t } = i18n;

    const autoSubmitCheckbox = document.getElementById("autoSubmit");
    const savedAutoSubmit = window.localStorage.getItem("autoSubmit");
    if (savedAutoSubmit !== null) {
        autoSubmitCheckbox.checked = savedAutoSubmit === "true";
    }

    const rotationInput = document.getElementById("rotation");
    const savedRotation = window.localStorage.getItem("rotation");
    if (savedRotation !== null) {
        rotationInput.value = savedRotation;
    }

    const annotateCheckbox = document.getElementById("annotate");
    const savedAnnotate = window.localStorage.getItem("annotate");
    if (savedAnnotate !== null) {
        annotateCheckbox.checked = savedAnnotate === "true";
    }

    const detailsElements = document.querySelectorAll('.sidebar details');
    detailsElements.forEach(details => {
        const savedOpenState = window.localStorage.getItem(`detailsOpen_${details.id}`);
        if (savedOpenState !== null) {
            details.open = savedOpenState === "true";
        }
    });

    loadCustomizations();
    createCustomizeModal();

    const isDark = window.localStorage.getItem("darkMode") === "true";
    setDarkMode(isDark);

    var select = document.getElementById("selectGame");
    var variantsContainer = document.getElementById("variantsContainer");
    var varInfo = document.getElementById("varInfo");
    var playerCountContainer = document.getElementById("playerCountContainer");

    APGames.gameinfoSorted.forEach((g) => {
        var opt = document.createElement('option');
        opt.value = g.uid;
        opt.innerHTML = g.name;
        select.appendChild(opt);
    });

    autoSubmitCheckbox.addEventListener("change", () => {
        window.localStorage.setItem("autoSubmit", autoSubmitCheckbox.checked);
    });

    const renderSettings = document.getElementById("details-render-settings");
    const customizeBtn = document.createElement("button");
    customizeBtn.id = "customizeBtn";
    customizeBtn.textContent = "Customize Renderer...";
    customizeBtn.className = "button is-small";
    customizeBtn.style.marginTop = "0.5em";
    customizeBtn.addEventListener("click", showCustomizeModal);
    const existingContent = renderSettings.querySelector(".render-settings-content");
    if (existingContent) {
        existingContent.innerHTML = "";
        existingContent.appendChild(customizeBtn);
    }

    rotationInput.addEventListener("input", () => {
        window.localStorage.setItem("rotation", rotationInput.value);
        renderGame();
    });

    annotateCheckbox.addEventListener("change", () => {
        window.localStorage.setItem("annotate", annotateCheckbox.checked);
        renderGame();
    });

    detailsElements.forEach(details => {
        details.addEventListener("toggle", () => {
            window.localStorage.setItem(`detailsOpen_${details.id}`, details.open);
        });
    });

    const savedPlayerCount = window.localStorage.getItem("playerCount");
    let currentPlayerCount = savedPlayerCount ? parseInt(savedPlayerCount, 10) : 2;

    select.addEventListener("change", (e) => {
        var infobox = document.getElementById("gameInfo");
        varInfo.innerHTML = "";
        variantsContainer.innerHTML = "";
        selectedGroupVariants = {};
        selectedNonGroupVariants = {};
        playerCountContainer.innerHTML = "";

        const gameUid = select.value;
        currentGameInfo = APGames.gameinfo.get(gameUid);

        if (!currentGameInfo) {
            infobox.innerHTML = "";
            return;
        }

        var converter = new showdown.Converter();
        infobox.innerHTML = converter.makeHtml(t(currentGameInfo.description));

        let gameEngine;
        try {
            if (currentGameInfo.playercounts.length > 1) {
                gameEngine = APGames.GameFactory(gameUid, 2);
            } else {
                gameEngine = APGames.GameFactory(gameUid);
            }
        } catch (error) {
            console.error("Failed to instantiate game engine for variants:", error);
            return;
        }

        if (typeof gameEngine.allvariants !== 'function') {
            console.log("Game engine does not support allvariants method.");
            currentGameInfo.variants = [];
            return;
        }

        let allVariants = gameEngine.allvariants() || [];
        currentGameInfo.variants = allVariants;

        const groups = {};
        const nonGrouped = [];

        allVariants.forEach(v => {
            if (v.group) {
                if (!groups[v.group]) {
                    groups[v.group] = [];
                }
                groups[v.group].push(v);
            } else if (!v.uid.startsWith("#")) {
                nonGrouped.push(v);
            }
        });

        Object.keys(groups).forEach(groupName => {
            const groupVariants = groups[groupName];
            const fieldset = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = `Group: ${groupName}`;
            fieldset.appendChild(legend);

            let defaultVariantExists = groupVariants.some(v => v.uid === `#${groupName}`);
            if (!defaultVariantExists) {
                groupVariants.unshift({
                    uid: `#${groupName}`,
                    name: `Default ${groupName}`,
                    group: groupName,
                    description: ""
                });
            }

            let defaultCheckedUid = `#${groupName}`;
            const explicitDefault = groupVariants.find(v => v.default === true);
            if (explicitDefault) {
                defaultCheckedUid = explicitDefault.uid;
            }

            selectedGroupVariants[groupName] = defaultCheckedUid;

            groupVariants.forEach(variant => {
                const div = document.createElement('div');
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = groupName;
                radio.value = variant.uid;
                radio.id = `variant_${variant.uid}`;
                if (variant.uid === defaultCheckedUid) {
                    radio.checked = true;
                }

                const label = document.createElement('label');
                label.htmlFor = radio.id;
                const nameKey = `variants.${gameUid}.${variant.uid}.name`;
                let vname = t(nameKey);
                if (vname === nameKey) vname = variant.name || variant.uid;
                label.textContent = ` ${vname}`;

                const updateFunc = () => {
                    selectedGroupVariants[groupName] = radio.value;
                };
                radio.addEventListener('change', updateFunc);
                radio.addEventListener('focus', updateFunc);

                radio.addEventListener('mouseenter', (ev) => showVariantTooltip(radio.value, radio));
                radio.addEventListener('mouseleave', hideVariantTooltip);
                label.addEventListener('mouseenter', (ev) => showVariantTooltip(radio.value, label));
                label.addEventListener('mouseleave', hideVariantTooltip);

                div.appendChild(radio);
                div.appendChild(label);
                fieldset.appendChild(div);
            });
            variantsContainer.appendChild(fieldset);
        });

        if (nonGrouped.length > 0) {
            const fieldset = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = 'Optional Variants';
            fieldset.appendChild(legend);

            nonGrouped.forEach(variant => {
                selectedNonGroupVariants[variant.uid] = false;

                const div = document.createElement('div');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = variant.uid;
                checkbox.id = `variant_${variant.uid}`;

                const label = document.createElement('label');
                label.htmlFor = checkbox.id;
                const nameKey = `variants.${gameUid}.${variant.uid}.name`;
                let vname = t(nameKey);
                if (vname === nameKey) vname = variant.name || variant.uid;
                label.textContent = ` ${vname}`;

                const updateFunc = () => {
                    selectedNonGroupVariants[variant.uid] = checkbox.checked;
                };
                checkbox.addEventListener('change', updateFunc);
                checkbox.addEventListener('focus', updateFunc);

                checkbox.addEventListener('mouseenter', (ev) => showVariantTooltip(checkbox.value, checkbox));
                checkbox.addEventListener('mouseleave', hideVariantTooltip);
                label.addEventListener('mouseenter', (ev) => showVariantTooltip(checkbox.value, label));
                label.addEventListener('mouseleave', hideVariantTooltip);

                div.appendChild(checkbox);
                div.appendChild(label);
                fieldset.appendChild(div);
            });
            variantsContainer.appendChild(fieldset);
        }

        if (currentGameInfo && Array.isArray(currentGameInfo.playercounts) && currentGameInfo.playercounts.length > 1) {
            const label = document.createElement('label');
            label.textContent = "Player count: ";
            label.setAttribute("for", "playerCountSelect");
            label.style.marginRight = "0.5em";
            const selectPC = document.createElement('select');
            selectPC.id = "playerCountSelect";
            selectPC.style.width = "auto";
            currentGameInfo.playercounts.forEach(pc => {
                const opt = document.createElement('option');
                opt.value = pc;
                opt.textContent = pc;
                selectPC.appendChild(opt);
            });
            let pcToSelect = currentPlayerCount;
            if (!currentGameInfo.playercounts.includes(pcToSelect)) {
                pcToSelect = currentGameInfo.playercounts[0];
            }
            selectPC.value = pcToSelect;
            currentPlayerCount = pcToSelect;
            selectPC.addEventListener("change", () => {
                currentPlayerCount = parseInt(selectPC.value, 10);
                window.localStorage.setItem("playerCount", currentPlayerCount);
            });
            playerCountContainer.appendChild(label);
            playerCountContainer.appendChild(selectPC);
            playerCountContainer.style.display = "block";
        } else {
            playerCountContainer.style.display = "none";
        }
    });

    const displayOptionsContainer = document.getElementById("displayOptionsContainer");
    if (displayOptionsContainer) {
        displayOptionsContainer.addEventListener('change', (event) => {
            if (event.target.type === 'radio' && event.target.name === 'displayOption') {
                window.localStorage.removeItem("interim");
                window.localStorage.setItem("selectedDisplay", event.target.value);
                renderGame();
            }
        });
    }

    document.getElementById("launch").addEventListener("click", () => {
        const gameUid = select.value;
        if (!gameUid) {
            alert("Please select a game first.");
            return;
        }
        const info = APGames.gameinfo.get(gameUid);
        if (!info) return;

        let playerCount = 2;
        if (info.playercounts.length > 1) {
            const pcSelect = document.getElementById("playerCountSelect");
            if (pcSelect) {
                playerCount = parseInt(pcSelect.value, 10);
                window.localStorage.setItem("playerCount", playerCount);
            }
        }

        let finalVariants = [];
        Object.values(selectedGroupVariants).forEach(uid => {
            if (!uid.startsWith("#")) {
                finalVariants.push(uid);
            }
        });
        Object.keys(selectedNonGroupVariants).forEach(uid => {
            if (selectedNonGroupVariants[uid]) {
                finalVariants.push(uid);
            }
        });

        let game;
        try {
            game = APGames.GameFactory(gameUid, info.playercounts.length > 1 ? playerCount : undefined, finalVariants.length > 0 ? finalVariants : undefined);
        } catch (error) {
            alert(`Failed to launch game: ${error.message}`);
            console.error(error);
            return;
        }

        window.localStorage.setItem("state", game.serialize());
        window.localStorage.setItem("gamename", gameUid);
        window.localStorage.removeItem("interim");
        clearRedoStack();
        window.localStorage.setItem("selectedDisplay", "default");

        updateDisplayOptions(game);

        var movebox = document.getElementById("moveEntry");
        movebox.value = "";
        movebox.classList.remove("move-incomplete", "move-ready");
        var result = game.validateMove("");
        var resultStr = '<p style="color: #888">' + result.message + '</p>';
        var statusbox = document.getElementById("clickstatus");
        statusbox.innerHTML = resultStr;
        const isDark = window.localStorage.getItem("darkMode") === "true";
        if (isDark) {
            setDarkMode(true);
        } else {
            renderGame();
        }
        updateGameStatusPanel(game, gameUid);
    }, false);

    document.getElementById("inject").addEventListener("click", () => {
        const field = document.getElementById("stateInject");
        const state = field.value;
        if (state.length > 0) {
            try {
                const parsed = JSON.parse(state);
                if ("game" in parsed) {
                    const meta = parsed.game;
                    let injectedPlayerCount = 2;
                    if (parsed.numplayers) {
                        injectedPlayerCount = parseInt(parsed.numplayers, 10);
                        window.localStorage.setItem("playerCount", injectedPlayerCount);
                        currentPlayerCount = injectedPlayerCount;
                    }
                    const game = APGames.GameFactory(meta, parsed.numplayers || undefined, undefined);
                    if (game !== undefined) {
                        field.value = "";
                        window.localStorage.setItem("state", game.serialize());
                        window.localStorage.setItem("gamename", meta);
                        window.localStorage.removeItem("interim");
                        clearRedoStack();
                        window.localStorage.setItem("selectedDisplay", "default");

                        const selectElement = document.getElementById("selectGame");
                        if (selectElement.value !== meta) {
                            selectElement.value = meta;
                            selectElement.dispatchEvent(new Event('change'));
                        }

                        updateDisplayOptions(game);

                        var movebox = document.getElementById("moveEntry");
                        movebox.value = "";
                        movebox.classList.remove("move-incomplete", "move-ready");
                        var result = game.validateMove("");
                        var resultStr = '<p style="color: #888">' + result.message + '</p>';
                        var statusbox = document.getElementById("clickstatus");
                        statusbox.innerHTML = resultStr;
                        renderGame();
                        updateGameStatusPanel(game, meta);
                    } else {
                        alert("Failed to hydrate injected state.")
                    }
                } else {
                    alert("Injected state missing 'game' property.");
                }
            } catch (e) {
                alert("Failed to parse injected state JSON: " + e.message);
            }
        }
    }, false);

    document.getElementById("moveBtn").addEventListener("click", () => {
        var movebox = document.getElementById("moveEntry");
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            var waserror = false;

            let redoStack = getRedoStack();
            let submittedMove = movebox.value;
            if (redoStack.length > 0 && redoStack[redoStack.length - 1] === submittedMove) {
                redoStack.pop();
                setRedoStack(redoStack);
                console.log("Submitted move matched redo stack top. Popped.");
            } else {
                clearRedoStack();
            }

            try {
                game.move(submittedMove);
            } catch (err) {
                waserror = true;
                if (err.name === "UserFacingError") {
                    var resultStr = '<p style="color: #f00">ERROR: ' + err.client + '</p>';
                    var statusbox = document.getElementById("clickstatus");
                    statusbox.innerHTML = resultStr;
                } else {
                    console.log(err);
                    alert("An error occurred: " + err.message);
                }
                console.log("Game state: "+state);
            }
            if (! waserror) {
                movebox.value = "";
                var statusbox = document.getElementById("clickstatus");
                if (game.gameover) {
                    var winnerStr = game.winner.length > 0 ? game.winner.join(", ") : "none";
                    statusbox.innerHTML = '<p style="color: #0a0; font-weight: bold;">Game Over! Winner: Player ' + winnerStr + '</p>';
                } else {
                    var result = game.validateMove("");
                    var resultStr = '<p style="color: #888">' + result.message + '</p>';
                    statusbox.innerHTML = resultStr;
                }
            }
            window.localStorage.setItem("state", game.serialize());
            window.localStorage.removeItem("interim");
            renderGame();
            updateGameStatusPanel(game, gamename);
        }
    });

    document.getElementById("moveRandom").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            if (typeof game.moves !== 'function' && !APGames.gameinfo.get(gamename).flags.includes("custom-randomization")) {
                alert("This game doesn't support random moves.")
                return;
            }

            let redoStack = getRedoStack();
            let generatedMove = null;

            try {
                generatedMove = game.randomMove();
                console.log(`Random move: ${generatedMove}`);

                if (redoStack.length > 0 && redoStack[redoStack.length - 1] === generatedMove) {
                    redoStack.pop();
                    setRedoStack(redoStack);
                    console.log("Random move matched redo stack top. Popped.");
                } else {
                    clearRedoStack();
                }

                game.move(generatedMove);
                console.log(JSON.stringify(game.board));
                var movebox = document.getElementById("moveEntry");
                movebox.value = "";
                movebox.classList.remove("move-incomplete", "move-ready");
                var statusbox = document.getElementById("clickstatus");
                if (game.gameover) {
                    var winnerStr = game.winner.length > 0 ? game.winner.join(", ") : "none";
                    statusbox.innerHTML = '<p style="color: #0a0; font-weight: bold;">Game Over! Winner: Player ' + winnerStr + '</p>';
                } else {
                    var result = game.validateMove("");
                    var resultStr = '<p style="color: #888">' + result.message + '</p>';
                    statusbox.innerHTML = resultStr;
                }
            } catch (err) {
                if (err.name === "UserFacingError") {
                    var resultStr = '<p style="color: #f00">ERROR: ' + err.client + '</p>';
                    var statusbox = document.getElementById("clickstatus");
                    statusbox.innerHTML = resultStr;
                } else {
                    console.log(err);
                    alert("An error occurred: " + err.message);
                }
                console.log("Game state: "+state);
            }
            window.localStorage.setItem("state", game.serialize());
            window.localStorage.removeItem("interim");
            renderGame();
            updateGameStatusPanel(game, gamename);
        }
    });

    document.getElementById("moveClear").addEventListener("click", () => {
        window.localStorage.removeItem("interim");
        var movebox = document.getElementById("moveEntry");
        movebox.value = "";
        renderGame();
    });

    document.getElementById("moveUndo").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            try {
                if (game.stack.length > 1) {
                    const moveToUndo = game.lastmove;

                    game.undo();
                    game.gameover = false;
                    game.winner = [];
                    window.localStorage.setItem("state", game.serialize());
                    window.localStorage.removeItem("interim");

                    if (typeof moveToUndo === 'string' && moveToUndo.length > 0) {
                        let redoStack = getRedoStack();
                        redoStack.push(moveToUndo);
                        setRedoStack(redoStack);
                    } else {
                        clearRedoStack();
                    }

                    var movebox = document.getElementById("moveEntry");
                    movebox.classList.remove("move-incomplete", "move-ready");
                    var result = game.validateMove("");
                    var resultStr = '<p style="color: #888">' + result.message + '</p>';
                    var statusbox = document.getElementById("clickstatus");
                    statusbox.innerHTML = resultStr;
                }
                renderGame();
            } catch (err) {
                console.error("Error during undo:", err);
                alert("Cannot undo: " + err.message);
            }
        }
    });

    document.getElementById("moveRedo").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            let redoStack = getRedoStack();
            if (redoStack.length > 0) {
                const moveToRedo = redoStack.pop();
                setRedoStack(redoStack);

                var gamename = window.localStorage.getItem("gamename");
                var game = APGames.GameFactory(gamename, state);
                var waserror = false;
                try {
                    game.move(moveToRedo);
                } catch (err) {
                    waserror = true;
                    redoStack.push(moveToRedo);
                    setRedoStack(redoStack);
                    console.error("Error during redo game.move:", err);
                    if (err.name === "UserFacingError") {
                        var resultStr = '<p style="color: #f00">REDO ERROR: ' + err.client + '</p>';
                        var statusbox = document.getElementById("clickstatus");
                        statusbox.innerHTML = resultStr;
                    } else {
                        alert("An error occurred during redo: " + err.message);
                    }
                    console.log("Game state before failed redo: "+state);
                }
                if (! waserror) {
                    var movebox = document.getElementById("moveEntry");
                    movebox.value = "";
                    movebox.classList.remove("move-incomplete", "move-ready");
                    var statusbox = document.getElementById("clickstatus");
                    if (game.gameover) {
                        var winnerStr = game.winner.length > 0 ? game.winner.join(", ") : "none";
                        statusbox.innerHTML = '<p style="color: #0a0; font-weight: bold;">Game Over! Winner: Player ' + winnerStr + '</p>';
                    } else {
                        var result = game.validateMove("");
                        var resultStr = '<p style="color: #888">' + result.message + '</p>';
                        statusbox.innerHTML = resultStr;
                    }

                    window.localStorage.setItem("state", game.serialize());
                    window.localStorage.removeItem("interim");
                    renderGame();
                }
            }
        }
    });

    document.getElementById("aiFast").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            if (gamename !== null) {
                var depth = APGames.aiFast.get(gamename);
                if ( (depth !== undefined) && (depth !== null) ) {
                    var movebox = document.getElementById("moveEntry");
                    if ( (game.numplayers !== undefined) && (game.numplayers !== 2) ) {
                        alert("AI only works with 2-player games.");
                        return false;
                    }
                    var factory = APGames.AIFactory(gamename);
                    var move = factory.constructor.findmove(game.state(), depth);
                    game.move(move);
                    window.localStorage.setItem("state", game.serialize());
                    window.localStorage.removeItem("interim");
                    if (game.gameover) {
                        var winnerStr = game.winner.length > 0 ? game.winner.join(", ") : "none";
                        document.getElementById("clickstatus").innerHTML = '<p style="color: #0a0; font-weight: bold;">Game Over! Winner: Player ' + winnerStr + '</p>';
                    }
                    renderGame();
                    updateGameStatusPanel(game, gamename);
                } else {
                    alert("This game does not support fast AI.");
                }
            }
        }
    });

    document.getElementById("aiSlow").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            if (gamename !== null) {
                var depth = APGames.aiSlow.get(gamename);
                if ( (depth !== undefined) && (depth !== null) ) {
                    var movebox = document.getElementById("moveEntry");
                    if ( (game.numplayers !== undefined) && (game.numplayers !== 2) ) {
                        alert("AI only works with 2-player games.");
                        return false;
                    }
                    var factory = APGames.AIFactory(gamename);
                    var move = factory.constructor.findmove(game.state(), depth);
                    game.move(move);
                    window.localStorage.setItem("state", game.serialize());
                    window.localStorage.removeItem("interim");
                    if (game.gameover) {
                        var winnerStr = game.winner.length > 0 ? game.winner.join(", ") : "none";
                        document.getElementById("clickstatus").innerHTML = '<p style="color: #0a0; font-weight: bold;">Game Over! Winner: Player ' + winnerStr + '</p>';
                    }
                    renderGame();
                    updateGameStatusPanel(game, gamename);
                } else {
                    alert("This game does not support slow AI.");
                }
            }
        }
    });

    document.getElementById("saveSVG").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var drawingDiv = document.getElementById("drawing");
            var svgElement = drawingDiv.querySelector("svg");

            if (svgElement) {
                if (!svgElement.getAttribute('xmlns')) {
                    svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }
                if (!svgElement.getAttribute('xmlns:xlink')) {
                    svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
                }

                var serializer = new XMLSerializer();
                var svgString = serializer.serializeToString(svgElement);
                var blob = new Blob([svgString], {type: "image/svg+xml;charset=utf-8"});
                var url = URL.createObjectURL(blob);

                var link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', gamename + '.svg');
                link.style.visibility = 'hidden';
                document.body.appendChild(link);

                link.click();

                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                alert("Could not find the SVG element to save.");
            }
        }
    });

    const modal = document.getElementById("dataModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalContent = document.getElementById("modalContent");
    const modalSaveBtn = document.getElementById("modalSaveBtn");
    const modalCopyBtn = document.getElementById("modalCopyBtn");

    function showModal(title, jsonDataString, filenameBase) {
        modalTitle.textContent = title;
        modalContent.textContent = jsonDataString;
        modal.dataset.filename = filenameBase + ".json";
        modal.dataset.rawJson = jsonDataString;
        document.body.style.overflow = 'hidden';
        modal.style.display = "block";
    }

    function hideModal() {
        modal.style.display = "none";
        document.body.style.overflow = '';
    }

    document.getElementById("modalCloseBtn").addEventListener("click", hideModal);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            hideModal();
        }
    });

    modalCopyBtn.addEventListener("click", () => {
        if (navigator.clipboard && modal.dataset.rawJson) {
            navigator.clipboard.writeText(modal.dataset.rawJson).then(() => {
                showModalStatus("dataModalStatus", "Data copied to clipboard!");
            }).catch(err => {
                console.error("Failed to copy text: ", err);
                showModalStatus("dataModalStatus", "Failed to copy data. See console.", true);
            });
        } else {
            showModalStatus("dataModalStatus", "Clipboard API not available or no data to copy.", true);
        }
    });

    modalSaveBtn.addEventListener("click", () => {
        const jsonDataString = modal.dataset.rawJson;
        const filename = modal.dataset.filename;
        if (jsonDataString && filename) {
            const blob = new Blob([jsonDataString], { type: "application/json;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else {
            alert("No data available to save.");
        }
    });

    document.getElementById("dumpState").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            try {
                const parsedState = JSON.parse(state);
                const prettyState = JSON.stringify(parsedState, null, 2);
                const gamename = window.localStorage.getItem("gamename") || "game";
                showModal("Game State", prettyState, `${gamename}-state`);
            } catch (e) {
                console.error("Error parsing state JSON:", e);
                alert("Could not parse game state JSON.");
            }
        } else {
            alert("No game state available to dump.");
        }
    });

    document.getElementById("dumpMoves").addEventListener("click", () => {
        var state = window.localStorage.getItem("state");
        if (state !== null) {
            var gamename = window.localStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            if (typeof game.moves === 'function') {
                try {
                    const moves = game.moves();
                    const prettyMoves = JSON.stringify({ currentPlayer: game.currplayer, availableMoves: moves }, null, 2);
                    showModal("Available Moves", prettyMoves, `${gamename}-moves`);
                } catch (e) {
                    console.error("Error getting or stringifying moves:", e);
                    alert("Could not get or format available moves.");
                }
            } else {
                alert("This game doesn't support listing moves.");
                return;
            }
        } else {
            alert("No game loaded to dump moves from.");
        }
    });

    const launchBtn = document.getElementById('launch');
    const moveBtn = document.getElementById('moveBtn');
    const moveRandomBtn = document.getElementById('moveRandom');
    const moveClear = document.getElementById('moveClear');
    const moveEntry = document.getElementById('moveEntry');
    const moveUndo = document.getElementById('moveUndo');
    const moveRedo = document.getElementById('moveRedo');

    document.addEventListener('keypress', function(event) {
        // Disable shortcuts if any modal is open
        const modals = document.querySelectorAll('.modal');
        for (const m of modals) {
            if (m.style.display === "block") return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            moveBtn.click();
        } else if (event.target.matches('input')) {
        } else if (event.key === 'r' || event.key === 'R') {
            event.preventDefault();
            moveRandomBtn.click();
        } else if (event.key === 'p' || event.key === 'P') {
            event.preventDefault();
            document.getElementById("passBtn").click();
        } else if (event.key === 'c' || event.key === 'C') {
            event.preventDefault();
            moveClear.click();
        } else if (event.key === 'l' || event.key === 'L') {
            event.preventDefault();
            launchBtn.click();
        } else if (event.key === 'u' || event.key === 'U') {
            event.preventDefault();
            moveUndo.click();
        } else if (event.key === 'y' || event.key === 'Y') {
            event.preventDefault();
            moveRedo.click();
        }
    });

    const sidebar = document.querySelector('.sidebar');
    const collapseBtn = document.querySelector('.collapse-button');
    const topBar = document.querySelector('.top-bar');
    const openSidebarBtn = document.getElementById('openSidebarBtn');

    // Function to set the sidebar state
    function setSidebarState(isCollapsed) {
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
            topBar.classList.add('sidebar-collapsed');
            topBar.classList.remove('sidebar-expanded');
            collapseBtn.innerHTML = '▼'; // Or use an appropriate icon/character
            collapseBtn.setAttribute('aria-label', 'Expand Sidebar');
            // Adjust position if needed, though CSS might handle this
            // collapseBtn.style.right = '-25px';
        } else {
            sidebar.classList.remove('collapsed');
            topBar.classList.remove('sidebar-collapsed');
            topBar.classList.add('sidebar-expanded');
            collapseBtn.innerHTML = '▲'; // Or use an appropriate icon/character
            collapseBtn.setAttribute('aria-label', 'Collapse Sidebar');
            // Adjust position if needed
            // collapseBtn.style.right = '-15px';
        }
        window.localStorage.setItem("sidebarCollapsed", isCollapsed);
        // Ensure the edge detection class is removed when sidebar is open
        if (!isCollapsed) {
            collapseBtn.classList.remove('show-edge');
        }
    }

    // Initial setup
    const initiallyCollapsed = window.localStorage.getItem("sidebarCollapsed") === "true";
    setSidebarState(initiallyCollapsed);

    // Event listener for the original collapse button
    collapseBtn.addEventListener('click', () => {
        const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
        setSidebarState(!isCurrentlyCollapsed); // Toggle state
    });

    document.getElementById("darkMode").addEventListener("click", () => {
        const isDark = window.localStorage.getItem("darkMode") === "true";
        setDarkMode(!isDark);
    });

    document.getElementById("passBtn").addEventListener("click", () => {
        const moveEntry = document.getElementById("moveEntry");
        moveEntry.value = "pass";
        document.getElementById("moveBtn").click();
    });

    document.addEventListener("keydown", function(event) {
        if (event.key === "Escape") {
            let closed = false;
            if (modal.style.display === "block") {
                hideModal();
                closed = true;
            }
            const customizeModal = document.getElementById("customizeModal");
            if (customizeModal && customizeModal.style.display === "block") {
                hideCustomizeModal();
                closed = true;
            }
            if (closed) {
                event.preventDefault();
            }
        }
    });

    if (window.localStorage.getItem("gamename")) {
        const savedGameName = window.localStorage.getItem("gamename");
        const savedState = window.localStorage.getItem("state");
        select.value = savedGameName;
        select.dispatchEvent(new Event('change'));

        if (window.localStorage.getItem("playerCount")) {
            currentPlayerCount = parseInt(window.localStorage.getItem("playerCount"), 10);
            const pcSelect = document.getElementById("playerCountSelect");
            if (pcSelect) {
                pcSelect.value = currentPlayerCount;
            }
        }

        if (savedState && savedGameName) {
            try {
                const game = APGames.GameFactory(savedGameName, savedState);
                const activeVariantUIDs = game.variants || [];

                Object.keys(selectedNonGroupVariants).forEach(uid => {
                    const checkbox = document.getElementById(`variant_${uid}`);
                    if (checkbox) {
                        const isActive = activeVariantUIDs.includes(uid);
                        checkbox.checked = isActive;
                        selectedNonGroupVariants[uid] = isActive;
                    }
                });

                const activeGroupVariants = {};
                activeVariantUIDs.forEach(uid => {
                    const radio = document.getElementById(`variant_${uid}`);
                    if (radio && radio.type === 'radio') {
                        activeGroupVariants[radio.name] = uid;
                    }
                });

                Object.keys(selectedGroupVariants).forEach(groupName => {
                    const activeUIDInGroup = activeGroupVariants[groupName];
                    if (activeUIDInGroup) {
                        const radioToSelect = document.getElementById(`variant_${activeUIDInGroup}`);
                        if (radioToSelect) {
                            const currentSelectedRadio = document.querySelector(`input[name="${groupName}"]:checked`);
                            if (currentSelectedRadio) {
                                currentSelectedRadio.checked = false;
                            }
                            radioToSelect.checked = true;
                            selectedGroupVariants[groupName] = activeUIDInGroup;
                        }
                    }
                });

                updateDisplayOptions(game);

            } catch (error) {
                console.error("Error restoring game state or variants/display:", error);
            }
        }

        renderGame();
    } else {
        renderGame();
    }
});
