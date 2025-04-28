function boardClick(row, col, piece) {
    console.log("Row: " + row + ", Col: " + col + ", Piece: " + piece);
    var state = window.sessionStorage.getItem("state");
    var gamename = window.sessionStorage.getItem("gamename");
    var game = APGames.GameFactory(gamename, state);
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
        let renderOpts = {};
        let selectedDisplay = window.sessionStorage.getItem("selectedDisplay") || "default";
        const checkedDisplayRadio = document.querySelector('input[name="displayOption"]:checked');
        if (checkedDisplayRadio) {
            selectedDisplay = checkedDisplayRadio.value;
        }
        if (selectedDisplay !== "default") {
            renderOpts = { altDisplay: selectedDisplay };
        }
        game.move(result.move, {partial: true});
        var interim = JSON.stringify(game.render(renderOpts));
        window.sessionStorage.setItem("interim", interim);
    }
    renderGame();
    if (result.complete === 1 && document.getElementById("autoSubmit").checked) {
        document.getElementById("moveBtn").click();
    }
}

function boardClickSimultaneous(row, col, piece) {
    console.log("Row: " + row + ", Col: " + col + ", Piece: " + piece);
    var state = window.sessionStorage.getItem("state");
    var gamename = window.sessionStorage.getItem("gamename");
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
        let renderOpts = { perspective: 1 };
        let selectedDisplay = window.sessionStorage.getItem("selectedDisplay") || "default";
        const checkedDisplayRadio = document.querySelector('input[name="displayOption"]:checked');
        if (checkedDisplayRadio) {
            selectedDisplay = checkedDisplayRadio.value;
        }
        if (selectedDisplay !== "default") {
            renderOpts.altDisplay = selectedDisplay;
        }
        game.move(result.move + ",", {partial: true});
        var interim = JSON.stringify(game.render(renderOpts));
        window.sessionStorage.setItem("interim", interim);
    } else {
        window.sessionStorage.removeItem("interim");
    }
    renderGame();
    if (result.complete === 1 && document.getElementById("autoSubmit").checked) {
        document.getElementById("moveBtn").click();
    }
}

function boardClickVolcano(row, col, piece) {
    renderGame(col, row);
}

// --- Palette and Context Management ---
let customPalettes = [];
let currentPaletteColors = [];
let customContextLight = { background: "#fff", strokes: "#000", borders: "#000", labels: "#000", annotations: "#000", fill: "#000" };
let customContextDark = { background: "#222", strokes: "#6d6d6d", borders: "#000", labels: "#009fbf", annotations: "#99cccc", fill: "#e6f2f2" };
let selectedCustomPaletteName = null;
let draggedColor = null;

function loadPalettes() {
    const stored = window.sessionStorage.getItem("customPalettes");
    if (stored) {
        try {
            customPalettes = JSON.parse(stored);
        } catch (e) {
            console.error("Error loading custom palettes:", e);
            customPalettes = [];
        }
    } else {
        customPalettes = [];
    }
    updatePaletteDropdown();
    selectedCustomPaletteName = window.sessionStorage.getItem("selectedCustomPalette");
    const selectElement = document.getElementById("selectCustomPalette");
    if (selectElement) {
        if (selectedCustomPaletteName && customPalettes.some(p => p.name === selectedCustomPaletteName)) {
            selectElement.value = selectedCustomPaletteName;
        } else {
            selectElement.value = "";
        }
        const customRadio = document.getElementById('fillCustom');
        if (customRadio) {
            selectElement.disabled = !customRadio.checked;
        } else {
            selectElement.disabled = true;
        }
    }
}

function savePalettesToStorage() {
    window.sessionStorage.setItem("customPalettes", JSON.stringify(customPalettes));
    updatePaletteDropdown();
}

