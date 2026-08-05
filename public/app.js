import { createIcons, icons } from '/vendor/lucide/esm/lucide.mjs';

const state = { config: null, library: null, route: 'home', query: '', type: 'all', sort: 'added', mobileFiltersOpen: false, current: null, playerTimer: null, controlsTimer: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
const icon = (name, className = '') => `<i data-lucide="${name === 'badge-hd' ? 'monitor-play' : name}"${className ? ` class="${className}"` : ''}></i>`;
const hydrateIcons = (root = document) => createIcons({ icons, attrs: { 'aria-hidden': 'true', 'stroke-width': 2 }, root });
const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Request failed (${response.status})`); }
  return response.status === 204 ? null : response.json();
};

function time(seconds) {
  if (!seconds) return '';
  const minutes = Math.max(1, Math.round(seconds / 60)); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
function clockTime(seconds) { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const whole = Math.floor(seconds); const hours = Math.floor(whole / 3600); const minutes = Math.floor((whole % 3600) / 60); const secs = String(whole % 60).padStart(2, '0'); return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`; }
function quality(item) { return item.height >= 2160 ? '4K' : item.height >= 1080 ? '1080p' : item.height >= 720 ? 'HD' : ''; }
function toast(message, error = false) {
  const node = document.createElement('div'); node.className = `toast${error ? ' error' : ''}`; node.textContent = message; $('#toastHost').append(node); setTimeout(() => node.remove(), 3500);
}
function mediaLabel(item) { return item.media_type === 'episode' && item.season_number ? `S${String(item.season_number).padStart(2, '0')} E${String(item.episode_number).padStart(2, '0')}` : item.media_type; }
function itemDuration(item) { return Number(item.runtime_seconds || item.duration_seconds || 0); }
function card(item) {
  const duration = itemDuration(item);
  const pct = duration ? Math.min(100, (item.position_seconds || 0) / duration * 100) : 0;
  return `<article class="media-card" data-id="${item.id}" tabindex="0" aria-label="${esc(item.title)}">
    <div class="poster"><img src="${item.backdrop}" alt="" loading="lazy" onerror="this.style.display='none'"><button class="play-badge" data-play="${item.id}" aria-label="Play">${icon('play')}</button>${duration ? `<span class="duration-badge">${clockTime(duration)}</span>` : ''}${pct ? `<span class="progress"><i style="width:${pct}%"></i></span>` : ''}</div>
    <div class="card-copy"><div class="video-avatar">${icon('play')}</div><div class="card-text"><div class="card-title" title="${esc(item.title)}">${esc(item.title)}</div><div class="card-meta"><span>${esc(mediaLabel(item))}</span><span>${item.year || 'Local video'}</span></div></div><button class="card-menu" aria-label="More options">${icon('more-vertical')}</button></div>
  </article>`;
}
function shelf(title, subtitle, items, route = 'library', className = '') {
  if (!items.length) return '';
  return `<section class="shelf ${className}"><div class="section-head"><div><h2>${className === 'shorts-shelf' ? icon('clapperboard') : ''}${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="text-button" data-route="${route}">View all ${icon('chevron-right')}</button></div><div class="rail">${items.map(card).join('')}</div></section>`;
}

