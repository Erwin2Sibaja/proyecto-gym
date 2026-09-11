window.addEventListener('DOMContentLoaded', () => {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch { /* Keep this session usable without storage. */ } }
    };
    const noticeVersion = '1';
    let accepted = storage.get('gymNoticeVersion') === noticeVersion;
    const savedLang = storage.get('uiLang');
    let lang = ['es', 'en'].includes(savedLang) ? savedLang : (navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en');
    let destino = storage.get('uiDestino');
    if (!['cancun', 'cabos'].includes(destino)) destino = null;
    let currentSectionId = 'pecho';
    let currentSub = 'cuerpo';
    let requestId = 0;
    let editing = false;
    const cache = new Map();
    const app = $('#app');
    const onboarding = $('#onboarding');
    const copy = {
        es: { preferences: 'Preferencias', destination: '¿En qué destino entrenas?', language: 'Idioma', save: 'Guardar', cancel: 'Cancelar', continue: 'Continuar', notice: 'Aviso importante', accept: 'Entendido', back: 'Cambiar preferencias', loading: 'Cargando rutinas…', error: 'No pudimos cargar las rutinas. Revisa tu conexión e inténtalo de nuevo.', retry: 'Reintentar', previous: 'Foto anterior', next: 'Foto siguiente', photo: 'Foto', of: 'de', tips: 'Ocultar consejos', menu: 'Menú', missing: 'Fotografía no disponible', disclaimer: '💡 Recuerda: Estas rutinas son solo una guía general para ayudarte a mantenerte activo y motivado. No reemplazan la orientación de un profesional de la salud o del ejercicio. Escucha siempre a tu cuerpo, ajusta el peso a tu nivel, descansa lo necesario y progresa de manera gradual. Nos deslindamos de cualquier responsabilidad por lesiones o accidentes durante su práctica.' },
        en: { preferences: 'Preferences', destination: 'Where are you training?', language: 'Language', save: 'Save', cancel: 'Cancel', continue: 'Continue', notice: 'Important Notice', accept: 'Got it', back: 'Change preferences', loading: 'Loading routines…', error: 'We could not load the routines. Check your connection and try again.', retry: 'Try again', previous: 'Previous photo', next: 'Next photo', photo: 'Photo', of: 'of', tips: 'Hide tips', menu: 'Menu', missing: 'Photo unavailable', disclaimer: '💡 Remember: These routines are only a general guide to help you stay active and motivated. They do not replace professional medical or fitness advice. Always listen to your body, adjust the weight to your level, rest properly, and progress gradually. We are not responsible for any injuries or accidents that may occur during your practice.' }
    };
    const t = () => copy[lang];
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

    function trackGymDestination(destination, uiLang, isChange = false) {
        if (!['cancun', 'cabos'].includes(destination) || !['es', 'en'].includes(uiLang)) return;
        const eventName = 'select_gym_destination';
        const params = {
            destination_name: destination,
            destination,
            ui_lang: uiLang,
            is_change: isChange,
            page_path: window.location.pathname
        };
        try {
            if (typeof window.gtag === 'function') {
                console.log('[GA4] Evento enviado:', eventName, params);
                window.gtag('event', eventName, params);
                return;
            }
        } catch { /* Try GTM if gtag is unavailable or fails. */ }
        try {
            if (typeof window.dataLayer?.push === 'function') {
                window.dataLayer.push({ event: eventName, ...params });
                return;
            }
        } catch { /* Analytics must not interrupt onboarding. */ }

        // Enable only after /api/gym/track-visit is available.
        const enableBackendFallback = false;
        if (!enableBackendFallback) return;
        try {
            const endpoint = '/api/gym/track-visit';
            const body = JSON.stringify({ event: eventName, ...params });
            let queued = false;
            try {
                if (typeof navigator.sendBeacon === 'function') {
                    queued = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
                }
            } catch { /* Fall back to fetch if beacon fails. */ }
            if (!queued && typeof window.fetch === 'function') {
                void window.fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true
                }).catch(() => {});
            }
        } catch { /* Keep the UI usable without a telemetry backend. */ }
    }

    function translate() {
        document.documentElement.lang = lang;
        $$('[data-ui]').forEach(el => { el.textContent = t()[el.dataset.ui]; });
        $('#preferencesBtn').textContent = `${destino === 'cabos' ? 'Los Cabos' : 'Cancún'} · ${lang.toUpperCase()} · ${t().preferences}`;
        $('.tips-close').setAttribute('aria-label', t().tips);
        $('#hamburgerBtn').setAttribute('aria-label', t().menu);
        $('#disclaimerText').textContent = t().disclaimer;
    }
    function showStep(id) {
        onboarding.hidden = false;
        app.hidden = true;
        $$('.onboarding-step').forEach(step => step.classList.toggle('activo', step.id === id));
        requestAnimationFrame(() => $('h2, h3', $('#'+id)).focus());
    }
    function openPreferences() {
        $$('input[name=destination]').forEach(input => { input.checked = input.value === destino; });
        $$('input[name=language]').forEach(input => { input.checked = input.value === lang; });
        $('#cancelPreferences').hidden = !editing;
        $('#savePreferences').textContent = editing ? t().save : t().continue;
        showStep('step-preferences');
    }
    function enterApp() {
        onboarding.hidden = true;
        app.hidden = false;
        editing = false;
        translate();
        loadData();
        $('#preferencesBtn').focus();
    }
    $('#preferencesBtn').addEventListener('click', () => { editing = true; openPreferences(); });
    $('#cancelPreferences').addEventListener('click', () => {
        onboarding.hidden = true;
        app.hidden = false;
        editing = false;
        $('#preferencesBtn').focus();
    });
    $('#preferencesForm').addEventListener('submit', event => {
        event.preventDefault();
        const selectedDestination = $('input[name=destination]:checked')?.value;
        const selectedLang = $('input[name=language]:checked')?.value;
        if (!['cancun', 'cabos'].includes(selectedDestination) || !['es', 'en'].includes(selectedLang)) return;
        destino = selectedDestination;
        lang = selectedLang;
        trackGymDestination(destino, lang, editing);
        storage.set('uiDestino', destino);
        storage.set('uiLang', lang);
        translate();
        if (accepted) enterApp();
        else showStep('step-disclaimer');
    });
    $('#noticeBack').addEventListener('click', openPreferences);
    $('#acceptDisclaimer').addEventListener('click', () => {
        accepted = true;
        storage.set('gymNoticeVersion', noticeVersion);
        enterApp();
    });
    $('#retryLoad').addEventListener('click', loadData);
    $('.tips-close').addEventListener('click', () => { $('#consejos').hidden = true; });
    $('#hamburgerBtn').addEventListener('click', event => {
        const open = $('.menu-inferior').classList.toggle('open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
    });
    $('.menu-inferior').addEventListener('click', event => {
        const button = event.target.closest('[data-seccion]');
        if (!button) return;
        currentSectionId = button.dataset.seccion;
        activateSection();
        $('.menu-inferior').classList.remove('open');
        $('#hamburgerBtn').setAttribute('aria-expanded', 'false');
        window.scrollTo({ top: 0, behavior: motion() });
    });
    $('#sections').addEventListener('click', event => {
        const button = event.target.closest('[data-sub]');
        if (!button) return;
        currentSub = button.dataset.sub;
        activateSection();
    });

    async function loadData() {
        const id = ++requestId;
        const key = `${destino}_${lang}`;
        $('#loadStatus').hidden = false;
        $('#loadMessage').textContent = t().loading;
        $('#retryLoad').hidden = true;
        $('#sections').hidden = true;
        $('#sections').setAttribute('aria-busy', 'true');
        try {
            if (!cache.has(key)) {
                const response = await fetch(`./assets/i18n/${key}.js`);
                if (!response.ok) throw new Error('Catalog request failed');
                // Existing catalogs contain a JSON object assigned to window.rutinasData.
                // Parse the object as data, without executing downloaded JavaScript.
                const source = await response.text();
                const data = JSON.parse(source.replace(/^\s*window\.rutinasData\s*=\s*/, '').replace(/;\s*$/, ''));
                if (!data.ui || !Array.isArray(data.sections)) throw new Error('Invalid catalog');
                cache.set(key, data);
            }
            if (id !== requestId) return;
            $('#sections').hidden = false;
            renderData(cache.get(key));
            $('#loadStatus').hidden = true;
        } catch {
            if (id !== requestId) return;
            $('#loadMessage').textContent = t().error;
            $('#retryLoad').hidden = false;
        } finally {
            if (id === requestId) $('#sections').setAttribute('aria-busy', 'false');
        }
    }
    function activateSection() {
        $$('.seccion').forEach(section => section.classList.toggle('activo', section.id === currentSectionId));
        $$('.menu-boton').forEach(button => {
            const active = button.dataset.seccion === currentSectionId;
            button.classList.toggle('activo', active);
            button.setAttribute('aria-pressed', String(active));
        });
        $$('.subnav-btn').forEach(button => {
            const active = button.dataset.sub === currentSub;
            button.classList.toggle('activo', active);
            button.setAttribute('aria-pressed', String(active));
        });
        $$('.subseccion').forEach(section => section.classList.toggle('activo', section.id === `sub-${currentSub}`));
        $$('.seccion.activo img[data-src]').forEach(img => {
            const sub = img.closest('.subseccion');
            if (sub && !sub.classList.contains('activo')) return;
            img.src = img.dataset.src;
            delete img.dataset.src;
        });
    }
    function buildImages(exercise) {
        return exercise.images.map((src, index) => `<img data-src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="${escapeHtml(exercise.title)} — ${t().photo} ${index + 1} ${t().of} ${exercise.images.length}">`).join('');
    }
    function renderData(data) {
        galleryObserver?.disconnect();
        // 1. Render UI Tips
        const tipsList = $('.tips-list');
        if (tipsList) {
            tipsList.innerHTML = '';
            data.ui.tips.forEach(tip => {
                const li = document.createElement('li');
                li.className = 'chip';
                li.textContent = tip;
                tipsList.appendChild(li);
            });
        }

        // 2. Update Nav Texts
        $$('.menu-boton').forEach(btn => {
            const id = btn.dataset.seccion;
            const p = btn.querySelector('p');
            if (id && p && data.ui.nav[id]) {
                p.textContent = data.ui.nav[id];
            }
        });

        // 3. Render Sections
        const mainSections = $('#sections');
        if (mainSections) {
            mainSections.innerHTML = ''; // Clear previous

            data.sections.forEach(secData => {
                const section = document.createElement('section');
                section.id = secData.id;
                section.className = 'seccion';
                section.dataset.index = secData.index;

                if (secData.id === 'full-body' && secData.subsections && secData.subsections.length > 0) {
                    // Full-body subnav
                    let html = `
                    <div class="subnav">
                        <button class="subnav-btn activo" data-sub="cuerpo">${data.ui.fullbody_subnav.cuerpo}</button>
                        <button class="subnav-btn" data-sub="cardio">${data.ui.fullbody_subnav.cardio}</button>
                    </div>`;

                    secData.subsections.forEach((sub, idx) => {
                        html += `<div id="${sub.id}" class="subseccion ${idx === 0 ? 'activo' : ''}">`;
                        html += buildSectionContent(sub, data.ui);
                        html += `</div>`;
                    });
                    section.innerHTML = html;
                } else {
                    section.innerHTML = buildSectionContent(secData, data.ui);
                }

                mainSections.appendChild(section);
            });
        }

        activateSection();
        initSliders();
    }

    function buildSectionContent(secData, ui) {
        let html = '';
        if (secData.warmup && secData.warmup.length > 0) {
            html += `<div class="calentamiento">`;
            const warmupTitle = (secData.id === 'sub-cardio') ? ui.cardio_workouts : ui.warmup;
            html += (secData.id.startsWith('sub-')) ? `<h2>${warmupTitle}</h2>` : `<div class="calentamiento-titulo">${warmupTitle}</div>`;
            
            secData.warmup.forEach(cal => {
                html += `
                <div class="calentamiento-ejercicio">
                    <h4>${cal.title}</h4>
                    <div class="imagenes-ejercicio">
                        ${buildImages(cal)}
                    </div>
                    <div class="calentamiento-desc">${cal.desc}</div>
                </div>`;
            });
            html += `</div>`;
        }

        if (secData.exercises && secData.exercises.length > 0) {
            html += `<h2>${ui.main_exercises}</h2>`;
            secData.exercises.forEach(ej => {
                html += `
                <div class="ejercicio">
                    <h3>${ej.title}</h3>
                    <div class="imagenes-ejercicio">
                        ${buildImages(ej)}
                    </div>
                    <p class="ej-desc">${ej.desc}</p>`;
                
                if (ej.variation) {
                    html += `
                    <div class="variacion">
                        <span class="var-label">${ui.variation}</span>
                        <h4>${ej.variation.title}</h4>
                        <div class="imagenes-ejercicio">
                            ${buildImages(ej.variation)}
                        </div>
                        <p class="ej-desc">${ej.variation.desc}</p>
                    </div>`;
                }
                html += `</div>`;
            });
        }
        return html;
    }

    function initSliders() {
        $$('.imagenes-ejercicio').forEach(gallery => {
            const images = $$('img', gallery);
            const track = document.createElement('div');
            track.className = 'track';
            images.forEach(img => {
                const slide = document.createElement('div');
                slide.className = 'slide';
                slide.append(img);
                track.append(slide);
            });
            gallery.replaceChildren(track);
            if (images.length < 2) return;
            const controls = document.createElement('div');
            controls.className = 'gallery-controls';
            controls.innerHTML = `<button type="button" aria-label="${t().previous}">‹</button><span class="gallery-count"></span><button type="button" aria-label="${t().next}">›</button>`;
            const [previous, next] = $$('button', controls);
            const count = $('.gallery-count', controls);
            const update = () => {
                const width = track.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(track).gap);
                const index = Math.round(track.scrollLeft / width) + 1;
                count.textContent = `${Math.min(images.length, Math.max(1, index || 1))} ${t().of} ${images.length}`;
                previous.disabled = track.scrollLeft <= 1;
                next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1;
            };
            const move = direction => {
                const step = track.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(track).gap);
                track.scrollBy({ left: step * direction, behavior: motion() });
            };
            previous.addEventListener('click', () => move(-1));
            next.addEventListener('click', () => move(1));
            track.addEventListener('scroll', update, { passive: true });
            gallery.append(controls);
            if (galleryObserver) galleryObserver.observe(track);
            update();
            track.galleryUpdate = update;
        });
    }
    const galleryObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
        entries.forEach(entry => entry.target.galleryUpdate?.());
    }) : null;
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(entries => {
            document.documentElement.style.setProperty('--header-height', `${entries[0].target.getBoundingClientRect().height}px`);
        }).observe($('header'));
        new ResizeObserver(entries => {
            const height = entries[0].target.getBoundingClientRect().height;
            if (height > 0) document.documentElement.style.setProperty('--bottom-menu-height', `${height}px`);
        }).observe($('.menu-inferior'));
    }
    translate();
    if (destino && accepted) enterApp();
    else if (destino) showStep('step-disclaimer');
    else openPreferences();
});