function updatePaletteDropdown() {
    const selectElement = document.getElementById("selectCustomPalette");
    const fillCustomRadio = document.getElementById('fillCustom');
    const fillCustomLabel = document.getElementById('fillCustomLabel');
    selectElement.innerHTML = "";

    if (customPalettes.length === 0) {
        selectElement.disabled = true;
        fillCustomRadio.disabled = true;
        if (fillCustomLabel) fillCustomLabel.classList.add("disabled-label");
        const noPalOpt = document.createElement('option');
        noPalOpt.value = "";
        noPalOpt.textContent = "No palettes available";
        noPalOpt.disabled = true;
        noPalOpt.selected = true;
        selectElement.appendChild(noPalOpt);
        selectElement.value = "";
        selectedCustomPaletteName = null;
        window.sessionStorage.removeItem("selectedCustomPalette");
        if (fillCustomRadio.checked) {
            document.getElementById('fillStandard').checked = true;
            window.sessionStorage.setItem("playerFill", "standard");
        }
    } else {
        fillCustomRadio.disabled = false;
        if (fillCustomLabel) fillCustomLabel.classList.remove("disabled-label");
        selectElement.disabled = false;
        customPalettes.forEach(p => {
            const option = document.createElement('option');
            option.value = p.name;
            option.textContent = p.name;
            selectElement.appendChild(option);
        });
        selectedCustomPaletteName = window.sessionStorage.getItem("selectedCustomPalette");
        if (selectedCustomPaletteName && customPalettes.some(p => p.name === selectedCustomPaletteName)) {
            selectElement.value = selectedCustomPaletteName;
        } else {
            selectElement.selectedIndex = 0;
            selectedCustomPaletteName = selectElement.value;
            window.sessionStorage.setItem("selectedCustomPalette", selectedCustomPaletteName);
        }
    }
}

function loadContexts() {
    const storedLight = window.sessionStorage.getItem("customContextLight");
    const storedDark = window.sessionStorage.getItem("customContextDark");
    if (storedLight) {
        try {
            customContextLight = JSON.parse(storedLight);
        } catch (e) { console.error("Error loading light context:", e); }
    }
    if (storedDark) {
        try {
            customContextDark = JSON.parse(storedDark);
        } catch (e) { console.error("Error loading dark context:", e); }
    }
}

function saveContextsToStorage() {
    window.sessionStorage.setItem("customContextLight", JSON.stringify(customContextLight));
    window.sessionStorage.setItem("customContextDark", JSON.stringify(customContextDark));
}

function showPaletteModal() {
    populateSavedPalettesList();
    document.getElementById("paletteModal").style.display = "block";
    document.body.style.overflow = 'hidden';
}

function hidePaletteModal() {
    document.getElementById("paletteModal").style.display = "none";
    document.body.style.overflow = '';
    document.getElementById("paletteNameInput").value = "";
    document.getElementById("paletteColorInput").value = "";
    currentPaletteColors = [];
    updateCurrentPaletteColorDisplay();
}

function showContextModal() {
    document.getElementById("contextModal").style.display = "block";
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
        loadContextForEditing(document.getElementById("selectContextMode").value);
    }, 50);
}

function hideContextModal() {
    document.getElementById("contextModal").style.display = "none";
    document.body.style.overflow = '';
}

function addColourToCurrentPalette() {
    const colorInput = document.getElementById("paletteColorInput");
    const color = colorInput.value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(color) && !currentPaletteColors.includes(color)) {
        currentPaletteColors.push(color);
        updateCurrentPaletteColorDisplay();
    } else if (currentPaletteColors.includes(color)) {
        alert("Color already added to this palette.");
    } else {
        alert("Invalid color value.");
    }
}

function deleteColourFromCurrentPalette(color) {
    currentPaletteColors = currentPaletteColors.filter(c => c !== color);
    updateCurrentPaletteColorDisplay();
}

function updateCurrentPaletteColorDisplay() {
    const container = document.getElementById("currentPaletteColors");
    container.innerHTML = "";
    currentPaletteColors.forEach((color, index) => {
        const swatch = document.createElement('span');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.textContent = `P${index + 1}`;
        swatch.title = `Click to remove ${color}. Drag to reorder.`;
        swatch.dataset.color = color;
        swatch.dataset.index = index;
        swatch.draggable = true;

        swatch.addEventListener('dragstart', handleDragStart);
        swatch.addEventListener('dragover', handleDragOver);
        swatch.addEventListener('drop', handleDrop);
        swatch.addEventListener('dragend', handleDragEnd);
        swatch.addEventListener('dragenter', handleDragEnter);
        swatch.addEventListener('dragleave', handleDragLeave);

        swatch.addEventListener('click', (e) => {
            if (e.target === swatch) {
                deleteColourFromCurrentPalette(color);
            }
        });

        container.appendChild(swatch);
    });
}

// Drag and Drop Handlers for palette color reordering
function handleDragStart(e) {
    draggedColor = e.target.dataset.color;
    e.target.classList.add('dragging');
    e.dataTransfer.setData('text/plain', draggedColor);
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (e.target.classList.contains('color-swatch') && e.target.dataset.color !== draggedColor) {
        e.target.classList.add('drag-over-target');
    }
}