async function loadLibrary() {
  const params = new URLSearchParams({ search: state.query, type: state.type, sort: state.sort });
  state.library = await api(`/api/library?${params}`);
  if (state.route !== 'watch') render();
}
function bindCards(root = document) {
  $$('.media-card', root).forEach((node) => {
    node.addEventListener('click', (event) => { if (event.target.closest('[data-play]')) return; showDetails(Number(node.dataset.id)); });
    node.addEventListener('keydown', (event) => { if (event.key === 'Enter') showDetails(Number(node.dataset.id)); });
  });
  $$('[data-play]', root).forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); play(Number(button.dataset.play)); }));
}
function render() {
  if (!state.library) return;
  document.body.classList.toggle('watch-mode', state.route === 'watch' && Boolean(state.current));
  $$('.nav-item,.side-item[data-route],.mobile-nav button[data-route]').forEach((x) => x.classList.toggle('active', x.dataset.route === state.route));
  const main = $('#main');
  if (state.route === 'watch' && state.current) renderWatch(main, state.current);
  else if (state.route === 'library' || state.query) renderLibrary(main);
  else renderHome(main);
  bindCards(main); bindRoutes(main);
  hydrateIcons(main);
}
function renderHome(main) {
  const lib = state.library;
  const featured = lib.continueWatching[0] || lib.recent[0] || lib.items[0];
  if (!featured) {
    main.innerHTML = `<div class="page"><div class="empty"><div><div class="empty-icon">${icon('clapperboard')}</div><h2>Your library is ready for its first film</h2><p>Add a folder containing videos. Home Library will organize them, create thumbnails, and keep the collection in sync.</p><button class="button primary" id="emptyAdd">${icon('folder-plus')} Add media folder</button></div></div></div>`;
    $('#emptyAdd').onclick = openSettings; return;
  }
  const longVideos = lib.items.filter((item) => !itemDuration(item) || itemDuration(item) >= 300);
  const shortVideos = lib.items.filter((item) => itemDuration(item) > 0 && itemDuration(item) < 300).slice(0, 12);
  const byType = (types) => longVideos.filter((item) => types.includes(item.media_type)).slice(0, 18);
  const movies = byType(['movie']);
  const episodes = byType(['episode']);
  const learning = byType(['tutorial', 'course']);
  const personal = byType(['personal']);
  const smartRows = [
    shelf('Continue watching', '', lib.continueWatching.filter((item) => !itemDuration(item) || itemDuration(item) >= 300)),
    shelf('Short videos', 'Videos under 5 minutes', shortVideos, 'library', 'shorts-shelf'),
    shelf('Recently added', '', lib.recent.filter((item) => !itemDuration(item) || itemDuration(item) >= 300)),
    shelf('Movies', '', movies),
    shelf('Episodes', '', episodes),
    shelf('Learning', '', learning),
    shelf('Personal', '', personal),
  ].filter(Boolean).join('');
  main.innerHTML = `<div class="home-page"><div class="content-wrap">${smartRows || shelf('Your videos', '', lib.items.slice(0, 18))}</div></div>`;
}
function renderLibrary(main) {
  const { items, total, counts } = state.library;
  const activeFilters = Number(state.type !== 'all') + Number(state.sort !== 'added');
  main.innerHTML = `<div class="page"><div class="library-head"><div class="library-heading"><div class="library-title-row"><h1 class="${state.query ? 'search-results-title' : ''}">${state.query ? `Results for “${esc(state.query)}”` : 'Your library'}</h1><button type="button" id="mobileFiltersBtn" class="mobile-filter-button${activeFilters ? ' active' : ''}" aria-expanded="${state.mobileFiltersOpen}" aria-controls="libraryFilters">${icon('sliders-horizontal')}<span>Filters</span>${activeFilters ? `<b>${activeFilters}</b>` : ''}</button></div><p>${total} ${total === 1 ? 'video' : 'videos'}</p></div><div id="libraryFilters" class="filters${state.mobileFiltersOpen ? ' open' : ''}"><select id="typeFilter" class="select" aria-label="Media type"><option value="all">All types</option>${['movie','episode','personal','tutorial','course','other'].map((t) => `<option value="${t}" ${state.type === t ? 'selected' : ''}>${t[0].toUpperCase()+t.slice(1)}${counts[t] ? ` (${counts[t]})` : ''}</option>`).join('')}</select><select id="sortFilter" class="select" aria-label="Sort"><option value="added">Recently added</option><option value="title" ${state.sort === 'title' ? 'selected' : ''}>Title A–Z</option><option value="year" ${state.sort === 'year' ? 'selected' : ''}>Release year</option><option value="runtime" ${state.sort === 'runtime' ? 'selected' : ''}>Runtime</option></select></div></div>${items.length ? `<div class="media-grid">${items.map(card).join('')}</div>` : `<div class="empty"><div><div class="empty-icon">${icon('search-x')}</div><h2>No videos found</h2><p>Try a different search or filter, or scan your folders for new files.</p></div></div>`}</div>`;
  $('#mobileFiltersBtn').onclick = (event) => {
    state.mobileFiltersOpen = !state.mobileFiltersOpen;
    event.currentTarget.setAttribute('aria-expanded', String(state.mobileFiltersOpen));
    $('#libraryFilters').classList.toggle('open', state.mobileFiltersOpen);
  };
  $('#typeFilter').onchange = (e) => { state.type = e.target.value; loadLibrary(); };
  $('#sortFilter').onchange = (e) => { state.sort = e.target.value; loadLibrary(); };
}
function closeMobileSearch() { const header = $('.topbar'); if (!header?.classList.contains('searching')) return; header.classList.remove('searching'); const button = $('#mobileSearchBtn'); button.setAttribute('aria-label', 'Open search'); button.innerHTML = icon('search'); hydrateIcons(button); }
function bindRoutes(root = document) { $$('[data-route]', root).forEach((button) => button.onclick = () => { stopActivePlayer(); closeMobileSearch(); state.mobileFiltersOpen = false; state.route = button.dataset.route; if (state.route === 'home') state.type = 'all'; state.query = ''; $('#searchInput').value = ''; window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); loadLibrary(); }); }

