/** Phase 0 smoke: Vite resolves the gameslib source alias (full import in Phase 1). */
const status = document.getElementById("status");
if (status) {
    status.textContent = "Vite dev server OK — wire @abstractplay/gameslib in Phase 1.";
}