function handleDragLeave(e) {
    if (e.target.classList.contains('color-swatch')) {
        e.target.classList.remove('drag-over-target');
    }
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetSwatch = e.target.closest('.color-swatch');
    targetSwatch.classList.remove('drag-over-target');

    if (!targetSwatch || targetSwatch.dataset.color === draggedColor) {
        return;
    }

    const droppedColor = draggedColor;
    const targetColor = targetSwatch.dataset.color;

    const draggedIndex = currentPaletteColors.indexOf(droppedColor);
    const targetIndex = currentPaletteColors.indexOf(targetColor);

    if (draggedIndex !== -1 && targetIndex !== -1) {
        currentPaletteColors.splice(draggedIndex, 1);
        currentPaletteColors.splice(targetIndex, 0, droppedColor);
        updateCurrentPaletteColorDisplay();
    }
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.color-swatch.drag-over-target').forEach(el => {
        el.classList.remove('drag-over-target');
    });
    draggedColor = null;
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

function saveOrUpdatePalette() {
    const nameInput = document.getElementById("paletteNameInput");
    const name = nameInput.value.trim();
    if (!name) {
        showModalStatus("paletteModalStatus", "Palette name cannot be empty.", true);
        return;
    }
    if (currentPaletteColors.length < 2) {
        showModalStatus("paletteModalStatus", "A palette must have at least two colors.", true);
        return;
    }

    const existingIndex = customPalettes.findIndex(p => p.name === name);
    if (existingIndex > -1) {
        customPalettes[existingIndex].colours = [...currentPaletteColors];
        showModalStatus("paletteModalStatus", "Palette updated.");
    } else {
        customPalettes.push({ name: name, colours: [...currentPaletteColors] });
        showModalStatus("paletteModalStatus", "Palette saved.");
    }
    savePalettesToStorage();
    populateSavedPalettesList();
    nameInput.value = "";
    currentPaletteColors = [];
    updateCurrentPaletteColorDisplay();
}

function deletePalette(name) {
    customPalettes = customPalettes.filter(p => p.name !== name);
    savePalettesToStorage();
    populateSavedPalettesList();
    if (selectedCustomPaletteName === name) {
        selectedCustomPaletteName = null;
        window.sessionStorage.removeItem("selectedCustomPalette");
        document.getElementById("selectCustomPalette").value = "";
        renderGame();
    }
    showModalStatus("paletteModalStatus", "Palette deleted.");
}

function loadPaletteForEditing(name) {
    const palette = customPalettes.find(p => p.name === name);
    if (palette) {
        document.getElementById("paletteNameInput").value = palette.name;
        currentPaletteColors = [...palette.colours];
        updateCurrentPaletteColorDisplay();
    }
}

function populateSavedPalettesList() {
    const listElement = document.getElementById("savedPalettesList");
    listElement.innerHTML = "";

    if (customPalettes.length === 0) {
        listElement.innerHTML = '<li class="no-palettes-message">No custom palettes saved yet.</li>';
        return;
    }

    customPalettes.forEach(p => {
        const li = document.createElement('li');
        const infoDiv = document.createElement('div');
        infoDiv.className = 'palette-list-item-info';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        infoDiv.appendChild(nameSpan);

        p.colours.forEach((color, index) => {
            const swatch = document.createElement('span');
            swatch.className = 'color-swatch-small';
            swatch.style.backgroundColor = color;
            swatch.title = `P${index + 1}: ${color}`;
            swatch.textContent = `P${index + 1}`;
            infoDiv.appendChild(swatch);
        });
        li.appendChild(infoDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'palette-list-item-actions';

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Load for Editing';
        editBtn.className = 'button is-small is-inline';
        editBtn.onclick = () => loadPaletteForEditing(p.name);
        actionsDiv.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'button is-small is-danger is-inline';
        deleteBtn.onclick = () => deletePalette(p.name);
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(actionsDiv);

        listElement.appendChild(li);
    });
}

function loadContextForEditing(mode) {
    const context = (mode === 'dark') ? customContextDark : customContextLight;
    const fields = ["Background", "Fill", "Strokes", "Borders", "Labels", "Annotations"];
    fields.forEach(field => {
        const key = field.toLowerCase();
        const colorInput = document.getElementById(`context${field}`);
        const hexInput = document.getElementById(`context${field}HexInput`);
        if (context[key]) {
            colorInput.value = context[key];
            hexInput.value = context[key];
        } else {
            colorInput.value = '#000000';
            hexInput.value = '#000000';
        }
    });
    renderContextSample();
}

function saveContext() {
    const mode = document.getElementById("selectContextMode").value;
    const contextToSave = {};
    let isValid = true;
    const fields = ["Background", "Fill", "Strokes", "Borders", "Labels", "Annotations"];
    fields.forEach(field => {
        const input = document.getElementById(`context${field}`);
        const value = input.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
            contextToSave[field.toLowerCase()] = value;
        } else {
            showModalStatus("contextModalStatus", `Invalid hex color for ${field}: ${value}`, true);
            isValid = false;
        }
    });

    if (isValid) {
        if (mode === 'dark') {
            customContextDark = contextToSave;
        } else {
            customContextLight = contextToSave;
        }
        saveContextsToStorage();
        renderGame();
        showModalStatus("contextModalStatus", "Context saved.");
    }
}

