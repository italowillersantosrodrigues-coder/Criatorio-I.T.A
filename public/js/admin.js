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

  // toolbar
  const imgToolbar = document.getElementById("imgToolbar");
  const replaceInput = document.getElementById("replaceInput");
  const btnReplace = document.getElementById("btnReplace");
  const btnRemove = document.getElementById("btnRemove");
  const btnMoveUp = document.getElementById("btnMoveUp");
  const btnMoveDown = document.getElementById("btnMoveDown");
  const widthRange = document.getElementById("widthRange");
  const alignLeft = document.getElementById("alignLeft");
  const alignCenter = document.getElementById("alignCenter");
  const alignRight = document.getElementById("alignRight");
  const btnLock = document.getElementById("btnLock");

  let currentPage = null;
  let selectedImgWrapper = null;
  let selectedImg = null;
  let locked = false;

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

  // load page for edit (use override if exists)
  async function loadPageForEdit(page) {
    currentPage = page;
    editingPageEl.textContent = page;
    const override = localStorage.getItem(PAGE_PREFIX + page);
    editor.innerHTML = override ?? await fetchOriginalPage(page);
    activateResizableImages();
  }

  function savePage() {
    if (!currentPage) return alert("Nenhuma página carregada");
    // simple sanitization could be added here
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

  // Drop & click insert image (inserir no caret ou final)
  function insertImageAtCaret(dataUrl){
    const wrapper = document.createElement("div");
    wrapper.className = "resizable";
    wrapper.style.display = "inline-block";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "imagem";
    wrapper.appendChild(img);
    ["tl","tr","bl","br"].forEach(pos => {
      const r = document.createElement("div");
      r.className = "resizer " + pos;
      wrapper.appendChild(r);
    });

    // insert at caret
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // try to insert the wrapper node at the caret
      range.deleteContents();
      range.insertNode(wrapper);
    } else {
      editor.appendChild(wrapper);
    }
    activateResizer(wrapper);
  }

  // drop handlers: allow both drag to insert or click to select file
  dropZone.addEventListener("click", ()=> replaceInput.click());
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", ()=> dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault(); dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return alert("Apenas imagens.");
    const reader = new FileReader();
    reader.onload = () => insertImageAtCaret(reader.result);
    reader.readAsDataURL(file);
  });

  // hidden input for inserting general images
  replaceInput.addEventListener("change", ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (!f.type.startsWith("image/")) return alert("Apenas imagens.");
    const rd = new FileReader();
    rd.onload = ()=> {
      // if a specific image selected, this replaceInput is also used for replacing selected image
      if (selectedImg) {
        selectedImg.src = rd.result;
        updateToolbarState();
      } else {
        insertImageAtCaret(rd.result);
      }
    };
    rd.readAsDataURL(f);
    // reset
    replaceInput.value = "";
  });

  // --- Resizer functions (same idea, slightly improved) ---
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
      // compute new width based on mouse
      if (!currentResizer) return;
      let newW, newH;
      if (currentResizer.classList.contains("br")) {
        newW = e.pageX - rect.left;
        newH = e.pageY - rect.top;
      } else if (currentResizer.classList.contains("bl")) {
        newW = rect.right - e.pageX;
        newH = e.pageY - rect.top;
      } else if (currentResizer.classList.contains("tr")) {
        newW = e.pageX - rect.left;
        newH = rect.bottom - e.pageY;
      } else if (currentResizer.classList.contains("tl")) {
        newW = rect.right - e.pageX;
        newH = rect.bottom - e.pageY;
      }
      if (newW > 20) {
        img.style.width = newW + "px";
      }
      // maintain auto height to preserve aspect ratio
      img.style.height = "auto";
    }

    function stopResize() {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResize);
    }
  }

  function activateResizableImages() {
    // wrap images not yet wrapped
    editor.querySelectorAll("img").forEach(img => {
      if (!img.parentElement.classList.contains("resizable")) {
        const wrapper = document.createElement("div");
        wrapper.className = "resizable";
        // preserve margin by copying display inline-block
        wrapper.style.display = "inline-block";
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
    // wire click selection
    editor.querySelectorAll(".resizable img").forEach(img => {
      img.style.cursor = "move";
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        selectImage(img);
      });
    });
  }

  // Select image: highlight, show toolbar
  function selectImage(img){
    // deselect previous
    if (selectedImg) {
      const prevWrap = selectedImg.closest(".resizable");
      if (prevWrap) prevWrap.classList.remove("img-selected");
    }
    selectedImg = img;
    selectedImgWrapper = img.closest(".resizable");
    if (selectedImgWrapper) selectedImgWrapper.classList.add("img-selected");
    // populate toolbar state
    updateToolbarState();
    positionToolbar();
    imgToolbar.style.display = "flex";
  }

  function deselectImage(){
    if (selectedImgWrapper) selectedImgWrapper.classList.remove("img-selected");
    selectedImg = null; selectedImgWrapper = null;
    imgToolbar.style.display = "none";
  }

  // Update toolbar controls to reflect selected image
  function updateToolbarState(){
    if (!selectedImg) return;
    const w = selectedImg.getBoundingClientRect().width;
    const contW = selectedImg.parentElement.parentElement ? selectedImg.parentElement.parentElement.getBoundingClientRect().width : selectedImg.getBoundingClientRect().width;
    // set width in percent of parent content width (approx)
    const parentWidth = selectedImg.parentElement.parentElement ? selectedImg.parentElement.parentElement.getBoundingClientRect().width : document.body.getBoundingClientRect().width;
    let pct = Math.round((w / parentWidth) * 100);
    if (pct < 10) pct = 10;
    if (pct > 100) pct = 100;
    widthRange.value = pct;
    locked = selectedImgWrapper.dataset.locked === "1";
    btnLock.textContent = locked ? "🔓" : "🔒";
  }

  // Position toolbar near selected image
  function positionToolbar(){
    if (!selectedImg) return;
    const rect = selectedImg.getBoundingClientRect();
    const toolbarRect = imgToolbar.getBoundingClientRect();
    const top = window.scrollY + rect.top - toolbarRect.height - 10;
    let left = window.scrollX + rect.left;
    // keep within viewport
    if (left + toolbarRect.width > window.scrollX + window.innerWidth - 12) {
      left = window.scrollX + window.innerWidth - toolbarRect.width - 12;
    }
    imgToolbar.style.top = `${top}px`;
    imgToolbar.style.left = `${left}px`;
  }

  // Toolbar actions
  btnReplace.addEventListener("click", ()=> {
    replaceInput.click();
  });
  btnRemove.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    if (!confirm("Remover esta imagem?")) return;
    selectedImgWrapper.remove();
    deselectImage();
  });
  btnMoveUp.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    const prev = selectedImgWrapper.previousElementSibling;
    if (prev) {
      selectedImgWrapper.parentNode.insertBefore(selectedImgWrapper, prev);
    } else {
      // try to move before parent block
      const parent = selectedImgWrapper.parentNode;
      if (parent && parent.previousElementSibling) parent.parentNode.insertBefore(selectedImgWrapper, parent.previousElementSibling);
    }
    updateToolbarState();
  });
  btnMoveDown.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    const next = selectedImgWrapper.nextElementSibling;
    if (next) {
      selectedImgWrapper.parentNode.insertBefore(next, selectedImgWrapper);
    } else {
      const parent = selectedImgWrapper.parentNode;
      if (parent && parent.nextElementSibling) parent.parentNode.insertBefore(selectedImgWrapper, parent.nextElementSibling.nextElementSibling);
    }
    updateToolbarState();
  });

  widthRange.addEventListener("input", ()=> {
    if (!selectedImg) return;
    const pct = widthRange.value;
    selectedImg.style.width = pct + "%";
    selectedImg.style.height = "auto";
    positionToolbar();
  });

  alignLeft.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    selectedImgWrapper.style.display = "block";
    selectedImg.style.cssFloat = "left";
    selectedImgWrapper.style.marginRight = "12px";
    selectedImgWrapper.style.marginLeft = "0";
  });
  alignCenter.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    selectedImgWrapper.style.display = "block";
    selectedImg.style.cssFloat = "none";
    selectedImgWrapper.style.marginLeft = "auto";
    selectedImgWrapper.style.marginRight = "auto";
    selectedImgWrapper.style.textAlign = "center";
  });
  alignRight.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    selectedImgWrapper.style.display = "block";
    selectedImg.style.cssFloat = "right";
    selectedImgWrapper.style.marginLeft = "12px";
    selectedImgWrapper.style.marginRight = "0";
  });

  btnLock.addEventListener("click", ()=> {
    if (!selectedImgWrapper) return;
    locked = !locked;
    selectedImgWrapper.dataset.locked = locked ? "1" : "0";
    btnLock.textContent = locked ? "🔓" : "🔒";
  });

  // replaceInput for replacing only selected image
  replaceInput.addEventListener("change", ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (!f.type.startsWith("image/")) return alert("Apenas imagens.");
    const reader = new FileReader();
    reader.onload = () => {
      if (selectedImg) {
        selectedImg.src = reader.result;
        selectedImg.style.width = ""; // reset inline width to let editor adapt or set default
        updateToolbarState();
      } else {
        insertImageAtCaret(reader.result);
      }
    };
    reader.readAsDataURL(f);
    replaceInput.value = "";
  });

  // select image by clicking in editor (capture from anywhere)
  editor.addEventListener("click", (e) => {
    // if clicked image inside .resizable
    const img = e.target.closest(".resizable") ? e.target.closest(".resizable").querySelector("img") : null;
    if (img) {
      selectImage(img);
    } else {
      // clicked elsewhere: deselect
      deselectImage();
    }
  });

  // handle window resize and scroll to reposition toolbar
  window.addEventListener("scroll", ()=>{ if (selectedImg) positionToolbar(); });
  window.addEventListener("resize", ()=>{ if (selectedImg) positionToolbar(); });

  // clicking outside editor hides toolbar
  document.addEventListener("click", (e)=>{
    if (!e.target.closest(".resizable") && !e.target.closest("#imgToolbar")) {
      deselectImage();
    }
  });

  // initial: wrap any existing images and attach handlers
  function activateResizableImages() {
    editor.querySelectorAll("img").forEach(img => {
      if (!img.parentElement.classList.contains("resizable")) {
        const wrapper = document.createElement("div");
        wrapper.className = "resizable";
        wrapper.style.display = "inline-block";
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
    // add click handler to images
    editor.querySelectorAll(".resizable img").forEach(img=>{
      img.style.cursor = "pointer";
      img.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        selectImage(img);
      });
    });
  }

  // --- reuse previously defined resizer activation (to avoid duplication) ---
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
      if (!currentResizer) return;
      let newW;
      if (currentResizer.classList.contains("br")) {
        newW = e.pageX - rect.left;
      } else if (currentResizer.classList.contains("bl")) {
        newW = rect.right - e.pageX;
      } else if (currentResizer.classList.contains("tr")) {
        newW = e.pageX - rect.left;
      } else if (currentResizer.classList.contains("tl")) {
        newW = rect.right - e.pageX;
      }
      if (newW > 24) {
        img.style.width = newW + "px";
        img.style.height = "auto";
      }
      positionToolbar();
    }
    function stopResize() {
      currentResizer = null;
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResize);
    }
  }

  // Utility to insert at caret (used earlier)
  function insertImageAtCaret(dataUrl){
    const wrapper = document.createElement("div");
    wrapper.className = "resizable";
    wrapper.style.display = "inline-block";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "imagem";
    wrapper.appendChild(img);
    ["tl","tr","bl","br"].forEach(pos => {
      const r = document.createElement("div");
      r.className = "resizer " + pos;
      wrapper.appendChild(r);
    });

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(wrapper);
    } else {
      editor.appendChild(wrapper);
    }
    activateResizer(wrapper);
  }

  // Events (login, load, save etc.)
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
