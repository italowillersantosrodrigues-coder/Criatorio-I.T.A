// public/js/site.js
(() => {
  const contentEl = document.getElementById('content');
  const navBtns = document.querySelectorAll('.nav-btn');

  // pages available (files in /pages/*.html)
  const PAGES = ['home','doencas','medicamentos','racoes','incubacao','manejo','aves'];

  // key onde salvamos overrides (admin edits)
  const STORAGE_PREFIX = 'ciata_page_'; // + pageName

  // helper: fetch page file or fallback to saved override
  async function loadPage(page) {
    // check overrides first
    const override = localStorage.getItem(STORAGE_PREFIX + page);
    if (override) {
      return override;
    }
    try {
      const r = await fetch(`/pages/${page}.html`);
      if (!r.ok) throw new Error('not found');
      return await r.text();
    } catch (err) {
      return `<div class="p-6"><h2 class="text-xl font-semibold">Página não encontrada</h2><p>Arquivo /pages/${page}.html não existe.</p></div>`;
    }
  }

  async function showPage(page) {
    contentEl.innerHTML = `<div class="p-6">Carregando...</div>`;
    const html = await loadPage(page);
    // sanitize minimal: inject as-is (admin controls what is edited)
    contentEl.innerHTML = html;
    // set active nav styles
    navBtns.forEach(b => {
      if (b.dataset.page === page) b.classList.add('bg-yellow-500','text-black');
      else b.classList.remove('bg-yellow-500','text-black');
    });
    // ensure internal links to anchors or other pages work
    contentEl.querySelectorAll('a[data-page]').forEach(a=>{
      a.addEventListener('click', e=>{
        e.preventDefault();
        const p = a.getAttribute('data-page');
        if (p) showPage(p);
      });
    });
  }

  // wire nav
  navBtns.forEach(b=>{
    b.addEventListener('click', ()=> showPage(b.dataset.page));
  });

  // initial
  showPage('home');

  // Public API to allow admin to signal re-load
  window.CIATA = {
    reloadPage(page) { if(PAGES.includes(page)) showPage(page); }
  };
})();