function resetContext() {
    const mode = document.getElementById("selectContextMode").value;
    if (mode === 'dark') {
        customContextDark = { background: "#222", strokes: "#6d6d6d", borders: "#000", labels: "#009fbf", annotations: "#99cccc", fill: "#e6f2f2" };
    } else {
        customContextLight = { background: "#fff", strokes: "#000", borders: "#000", labels: "#000", annotations: "#000", fill: "#000" };
    }
    saveContextsToStorage();
    loadContextForEditing(mode);
    renderGame();
    showModalStatus("contextModalStatus", "Context reset to defaults.");
}

function renderContextSample() {
    const sampleDiv = document.getElementById("contextSampleRender");
    sampleDiv.innerHTML = "";
    const mode = document.getElementById("selectContextMode").value;
    const currentContextInModal = {};
    const fields = ["Background", "Fill", "Strokes", "Borders", "Labels", "Annotations"];
    let isValid = true;

    fields.forEach(field => {
        const key = field.toLowerCase();
        const input = document.getElementById(`context${field}`);
        const value = input.value;
        const hexInput = document.getElementById(`context${field}HexInput`);
        hexInput.value = value;
        if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
            currentContextInModal[key] = value;
        } else {
            isValid = false;
        }
    });

    if (!isValid) {
        sampleDiv.textContent = "Invalid hex code detected.";
        sampleDiv.style.backgroundColor = "inherit";
        return;
    }

    sampleDiv.style.backgroundColor = currentContextInModal.background;

    // Minimal sample data for context preview
    const json = JSON.parse(
        `{"board":{"style":"squares-checkered","width":3,"height":3},"legend":{"A":{"name":"piece","colour":1},"B":{"name":"piece","colour":2}},"pieces":"A-B\\n-A-\\nB-A","annotations":[{"type":"move","targets":[{"row":0,"col":0},{"row":1,"col":1}]}]}`
      );
    const options = {
        divid: "contextSampleRender",
        svgid: "contextSampleSVG",
        colourContext: currentContextInModal,
        height: "180px",
        width: "100%",
        preserveAspectRatio: "xMidYMid meet"
    };
    try {
        APRender.render(json, options);
    } catch (e) {
        console.error("Error rendering context sample:", e);
        sampleDiv.textContent = "Error rendering sample.";
    }
}

// --- End Palette and Context Management ---

