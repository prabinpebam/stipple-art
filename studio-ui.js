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
