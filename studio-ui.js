(() => {
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  let preference = null;

  try {
    const stored = localStorage.getItem("stipple-theme");
    if (stored === "light" || stored === "dark") preference = stored;
  } catch (error) {
    console.warn("Theme preference cannot be read; using the system theme.", error);
  }
  if (param === "light" || param === "dark") preference = param;

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const toggle = document.getElementById("themeToggle");
    const nextTheme = theme === "dark" ? "light" : "dark";
    if (toggle) {
      toggle.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
      document.getElementById("themeLabel").textContent = `${nextTheme === "dark" ? "Dark" : "Light"} mode`;
    }
  }

  applyTheme(preference || (systemTheme.matches ? "dark" : "light"));
  systemTheme.addEventListener("change", event => {
    if (!preference) applyTheme(event.matches ? "dark" : "light");
  });

  document.addEventListener("DOMContentLoaded", () => {
    const studio = document.querySelector(".studio");
    const workspace = document.getElementById("previewWorkspace");
    const settings = document.getElementById("settingsPanel");
    const actions = document.querySelector(".action-panel");
    const mobileLayout = matchMedia("(max-width: 1023px)");
    const previewView = document.getElementById("previewViewButton");
    const settingsView = document.getElementById("settingsViewButton");
    function updateViewportHeight() {
      if (mobileLayout.matches && window.visualViewport) {
        root.style.setProperty("--studio-height", `${window.visualViewport.height}px`);
      } else root.style.removeProperty("--studio-height");
    }
    const phone = StudioRuntime.phoneProfile(innerWidth, matchMedia("(pointer: coarse)").matches);
    root.dataset.phone = String(phone);
    if (phone) {
      document.getElementById("stippleCount").value = "10000";
      document.querySelector('input[name="resolutionOption"][value="1024"]').checked = true;
      document.getElementById("particleSound").checked = false;
    }
    function applyView() {
      updateViewportHeight();
      const showSettings = mobileLayout.matches && studio.dataset.mobileView === "settings";
      workspace.inert = showSettings;
      settings.inert = mobileLayout.matches && !showSettings;
      previewView.setAttribute("aria-pressed", String(!showSettings));
      settingsView.setAttribute("aria-pressed", String(showSettings));
      if (mobileLayout.matches) studio.append(actions);
      else settings.append(actions);
      document.dispatchEvent(new Event("studio-view-change"));
    }
    function switchView(view) {
      studio.dataset.mobileView = view;
      applyView();
      (view === "preview" ? previewView : settingsView).focus({ preventScroll: true });
    }
    previewView.addEventListener("click", () => switchView("preview"));
    settingsView.addEventListener("click", () => switchView("settings"));
    document.addEventListener("studio-show-preview", () => switchView("preview"));
    document.addEventListener("studio-show-settings", () => switchView("settings"));
    mobileLayout.addEventListener("change", applyView);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", updateViewportHeight);
    applyView();
    applyTheme(root.dataset.theme);
    document.getElementById("themeToggle").addEventListener("click", () => {
      preference = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(preference);
      try {
        localStorage.setItem("stipple-theme", preference);
      } catch (error) {
        console.warn("Theme preference cannot be saved; it applies to this visit only.", error);
      }
    });

    document.querySelectorAll(".range").forEach(slider => {
      const update = () => {
        document.getElementById(`${slider.id}Val`).textContent = slider.value;
        const fill = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100;
        slider.style.setProperty("--fill", `${fill}%`);
      };
      slider.addEventListener("input", update);
      update();
    });

    document.getElementById("emptyUploadButton").addEventListener("click", () => {
      document.getElementById("imageUpload").click();
    });

    const resolutionButton = document.getElementById("resolutionButton");
    const resolutionPopover = document.getElementById("resolutionPopover");
    resolutionPopover.addEventListener("beforetoggle", event => {
      if (event.newState !== "open") return;
      const bounds = resolutionButton.getBoundingClientRect();
      const width = Math.min(352, innerWidth - 32);
      resolutionPopover.style.left = `${Math.max(16, Math.min(bounds.left, innerWidth - width - 16))}px`;
      const above = bounds.top - 24;
      resolutionPopover.style.bottom = above >= 180 ? `${Math.max(16, innerHeight - bounds.top + 8)}px` : "auto";
      resolutionPopover.style.top = above >= 180 ? "auto" : "16px";
      resolutionPopover.style.maxHeight = `${above >= 180 ? above : innerHeight - 32}px`;
    });
    resolutionPopover.addEventListener("toggle", event => {
      resolutionButton.setAttribute("aria-expanded", String(event.newState === "open"));
    });
    resolutionPopover.addEventListener("change", () => {
      resolutionPopover.hidePopover();
      resolutionButton.focus({ preventScroll: true });
    });
    window.addEventListener("resize", () => {
      if (resolutionPopover.matches(":popover-open")) resolutionPopover.hidePopover();
    });
    document.addEventListener("studio-view-change", () => {
      if (resolutionPopover.matches(":popover-open")) resolutionPopover.hidePopover();
    });

    const stage = document.getElementById("renderArea");
    stage.addEventListener("dragenter", event => {
      event.preventDefault();
      stage.classList.add("is-dragging");
    });
    stage.addEventListener("dragover", event => event.preventDefault());
    stage.addEventListener("dragleave", event => {
      if (!stage.contains(event.relatedTarget)) stage.classList.remove("is-dragging");
    });
    stage.addEventListener("drop", () => stage.classList.remove("is-dragging"));
  });
})();