function relatedCard(item) {
  return `<article class="watch-card" data-watch="${item.id}" tabindex="0"><div class="watch-thumb"><img src="${item.backdrop}" alt="" loading="lazy" onerror="this.style.display='none'"><span class="watch-play">${icon('play')}</span></div><div class="watch-card-copy"><strong title="${esc(item.title)}">${esc(item.title)}</strong><small>${item.year || 'Unknown year'} · ${esc(mediaLabel(item))}</small></div></article>`;
}

function renderWatch(main, item) {
  const related = (state.library?.items || []).filter((x) => x.id !== item.id).slice(0, 14);
  const sourceWidth = Number(item.width) > 0 ? Number(item.width) : 16;
  const sourceHeight = Number(item.height) > 0 ? Number(item.height) : 9;
  main.innerHTML = `<div class="watch-page"><section class="watch-main"><div class="watch-stage"><div class="video-shell" style="--video-aspect:${sourceWidth} / ${sourceHeight};--video-ratio:${sourceWidth / sourceHeight}"><video id="watchVideo" controls autoplay playsinline preload="metadata" src="${item.stream}"></video></div></div>${['mkv','avi','wmv'].includes(item.container) ? `<div class="player-note">${icon('triangle-alert')} This format may not play in every browser. MP4 (H.264/AAC) and WebM have the widest support.</div>` : ''}<div class="watch-info"><div class="watch-title-row"><div><div class="watch-now">${icon('circle-play')} Now playing</div><h1 title="${esc(item.title)}">${esc(item.title)}</h1><div class="watch-meta"><span>${item.year || 'Year unknown'}</span><span>•</span><span>${esc(mediaLabel(item))}</span>${time(item.runtime_seconds) ? `<span>•</span><span>${time(item.runtime_seconds)}</span>` : ''}${quality(item) ? `<span class="quality">${quality(item)}</span>` : ''}</div></div><button class="watch-back" id="backFromWatch">${icon('chevron-left')} Back to library</button></div>${item.description ? `<div class="watch-description"><p>${esc(item.description)}</p></div>` : ''}</div></section><section class="watch-side"><div class="section-head"><div><h2>Up next</h2><p>More from your library</p></div></div><div class="watch-list">${related.length ? related.map(relatedCard).join('') : '<p class="help">Add more videos to see suggestions here.</p>'}</div></section></div>`;
  if (/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(item.title)) { $('.watch-info h1', main).textContent = 'Untitled video'; $('.watch-info h1', main).title = item.title; }
  const video = $('#watchVideo');
  const shell = $('.video-shell', main);
  const applyVideoAspect = (width, height) => { if (width > 0 && height > 0) { shell.style.setProperty('--video-aspect', `${width} / ${height}`); shell.style.setProperty('--video-ratio', String(width / height)); } };
  video.controls = false;
  shell.insertAdjacentHTML('beforeend', `<div class="seek-feedback" id="seekFeedback" aria-live="polite"></div><div class="player-controls" id="playerControls"><div class="seek-area"><input id="seekBar" class="seek-bar" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek through video"></div><div class="control-row"><button class="control-button primary-control" id="togglePlayback" aria-label="Pause">${icon('pause')}</button><button class="control-button" id="rewindVideo" aria-label="Go back 10 seconds">${icon('rotate-ccw')}<small>10</small></button><button class="control-button" id="forwardVideo" aria-label="Go forward 10 seconds">${icon('rotate-cw')}<small>10</small></button><span class="player-time"><span id="currentTime">0:00</span><i>/</i><span id="totalTime">${clockTime(item.runtime_seconds)}</span></span><div class="volume-control"><button class="control-button" id="muteVideo" aria-label="Mute">${icon('volume-2')}</button><input id="volumeBar" class="volume-bar" type="range" min="0" max="1" value="1" step="0.05" aria-label="Volume"></div><span class="control-spacer"></span><button class="control-button" id="fullscreenVideo" aria-label="Enter fullscreen">${icon('maximize')}</button></div></div>`);
  const seekBar = $('#seekBar', shell); const volumeBar = $('#volumeBar', shell); const playButton = $('#togglePlayback', shell); const muteButton = $('#muteVideo', shell); const fullscreenButton = $('#fullscreenVideo', shell); const seekFeedback = $('#seekFeedback', shell);
  let touchTapTimer; let feedbackTimer; let lastTouchTap = { at: 0, side: '' }; let ignoreTouchClickUntil = 0;
  const updateButtonIcon = (button, name, label) => { button.innerHTML = icon(name); button.setAttribute('aria-label', label); hydrateIcons(button); };
  const showControls = (persist = false) => { shell.classList.remove('controls-hidden'); clearTimeout(state.controlsTimer); if (!persist && !video.paused) state.controlsTimer = setTimeout(() => shell.classList.add('controls-hidden'), 2600); };
  const togglePlayback = () => video.paused ? video.play().catch(() => {}) : video.pause();
  const updateTimeline = () => { const duration = Number.isFinite(video.duration) ? video.duration : (item.runtime_seconds || 0); const progress = duration ? video.currentTime / duration : 0; seekBar.value = String(Math.round(progress * 1000)); seekBar.style.setProperty('--seek-progress', `${progress * 100}%`); $('#currentTime', shell).textContent = clockTime(video.currentTime); $('#totalTime', shell).textContent = clockTime(duration); };
  const seekBy = (seconds) => { const end = Number.isFinite(video.duration) ? video.duration : Infinity; video.currentTime = Math.max(0, Math.min(end, video.currentTime + seconds)); updateTimeline(); showControls(); };
  const showSeekFeedback = (seconds) => { seekFeedback.className = `seek-feedback ${seconds > 0 ? 'forward' : 'backward'} visible`; seekFeedback.innerHTML = `${icon(seconds > 0 ? 'rotate-cw' : 'rotate-ccw')}<strong>${seconds > 0 ? '+' : '−'}10s</strong>`; hydrateIcons(seekFeedback); clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => seekFeedback.classList.remove('visible'), 650); };
  const usesMobileGestures = () => matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  playButton.onclick = togglePlayback;
  $('#rewindVideo', shell).onclick = () => seekBy(-10);
  $('#forwardVideo', shell).onclick = () => seekBy(10);
  seekBar.oninput = () => { if (Number.isFinite(video.duration)) video.currentTime = Number(seekBar.value) / 1000 * video.duration; updateTimeline(); showControls(true); };
  seekBar.onchange = () => showControls();
  volumeBar.oninput = () => { video.volume = Number(volumeBar.value); video.muted = video.volume === 0; volumeBar.style.setProperty('--volume', video.volume); updateButtonIcon(muteButton, video.muted ? 'volume-x' : video.volume < .5 ? 'volume-1' : 'volume-2', video.muted ? 'Unmute' : 'Mute'); };
  muteButton.onclick = () => { video.muted = !video.muted; updateButtonIcon(muteButton, video.muted ? 'volume-x' : video.volume < .5 ? 'volume-1' : 'volume-2', video.muted ? 'Unmute' : 'Mute'); showControls(); };
  fullscreenButton.onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (shell.requestFullscreen) await shell.requestFullscreen(); else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); } catch { toast('Fullscreen is not available in this browser.', true); } };
  document.onfullscreenchange = () => updateButtonIcon(fullscreenButton, document.fullscreenElement ? 'minimize' : 'maximize', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  video.addEventListener('play', () => { updateButtonIcon(playButton, 'pause', 'Pause'); showControls(); });
  video.addEventListener('pause', () => { updateButtonIcon(playButton, 'play', 'Play'); showControls(true); });
  video.addEventListener('timeupdate', updateTimeline); video.addEventListener('durationchange', updateTimeline);
  shell.addEventListener('mousemove', () => showControls()); shell.addEventListener('mouseleave', () => { if (!video.paused) shell.classList.add('controls-hidden'); });
  video.addEventListener('click', () => { if (performance.now() < ignoreTouchClickUntil) return; if (shell.classList.contains('controls-hidden')) showControls(true); else togglePlayback(); });
  video.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch' || !usesMobileGestures()) return;
    event.preventDefault(); ignoreTouchClickUntil = performance.now() + 500;
    const bounds = video.getBoundingClientRect(); const side = event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right'; const now = performance.now();
    if (lastTouchTap.side === side && now - lastTouchTap.at < 350) { clearTimeout(touchTapTimer); lastTouchTap = { at: 0, side: '' }; const seconds = side === 'left' ? -10 : 10; seekBy(seconds); showSeekFeedback(seconds); return; }
    lastTouchTap = { at: now, side }; clearTimeout(touchTapTimer); touchTapTimer = setTimeout(() => { if (shell.classList.contains('controls-hidden')) showControls(true); else togglePlayback(); lastTouchTap = { at: 0, side: '' }; }, 360);
  });
  video.addEventListener('dblclick', (event) => { if (usesMobileGestures()) return; event.preventDefault(); fullscreenButton.click(); });
  document.onkeydown = (event) => { if (state.route !== 'watch' || (event.target instanceof Element && event.target.matches('input,textarea,select'))) return; if (event.code === 'Space') { event.preventDefault(); togglePlayback(); } else if (event.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 10); } else if (event.key === 'ArrowRight') { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); } else if (event.key.toLowerCase() === 'm') muteButton.click(); else if (event.key.toLowerCase() === 'f') fullscreenButton.click(); showControls(); };
  const resume = () => { if (item.position_seconds > 5 && Number.isFinite(video.duration)) video.currentTime = Math.min(item.position_seconds, Math.max(0, video.duration - 1)); };
  video.addEventListener('loadedmetadata', () => { applyVideoAspect(video.videoWidth, video.videoHeight); resume(); }, { once: true });
  video.addEventListener('error', () => toast('Your browser cannot play this file format directly.', true));
  video.addEventListener('ended', () => saveProgress(item.id, video));
  clearInterval(state.playerTimer); state.playerTimer = setInterval(() => saveProgress(item.id, video), 10000);
  $('#backFromWatch').onclick = () => { stopActivePlayer(); state.route = 'library'; loadLibrary(); };
  $$('[data-watch]', main).forEach((node) => {
    const open = () => play(Number(node.dataset.watch));
    node.onclick = open; node.onkeydown = (event) => { if (event.key === 'Enter') open(); };
  });
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

