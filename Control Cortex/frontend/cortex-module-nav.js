(() => {
  'use strict';
  if (window.__cortexModuleNavMounted) return;
  window.__cortexModuleNavMounted = true;

  const base = document.documentElement.dataset.cortexBase || `${location.protocol}//${location.hostname}:4000`;
  const normalPath = value => { const path = String(value || '/').replace(/\/+$/, ''); return path || '/'; };
  const asUrl = raw => {
    try {
      const target = new URL(String(raw || ''), base);
      const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      const currentHost = location.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host) && !['localhost', '127.0.0.1', '::1'].includes(currentHost)) target.hostname = location.hostname;
      return target.href;
    } catch { return ''; }
  };
  const currentIs = href => {
    try { const url = new URL(href); return url.origin === location.origin && normalPath(url.pathname) === normalPath(location.pathname); }
    catch { return false; }
  };
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const fixedLinks = [
    { id:'home', name:'Todos tus paneles', category:'Cortex', url:'/home.html' },
    { id:'databases', name:'Bases de datos', category:'Cortex', url:'/home.html?view=databases' },
    { id:'lottery-db', name:'Firestore · Loterías', category:'Lotería y sorteos', url:'/home.html?view=databases&db=lottery' },
    { id:'lottery-rulo', name:'Rulo · Sistema de lotería', category:'Lotería y sorteos', url:'/rulo-lottery-dashboard.html' },
    { id:'lottery-admin', name:'Operar lotería', category:'Lotería y sorteos', url:'/loteria/dashboard.html' },
    { id:'lottery-overlay', name:'Overlay de números', category:'Lotería y sorteos', url:'/loteria/lottery-numbers.html' },
    { id:'iafas', name:'Sorteos IAFAS', category:'Lotería y sorteos', url:'http://localhost:8872/dashboard.html' },
    { id:'comments-roulette', name:'Ruleta de comentarios', category:'Participación en vivo', url:'http://localhost:9742/dashboard.html' },
    { id:'spotify', name:'Spotify', category:'Música', url:'/rulo-spotify.html' },
    { id:'spotify-bot', name:'Bot musical', category:'Música', url:'/rulo-spotify-bot.html' },
    { id:'spotify-training', name:'Entrenamiento e IA', category:'Música', url:'/rulo-spotify-training.html' },
    { id:'chat-history', name:'Historial de chat', category:'Rulo y chat', url:'/rulo-chat-historial.html' },
    { id:'rulo-talk', name:'Hablar con Rulo', category:'Rulo y chat', url:'/rulo-hablar.html' },
    { id:'rulo-look', name:'Rulo · Apariencia', category:'Rulo y chat', url:'/rulo-dashboard.html' },
    { id:'rulo-mascot', name:'Rulo · Animaciones', category:'Rulo y chat', url:'/rulo-mascota.html' },
    { id:'rulo-library', name:'Biblioteca de animaciones', category:'Rulo y chat', url:'/rulo-library.html' },
    { id:'unified', name:'Overlay unificado', category:'OBS y overlays', url:'/rulo-unified-dashboard.html' },
    { id:'weather', name:'Clima y Tiempo', category:'Clima', url:'http://localhost:3757/dashboard.html' },
    { id:'lights', name:'Luces de Fiesta', category:'Luces', url:'http://localhost:3758/dashboard.html' },
    { id:'welcome', name:'Bienvenidas y Banner', category:'Bienvenida y banner', url:'http://localhost:9344/admin' },
    { id:'triggers', name:'TriggerStudio', category:'OBS y overlays', url:'http://localhost:2188/' },
    { id:'spotify-capture', name:'Chat Bot Spotify', category:'Música', url:'http://localhost:9765/' },
    { id:'services', name:'Control de servicios', category:'Sistema', url:'/index.html' },
    { id:'animation-guide', name:'Guía de animaciones', category:'Rulo y chat', url:'/rulo-animaciones-guia.html' },
    { id:'event-traces', name:'Trazas de eventos', category:'Sistema', url:'/event-traces.html' }
  ];
  const contextGroups = {
    lottery: ['Lotería y sorteos', 'Participación en vivo', 'Rulo y chat', 'Música', 'OBS y overlays', 'Sistema', 'Otros'],
    participation: ['Participación en vivo', 'Rulo y chat', 'Lotería y sorteos', 'Música', 'OBS y overlays', 'Sistema', 'Otros'],
    music: ['Música', 'Rulo y chat', 'Lotería y sorteos', 'Participación en vivo', 'OBS y overlays', 'Sistema', 'Otros'],
    chat: ['Rulo y chat', 'Participación en vivo', 'Música', 'Lotería y sorteos', 'OBS y overlays', 'Sistema', 'Otros'],
    rulo: ['Rulo y chat', 'Música', 'Lotería y sorteos', 'Participación en vivo', 'OBS y overlays', 'Sistema', 'Otros'],
    weather: ['Clima', 'OBS y overlays', 'Sistema', 'Otros'],
    lights: ['Luces', 'OBS y overlays', 'Sistema', 'Otros'],
    welcome: ['Bienvenida y banner', 'OBS y overlays', 'Rulo y chat', 'Sistema', 'Otros'],
    triggers: ['OBS y overlays', 'Rulo y chat', 'Sistema', 'Otros'],
    system: ['Sistema', 'Rulo y chat', 'Música', 'Lotería y sorteos', 'Participación en vivo', 'OBS y overlays', 'Otros'],
    default: ['Rulo y chat', 'Música', 'Lotería y sorteos', 'Participación en vivo', 'OBS y overlays', 'Sistema', 'Otros']
  };
  function getContext() {
    const value = `${location.pathname} ${location.search} ${document.title}`.toLowerCase();
    const portContext = { '8872':'lottery', '9742':'participation', '3757':'weather', '3758':'lights', '9344':'welcome', '2188':'triggers', '9765':'music' }[location.port];
    if (portContext) return portContext;
    if (/ruleta de comentarios|participantes/.test(value)) return 'participation';
    if (/loter|sorteo|iafas|ruleta|giveaway/.test(value)) return 'lottery';
    if (/spotify|musica|music|entrenamiento/.test(value)) return 'music';
    if (/chat|historial|bot-overlay/.test(value)) return 'chat';
    if (/clima|tiempo|weather/.test(value)) return 'weather';
    if (/luces|lighting|boliche/.test(value)) return 'lights';
    if (/bienven|banner|social.?loop|lower.third/.test(value)) return 'welcome';
    if (/trigger|obs-websocket/.test(value)) return 'triggers';
    if (/rulo|mascota|animacion/.test(value)) return 'rulo';
    if (/control-cortex|services|index\.html|home\.html|event-traces|trazas de eventos/.test(value)) return 'system';
    return 'default';
  }
  function groupFor(item) {
    const text = `${item.name || ''} ${item.category || ''} ${item.url || ''}`.toLowerCase();
    if (/ruleta de comentarios|participantes|comentarios/.test(text)) return 'Participación en vivo';
    if (/loter|sorteo|iafas|ruleta|giveaway/.test(text)) return 'Lotería y sorteos';
    if (/spotify|musica|music|cancion/.test(text)) return 'Música';
    if (/clima|tiempo|weather/.test(text)) return 'Clima';
    if (/luces|lighting|boliche/.test(text)) return 'Luces';
    if (/bienven|banner|social.loop/.test(text)) return 'Bienvenida y banner';
    if (/obs|overlay|trigger/.test(text)) return 'OBS y overlays';
    if (/rulo|chat|bot|mascota|animacion/.test(text)) return 'Rulo y chat';
    const category = String(item.category || '').toLowerCase();
    if (/sistema|control|cortex/.test(category)) return 'Sistema';
    return 'Otros';
  }
  function mergeItems(modules) {
    const seen = new Set();
    return [...fixedLinks, ...(Array.isArray(modules) ? modules : [])]
      .filter(item => item && item.name && item.url)
      .map(item => ({ id:String(item.id || item.url), name:String(item.name), category:groupFor(item), url:String(item.url) }))
      .filter(item => {
        const href = asUrl(item.url);
        if (!href) return false;
        const key = new URL(href).href;
        if (seen.has(key)) return false;
        seen.add(key); item.href = href; return true;
      });
  }
  function makeAnchor(item, className = '') {
    const link = node('a', className, item.name);
    link.href = item.href || asUrl(item.url);
    if (currentIs(link.href)) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', () => { const menu = document.querySelector('#cortex-module-nav details'); if (menu) menu.open = false; });
    return link;
  }
  function renderAllModules(container, items, context) {
    container.replaceChildren();
    const order = contextGroups[context] || contextGroups.default;
    const groups = new Map();
    for (const item of items) {
      const label = item.category || 'Otros';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    }
    const labels = [...groups.keys()].sort((a,b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b, 'es');
    });
    for (const label of labels) {
      const section = node('section', 'cortex-nav-group');
      section.dataset.navGroup = label.toLowerCase();
      section.append(node('h3', '', label));
      for (const item of groups.get(label).sort((a,b) => a.name.localeCompare(b.name, 'es'))) {
        const link = makeAnchor(item); link.dataset.navText = item.name.toLowerCase(); section.append(link);
      }
      container.append(section);
    }
  }
  function mount(modules) {
    if (!document.body || document.getElementById('cortex-module-nav')) return;
    const context = getContext();
    const items = mergeItems(modules);
    const relatedPatterns = {
      lottery:/loter|sorteo|iafas|ruleta|rulo.*sistema de loter|rulo-chat|historial/i,
      participation:/comentarios|participantes|ruleta|rulo|chat/i,
      music:/spotify|musica|music|entrenamiento/i,
      chat:/chat|rulo|spotify|loter|mascota|bot/i,
      rulo:/rulo|chat|spotify|mascota|animacion|loter/i,
      weather:/clima|tiempo|weather/i,
      lights:/luces|lighting|boliche|obs/i,
      welcome:/bienven|banner|social.loop/i,
      triggers:/trigger|obs|rulo/i,
      system:/sistema|control|cortex|rulo|spotify|loter/i,
      default:/rulo|spotify|loter|chat/i
    };
    const related = items.filter(item => item.category !== 'Cortex' && (relatedPatterns[context] || relatedPatterns.default).test(`${item.name} ${item.category} ${item.url}`))
      .sort((a,b) => {
        const rank = item => context === 'system' && item.id === 'services' ? 0
          : context === 'participation' && item.id === 'comments-roulette' ? 0
          : context === 'weather' && item.id === 'weather' ? 0
          : context === 'lights' && item.id === 'lights' ? 0
          : context === 'welcome' && item.id === 'welcome' ? 0
          : context === 'triggers' && item.id === 'triggers' ? 0
          : context === 'rulo' && item.id === 'rulo-look' ? 0
          : context === 'rulo' && item.id === 'rulo-mascot' ? 1
          : context === 'rulo' && item.id === 'chat-history' ? 2
          : item.id === 'rulo-lottery' || /rulo-lottery-dashboard/.test(item.url) ? (context === 'lottery' ? 0 : 5)
          : /rulo-spotify\.html|spotify-dashboard/.test(item.url) ? (context === 'music' ? 0 : 3)
          : /rulo-chat-historial/.test(item.url) ? (context === 'chat' ? 0 : 4)
          : /rulo-spotify-bot/.test(item.url) ? 1
          : /rulo-spotify-training/.test(item.url) ? 2 : 10;
        return rank(a)-rank(b) || a.name.localeCompare(b.name, 'es');
      }).slice(0, 6);

    const bar = node('header'); bar.id = 'cortex-module-nav'; bar.className = 'topnav'; bar.setAttribute('aria-label','Navegación entre módulos de Cortex');
    const brand = node('a','cortex-nav-brand'); brand.href = asUrl('/home.html'); brand.setAttribute('aria-label','Volver a Cortex Inicio');
    brand.append(node('span','cortex-nav-mark','C'),node('span','cortex-nav-label','CORTEX'));
    const shortcuts = node('nav','cortex-nav-related'); shortcuts.setAttribute('aria-label','Accesos relacionados');
    for (const item of related) shortcuts.append(makeAnchor(item));

    const details = node('details','cortex-nav-all');
    const summary = node('summary','cortex-nav-summary','Todos los módulos');
    const panel = node('div','cortex-nav-panel');
    const panelHead = node('div','cortex-nav-panel-head'); panelHead.append(node('strong','','Paneles y herramientas'),node('small','','Los accesos relacionados con esta página aparecen primero.'));
    const search = node('input','cortex-nav-search'); search.type='search'; search.placeholder='Buscar un módulo…'; search.setAttribute('aria-label','Buscar módulos');
    const groups = node('div','cortex-nav-groups');
    panel.append(panelHead,search,groups); details.append(summary,panel);
    const home = makeAnchor({name:'Inicio',url:'/home.html'}); home.className='cortex-nav-all-home';
    bar.append(brand,shortcuts,home,details);
    document.body.prepend(bar);
    document.documentElement.classList.add('cortex-module-nav-ready');

    const show = () => {
      const query = search.value.trim().toLocaleLowerCase('es');
      groups.querySelectorAll('.cortex-nav-group').forEach(section => {
        let visible = 0;
        section.querySelectorAll('a').forEach(link => { const match = !query || link.dataset.navText.includes(query); link.hidden = !match; if (match) visible++; });
        section.hidden = visible === 0;
      });
      let empty = groups.querySelector('.cortex-nav-empty');
      const any = [...groups.querySelectorAll('.cortex-nav-group')].some(section => !section.hidden);
      if (!any && !empty) { empty = node('div','cortex-nav-empty','No hay módulos que coincidan con la búsqueda.'); groups.append(empty); }
      else if (any && empty) empty.remove();
    };
    renderAllModules(groups, items, context); search.addEventListener('input',show);
    details.addEventListener('toggle',() => { if (details.open) { search.value=''; show(); search.focus(); } });
    document.addEventListener('keydown',event => { if (event.key === 'Escape') details.open=false; });
  }

  const ready = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    fetch(`${base}/api/cortex-home`, { cache:'no-store', signal:controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Paneles no disponibles')))
      .then(data => mount(data.modules || []))
      .catch(() => mount([]))
      .finally(() => clearTimeout(timer));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once:true });
  else ready();
})();
