

// SIFA mobile navigation menu — shared by all pages
function initializeSifaMenu() {
  const header = document.querySelector("header");
  const menu = header?.querySelector(".menu");
  const nav = header?.querySelector("nav");
  const list = nav?.querySelector("ul");
  if (!header || !menu || !nav || !list || menu.dataset.sifaMenuReady === "true") return;
  menu.dataset.sifaMenuReady = "true";
  menu.type = "button";
  menu.setAttribute("aria-controls", "sifa-main-navigation");
  list.id = list.id || "sifa-main-navigation";

  function setMenuOpen(isOpen) {
    list.classList.toggle("open", isOpen);
    menu.setAttribute("aria-expanded", String(isOpen));
    menu.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    menu.textContent = isOpen ? "✕" : "☰";
  }

  setMenuOpen(false);
  window.matchMedia("(max-width: 1350px)").addEventListener("change", () => setMenuOpen(false));
  menu.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(!list.classList.contains("open"));
  });

  list.addEventListener("click", function (event) {
    if (event.target.closest("a")) setMenuOpen(false);
  });

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") setMenuOpen(false);
  });

  document.addEventListener("click", function(event) {
    if (!header.contains(event.target)) setMenuOpen(false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeSifaMenu);
} else {
  initializeSifaMenu();
}

document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{
    const id=a.getAttribute('href');
    if(id.length>1){
      const el=document.querySelector(id);
      if (el) {
  e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth' });

  const nav = document.querySelector('header nav ul');
  const menu = document.querySelector('header .menu');

  nav?.classList.remove('open');

  if (menu) {
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open menu');
    menu.textContent = '☰';
  }
}
    }
  })
});

const year=document.querySelector('[data-year]');
if(year) year.textContent=new Date().getFullYear();

const apply=document.querySelector('#applicationForm');

