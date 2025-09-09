(() => {
  const PAGE_PREFIX = "ciata_page_";
  const USER_KEY = "ciata_admin_user";

  // DOM
  const loginBox = document.getElementById("loginBox");
  const adminPanel = document.getElementById("adminPanel");
  const loginBtn = document.getElementById("loginBtn");
  const loginMsg = document.getElementById("loginMsg");
  const adminUser = document.getElementById("adminUser");
  const adminPass = document.getElementById("adminPass");
  const pageSelect = document.getElementById("pageSelect");
  const loadPageBtn = document.getElementById("loadPageBtn");
  const saveBtn = document.getElementById("saveBtn");
  const revertBtn = document.getElementById("revertBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");
  const logoutBtn = document.getElementById("logoutBtn");
  const editingPageEl = document.getElementById("editingPage");
  const editor = document.getElementById("editor");
  const dropZone = document.getElementById("dropZone");

  let currentPage = null;

  // Auth
  function checkAuth() { return !!localStorage.getItem(USER_KEY); }
  function setAuth(u) { localStorage.setItem(USER_KEY, u); }
  function clearAuth() { localStorage.removeItem(USER_KEY); }

  function showAdminUI() {
    loginBox.classList.add("hidden");
    adminPanel.classList.remove("hidden");
  }
  function showLogin() {
    loginBox.classList.remove("hidden");
    adminPanel.classList.add("hidden");
  }

  // Fetch página original
  async function fetchOriginalPage(page) {
    const r = await fetch(`/pages/${page}.html`);
    return r.ok ? await r.text() : `<h2>Página não encontrada</h2>`;
  }

  async function loadPageForEdit(page) {
    currentPage = page;
    editingPageEl.textContent = page;
    const override = localStorage.getItem(PAGE_PREFIX + page);
    editor.innerHTML = override ?? await fetchOriginalPage(page);

    // Ativar resizable para imagens já existentes
    activateResizableImages();
  }

  function savePage() {
    if (!currentPage) return alert("Nenhuma página carregada");
    localStorage.setItem(PAGE_PREFIX + currentPage, editor.innerHTML);
    alert("Página salva localmente.");
    if (window.top && window.top.CIATA) {
      window.top.CIATA.reloadPage(currentPage);
    }
  }

  async function revertPage() {
    if (!currentPage) return;
    if (confirm("Reverter para o original?")) {
      localStorage.removeItem(PAGE_PREFIX + currentPage);
      editor.innerHTML = await fetchOriginalPage(currentPage);
      activateResizableImages();
    }
  }

  // Export/Import
  function exportAll() {
    const exportObj = { pages: {} };
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(PAGE_PREFIX)) {
        const page = k.slice(PAGE_PREFIX.length);
        exportObj.pages[page] = localStorage.getItem(k);
      }
    });
    const a = document.createElement("a");
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
    a.download = "ciata_export.json";
    a.click();
  }
  function importBackup() { importFile.click(); }
  importFile.addEventListener("change", ev => {
    const f = ev.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj.pages) {
          Object.keys(obj.pages).forEach(p => {
            localStorage.setItem(PAGE_PREFIX + p, obj.pages[p]);
          });
        }
        alert("Importado com sucesso.");
      } catch (err) { alert("Arquivo inválido"); }
    };
    reader.readAsText(f);
  });

  // Drag & Drop de imagens
  dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (!file.type.startsWith("image/")) return alert("Apenas imagens.");
    const reader = new FileReader();
    reader.onload = () => {
      insertResizableImage(reader.result);
    };
    reader.readAsDataURL(file);
  });

  // --- Funções de redimensionamento ---
  function insertResizableImage(src) {
    const wrapper = document.createElement("div");
    wrapper.className = "resizable";
    const img = document.createElement("img");
    img.src = src;
    wrapper.appendChild(img);

    ["tl","tr","bl","br"].forEach(pos => {
      const r = document.createElement("div");
      r.className = "resizer " + pos;
      wrapper.appendChild(r);
    });

    editor.appendChild(wrapper);
    activateResizer(wrapper);
  }

  function activateResizableImages() {
    editor.querySelectorAll("img").forEach(img => {
      if (!img.parentElement.classList.contains("resizable")) {
        const wrapper = document.createElement("div");
        wrapper.className = "resizable";
        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
        ["tl","tr","bl","br"].forEach(pos => {
          const r = document.createElement("div");
          r.className = "resizer " + pos;
          wrapper.appendChild(r);
        });
        activateResizer(wrapper);
      }
    });
  }

  function activateResizer(wrapper) {
    const img = wrapper.querySelector("img");
    const resizers = wrapper.querySelectorAll(".resizer");
    let currentResizer;

    resizers.forEach(resizer => {
      resizer.addEventListener("mousedown", e => {
        e.preventDefault();
        currentResizer = resizer;
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResize);
      });
    });

    function resize(e) {
      const rect = wrapper.getBoundingClientRect();
      if (currentResizer.classList.contains("br")) {
        img.style.width = e.pageX - rect.left + "px";
        img.style.height = e.pageY - rect.top + "px";
      } else if (currentResizer.classList.contains("bl")) {
        img.style.width = rect.right - e.pageX + "px";
        img.style.height = e.pageY - rect.top + "px";
      } else if (currentResizer.classList.contains("tr")) {
        img.style.width = e.pageX - rect.left + "px";
        img.style.height = rect.bottom - e.pageY + "px";
      } else if (currentResizer.classList.contains("tl")) {
        img.style.width = rect.right - e.pageX + "px";
        img.style.height = rect.bottom - e.pageY + "px";
      }
    }

    function stopResize() {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResize);
    }
  }

  // Eventos
  loginBtn.addEventListener("click", () => {
    const u = adminUser.value.trim();
    const p = adminPass.value;
    if (u === "admin" && p === "admin") {
      setAuth(u); showAdminUI();
    } else loginMsg.textContent = "Credenciais inválidas";
  });
  loadPageBtn.addEventListener("click", () => loadPageForEdit(pageSelect.value));
  saveBtn.addEventListener("click", savePage);
  revertBtn.addEventListener("click", revertPage);
  exportBtn.addEventListener("click", exportAll);
  importBtn.addEventListener("click", importBackup);
  logoutBtn.addEventListener("click", () => { clearAuth(); showLogin(); });

  // Init
  if (checkAuth()) showAdminUI(); else showLogin();
})();