function renderGame(...args) {
    var myNode = document.getElementById("drawing");
    while (myNode.lastChild) {
        myNode.removeChild(myNode.lastChild);
    }
    var options = args[2] || {divid: "drawing"};
    options.divid = "drawing";

    const isDark = window.sessionStorage.getItem("darkMode") === "true";
    loadContexts();
    const currentContext = isDark ? customContextDark : customContextLight;
    if (!options.hasOwnProperty("colourContext")) {
        options.colourContext = { ...currentContext };
    }

    if (options.colourContext && options.colourContext.background) {
        myNode.style.backgroundColor = options.colourContext.background;
    } else {
        myNode.style.backgroundColor = "";
    }

    var radio = document.querySelector('input[name="playerfill"]:checked').value;
    if (radio === "blind") {
        options.colourBlind = true;
    } else if (radio === "patterns") {
        options.patterns = true;
    } else if (radio === "custom") {
        const selectedPaletteName = document.getElementById("selectCustomPalette").value;
        const selectedPalette = customPalettes.find(p => p.name === selectedPaletteName);
        if (selectedPalette && selectedPalette.colours && selectedPalette.colours.length > 0) {
            options.colours = selectedPalette.colours;
        } else {
            console.warn("Custom palette selected but not found or invalid. Using default colors.");
        }
    }

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
    var state = window.sessionStorage.getItem("state");
    const displayOptionsContainer = document.getElementById("displayOptionsContainer");
    const clickStatusBox = document.getElementById("clickstatus");

    let selectedDisplay = window.sessionStorage.getItem("selectedDisplay") || "default";
    const checkedDisplayRadio = document.querySelector('input[name="displayOption"]:checked');
    if (checkedDisplayRadio) {
        selectedDisplay = checkedDisplayRadio.value;
    }

    if (state !== null) {
        var gamename = window.sessionStorage.getItem("gamename");
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

        if (gamename === "entropy") {
            options.boardClick = boardClickSimultaneous;
        }
        var game = APGames.GameFactory(gamename, state);

        if (displayOptionsContainer && displayOptionsContainer.children.length > 0) {
            displayOptionsContainer.style.display = 'block';
        }

        var data = JSON.parse(window.sessionStorage.getItem("interim"));

        let renderOpts = {};
        if (selectedDisplay !== "default") {
            renderOpts = { altDisplay: selectedDisplay };
        }
        if (data === null) {
            data = game.render(renderOpts);
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

        var movelst = game.moveHistory();
        var div = document.getElementById("moveHistory");
        if (Array.isArray(movelst)) {
            div.innerHTML = movelst.map((x) => {
                if (Array.isArray(x)) {
                    return "[" + x.join(", ") + "]";
                }
                return "[invalid move entry]";
            }).join(" ");
        } else {
            div.innerHTML = "[move history unavailable]";
        }

        var status = game.status();
        if (typeof game.chatLog === "function") {
            var results = game.chatLog(["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Judy"]).reverse().slice(0, 5).map(e => e.join(" "));
            if (results.length > 0) {
                status += "\n\n* " + results.join("\n* ") + "\n\n&hellip;";
            }
        } else if (typeof game.resultsHistory === "function") {
            var results = game.resultsHistory().reverse().slice(0, 5);
            if (results.length > 0) {
                status += "\n\n* " + results.map((x) => { return JSON.stringify(x); }).join("\n* ") + "\n\n&hellip;";
            }
        }
        var statusbox = document.getElementById("status");
        var converter = new showdown.Converter();
        statusbox.innerHTML = converter.makeHtml(status);
    } else {
        if (displayOptionsContainer) {
            displayOptionsContainer.style.display = 'none';
        }
    }

    return false;
}

// Redo stack management
function getRedoStack() {
    const stackJSON = window.sessionStorage.getItem("redoStack");
    return stackJSON ? JSON.parse(stackJSON) : [];
}

function setRedoStack(stack) {
    window.sessionStorage.setItem("redoStack", JSON.stringify(stack));
}

function clearRedoStack() {
    window.sessionStorage.removeItem("redoStack");
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
    window.sessionStorage.setItem("darkMode", isDark ? "true" : "false");
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    renderGame();
    document.getElementById("darkMode").textContent = isDark ? "Light Mode" : "Dark Mode";
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

            const savedDisplay = window.sessionStorage.getItem("selectedDisplay") || "default";
            const displayRadio = document.getElementById(`display_${savedDisplay}`);
            if (displayRadio) {
                displayRadio.checked = true;
            } else {
                const defaultDisplayRadio = document.getElementById('display_default');
                if (defaultDisplayRadio) {
                    defaultDisplayRadio.checked = true;
                    window.sessionStorage.setItem("selectedDisplay", "default");
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
    const savedAutoSubmit = window.sessionStorage.getItem("autoSubmit");
    if (savedAutoSubmit !== null) {
        autoSubmitCheckbox.checked = savedAutoSubmit === "true";
    }

    const savedPlayerFill = window.sessionStorage.getItem("playerFill");
    if (savedPlayerFill !== null) {
        const playerFillRadio = document.querySelector(`input[name="playerfill"][value="${savedPlayerFill}"]`);
        if (playerFillRadio) {
            playerFillRadio.checked = true;
        }
    }

    const rotationInput = document.getElementById("rotation");
    const savedRotation = window.sessionStorage.getItem("rotation");
    if (savedRotation !== null) {
        rotationInput.value = savedRotation;
    }

    const annotateCheckbox = document.getElementById("annotate");
    const savedAnnotate = window.sessionStorage.getItem("annotate");
    if (savedAnnotate !== null) {
        annotateCheckbox.checked = savedAnnotate === "true";
    }

    const detailsElements = document.querySelectorAll('.sidebar details');
    detailsElements.forEach(details => {
        const savedOpenState = window.sessionStorage.getItem(`detailsOpen_${details.id}`);
        if (savedOpenState !== null) {
            details.open = savedOpenState === "true";
        }
    });

    loadPalettes();
    loadContexts();

    const isDark = window.sessionStorage.getItem("darkMode") === "true";
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
        window.sessionStorage.setItem("autoSubmit", autoSubmitCheckbox.checked);
    });

    document.getElementsByName("playerfill").forEach(el => {
        el.addEventListener("change", (event) => {
            if (event.target.checked) {
                window.sessionStorage.setItem("playerFill", event.target.value);
                const customSelect = document.getElementById("selectCustomPalette");
                const fillCustomRadio = document.getElementById("fillCustom");
                const fillCustomLabel = document.getElementById("fillCustomLabel");
                if (customPalettes.length === 0) {
                    customSelect.disabled = true;
                    fillCustomRadio.disabled = true;
                    if (fillCustomLabel) fillCustomLabel.classList.add("disabled-label");
                    if (fillCustomRadio.checked) {
                        document.getElementById('fillStandard').checked = true;
                        window.sessionStorage.setItem("playerFill", "standard");
                    }
                } else {
                    customSelect.disabled = false;
                    fillCustomRadio.disabled = false;
                    if (fillCustomLabel) fillCustomLabel.classList.remove("disabled-label");
                }
                renderGame();
            }
        });
    });

    document.getElementById("selectCustomPalette").addEventListener("change", (event) => {
        selectedCustomPaletteName = event.target.value;
        window.sessionStorage.setItem("selectedCustomPalette", selectedCustomPaletteName);
        if (selectedCustomPaletteName) {
            document.getElementById('fillCustom').checked = true;
            window.sessionStorage.setItem("playerFill", "custom");
            renderGame();
        }
    });

    rotationInput.addEventListener("input", () => {
        window.sessionStorage.setItem("rotation", rotationInput.value);
        renderGame();
    });

    annotateCheckbox.addEventListener("change", () => {
        window.sessionStorage.setItem("annotate", annotateCheckbox.checked);
        renderGame();
    });

    detailsElements.forEach(details => {
        details.addEventListener("toggle", () => {
            window.sessionStorage.setItem(`detailsOpen_${details.id}`, details.open);
        });
    });

    const savedPlayerCount = window.sessionStorage.getItem("playerCount");
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
                window.sessionStorage.setItem("playerCount", currentPlayerCount);
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
                window.sessionStorage.removeItem("interim");
                window.sessionStorage.setItem("selectedDisplay", event.target.value);
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
                window.sessionStorage.setItem("playerCount", playerCount);
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

        window.sessionStorage.setItem("state", game.serialize());
        window.sessionStorage.setItem("gamename", gameUid);
        window.sessionStorage.removeItem("interim");
        clearRedoStack();
        window.sessionStorage.setItem("selectedDisplay", "default");

        updateDisplayOptions(game);

        var movebox = document.getElementById("moveEntry");
        movebox.value = "";
        movebox.classList.remove("move-incomplete", "move-ready");
        var result = game.validateMove("");
        var resultStr = '<p style="color: #888">' + result.message + '</p>';
        var statusbox = document.getElementById("clickstatus");
        statusbox.innerHTML = resultStr;
        const isDark = window.sessionStorage.getItem("darkMode") === "true";
        if (isDark) {
            setDarkMode(true);
        } else {
            renderGame();
        }
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
                        window.sessionStorage.setItem("playerCount", injectedPlayerCount);
                        currentPlayerCount = injectedPlayerCount;
                    }
                    const game = APGames.GameFactory(meta, parsed.numplayers || undefined, undefined);
                    if (game !== undefined) {
                        field.value = "";
                        window.sessionStorage.setItem("state", game.serialize());
                        window.sessionStorage.setItem("gamename", meta);
                        window.sessionStorage.removeItem("interim");
                        clearRedoStack();
                        window.sessionStorage.setItem("selectedDisplay", "default");

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
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
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
                    alert("An error occurred: " + err.message);
                }
                console.log("Game state: "+state);
            }
            if (! waserror) {
                movebox.value = "";
                var result = game.validateMove("");
                var resultStr = '<p style="color: #888">' + result.message + '</p>';
                var statusbox = document.getElementById("clickstatus");
                statusbox.innerHTML = resultStr;
            }
            window.sessionStorage.setItem("state", game.serialize());
            window.sessionStorage.removeItem("interim");
            renderGame();
        }
    });

    document.getElementById("moveRandom").addEventListener("click", () => {
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
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
                var result = game.validateMove("");
                var resultStr = '<p style="color: #888">' + result.message + '</p>';
                var statusbox = document.getElementById("clickstatus");
                statusbox.innerHTML = resultStr;
            } catch (err) {
                if (err.name === "UserFacingError") {
                    var resultStr = '<p style="color: #f00">ERROR: ' + err.client + '</p>';
                    var statusbox = document.getElementById("clickstatus");
                    statusbox.innerHTML = resultStr;
                } else {
                    alert("An error occurred: " + err.message);
                }
                console.log("Game state: "+state);
            }
            window.sessionStorage.setItem("state", game.serialize());
            window.sessionStorage.removeItem("interim");
            renderGame();
        }
    });

    document.getElementById("moveClear").addEventListener("click", () => {
        window.sessionStorage.removeItem("interim");
        var movebox = document.getElementById("moveEntry");
        movebox.value = "";
        renderGame();
    });

    document.getElementById("moveUndo").addEventListener("click", () => {
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
            var game = APGames.GameFactory(gamename, state);
            try {
                if (game.stack.length > 1) {
                    const moveToUndo = game.lastmove;

                    game.undo();
                    game.gameover = false;
                    game.winner = [];
                    window.sessionStorage.setItem("state", game.serialize());
                    window.sessionStorage.removeItem("interim");

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
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            let redoStack = getRedoStack();
            if (redoStack.length > 0) {
                const moveToRedo = redoStack.pop();
                setRedoStack(redoStack);

                var gamename = window.sessionStorage.getItem("gamename");
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
                    var result = game.validateMove("");
                    var resultStr = '<p style="color: #888">' + result.message + '</p>';
                    var statusbox = document.getElementById("clickstatus");
                    statusbox.innerHTML = resultStr;

                    window.sessionStorage.setItem("state", game.serialize());
                    window.sessionStorage.removeItem("interim");
                    renderGame();
                }
            }
        }
    });

    document.getElementById("aiFast").addEventListener("click", () => {
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
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
                    window.sessionStorage.setItem("state", game.serialize());
                    window.sessionStorage.removeItem("interim");
                    renderGame();
                } else {
                    alert("This game does not support fast AI.");
                }
            }
        }
    });

    document.getElementById("aiSlow").addEventListener("click", () => {
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
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
                    window.sessionStorage.setItem("state", game.serialize());
                    window.sessionStorage.removeItem("interim");
                    renderGame();
                } else {
                    alert("This game does not support slow AI.");
                }
            }
        }
    });

    document.getElementById("saveSVG").addEventListener("click", () => {
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
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
        modalContent.textContent = "";
        delete modal.dataset.filename;
        delete modal.dataset.rawJson;
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
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            try {
                const parsedState = JSON.parse(state);
                const prettyState = JSON.stringify(parsedState, null, 2);
                const gamename = window.sessionStorage.getItem("gamename") || "game";
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
        var state = window.sessionStorage.getItem("state");
        if (state !== null) {
            var gamename = window.sessionStorage.getItem("gamename");
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
        window.sessionStorage.setItem("sidebarCollapsed", isCollapsed);
        // Ensure the edge detection class is removed when sidebar is open
        if (!isCollapsed) {
            collapseBtn.classList.remove('show-edge');
        }
    }

    // Initial setup
    const initiallyCollapsed = window.sessionStorage.getItem("sidebarCollapsed") === "true";
    setSidebarState(initiallyCollapsed);

    // Event listener for the original collapse button
    collapseBtn.addEventListener('click', () => {
        const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
        setSidebarState(!isCurrentlyCollapsed); // Toggle state
    });

    // Event listener for the open sidebar button
    openSidebarBtn.addEventListener('click', () => {
        setSidebarState(false); // Force open
    });

    document.addEventListener('mousemove', (e) => {
        const threshold = 20;
        if (sidebar.classList.contains('collapsed')) {
            if (e.clientX <= threshold) {
                collapseBtn.classList.add('show-edge');
            } else {
                collapseBtn.classList.remove('show-edge');
            }
        } else {
            collapseBtn.classList.remove('show-edge');
        }
    });

    document.getElementById("darkMode").addEventListener("click", () => {
        const isDark = window.sessionStorage.getItem("darkMode") === "true";
        setDarkMode(!isDark);
    });

    document.getElementById("passBtn").addEventListener("click", () => {
        const moveEntry = document.getElementById("moveEntry");
        moveEntry.value = "pass";
        document.getElementById("moveBtn").click();
    });

    document.getElementById("managePalettesBtn").addEventListener("click", showPaletteModal);
    document.getElementById("paletteModalCloseBtn").addEventListener("click", hidePaletteModal);
    document.getElementById("paletteModal").addEventListener("click", (event) => {
        if (event.target === document.getElementById("paletteModal")) hidePaletteModal();
    });
    const paletteColorInput = document.getElementById("paletteColorInput");
    const paletteColorHexInput = document.getElementById("paletteColorHexInput");

    paletteColorInput.addEventListener("input", () => {
        paletteColorHexInput.value = paletteColorInput.value;
    });
    paletteColorHexInput.addEventListener("input", () => {
        let val = paletteColorHexInput.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            paletteColorInput.value = val;
        }
    });
    paletteColorHexInput.value = paletteColorInput.value;

    document.getElementById("addPaletteColorBtn").addEventListener("click", addColourToCurrentPalette);
    document.getElementById("savePaletteBtn").addEventListener("click", saveOrUpdatePalette);
    document.getElementById("paletteModalSaveAndCloseBtn").addEventListener("click", () => {
        hidePaletteModal();
    });

    document.getElementById("manageContextsBtn").addEventListener("click", showContextModal);
    document.getElementById("contextModalCloseBtn").addEventListener("click", hideContextModal);
    document.getElementById("contextModal").addEventListener("click", (event) => {
        if (event.target === document.getElementById("contextModal")) hideContextModal();
    });
    document.getElementById("selectContextMode").addEventListener("change", (event) => {
        loadContextForEditing(event.target.value);
    });
    document.getElementById("saveContextBtn").addEventListener("click", saveContext);
    document.getElementById("resetContextBtn").addEventListener("click", resetContext);
    ["Background", "Fill", "Strokes", "Borders", "Labels", "Annotations"].forEach(field => {
        const colorInput = document.getElementById(`context${field}`);
        const hexInput = document.getElementById(`context${field}HexInput`);
        colorInput.addEventListener("input", () => {
            hexInput.value = colorInput.value;
            renderContextSample();
        });
        hexInput.addEventListener("input", () => {
            let val = hexInput.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                colorInput.value = val;
                renderContextSample();
            }
        });
        hexInput.value = colorInput.value;
    });

    document.addEventListener("keydown", function(event) {
        if (event.key === "Escape") {
            let closed = false;
            if (modal.style.display === "block") {
                hideModal();
                closed = true;
            }
            const paletteModal = document.getElementById("paletteModal");
            if (paletteModal && paletteModal.style.display === "block") {
                hidePaletteModal();
                closed = true;
            }
            const contextModal = document.getElementById("contextModal");
            if (contextModal && contextModal.style.display === "block") {
                hideContextModal();
                closed = true;
            }
            if (closed) {
                event.preventDefault();
            }
        }
    });

    if (window.sessionStorage.getItem("gamename")) {
        const savedGameName = window.sessionStorage.getItem("gamename");
        const savedState = window.sessionStorage.getItem("state");
        select.value = savedGameName;
        select.dispatchEvent(new Event('change'));

        if (window.sessionStorage.getItem("playerCount")) {
            currentPlayerCount = parseInt(window.sessionStorage.getItem("playerCount"), 10);
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

        const savedPlayerFill = window.sessionStorage.getItem("playerFill");
        const customSelect = document.getElementById("selectCustomPalette");
        const fillCustomRadio = document.getElementById("fillCustom");
        const fillCustomLabel = document.getElementById("fillCustomLabel");
        if (savedPlayerFill) {
            const fillRadio = document.querySelector(`input[name="playerfill"][value="${savedPlayerFill}"]`);
            if (fillRadio) {
                fillRadio.checked = true;
            }
        }
        if (customPalettes.length === 0) {
            customSelect.disabled = true;
            fillCustomRadio.disabled = true;
            if (fillCustomLabel) fillCustomLabel.classList.add("disabled-label");
            if (fillCustomRadio.checked) {
                document.getElementById('fillStandard').checked = true;
                window.sessionStorage.setItem("playerFill", "standard");
            }
        } else {
            customSelect.disabled = false;
            fillCustomRadio.disabled = false;
            if (fillCustomLabel) fillCustomLabel.classList.remove("disabled-label");
        }

        renderGame();
    } else {
        const customSelect = document.getElementById("selectCustomPalette");
        const fillCustomRadio = document.getElementById('fillCustom');
        const fillCustomLabel = document.getElementById("fillCustomLabel");
        if (customPalettes.length === 0) {
            customSelect.disabled = true;
            fillCustomRadio.disabled = true;
            if (fillCustomLabel) fillCustomLabel.classList.add("disabled-label");
        } else {
            fillCustomRadio.disabled = false;
            if (fillCustomLabel) fillCustomLabel.classList.remove("disabled-label");
            customSelect.disabled = !fillCustomRadio.checked;
        }
        renderGame();
    }
});