async function showDetails(id) {
  const item = await api(`/api/media/${id}`); state.current = item; const dialog = $('#detailsDialog');
  dialog.innerHTML = `<div class="details-hero" style="background-image:url('${item.backdrop}')"><button class="close details-close" aria-label="Close">${icon('x')}</button></div><div class="details-content"><h2>${esc(item.title)}</h2><div class="details-stats"><span>${item.year || 'Year unknown'}</span><span>•</span><span>${esc(mediaLabel(item))}</span><span>•</span><span>${time(item.runtime_seconds) || 'Runtime unknown'}</span>${quality(item) ? `<span class="quality">${quality(item)}</span>` : ''}</div><div class="actions details-actions"><button class="button primary" id="detailPlay">${icon('play')} ${item.position_seconds ? 'Resume' : 'Play'}</button><button class="button ghost" id="editMetadata">${icon('pencil')} Edit details</button></div>${item.description ? `<p>${esc(item.description)}</p>` : '<p>No description yet. Edit this title or refresh online metadata.</p>'}<div class="help">${esc(item.filename)}${item.video_codec ? ` · ${esc(item.video_codec.toUpperCase())}` : ''}${item.width ? ` · ${item.width}×${item.height}` : ''}</div></div>`;
  hydrateIcons(dialog);
  $('.details-close', dialog).onclick = () => dialog.close(); $('#detailPlay').onclick = () => { dialog.close(); play(id); }; $('#editMetadata').onclick = () => renderEditForm(dialog, item); dialog.showModal();
}
function renderEditForm(dialog, item) {
  dialog.innerHTML = `<div class="dialog-head"><h2>Edit details</h2><button class="close">${icon('x')}</button></div><form class="dialog-body" id="metadataForm"><div class="form-grid"><div class="field full"><label>Title</label><input class="input" name="title" required maxlength="200" value="${esc(item.title)}"></div><div class="field"><label>Type</label><select class="input" name="media_type">${['movie','episode','personal','tutorial','course','other'].map((x) => `<option ${item.media_type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>Year</label><input class="input" name="year" type="number" min="1800" max="2200" value="${item.year || ''}"></div><div class="field full"><label>Description</label><textarea class="input" name="description">${esc(item.description)}</textarea></div><div class="field full"><label>Genres (comma separated)</label><input class="input" name="genres" value="${esc(item.genres.join(', '))}"></div><div class="field"><label>Show / collection title</label><input class="input" name="show_title" value="${esc(item.show_title || '')}"></div><div class="field"><label>Season / episode</label><div style="display:flex;gap:8px"><input class="input" aria-label="Season" name="season_number" type="number" min="1" placeholder="Season" value="${item.season_number || ''}"><input class="input" aria-label="Episode" name="episode_number" type="number" min="1" placeholder="Episode" value="${item.episode_number || ''}"></div></div></div><div class="actions" style="margin-top:22px"><button class="button primary" type="submit">${icon('check')} Save changes</button><button class="button ghost" type="button" id="refreshMeta">${icon('refresh-cw')} Match online</button><button class="button ghost" type="button" id="newThumb">${icon('image')} New thumbnail</button></div></form>`;
  hydrateIcons(dialog);
  $('.close', dialog).setAttribute('aria-label', 'Close');
  $('.close', dialog).onclick = () => dialog.close();
  $('#metadataForm').onsubmit = async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); for (const key of ['year','season_number','episode_number']) data[key] = data[key] ? Number(data[key]) : null; data.show_title ||= null; data.genres = data.genres.split(',').map((x) => x.trim()).filter(Boolean); try { await api(`/api/media/${item.id}`, { method:'PUT', body:JSON.stringify(data) }); dialog.close(); toast('Details saved'); loadLibrary(); } catch (e) { toast(e.message, true); } };
  $('#refreshMeta').onclick = async (e) => { e.currentTarget.disabled = true; try { const out = await api(`/api/media/${item.id}/refresh-metadata`, { method:'POST' }); toast(out.matched ? 'Online metadata updated' : 'No confident match found', !out.matched); dialog.close(); loadLibrary(); } catch (err) { toast(err.message,true); } finally { e.currentTarget.disabled = false; } };
  $('#newThumb').onclick = async (e) => { e.currentTarget.disabled=true; try { await api(`/api/media/${item.id}/thumbnail`,{method:'POST'}); toast('Thumbnail regenerated'); } catch(err){toast(err.message,true)} finally{e.currentTarget.disabled=false} };
}

async function play(id) {
  stopActivePlayer();
  closeMobileSearch();
  state.current = await api(`/api/media/${id}`);
  state.route = 'watch';
  render();
}
function stopActivePlayer() { const video = $('#watchVideo'); if (video) { saveProgress(state.current?.id, video); video.pause(); } clearInterval(state.playerTimer); clearTimeout(state.controlsTimer); state.playerTimer = null; state.controlsTimer = null; document.onkeydown = null; document.onfullscreenchange = null; }
function saveProgress(id, video) { if (Number.isFinite(video.currentTime) && video.currentTime > 0) api(`/api/media/${id}/progress`, { method:'PUT', body:JSON.stringify({position:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null}) }).catch(() => {}); }

async function openSettings() {
  const [folders, settings] = await Promise.all([api('/api/folders'), api('/api/settings')]); const dialog = $('#settingsDialog');
  dialog.innerHTML = `<div class="dialog-head"><h2>Settings</h2><button class="close">${icon('x')}</button></div><div class="dialog-body"><div class="setting-block"><div class="setting-title"><div><h3>Media folders</h3><p>Home Library scans all supported video files inside these folders.</p></div><button class="button primary" id="addFolder">${icon('folder-plus')} Add folder</button></div><div class="folder-list">${folders.length ? folders.map((f)=>`<div class="folder"><span class="folder-icon">${icon('folder')}</span><div class="folder-copy"><strong>${esc(f.label)}</strong><small>${esc(f.path)}</small></div><button data-remove-folder="${f.id}" aria-label="Remove folder">${icon('trash-2')}</button></div>`).join('') : '<div class="help">No folders have been added yet.</div>'}</div></div><div class="setting-block"><div class="setting-title"><div><h3>Library scan</h3><p>Scan now, or choose how often Home Library checks for changes.</p></div><button class="button ghost" id="scanNow">${icon('refresh-cw')} Scan now</button></div><div class="field" style="margin-top:14px"><label>Automatic scan interval</label><select class="input" id="scanInterval"><option value="0">Off</option>${[5,15,30,60,180,360,720,1440].map((n)=>`<option value="${n}" ${settings.autoScanMinutes===n?'selected':''}>${n<60?`${n} minutes`:n===60?'Every hour':n===1440?'Daily':`Every ${n/60} hours`}</option>`).join('')}</select></div></div><div class="setting-block"><h3 style="margin-top:0">This device</h3><p class="help">Open Home Library on another device connected to the same network:</p>${state.config.addresses.map((x)=>`<div class="folder"><span class="folder-icon">${icon('wifi')}</span><div class="folder-copy"><strong>${esc(x)}</strong></div><button data-copy="${esc(x)}" aria-label="Copy address">${icon('copy')}</button></div>`).join('') || '<p class="help">No LAN address is currently available.</p>'}<p class="help">Online movie metadata: ${state.config.tmdbConfigured ? 'TMDB is configured.' : 'Add TMDB_API_KEY to the environment to enable movie matching. TV show matching works without a key.'}</p></div></div>`;
  hydrateIcons(dialog);
  $('.close', dialog).setAttribute('aria-label', 'Close');
  $('.close', dialog).onclick=()=>dialog.close(); $('#addFolder').onclick=()=>openBrowser(dialog); $('#scanNow').onclick=async()=>{await api('/api/scan',{method:'POST'});dialog.close();toast('Library scan started')}; $('#scanInterval').onchange=(e)=>api('/api/settings',{method:'PUT',body:JSON.stringify({autoScanMinutes:Number(e.target.value)})}).then(()=>toast('Scan schedule saved')).catch((x)=>toast(x.message,true));
  $$('[data-remove-folder]',dialog).forEach((b)=>b.onclick=async()=>{if(!confirm('Remove this folder and its videos from Home Library? Your original files will not be deleted.'))return;await api(`/api/folders/${b.dataset.removeFolder}`,{method:'DELETE'});dialog.close();openSettings();loadLibrary()});
  $$('[data-copy]',dialog).forEach((b)=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.copy).then(()=>toast('Address copied'))); dialog.showModal();
}
async function openBrowser(settingsDialog, at = '') {
  const data = await api(`/api/directories${at ? `?path=${encodeURIComponent(at)}` : ''}`); const dialog=$('#browserDialog');
  dialog.innerHTML=`<div class="dialog-head"><h2>Choose media folder</h2><button class="close">${icon('x')}</button></div><div class="dialog-body"><p class="browser-path">${esc(data.current)}</p><div class="browser-list">${data.parent?`<button class="browser-row" data-dir="${esc(data.parent)}">${icon('corner-left-up')} <span>Parent folder</span></button>`:''}${data.directories.map((d)=>`<button class="browser-row" data-dir="${esc(d.path)}"><span class="folder-icon">${icon('folder')}</span><span>${esc(d.name)}</span></button>`).join('')}</div><div class="browser-actions"><button class="button primary" id="chooseHere">${icon('check')} Choose this folder</button></div></div>`;
  hydrateIcons(dialog);
  $('.close', dialog).setAttribute('aria-label', 'Close');
  $('.close',dialog).onclick=()=>dialog.close(); $$('[data-dir]',dialog).forEach((b)=>b.onclick=()=>openBrowser(settingsDialog,b.dataset.dir)); $('#chooseHere').onclick=async()=>{try{await api('/api/folders',{method:'POST',body:JSON.stringify({path:data.current})});dialog.close();settingsDialog.close();toast('Folder added. Starting scan…');await api('/api/scan',{method:'POST'});openSettings()}catch(e){toast(e.message,true)}}; if(!dialog.open)dialog.showModal();
}

function showScan(scan) {
  let banner=$('.scan-banner'); if(!scan.running){banner?.remove();if(scan.phase==='complete'){toast(`Scan complete · ${scan.added} added · ${scan.removed} removed`);loadLibrary()}return}
  if(!banner){banner=document.createElement('div');banner.className='scan-banner';document.body.append(banner)} banner.innerHTML=`<span class="spinner"></span><div class="scan-copy"><strong>Scanning your library</strong><small>${scan.processed||0} checked${scan.current?` · ${esc(scan.current.split('/').pop())}`:''}</small></div>`;
}

async function init() {
  try { state.config=await api('/api/config'); document.title=state.config.name; $('#brandName').textContent=state.config.name; hydrateIcons(); bindRoutes(); $('#settingsBtn').onclick=openSettings; $('#mobileSettings').onclick=openSettings; $('#menuBtn').onclick=()=>document.body.classList.toggle('sidebar-collapsed'); $$('[data-filter]', $('.sidebar')).forEach((button)=>button.onclick=()=>{state.type=button.dataset.filter;state.route='library';loadLibrary()}); $('[data-shortcut="shorts"]').onclick=()=>{state.type='all';state.route='home';loadLibrary().then(()=>requestAnimationFrame(()=>$('.shorts-shelf')?.scrollIntoView({behavior:'smooth',block:'start'})))}; const focusSearch=()=>{const input=$('#searchInput');input.focus({preventScroll:true});const end=input.value.length;input.setSelectionRange(end,end)}; const mobileSearchButton=$('#mobileSearchBtn'); const setMobileSearch=(opening)=>{const header=$('.topbar');header.classList.toggle('searching',opening);mobileSearchButton.setAttribute('aria-label',opening?'Close search':'Open search');mobileSearchButton.innerHTML=icon(opening?'x':'search');hydrateIcons(mobileSearchButton);if(opening){focusSearch();requestAnimationFrame(focusSearch)}else if(!$('#searchInput').value)$('#searchInput').blur()}; let openedOnPointerDown=false; mobileSearchButton.onpointerdown=(event)=>{if(!$('.topbar').classList.contains('searching')){event.preventDefault();openedOnPointerDown=true;setMobileSearch(true)}}; mobileSearchButton.onclick=(event)=>{event.preventDefault();if(openedOnPointerDown){openedOnPointerDown=false;return}setMobileSearch(!$('.topbar').classList.contains('searching'))}; $('.search-submit').onclick=focusSearch; let debounce; $('#searchInput').oninput=(e)=>{clearTimeout(debounce);debounce=setTimeout(()=>{stopActivePlayer();state.query=e.target.value.trim();state.route='library';loadLibrary()},250)}; const events=new EventSource('/api/events');events.addEventListener('scan',(e)=>showScan(JSON.parse(e.data)));await loadLibrary(); } catch(error){ $('#main').innerHTML=`<div class="page"><div class="empty"><div><h2>Home Library could not start</h2><p>${esc(error.message)}</p></div></div></div>`; }
}
init();
