(() => {
  const toggle = document.getElementById("adminMenuToggle");
  const sidebar = document.getElementById("adminSidebar");
  if (!toggle || !sidebar) return;

  const expanded = () => toggle.getAttribute("aria-expanded") === "true";
  const close = () => toggle.setAttribute("aria-expanded", "false");

  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    if (expanded()) {
      close();
    } else {
      toggle.setAttribute("aria-expanded", "true");
      sidebar.querySelector("nav a")?.focus();
    }
  });
  document.addEventListener("click", event => {
    if (expanded() && !sidebar.contains(event.target) && !toggle.contains(event.target)) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !expanded()) return;
    close();
    toggle.focus();
  });
  document.addEventListener("focusin", event => {
    if (expanded() && !sidebar.contains(event.target) && !toggle.contains(event.target)) close();
  });
  window.matchMedia("(max-width: 760px)").addEventListener("change", close);
})();
