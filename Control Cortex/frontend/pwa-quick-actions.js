(() => {
  if (document.getElementById('cortex-quick-actions')) return;

  const mount = () => {
    if (!document.body || document.getElementById('cortex-quick-actions')) return;
    const style = document.createElement('style');
    style.id = 'cortex-quick-actions-style';
    style.textContent = `
      #cortex-quick-actions{position:fixed!important;z-index:2147483000!important;right:18px!important;bottom:max(14px,env(safe-area-inset-bottom,0px))!important;display:flex!important;align-items:center!important;gap:8px!important;width:max-content!important;padding:5px!important;border:1px solid #dfe3da!important;border-radius:999px!important;background:#fff!important;box-shadow:0 6px 24px #14241a33!important;pointer-events:none!important}
      #cortex-quick-actions button{display:grid!important;place-items:center!important;width:46px!important;height:46px!important;min-width:46px!important;margin:0!important;padding:11px!important;border:0!important;border-radius:50%!important;background:#f1f3ed!important;color:#232a29!important;box-shadow:none!important;cursor:pointer!important;pointer-events:auto!important;-webkit-tap-highlight-color:transparent!important}
      #cortex-quick-actions button:hover{background:#e4eadb!important}
      #cortex-quick-actions svg{display:block!important;width:23px!important;height:23px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}
      #cortex-quick-actions-toast{position:fixed!important;z-index:2147483001!important;left:50%!important;bottom:calc(max(14px,env(safe-area-inset-bottom,0px)) + 66px)!important;transform:translateX(-50%)!important;max-width:calc(100vw - 32px)!important;padding:10px 14px!important;border-radius:9px!important;background:#182420!important;color:#fff!important;font:13px/1.4 system-ui,sans-serif!important;box-shadow:0 4px 18px #0003!important}
      @media(max-width:720px){#cortex-quick-actions{right:auto!important;left:50%!important;transform:translateX(-50%)!important;bottom:max(12px,env(safe-area-inset-bottom,0px))!important}}
    `;
    document.head.append(style);

    const group = document.createElement('div');
    group.id = 'cortex-quick-actions';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Acciones rápidas de Cortex');
    group.innerHTML = `
      <button type="button" data-action="copy" aria-label="Copiar dirección de esta página" title="Copiar dirección de esta página">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7.5V5.75A2.75 2.75 0 0 1 10.75 3h7.5A2.75 2.75 0 0 1 21 5.75v7.5A2.75 2.75 0 0 1 18.25 16H16.5"/><rect x="3" y="8" width="13.5" height="13" rx="2.5"/></svg>
      </button>
      <button type="button" data-action="back" aria-label="Volver a la página anterior" title="Volver a la página anterior">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5 3 12l7 7M4 12h10a7 7 0 0 1 7 7"/></svg>
      </button>`;
    document.body.append(group);

    const showToast = message => {
      let toast = document.getElementById('cortex-quick-actions-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cortex-quick-actions-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.append(toast);
      }
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.remove(), 2200);
    };
    const copyUrl = async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API no disponible');
        await navigator.clipboard.writeText(location.href);
        showToast('Dirección copiada');
      } catch {
        const field = document.createElement('textarea');
        field.value = location.href;
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.append(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        showToast(copied ? 'Dirección copiada' : 'No se pudo copiar la dirección');
      }
    };

    group.querySelector('[data-action="copy"]').addEventListener('click', copyUrl);
    group.querySelector('[data-action="back"]').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else if (location.protocol === 'https:') location.assign('/');
      else location.assign(`${location.protocol}//${location.hostname}:4000/`);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
