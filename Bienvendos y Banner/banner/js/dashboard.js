(function () {
  const {
    getState,
    updateState,
    resetState,
    onChange,
    formatHandle,
    platformMeta,
    uid
  } = window.BannerStudio;

  const loopIntervalInput = document.getElementById('loop-interval');
  const previewStage = document.getElementById('preview-stage');
  const socialEditorList = document.getElementById('social-editor-list');
  const addSocialBtn = document.getElementById('add-social-btn');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const resetBtn = document.getElementById('reset-btn');

  let suppress = false;

  function firstVisibleItem(state) {
    return state.items.find((item) => item.visible) || state.items[0] || null;
  }

  function buildPreview(state) {
    const current = firstVisibleItem(state);
    const platform = current ? current.platform : 'web';

    const page = document.createElement('div');
    page.className = 'overlay-page';
    page.dataset.loop = platform;

    const stage = document.createElement('main');
    stage.className = 'onair-preview';

    const lower = document.createElement('section');
    lower.className = 'lower-third';

    const bevel = document.createElement('div');
    bevel.className = 'bevel';

    const icon = document.createElement('div');
    icon.className = 'icon-rail';

    const copy = document.createElement('div');
    copy.className = 'copy-rail';

    const label = document.createElement('div');
    label.className = 'top-line';
    label.textContent = current ? current.label : 'Web';

    const handle = document.createElement('div');
    handle.className = 'bottom-line';
    handle.textContent = current ? formatHandle(current.platform, current.handle) : 'www.cdelu.ar';

    copy.append(label, handle);

    const accent = document.createElement('div');
    accent.className = 'accent-block';

    lower.append(bevel, icon, copy, accent);
    stage.appendChild(lower);
    page.appendChild(stage);
    return page;
  }

  function renderPreview(state) {
    previewStage.replaceChildren(buildPreview(state));
  }

  function createEditorRow(item) {
    const row = document.createElement('div');
    row.className = 'social-editor-row';
    row.dataset.id = item.id;

    const platform = document.createElement('select');
    ['instagram', 'facebook', 'tiktok', 'telegram', 'web'].forEach((key) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = platformMeta[key].label;
      if (item.platform === key) option.selected = true;
      platform.appendChild(option);
    });

    const label = document.createElement('input');
    label.type = 'text';
    label.value = item.label;
    label.placeholder = 'Etiqueta';

    const handle = document.createElement('input');
    handle.type = 'text';
    handle.value = item.handle;
    handle.placeholder = item.platform === 'web' ? 'www.cdelu.ar' : '/cdelu.ar';

    const visibleWrap = document.createElement('label');
    visibleWrap.className = 'mini-toggle';
    visibleWrap.innerHTML = '<input type="checkbox"><span>Visible</span>';
    const visible = visibleWrap.querySelector('input');
    visible.checked = item.visible;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.textContent = '-';

    row.append(platform, label, handle, visibleWrap, remove);

    const sync = () => syncItems();

    platform.addEventListener('change', () => {
      handle.placeholder = platform.value === 'web' ? 'www.cdelu.ar' : '/cdelu.ar';
      sync();
    });
    label.addEventListener('input', sync);
    handle.addEventListener('input', sync);
    visible.addEventListener('change', sync);
    remove.addEventListener('click', () => {
      row.remove();
      syncItems();
    });

    row._controls = { platform, label, handle, visible };
    return row;
  }

  function renderEditors(state) {
    socialEditorList.replaceChildren();
    state.items.forEach((item) => {
      socialEditorList.appendChild(createEditorRow(item));
    });
    loopIntervalInput.value = state.loopInterval;
  }

  function syncItems() {
    if (suppress) return;

    const items = Array.from(socialEditorList.querySelectorAll('.social-editor-row')).map((row, index) => ({
      id: row.dataset.id || uid(`item-${index}`),
      platform: row._controls.platform.value,
      label: row._controls.label.value.trim() || platformMeta[row._controls.platform.value].label,
      handle: row._controls.handle.value.trim(),
      visible: row._controls.visible.checked
    }));

    updateState({ items });
  }

  loopIntervalInput.addEventListener('input', () => {
    const value = Math.max(1500, parseInt(loopIntervalInput.value, 10) || 4200);
    updateState({ loopInterval: value });
  });

  addSocialBtn.addEventListener('click', () => {
    const state = getState();
    updateState({
      items: [
        ...state.items,
        { id: uid('social'), platform: 'instagram', label: 'Instagram', handle: '', visible: true }
      ]
    });
  });

  copyLinkBtn.addEventListener('click', async () => {
    const url = `${window.location.origin}/banner`;
    try {
      await navigator.clipboard.writeText(url);
      copyLinkBtn.textContent = 'Enlace copiado';
      setTimeout(() => {
        copyLinkBtn.textContent = 'Copiar enlace';
      }, 1800);
    } catch {
      window.prompt('Copiar enlace manualmente:', url);
    }
  });

  resetBtn.addEventListener('click', () => {
    resetState();
  });

  const initial = getState();
  renderEditors(initial);
  renderPreview(initial);

  onChange((state) => {
    suppress = true;
    renderEditors(state);
    suppress = false;
    renderPreview(state);
  });
})();
