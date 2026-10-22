(function () {
    'use strict';

    const CONFIG = JSON.parse(document.getElementById('constructor-config').textContent);
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const KIND_ICON = {
        pc: 'M3 4h18v12H3z M8 20h8 M12 16v4',
        printer: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z',
        meeting: 'M3 6h12v12H3z M15 10l6-3v10l-6-3z',
        server: 'M4 3h16v7H4z M4 14h16v7H4z M8 6.5h.01 M8 17.5h.01',
    };
    const KIND_NAMES = {
        pc: 'Стол сотрудника (ПК)',
        printer: 'МФУ / Принтер',
        meeting: 'ВКС / Переговорная',
        server: 'Серверная стойка',
    };

    // ---------- Состояние редактора ----------
    const normalizedFloors = (CONFIG.floors || []).map((f) => ({
        ...f,
        width: Number(f.width) || 1200,
        height: Number(f.height) || 700,
        walls: Array.isArray(f.walls) ? f.walls : [],
        labels: Array.isArray(f.labels) ? f.labels : [],
        workplaces: Array.isArray(f.workplaces) ? f.workplaces : [],
    }));

    const state = {
        floors: normalizedFloors,
        activeFloorId: CONFIG.active_floor_id || (normalizedFloors[0] ? normalizedFloors[0].id : null),
        currentTool: 'select', // select, wall, label, pc, printer, meeting, server, delete
        gridSnap: 20,
        selectedItem: null, // { type: 'wall'|'label'|'workplace', index: number, data: object }
        wallStart: null,    // { x, y } для рисования стены
        isDragging: false,
        dragTarget: null,
        dragOffset: { x: 0, y: 0 },
        mousePos: { x: 0, y: 0 },

        // Список сотрудников для поиска и привязки
        employees: CONFIG.employees || [],

        // Масштабирование и панорамирование
        zoom: 1.0,
        viewBox: { x: 0, y: 0, w: 1200, h: 700 },
        isSpacePressed: false,
        isPanning: false,
        panStart: { clientX: 0, clientY: 0, startVx: 0, startVy: 0 },
        didPan: false,
    };

    if (!state.employees || state.employees.length === 0) {
        fetch('/api/employees/')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data && data.employees) {
                    state.employees = data.employees;
                }
            })
            .catch(() => {});
    }

    // ---------- Получение CSRF токена ----------
    function getCsrfToken() {
        const name = 'csrftoken';
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatDeskLabel(label) {
        if (!label) return '';
        const s = String(label).trim();
        if (s.toLowerCase() === 'место переговоров') return 'Переговорная';
        return s.length > 14 ? s.slice(0, 13) + '…' : s;
    }

    function getCurrentFloor() {
        return state.floors.find((f) => f.id === state.activeFloorId);
    }

    function getFloorDims(floor = getCurrentFloor()) {
        const w = (floor && Number(floor.width)) || 1200;
        const h = (floor && Number(floor.height)) || 700;
        return { w, h };
    }

    // ---------- Утилиты SVG ----------
    function svg(tag, attrs = {}) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v != null) node.setAttribute(k, v);
        }
        return node;
    }

    function snap(val, step, isShiftPressed) {
        if (isShiftPressed || !step || step <= 0) return Math.round(val);
        return Math.round(val / step) * step;
    }

    function updateStatusAndZoomDisplay(coords) {
        const zoomPercent = Math.round(state.zoom * 100);
        const zoomResetBtn = document.getElementById('zoomResetBtn');
        if (zoomResetBtn) {
            zoomResetBtn.textContent = `${zoomPercent}%`;
        }
        const canvasStatus = document.getElementById('canvasStatus');
        if (canvasStatus) {
            const x = coords ? coords.x : (state.mousePos ? state.mousePos.x : 0);
            const y = coords ? coords.y : (state.mousePos ? state.mousePos.y : 0);
            canvasStatus.textContent = `X: ${x}, Y: ${y} · ${zoomPercent}%`;
        }
    }

    function setZoom(newZoom, anchorX, anchorY) {
        const clampedZoom = Math.max(0.4, Math.min(6.0, newZoom));
        if (Math.abs(clampedZoom - state.zoom) < 0.001) return;

        const svgEl = document.getElementById('editorSvg');
        const { w: baseW, h: baseH } = getFloorDims();

        if (anchorX == null || anchorY == null) {
            anchorX = state.viewBox.x + state.viewBox.w / 2;
            anchorY = state.viewBox.y + state.viewBox.h / 2;
        }

        const rx = (anchorX - state.viewBox.x) / state.viewBox.w;
        const ry = (anchorY - state.viewBox.y) / state.viewBox.h;

        const newW = baseW / clampedZoom;
        const newH = baseH / clampedZoom;

        let newX = anchorX - rx * newW;
        let newY = anchorY - ry * newH;

        const marginX = newW * 0.6;
        const marginY = newH * 0.6;
        newX = Math.max(-marginX, Math.min(baseW + marginX - newW, newX));
        newY = Math.max(-marginY, Math.min(baseH + marginY - newH, newY));

        state.zoom = clampedZoom;
        state.viewBox = {
            x: Math.round(newX),
            y: Math.round(newY),
            w: Math.round(newW),
            h: Math.round(newH),
        };

        svgEl.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
        updateStatusAndZoomDisplay();
    }

    function resetZoom() {
        const { w: baseW, h: baseH } = getFloorDims();
        state.zoom = 1.0;
        state.viewBox = { x: 0, y: 0, w: baseW, h: baseH };
        const svgEl = document.getElementById('editorSvg');
        svgEl.setAttribute('viewBox', `0 0 ${baseW} ${baseH}`);
        svgEl.style.aspectRatio = `${baseW} / ${baseH}`;
        const gridBg = svgEl.querySelector('.grid-bg');
        if (gridBg) {
            gridBg.setAttribute('width', String(baseW));
            gridBg.setAttribute('height', String(baseH));
        }
        updateStatusAndZoomDisplay();
    }

    function getSvgCoordinates(e) {
        const svgEl = document.getElementById('editorSvg');
        const { w: baseW, h: baseH } = getFloorDims();
        const pt = svgEl.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const cursorPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
        const isShift = e.shiftKey;
        const snappedX = Math.max(0, Math.min(baseW, snap(cursorPt.x, state.gridSnap, isShift)));
        const snappedY = Math.max(0, Math.min(baseH, snap(cursorPt.y, state.gridSnap, isShift)));
        return {
            rawX: Math.round(cursorPt.x),
            rawY: Math.round(cursorPt.y),
            x: snappedX,
            y: snappedY,
        };
    }

    // ---------- Уведомления (Toast) ----------
    let toastTimeout = null;
    function showToast(text, type = 'success') {
        const toast = document.getElementById('editorToast');
        toast.textContent = text;
        toast.className = `toast toast--show toast--${type}`;
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.className = 'toast';
        }, 2500);
    }

    // ---------- Рендеринг вкладок этажей ----------
    function renderFloorTabs() {
        const tabsEl = document.getElementById('editorFloorTabs');
        tabsEl.innerHTML = '';
        state.floors.forEach((f) => {
            const btn = document.createElement('button');
            btn.className = `floor-tab${f.id === state.activeFloorId ? ' floor-tab--active' : ''}`;
            btn.type = 'button';
            btn.textContent = f.name;
            btn.title = f.name;
            btn.onclick = () => switchFloor(f.id);
            tabsEl.appendChild(btn);
        });

        const current = getCurrentFloor();
        if (current) {
            document.getElementById('floorNameInput').value = current.name;
        }
    }

    function switchFloor(id) {
        state.activeFloorId = id;
        state.selectedItem = null;
        state.wallStart = null;
        resetZoom();
        renderFloorTabs();
        renderCanvas();
        renderInspector();
        history.replaceState(null, '', `/constructor/${id}/`);
    }

    // ---------- Рендеринг холста ----------
    const editorSvg = document.getElementById('editorSvg');
    const wallsLayer = document.getElementById('wallsLayer');
    const labelsLayer = document.getElementById('labelsLayer');
    const workplacesLayer = document.getElementById('workplacesLayer');
    const tempLayer = document.getElementById('tempLayer');

    function renderCanvas() {
        const floor = getCurrentFloor();
        if (!floor) return;

        floor.walls = floor.walls || [];
        floor.labels = floor.labels || [];
        floor.workplaces = floor.workplaces || [];

        wallsLayer.innerHTML = '';
        labelsLayer.innerHTML = '';
        workplacesLayer.innerHTML = '';
        tempLayer.innerHTML = '';

        // 1. Стены
        floor.walls.forEach((w, index) => {
            const isSelected = state.selectedItem && state.selectedItem.type === 'wall' && state.selectedItem.index === index;
            const line = svg('line', {
                class: `wall-element${isSelected ? ' wall-element--selected' : ''}`,
                x1: w.x1,
                y1: w.y1,
                x2: w.x2,
                y2: w.y2,
                'data-index': index,
            });
            line.onclick = (e) => handleItemClick('wall', index, e);
            wallsLayer.appendChild(line);

            if (isSelected) {
                // Точки на концах выбранной стены
                const h1 = svg('circle', { class: 'wall-handle', cx: w.x1, cy: w.y1, r: 5 });
                const h2 = svg('circle', { class: 'wall-handle', cx: w.x2, cy: w.y2, r: 5 });
                wallsLayer.appendChild(h1);
                wallsLayer.appendChild(h2);
            }
        });

        // 2. Подписи комнат
        floor.labels.forEach((l, index) => {
            const isSelected = state.selectedItem && state.selectedItem.type === 'label' && state.selectedItem.index === index;
            const textNode = svg('text', {
                class: `label-element${isSelected ? ' label-element--selected' : ''}`,
                x: l.x,
                y: l.y,
                'data-index': index,
            });
            textNode.textContent = l.text;
            textNode.onclick = (e) => handleItemClick('label', index, e);
            labelsLayer.appendChild(textNode);
        });

        // 3. Рабочие места
        const deskW = 72;
        const deskH = 48;
        floor.workplaces.forEach((wp, index) => {
            const isSelected = state.selectedItem && state.selectedItem.type === 'workplace' && state.selectedItem.index === index;
            const g = svg('g', {
                class: `desk-element${isSelected ? ' desk-element--selected' : ''}`,
                transform: `translate(${wp.x}, ${wp.y})`,
                'data-index': index,
            });

            // Прямоугольник стола
            const rect = svg('rect', {
                class: 'desk-rect',
                x: -deskW / 2,
                y: -deskH / 2,
                width: deskW,
                height: deskH,
            });
            g.appendChild(rect);

            // Иконка типа оборудования
            const iconPath = svg('path', {
                class: 'desk-icon',
                d: KIND_ICON[wp.kind] || KIND_ICON.pc,
                transform: 'translate(-10, -21) scale(0.84)',
            });
            g.appendChild(iconPath);

            // Код места
            const textCode = svg('text', {
                class: 'desk-text-code',
                x: 0,
                y: 17,
            });
            textCode.textContent = wp.code;
            g.appendChild(textCode);

            // Подпись оборудования / места (сотрудника на самом плане не подписываем)
            const textName = svg('text', {
                class: 'desk-text-name',
                x: 0,
                y: deskH / 2 + 16,
            });
            textName.textContent = formatDeskLabel(wp.label);
            g.appendChild(textName);

            g.onclick = (e) => handleItemClick('workplace', index, e);
            g.onmousedown = (e) => handleItemMouseDown('workplace', index, e);
            workplacesLayer.appendChild(g);
        });
    }

    // ---------- Обработка клика по объектам ----------
    function handleItemClick(type, index, e) {
        e.stopPropagation();
        const floor = getCurrentFloor();

        if (state.currentTool === 'delete') {
            deleteItem(type, index);
            return;
        }

        if (state.currentTool === 'select') {
            let data = null;
            if (type === 'wall') data = floor.walls[index];
            if (type === 'label') data = floor.labels[index];
            if (type === 'workplace') data = floor.workplaces[index];

            state.selectedItem = { type, index, data };
            renderCanvas();
            renderInspector();
        }
    }

    function handleItemMouseDown(type, index, e) {
        if (state.currentTool !== 'select') return;
        if (e.button !== 0) return; // только левая кнопка
        e.stopPropagation();

        const floor = getCurrentFloor();
        let targetData = null;
        if (type === 'workplace') targetData = floor.workplaces[index];
        if (type === 'label') targetData = floor.labels[index];

        if (targetData) {
            state.isDragging = true;
            state.dragTarget = { type, index, data: targetData };
            const coords = getSvgCoordinates(e);
            state.dragOffset = {
                x: coords.rawX - targetData.x,
                y: coords.rawY - targetData.y,
            };
            editorSvg.classList.add('cursor-grabbing');
        }
    }

    function deleteItem(type, index) {
        const floor = getCurrentFloor();
        if (type === 'wall') floor.walls.splice(index, 1);
        if (type === 'label') floor.labels.splice(index, 1);
        if (type === 'workplace') floor.workplaces.splice(index, 1);

        if (state.selectedItem && state.selectedItem.type === type && state.selectedItem.index === index) {
            state.selectedItem = null;
        } else if (state.selectedItem && state.selectedItem.type === type && state.selectedItem.index > index) {
            state.selectedItem.index -= 1;
        }

        renderCanvas();
        renderInspector();
    }

    // ---------- Взаимодействие с холстом (Зум и Панорамирование) ----------
    editorSvg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const pt = editorSvg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const cursorPt = pt.matrixTransform(editorSvg.getScreenCTM().inverse());

        // Колёсико мыши: зум с центром в точке курсора
        const factor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
        setZoom(state.zoom * factor, cursorPt.x, cursorPt.y);
    }, { passive: false });

    editorSvg.addEventListener('mousedown', (e) => {
        // СКМ (средняя кнопка) или ЛКМ с зажатым пробелом -> начало панорамирования
        if (e.button === 1 || (e.button === 0 && state.isSpacePressed)) {
            state.isPanning = true;
            state.didPan = false;
            state.panStart = {
                clientX: e.clientX,
                clientY: e.clientY,
                startVx: state.viewBox.x,
                startVy: state.viewBox.y,
            };
            editorSvg.classList.add('cursor-panning');
            e.preventDefault();
            e.stopPropagation();
        }
    });

    editorSvg.addEventListener('mousemove', (e) => {
        const { w: baseW, h: baseH } = getFloorDims();
        // 1. Панорамирование холста
        if (state.isPanning) {
            const screenDx = e.clientX - state.panStart.clientX;
            const screenDy = e.clientY - state.panStart.clientY;
            if (Math.hypot(screenDx, screenDy) > 3) {
                state.didPan = true;
            }
            const svgRect = editorSvg.getBoundingClientRect();
            const scaleX = state.viewBox.w / svgRect.width;
            const scaleY = state.viewBox.h / svgRect.height;

            let newVx = state.panStart.startVx - screenDx * scaleX;
            let newVy = state.panStart.startVy - screenDy * scaleY;

            const marginX = state.viewBox.w * 0.6;
            const marginY = state.viewBox.h * 0.6;
            newVx = Math.max(-marginX, Math.min(baseW + marginX - state.viewBox.w, newVx));
            newVy = Math.max(-marginY, Math.min(baseH + marginY - state.viewBox.h, newVy));

            state.viewBox.x = Math.round(newVx);
            state.viewBox.y = Math.round(newVy);
            editorSvg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
            return;
        }

        const coords = getSvgCoordinates(e);
        state.mousePos = coords;
        updateStatusAndZoomDisplay(coords);

        // 2. Перетаскивание объекта
        if (state.isDragging && state.dragTarget) {
            const isShift = e.shiftKey;
            const newX = snap(coords.rawX - state.dragOffset.x, state.gridSnap, isShift);
            const newY = snap(coords.rawY - state.dragOffset.y, state.gridSnap, isShift);
            state.dragTarget.data.x = Math.max(30, Math.min(baseW - 30, newX));
            state.dragTarget.data.y = Math.max(30, Math.min(baseH - 30, newY));
            renderCanvas();
            renderInspector();
            return;
        }

        // 3. Превью стены при рисовании
        if (state.currentTool === 'wall' && state.wallStart) {
            tempLayer.innerHTML = '';
            const preview = svg('line', {
                class: 'wall-preview',
                x1: state.wallStart.x,
                y1: state.wallStart.y,
                x2: coords.x,
                y2: coords.y,
            });
            tempLayer.appendChild(preview);

            // Точки-узлы
            tempLayer.appendChild(svg('circle', { class: 'snap-point', cx: state.wallStart.x, cy: state.wallStart.y }));
            tempLayer.appendChild(svg('circle', { class: 'snap-point', cx: coords.x, cy: coords.y }));
        }
    });

    window.addEventListener('mouseup', () => {
        if (state.isPanning) {
            state.isPanning = false;
            editorSvg.classList.remove('cursor-panning');
            if (state.isSpacePressed) {
                editorSvg.classList.add('cursor-pan');
            }
        }
        if (state.isDragging) {
            state.isDragging = false;
            state.dragTarget = null;
            editorSvg.classList.remove('cursor-grabbing');
        }
    });

    editorSvg.addEventListener('click', (e) => {
        // Если только что сдвигали холст мышью, клик игнорируем
        if (state.didPan) {
            state.didPan = false;
            return;
        }

        const coords = getSvgCoordinates(e);
        const floor = getCurrentFloor();
        if (!floor) return;

        // Рисование стены
        if (state.currentTool === 'wall') {
            if (!state.wallStart) {
                // Начальная точка стены
                state.wallStart = { x: coords.x, y: coords.y };
            } else {
                // Конечная точка стены
                if (state.wallStart.x !== coords.x || state.wallStart.y !== coords.y) {
                    floor.walls.push({
                        x1: state.wallStart.x,
                        y1: state.wallStart.y,
                        x2: coords.x,
                        y2: coords.y,
                    });
                }
                // Продолжаем цепочку от новой точки
                state.wallStart = { x: coords.x, y: coords.y };
                renderCanvas();
            }
            return;
        }

        // Добавление подписи
        if (state.currentTool === 'label') {
            const text = prompt('Введите название помещения или зоны:', 'Кабинет');
            if (text && text.trim()) {
                floor.labels.push({ text: text.trim(), x: coords.x, y: coords.y });
                state.selectedItem = { type: 'label', index: floor.labels.length - 1, data: floor.labels[floor.labels.length - 1] };
                renderCanvas();
                renderInspector();
            }
            return;
        }

        // Добавление оборудования (стол, принтер, ВКС, сервер)
        if (['pc', 'printer', 'meeting', 'server'].includes(state.currentTool)) {
            const count = floor.workplaces.length + 1;
            const code = `${floor.order}-${count < 10 ? '0' + count : count}`;
            const defaultLabel = state.currentTool === 'server' ? `Стойка R${count}` : (state.currentTool === 'printer' ? 'МФУ' : '');

            const newWp = {
                code,
                kind: state.currentTool,
                employee: '',
                label: defaultLabel,
                room: '',
                x: coords.x,
                y: coords.y,
            };
            floor.workplaces.push(newWp);
            state.selectedItem = { type: 'workplace', index: floor.workplaces.length - 1, data: newWp };
            renderCanvas();
            renderInspector();
            if (state.currentTool === 'pc') {
                const empInput = document.getElementById('propEmployee');
                if (empInput) {
                    setTimeout(() => empInput.focus(), 60);
                }
            }
            return;
        }

        // Клик по фону в режиме выбора — снять выделение
        if (state.currentTool === 'select') {
            state.selectedItem = null;
            renderCanvas();
            renderInspector();
        }
    });

    // Отмена цепочки рисования по Esc или правой кнопке, управление пробелом
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const inInput = activeTag === 'input' || activeTag === 'select' || activeTag === 'textarea';

        if (e.code === 'Space' && !inInput) {
            e.preventDefault();
            if (!state.isSpacePressed) {
                state.isSpacePressed = true;
                editorSvg.classList.add('cursor-pan');
            }
        } else if (e.key === 'Escape') {
            state.wallStart = null;
            tempLayer.innerHTML = '';
            state.selectedItem = null;
            renderCanvas();
            renderInspector();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
            if (state.selectedItem) {
                deleteItem(state.selectedItem.type, state.selectedItem.index);
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            state.isSpacePressed = false;
            editorSvg.classList.remove('cursor-pan');
            if (!state.isPanning) {
                editorSvg.classList.remove('cursor-panning');
            }
        }
    });

    editorSvg.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (state.wallStart) {
            state.wallStart = null;
            tempLayer.innerHTML = '';
        }
    });

    // Кнопки зума внизу холста
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomResetBtn = document.getElementById('zoomResetBtn');
    if (zoomInBtn) zoomInBtn.onclick = () => setZoom(state.zoom * 1.25);
    if (zoomOutBtn) zoomOutBtn.onclick = () => setZoom(state.zoom / 1.25);
    if (zoomResetBtn) zoomResetBtn.onclick = () => resetZoom();

    // ---------- Инспектор свойств ----------
    const inspectorTitle = document.getElementById('inspectorTitle');
    const inspectorBody = document.getElementById('inspectorBody');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

    function renderInspector() {
        const item = state.selectedItem;

        if (!item) {
            inspectorTitle.textContent = 'Свойства объекта';
            deleteSelectedBtn.hidden = true;
            inspectorBody.innerHTML = `
                <div class="inspector__empty">
                    <svg viewBox="0 0 24 24" class="empty-icon"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                    <p>Выберите стену, надпись или рабочее место на холсте для редактирования</p>
                </div>
            `;
            return;
        }

        deleteSelectedBtn.hidden = false;

        if (item.type === 'workplace') {
            const wp = item.data;
            inspectorTitle.textContent = `Рабочее место ${wp.code}`;
            inspectorBody.innerHTML = `
                <div class="form-group">
                    <label>Код места</label>
                    <input type="text" class="form-input" id="propCode" value="${escapeHtml(wp.code || '')}">
                </div>
                <div class="form-group">
                    <label>Тип оборудования</label>
                    <select class="form-input" id="propKind">
                        <option value="pc" ${wp.kind === 'pc' ? 'selected' : ''}>Стол (ПК)</option>
                        <option value="printer" ${wp.kind === 'printer' ? 'selected' : ''}>МФУ / Принтер</option>
                        <option value="meeting" ${wp.kind === 'meeting' ? 'selected' : ''}>ВКС / Переговорная</option>
                        <option value="server" ${wp.kind === 'server' ? 'selected' : ''}>Серверная стойка</option>
                    </select>
                </div>
                <div class="form-group emp-search-group">
                    <label>Сотрудник</label>
                    <input type="text" class="form-input" id="propEmployee" value="${escapeHtml(wp.employee || '')}" placeholder="Поиск по сотрудникам..." autocomplete="off">
                    <div class="emp-autocomplete-list" id="empAutocompleteList" hidden></div>
                </div>
                <div class="form-group">
                    <label>Подпись / Оборудование</label>
                    <input type="text" class="form-input" id="propLabel" value="${escapeHtml(wp.label || '')}" placeholder="например: Стойка R1">
                </div>
                <div class="form-group">
                    <label>Помещение / Зона</label>
                    <input type="text" class="form-input" id="propRoom" value="${escapeHtml(wp.room || '')}" placeholder="например: Бухгалтерия">
                </div>
                <div class="grid-2">
                    <div class="form-group">
                        <label>X</label>
                        <input type="number" class="form-input" id="propX" value="${wp.x}">
                    </div>
                    <div class="form-group">
                        <label>Y</label>
                        <input type="number" class="form-input" id="propY" value="${wp.y}">
                    </div>
                </div>
            `;

            document.getElementById('propCode').oninput = (e) => { wp.code = e.target.value; renderCanvas(); };
            document.getElementById('propKind').onchange = (e) => { wp.kind = e.target.value; renderCanvas(); };
            document.getElementById('propLabel').oninput = (e) => { wp.label = e.target.value; renderCanvas(); };
            document.getElementById('propRoom').oninput = (e) => { wp.room = e.target.value; };
            document.getElementById('propX').onchange = (e) => { wp.x = Number(e.target.value); renderCanvas(); };
            document.getElementById('propY').onchange = (e) => { wp.y = Number(e.target.value); renderCanvas(); };

            setupEmployeeAutocomplete(wp);
        } else if (item.type === 'label') {
            const lbl = item.data;
            inspectorTitle.textContent = 'Подпись помещения';
            inspectorBody.innerHTML = `
                <div class="form-group">
                    <label>Текст подписи</label>
                    <input type="text" class="form-input" id="propLabelText" value="${lbl.text || ''}">
                </div>
                <div class="grid-2">
                    <div class="form-group">
                        <label>X</label>
                        <input type="number" class="form-input" id="propLabelX" value="${lbl.x}">
                    </div>
                    <div class="form-group">
                        <label>Y</label>
                        <input type="number" class="form-input" id="propLabelY" value="${lbl.y}">
                    </div>
                </div>
            `;
            document.getElementById('propLabelText').oninput = (e) => { lbl.text = e.target.value; renderCanvas(); };
            document.getElementById('propLabelX').onchange = (e) => { lbl.x = Number(e.target.value); renderCanvas(); };
            document.getElementById('propLabelY').onchange = (e) => { lbl.y = Number(e.target.value); renderCanvas(); };
        } else if (item.type === 'wall') {
            const w = item.data;
            inspectorTitle.textContent = 'Стена (отрезок)';
            inspectorBody.innerHTML = `
                <div class="grid-2">
                    <div class="form-group">
                        <label>X1</label>
                        <input type="number" class="form-input" id="propWallX1" value="${w.x1}">
                    </div>
                    <div class="form-group">
                        <label>Y1</label>
                        <input type="number" class="form-input" id="propWallY1" value="${w.y1}">
                    </div>
                </div>
                <div class="grid-2">
                    <div class="form-group">
                        <label>X2</label>
                        <input type="number" class="form-input" id="propWallX2" value="${w.x2}">
                    </div>
                    <div class="form-group">
                        <label>Y2</label>
                        <input type="number" class="form-input" id="propWallY2" value="${w.y2}">
                    </div>
                </div>
            `;
            document.getElementById('propWallX1').onchange = (e) => { w.x1 = Number(e.target.value); renderCanvas(); };
            document.getElementById('propWallY1').onchange = (e) => { w.y1 = Number(e.target.value); renderCanvas(); };
            document.getElementById('propWallX2').onchange = (e) => { w.x2 = Number(e.target.value); renderCanvas(); };
            document.getElementById('propWallY2').onchange = (e) => { w.y2 = Number(e.target.value); renderCanvas(); };
        }
    }

    function setupEmployeeAutocomplete(wp) {
        const input = document.getElementById('propEmployee');
        const listEl = document.getElementById('empAutocompleteList');
        if (!input || !listEl) return;

        function getInitials(name) {
            if (!name) return '—';
            const parts = name.trim().split(/\s+/);
            if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
            return parts[0].slice(0, 2).toUpperCase();
        }

        function highlightMatch(text, query) {
            if (!query) return escapeHtml(text);
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) return escapeHtml(text);
            const before = escapeHtml(text.slice(0, idx));
            const match = escapeHtml(text.slice(idx, idx + query.length));
            const after = escapeHtml(text.slice(idx + query.length));
            return `${before}<mark>${match}</mark>${after}`;
        }

        function renderSuggestions(query) {
            const q = query.trim().toLowerCase();
            const emps = state.employees || [];
            let matched = [];

            if (q.length > 0) {
                matched = emps.filter((e) => {
                    return (e.full_name && e.full_name.toLowerCase().includes(q)) ||
                           (e.position && e.position.toLowerCase().includes(q)) ||
                           (e.department && e.department.toLowerCase().includes(q)) ||
                           (e.email && e.email.toLowerCase().includes(q));
                }).slice(0, 10);
            }

            listEl.innerHTML = '';
            if (matched.length === 0) {
                if (q.length > 0) {
                    const emptyItem = document.createElement('div');
                    emptyItem.className = 'emp-autocomplete-empty';
                    emptyItem.textContent = 'Сотрудник не найден в базе (сохранится введённый текст)';
                    listEl.appendChild(emptyItem);
                    listEl.hidden = false;
                } else {
                    listEl.hidden = true;
                }
                return;
            }

            matched.forEach((e) => {
                const item = document.createElement('div');
                item.className = 'emp-autocomplete-item';

                // Аватар
                let avatarEl;
                if (e.photo_url) {
                    avatarEl = document.createElement('img');
                    avatarEl.className = 'emp-autocomplete-avatar';
                    avatarEl.src = e.photo_url;
                    avatarEl.alt = e.full_name;
                } else {
                    avatarEl = document.createElement('div');
                    avatarEl.className = 'emp-autocomplete-avatar';
                    avatarEl.textContent = e.initials || getInitials(e.full_name);
                }

                // Инфо
                const infoEl = document.createElement('div');
                infoEl.className = 'emp-autocomplete-info';

                const nameEl = document.createElement('div');
                nameEl.className = 'emp-autocomplete-name';
                nameEl.innerHTML = highlightMatch(e.full_name, q);

                const subEl = document.createElement('div');
                subEl.className = 'emp-autocomplete-sub';
                const parts = [e.position, e.department].filter(Boolean);
                subEl.textContent = parts.join(' · ') || 'Должность не указана';

                infoEl.appendChild(nameEl);
                infoEl.appendChild(subEl);

                item.appendChild(avatarEl);
                item.appendChild(infoEl);

                if (e.workplace && e.workplace.code) {
                    const badge = document.createElement('span');
                    badge.className = 'emp-autocomplete-badge';
                    badge.textContent = `📍 ${e.workplace.code}`;
                    badge.title = `Закреплен за местом ${e.workplace.code}`;
                    item.appendChild(badge);
                }

                item.onmousedown = (evt) => {
                    evt.preventDefault();
                    wp.employee = e.full_name;
                    input.value = e.full_name;
                    listEl.hidden = true;
                    showToast(`Выбран: ${e.full_name}`, 'success');
                };

                listEl.appendChild(item);
            });

            listEl.hidden = false;
        }

        input.oninput = (e) => {
            wp.employee = e.target.value;
            renderSuggestions(e.target.value);
        };

        input.onfocus = () => {
            if (input.value.trim().length > 0) {
                renderSuggestions(input.value);
            }
        };

        input.onblur = () => {
            setTimeout(() => {
                listEl.hidden = true;
            }, 180);
        };
    }

    document.getElementById('deselectBtn').onclick = () => {
        state.selectedItem = null;
        renderCanvas();
        renderInspector();
    };

    deleteSelectedBtn.onclick = () => {
        if (state.selectedItem) {
            deleteItem(state.selectedItem.type, state.selectedItem.index);
        }
    };

    // ---------- Панель инструментов ----------
    document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
        btn.onclick = () => {
            document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('tool-btn--active'));
            btn.classList.add('tool-btn--active');
            state.currentTool = btn.dataset.tool;
            state.wallStart = null;
            tempLayer.innerHTML = '';

            if (state.currentTool === 'select') {
                editorSvg.classList.add('cursor-default');
            } else {
                editorSvg.classList.remove('cursor-default');
            }
        };
    });

    // Привязка к сетке
    document.getElementById('gridSnapSelect').onchange = (e) => {
        state.gridSnap = Number(e.target.value);
    };

    // Переименование этажа
    document.getElementById('floorNameInput').onchange = (e) => {
        const floor = getCurrentFloor();
        if (floor) {
            floor.name = e.target.value.trim() || floor.name;
            renderFloorTabs();
        }
    };

    // Очистить этаж
    document.getElementById('clearFloorBtn').onclick = () => {
        const floor = getCurrentFloor();
        if (!floor) return;
        if (confirm(`Очистить все стены и объекты для «${floor.name}»?`)) {
            floor.walls = [];
            floor.labels = [];
            floor.workplaces = [];
            state.selectedItem = null;
            state.wallStart = null;
            renderCanvas();
            renderInspector();
            showToast('План этажа очищен', 'success');
        }
    };

    // Модальное окно подтверждения удаления этажа
    const deleteFloorModal = document.getElementById('deleteFloorModal');
    const deleteFloorModalMessage = document.getElementById('deleteFloorModalMessage');
    const confirmDeleteFloorBtn = document.getElementById('confirmDeleteFloorBtn');
    let floorToDelete = null;

    function openDeleteFloorModal(floor) {
        if (!deleteFloorModal) return;
        floorToDelete = floor;
        if (deleteFloorModalMessage) {
            deleteFloorModalMessage.innerHTML = `Вы действительно хотите удалить этаж <strong>«${escapeHtml(floor.name)}»</strong>?`;
        }
        deleteFloorModal.hidden = false;
    }

    function closeDeleteFloorModal() {
        if (deleteFloorModal) {
            deleteFloorModal.hidden = true;
        }
        floorToDelete = null;
    }

    if (deleteFloorModal) {
        deleteFloorModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeDeleteFloorModal);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !deleteFloorModal.hidden) {
                closeDeleteFloorModal();
            }
        });
    }

    // Удалить текущий этаж
    const deleteFloorBtn = document.getElementById('deleteFloorBtn');
    if (deleteFloorBtn) {
        deleteFloorBtn.onclick = () => {
            const floor = getCurrentFloor();
            if (!floor) return;

            if (state.floors.length <= 1) {
                showToast('Нельзя удалить единственный этаж!', 'error');
                return;
            }

            openDeleteFloorModal(floor);
        };
    }

    if (confirmDeleteFloorBtn) {
        confirmDeleteFloorBtn.onclick = async () => {
            if (!floorToDelete) return;
            const floor = floorToDelete;
            confirmDeleteFloorBtn.disabled = true;

            try {
                const resp = await fetch(`/api/floors/${floor.id}/delete/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                });
                const data = await resp.json();
                if (data.success || data.ok) {
                    showToast(`Этаж «${floor.name}» удалён`, 'success');
                    closeDeleteFloorModal();
                    const idx = state.floors.findIndex((f) => f.id === floor.id);
                    if (idx !== -1) {
                        state.floors.splice(idx, 1);
                    }
                    switchFloor(state.floors[0].id);
                } else {
                    showToast(data.error || 'Ошибка при удалении этажа', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Ошибка при удалении этажа', 'error');
            } finally {
                confirmDeleteFloorBtn.disabled = false;
            }
        };
    }

    // Добавить новый этаж через модальное окно
    const createFloorModal = document.getElementById('createFloorModal');
    const createFloorForm = document.getElementById('createFloorForm');
    const createFloorNameInput = document.getElementById('createFloorNameInput');
    const submitCreateFloorBtn = document.getElementById('submitCreateFloorBtn');

    function openCreateFloorModal() {
        if (!createFloorModal) return;
        createFloorNameInput.value = `${state.floors.length + 1} этаж`;
        createFloorModal.hidden = false;
        createFloorNameInput.focus();
        createFloorNameInput.select();
    }

    function closeCreateFloorModal() {
        if (createFloorModal) createFloorModal.hidden = true;
    }

    if (createFloorModal) {
        createFloorModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeCreateFloorModal);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !createFloorModal.hidden) {
                closeCreateFloorModal();
            }
        });
    }

    if (createFloorForm) {
        createFloorForm.onsubmit = async (e) => {
            e.preventDefault();
            const name = createFloorNameInput.value.trim();
            if (!name) return;

            if (submitCreateFloorBtn) submitCreateFloorBtn.disabled = true;
            try {
                const resp = await fetch('/api/floors/create/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({ name }),
                });
                const data = await resp.json();
                if (data.ok) {
                    const newFloor = {
                        id: data.floor_id,
                        name: data.name,
                        order: state.floors.length + 1,
                        width: 1200,
                        height: 700,
                        walls: [],
                        labels: [],
                        workplaces: [],
                    };
                    state.floors.push(newFloor);
                    closeCreateFloorModal();
                    switchFloor(newFloor.id);
                    showToast(`Создан «${newFloor.name}»`, 'success');
                } else {
                    showToast(data.error || 'Ошибка при создании этажа', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Ошибка при создании этажа', 'error');
            } finally {
                if (submitCreateFloorBtn) submitCreateFloorBtn.disabled = false;
            }
        };
    }

    document.getElementById('addFloorBtn').onclick = () => {
        openCreateFloorModal();
    };

    // Сохранить текущий этаж на сервер в БД
    document.getElementById('saveFloorBtn').onclick = async () => {
        const floor = getCurrentFloor();
        if (!floor) return;

        const btn = document.getElementById('saveFloorBtn');
        btn.disabled = true;

        try {
            const payload = {
                name: floor.name,
                width: floor.width || 1200,
                height: floor.height || 700,
                walls: floor.walls,
                labels: floor.labels,
                workplaces: floor.workplaces,
            };

            const resp = await fetch(`/api/floors/${floor.id}/save/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify(payload),
            });

            const res = await resp.json();
            if (res.ok) {
                showToast(`План «${floor.name}» успешно сохранён!`, 'success');
            } else {
                showToast('Ошибка при сохранении', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Не удалось связаться с сервером', 'error');
        } finally {
            btn.disabled = false;
        }
    };

    // ---------- Предупреждение о сборе Cookie ----------
    function initCookieBanner() {
        const STORAGE_KEY = 'ptracker.cookie_consent_accepted';
        const banner = document.getElementById('cookieBanner');
        const btn = document.getElementById('cookieAcceptBtn');
        if (!banner || !btn) return;

        if (!localStorage.getItem(STORAGE_KEY)) {
            setTimeout(() => {
                banner.hidden = false;
                requestAnimationFrame(() => {
                    banner.classList.add('cookie-banner--visible');
                });
            }, 600);
        }

        btn.addEventListener('click', () => {
            localStorage.setItem(STORAGE_KEY, 'true');
            banner.classList.remove('cookie-banner--visible');
            setTimeout(() => {
                banner.hidden = true;
            }, 300);
        });
    }

    // Инициализация
    editorSvg.classList.add('cursor-default');
    initCookieBanner();
    renderFloorTabs();
    resetZoom();
    renderCanvas();
    renderInspector();
})();
