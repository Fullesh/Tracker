(function () {
    'use strict';

    const CONFIG = JSON.parse(document.getElementById('tracker-config').textContent);
    const STORAGE_KEY = 'ptracker.tasks.v4';
    const KEY_PREFIX = 'PT';
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const AVATAR_COLORS = ['#0077ff', '#fc3f1d', '#6b3fd4', '#24803c', '#ff9900', '#00a3bf'];

    const byId = (list) => Object.fromEntries((list || []).filter(Boolean).map((x) => [String(x.id), x]));
    const assigneesById = byId(CONFIG.assignees);
    const prioritiesById = byId(CONFIG.priorities);
    const severitiesById = byId(CONFIG.severities);
    const floorsById = byId(CONFIG.floors);
    const workplaces = (CONFIG.floors || []).flatMap((f) => f.workplaces || []);
    const workplacesById = byId(workplaces);

    const priorityOrder = Object.fromEntries(CONFIG.priorities.map((p, i) => [p.id, i]));
    const severityOrder = Object.fromEntries(CONFIG.severities.map((s, i) => [s.id, i]));

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
        return cookieValue || '';
    }

    function parseHashView() {
        if (location.hash === '#map') return 'map';
        if (location.hash === '#employees') return 'employees';
        if (location.hash === '#my-tasks') return 'my-tasks';
        if (location.hash === '#inventory') return 'inventory';
        if (location.hash === '#rooms') return 'rooms';
        return 'board';
    }

    // ---------- Состояние ----------
    const state = {
        tasks: loadTasks(),
        filters: { assignee: '', priority: '', severity: '', query: '' },
        empFilters: { dept: '', workplace: '', floor: '', query: '' },
        invFilters: { status: 'all', category: '', query: '' },
        roomDate: new Date().toISOString().split('T')[0],
        roomFloor: '',
        view: parseHashView(),
        floor: String(CONFIG.floors[0]?.id || 1),
        selectedPlace: null,
        employees: CONFIG.employees || [],
        departments: CONFIG.departments || [],
        workplaces: CONFIG.workplaces || [],
        inventory: [],
        inventoryLoaded: false,
        auth: CONFIG.auth || { is_authenticated: false, username: '', is_admin: false },
        selectedEmployee: null,
        workday: null,
    };

    function loadTasks() {
        if (Array.isArray(CONFIG.tasks) && CONFIG.tasks.length > 0) {
            return CONFIG.tasks;
        }
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* повреждённые данные — начинаем с демо */ }
        localStorage.removeItem('ptracker.tasks.v1');
        localStorage.removeItem('ptracker.tasks.v2');
        localStorage.removeItem('ptracker.tasks.v3');
        return seedTasks();
    }

    function saveTasks() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    }

    function seedTasks() {
        const now = Date.now();
        const t = (id, title, description, workplace, creator, assignee, status, priority, severity) =>
            ({ id, title, description, workplace, creator, assignee, status, priority, severity, createdAt: now });
        return [
            t(1, 'Перегрев стойки R2', 'Температура на входе 34°C, сработал алерт мониторинга.', '3-07', 'Мониторинг Zabbix', '2', 'in_progress', 'blocker', 's1'),
            t(2, 'Не печатает МФУ', 'Ошибка «Замятие бумаги», хотя бумаги внутри нет.', '5-13', 'Игорь Чепель', '1', 'open', 'high', 's2'),
            t(3, 'Нет доступа к 1С', 'После обновления пароля не пускает в базу.', '5-04', 'Елена Петрова', '1', 'open', 'critical', 's2'),
            t(4, 'Мерцает монитор', '', '9-05', 'Артём Семёнов', '2', 'open', 'normal', 's3'),
            t(5, 'Не работает ВКС в «Казани»', 'Камера не определяется в Телемосте.', '9-13', 'Никита Лебедев', '2', 'review', 'high', 's3'),
            t(6, 'Установить второй монитор', 'Запрос от директора.', '3-01', 'Виктор Макаров', '1', 'open', 'low', 's4'),
            t(7, 'Заменить клавиатуру', '', '5-01', 'Анна Смирнова', '1', 'closed', 'low', 's4'),
        ];
    }

    function nextId() {
        return state.tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    }

    // ---------- Утилиты ----------
    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        setAttrs(node, attrs);
        [].concat(children).forEach((c) => c != null && node.append(c));
        return node;
    }

    function svg(tag, attrs = {}, children = []) {
        const node = document.createElementNS(SVG_NS, tag);
        setAttrs(node, attrs);
        [].concat(children).forEach((c) => c != null && node.append(c));
        return node;
    }

    function setAttrs(node, attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null) continue;
            if (k === 'class') node.setAttribute('class', v);
            else if (k === 'text') node.textContent = v;
            else if (k === 'html') node.innerHTML = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v);
        }
    }

    function initials(name) {
        return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    }

    function shortName(name) {
        const [first, last] = name.split(/\s+/);
        return last ? `${first[0]}. ${last}` : name;
    }

    function placeTitle(wp) {
        return wp.employee || wp.label || wp.room;
    }

    function formatDeskLabel(label) {
        if (!label) return '';
        const s = String(label).trim();
        if (s.toLowerCase() === 'место переговоров') return 'Переговорная';
        return s.length > 14 ? s.slice(0, 13) + '…' : s;
    }

    function isOpen(task) {
        return task.status !== 'closed';
    }

    function avatar(assigneeId) {
        const user = assigneesById[assigneeId];
        if (!user) return el('span', { class: 'avatar avatar--empty', title: 'Не назначен', text: '?' });
        const color = AVATAR_COLORS[(Number(user.id) - 1) % AVATAR_COLORS.length];
        return el('span', { class: 'avatar', title: user.role ? `${user.name} · ${user.role}` : user.name, style: `background:${color}`, text: initials(user.name) });
    }

    const PRIO_ICON = {
        blocker: '<svg class="prio-icon" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 9.5l7-7" stroke="currentColor" stroke-width="1.6"/></svg>',
        critical: '<svg class="prio-icon" viewBox="0 0 12 12"><path d="M2 7l4-4 4 4M2 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
        high: '<svg class="prio-icon" viewBox="0 0 12 12"><path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
        normal: '<svg class="prio-icon" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="1.6"/></svg>',
        low: '<svg class="prio-icon" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    };

    // Иконки оборудования (контуры в сетке 24×24)
    const KIND_ICON = {
        pc: 'M3 4h18v12H3z M8 20h8 M12 16v4',
        printer: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z',
        meeting: 'M3 6h12v12H3z M15 10l6-3v10l-6-3z',
        server: 'M4 3h16v7H4z M4 14h16v7H4z M8 6.5h.01 M8 17.5h.01',
    };
    const KIND_NAME = { pc: 'Рабочее место', printer: 'Принтер', meeting: 'Переговорная', server: 'Серверная стойка' };

    const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
    const IMAGE_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

    function priorityBadge(id) {
        const p = prioritiesById[id];
        if (!p) return null;
        const b = el('span', { class: `badge prio-${id}`, title: `Priority: ${p.name}`, html: PRIO_ICON[id] || '' });
        b.append(document.createTextNode(p.name));
        return b;
    }

    function severityBadge(id) {
        const s = severitiesById[id];
        if (!s) return null;
        return el('span', { class: `badge sev-${id}`, title: `Severity: ${s.name}`, text: id.toUpperCase() });
    }

    function fillSelect(select, items, { keepFirst = false } = {}) {
        if (!keepFirst) select.innerHTML = '';
        items.forEach((i) => select.append(el('option', { value: i.id, text: i.name })));
    }

    // ---------- Фильтрация ----------
    function filtersActive() {
        const f = state.filters;
        return Boolean(f.assignee || f.priority || f.severity || f.query.trim());
    }

    function placeMatchesQuery(wp, q) {
        return [wp.id, wp.employee, wp.label, wp.room].some((s) => s && s.toLowerCase().includes(q));
    }

    function filteredTasks() {
        const { assignee, priority, severity, query } = state.filters;
        const q = query.trim().toLowerCase();
        return state.tasks.filter((t) => {
            const wp = workplacesById[t.workplace];
            return (!assignee || (assignee === 'none' ? !t.assignee : t.assignee === assignee)) &&
                (!priority || t.priority === priority) &&
                (!severity || t.severity === severity) &&
                (!q || t.title.toLowerCase().includes(q) ||
                    (t.description || '').toLowerCase().includes(q) ||
                    (t.creator || '').toLowerCase().includes(q) ||
                    `${KEY_PREFIX}-${t.id}`.toLowerCase().includes(q) ||
                    (wp && placeMatchesQuery(wp, q)));
        });
    }

    function worstSeverity(tasks) {
        return tasks.reduce((worst, t) =>
            (worst == null || severityOrder[t.severity] < severityOrder[worst]) ? t.severity : worst, null);
    }

    function sortByUrgency(a, b) {
        return (severityOrder[a.severity] - severityOrder[b.severity]) ||
            (priorityOrder[a.priority] - priorityOrder[b.priority]) || (b.id - a.id);
    }

    // ---------- Общий рендер ----------
    const boardEl = document.getElementById('board');
    const officeEl = document.getElementById('officeView');
    const employeesViewEl = document.getElementById('employeesView');
    const employeesGridEl = document.getElementById('employeesGrid');
    const employeesEmptyEl = document.getElementById('employeesEmpty');

    const taskFiltersEl = document.getElementById('taskFilters');
    const employeeFiltersEl = document.getElementById('employeeFilters');
    const filterEmpDeptEl = document.getElementById('filterEmpDept');
    const filterEmpWorkplaceEl = document.getElementById('filterEmpWorkplace');
    const filterEmpFloorEl = document.getElementById('filterEmpFloor');
    const resetEmpFiltersEl = document.getElementById('resetEmpFilters');

    const counterEl = document.getElementById('taskCounter');
    const peopleEl = document.getElementById('peopleList');
    const pageTitleEl = document.getElementById('pageTitle');
    const toggleViewText = document.getElementById('toggleViewText');
    const toggleViewBtn = document.getElementById('toggleViewBtn');
    const createBtn = document.getElementById('createBtn');
    const userPillEl = document.getElementById('userPill');

    const employeeModalEl = document.getElementById('employeeModal');
    const employeeDialogEl = document.getElementById('employeeDialog');
    const loginModalEl = document.getElementById('loginModal');
    const loginFormEl = document.getElementById('loginForm');
    const loginErrorEl = document.getElementById('loginError');
    const creatorListEl = document.getElementById('creatorList');
    const myTasksViewEl = document.getElementById('myTasksView');
    const myTasksGridEl = document.getElementById('myTasksGrid');
    const myTasksEmptyEl = document.getElementById('myTasksEmpty');

    const inventoryViewEl = document.getElementById('inventoryView');
    const inventoryFiltersEl = document.getElementById('inventoryFilters');
    const inventoryTableBodyEl = document.getElementById('inventoryTableBody');
    const inventoryEmptyEl = document.getElementById('inventoryEmpty');
    const filterInvStatusEl = document.getElementById('filterInvStatus');
    const filterInvCategoryEl = document.getElementById('filterInvCategory');
    const resetInvFiltersEl = document.getElementById('resetInvFilters');

    const roomsViewEl = document.getElementById('roomsView');
    const roomsGridEl = document.getElementById('roomsGrid');
    const roomsEmptyEl = document.getElementById('roomsEmpty');
    const roomFiltersEl = document.getElementById('roomFilters');
    const roomDateInput = document.getElementById('roomDateInput');
    const filterRoomFloor = document.getElementById('filterRoomFloor');
    const todayRoomsBtn = document.getElementById('todayRoomsBtn');
    const openCreateBookingModalBtn = document.getElementById('openCreateBookingModalBtn');
    const roomBookingModal = document.getElementById('roomBookingModal');
    const roomBookingForm = document.getElementById('roomBookingForm');
    const bookingRoomSelect = document.getElementById('bookingRoomSelect');
    const bookingDateInput = document.getElementById('bookingDateInput');
    const bookingStartTime = document.getElementById('bookingStartTime');
    const bookingEndTime = document.getElementById('bookingEndTime');
    const bookingOrganizerInput = document.getElementById('bookingOrganizerInput');
    const bookingErrorMsg = document.getElementById('bookingErrorMsg');
    const submitBookingBtn = document.getElementById('submitBookingBtn');
    const deleteBookingModal = document.getElementById('deleteBookingModal');
    const deleteBookingModalMessage = document.getElementById('deleteBookingModalMessage');
    const confirmDeleteBookingBtn = document.getElementById('confirmDeleteBookingBtn');

    function render() {
        hideHoverCard();
        const isEmployees = state.view === 'employees';
        const isMap = state.view === 'map';
        const isBoard = state.view === 'board';
        const isMyTasks = state.view === 'my-tasks';
        const isInventory = state.view === 'inventory';
        const isRooms = state.view === 'rooms';

        boardEl.hidden = !isBoard;
        officeEl.hidden = !isMap;
        if (employeesViewEl) employeesViewEl.hidden = !isEmployees;
        if (myTasksViewEl) myTasksViewEl.hidden = !isMyTasks;
        if (inventoryViewEl) inventoryViewEl.hidden = !isInventory;
        if (roomsViewEl) roomsViewEl.hidden = !isRooms;

        if (taskFiltersEl) taskFiltersEl.hidden = (isEmployees || isMyTasks || isInventory || isRooms);
        if (employeeFiltersEl) employeeFiltersEl.hidden = !isEmployees;
        if (inventoryFiltersEl) inventoryFiltersEl.hidden = !isInventory;
        if (roomFiltersEl) roomFiltersEl.hidden = !isRooms;

        const canAccessMTO = !!(state.auth.is_admin || state.auth.is_mto);
        const invNavBtn = document.getElementById('inventoryNavBtn');
        if (invNavBtn) invNavBtn.hidden = !canAccessMTO;

        const searchEl = document.getElementById('searchInput');
        if (searchEl) {
            if (isInventory) {
                searchEl.placeholder = 'Поиск по номеру, названию, месту...';
            } else if (isEmployees) {
                searchEl.placeholder = 'Поиск по ФИО, должности, отделу...';
            } else if (isRooms) {
                searchEl.placeholder = 'Поиск по названию или коду переговорной...';
            } else {
                searchEl.placeholder = 'Поиск по задачам, местам или людям';
            }
        }

        if (isRooms) {
            pageTitleEl.textContent = 'Бронирование переговорных';
            const roomList = getMeetingRooms();
            counterEl.textContent = roomList.length;
            counterEl.title = 'Всего переговорных';
            toggleViewBtn.hidden = true;
            createBtn.hidden = false;
            createBtn.innerHTML = '<span class="btn__plus">+</span> Забронировать';
            renderRooms();
        } else if (isInventory) {
            pageTitleEl.textContent = 'Инвентаризация';
            const invList = filteredInventory();
            counterEl.textContent = invList.length;
            counterEl.title = 'Всего оборудования';
            toggleViewBtn.hidden = true;
            if (canAccessMTO) {
                createBtn.hidden = false;
                createBtn.innerHTML = '<span class="btn__plus">+</span> Добавить оборудование';
            } else {
                createBtn.hidden = true;
            }
            renderInventory(invList);
        } else if (isMyTasks) {
            pageTitleEl.textContent = 'Мои задачи';
            const myTasks = getMyTasks();
            counterEl.textContent = myTasks.length;
            counterEl.title = 'Моих задач';
            toggleViewBtn.hidden = true;
            createBtn.hidden = false;
            createBtn.innerHTML = '<span class="btn__plus">+</span> Создать задачу';
            renderMyTasks();
        } else if (isEmployees) {
            pageTitleEl.textContent = 'Сотрудники';
            const empList = filteredEmployees();
            counterEl.textContent = empList.length;
            counterEl.title = 'Всего сотрудников';
            toggleViewBtn.hidden = true;
            if (state.auth.is_admin) {
                createBtn.hidden = false;
                createBtn.innerHTML = '<span class="btn__plus">+</span> Добавить сотрудника';
            } else {
                createBtn.hidden = true;
            }
            renderEmployees();
        } else if (isMap) {
            const tasks = filteredTasks();
            pageTitleEl.textContent = 'Задачи на карте';
            toggleViewText.textContent = 'Доска задач';
            toggleViewBtn.hidden = false;
            createBtn.hidden = false;
            createBtn.innerHTML = '<span class="btn__plus">+</span> Создать задачу';
            counterEl.textContent = tasks.filter(isOpen).length;
            counterEl.title = 'Открытых задач';
            renderMap(tasks);
        } else {
            const tasks = filteredTasks();
            pageTitleEl.textContent = 'Задачи';
            toggleViewText.textContent = 'Задачи на карте';
            toggleViewBtn.hidden = false;
            createBtn.hidden = false;
            createBtn.innerHTML = '<span class="btn__plus">+</span> Создать задачу';
            counterEl.textContent = tasks.length;
            counterEl.title = 'Всего задач';
            renderBoard(tasks);
        }

        document.querySelectorAll('.nav-item[data-view]').forEach((n) =>
            n.classList.toggle('nav-item--active', n.dataset.view === state.view));

        renderPeople();
        renderUserPill();
        renderWorkdayWidget();
    }

    // ---------- Доска ----------
    function renderBoard(tasks) {
        boardEl.innerHTML = '';
        CONFIG.statuses.forEach((status) => {
            const items = tasks
                .filter((t) => t.status === status.id)
                .sort((a, b) => (priorityOrder[a.priority] - priorityOrder[b.priority]) || (b.id - a.id));

            const column = el('div', { class: 'column', 'data-status': status.id }, [
                el('div', { class: 'column__header' }, [
                    el('div', { class: 'column__title' }, [
                        el('span', { class: `column__dot dot-${status.id}` }),
                        el('span', { text: status.name }),
                        el('span', { class: 'column__count', text: items.length }),
                    ]),
                    el('button', { class: 'column__add', type: 'button', title: 'Добавить задачу', text: '+', onclick: () => openModal(null, { status: status.id }) }),
                ]),
            ]);

            if (!items.length) column.append(el('div', { class: 'column__empty', text: 'Нет задач' }));
            items.forEach((t) => column.append(renderCard(t)));

            attachDropZone(column);
            boardEl.append(column);
        });
    }

    function renderCard(task, { draggable = true, showPlace = true } = {}) {
        const borderCls = ['blocker', 'critical', 'high'].includes(task.priority) ? ` border-${task.priority}` : '';
        const wp = workplacesById[task.workplace];
        const statusName = CONFIG.statuses.find((s) => s.id === task.status)?.name;

        const card = el('article', {
            class: `card${borderCls}${task.status === 'closed' ? ' card--closed' : ''}`,
            draggable: draggable ? 'true' : null,
            'data-id': task.id,
            onclick: () => openModal(task),
        }, [
            el('div', { class: 'card__top' }, [
                el('span', { class: 'card__key', text: `${KEY_PREFIX}-${task.id}` }),
                showPlace && wp
                    ? el('span', { class: 'card__place', title: `${wp.room} · ${placeTitle(wp)}`, html: PIN_ICON }, [document.createTextNode(wp.id)])
                    : (!showPlace ? el('span', { class: 'panel__status-chip', text: statusName }) : null),
            ]),
            el('div', { class: 'card__title', text: task.title }),
            task.description ? el('div', { class: 'card__desc', text: task.description }) : null,
            task.creator ? el('div', { class: 'card__creator', title: `Создал: ${task.creator}` }, [
                el('span', { class: 'card__creator-label', text: 'Создал:' }),
                document.createTextNode(` ${task.creator}`),
            ]) : null,
            (() => {
                const shots = parseScreenshots(task.screenshot);
                if (!shots.length) return null;
                const label = shots.length === 1 ? 'Скриншот' : `Скриншоты (${shots.length})`;
                return el('button', {
                    type: 'button',
                    class: 'card__screenshot-badge',
                    title: `Просмотреть прикрепленные скриншоты (${shots.length})`,
                    onclick: (e) => {
                        e.stopPropagation();
                        openImageViewerList(shots, 0, `${KEY_PREFIX}-${task.id} · ${task.title}`);
                    }
                }, [
                    el('span', { class: 'card__screenshot-icon', html: IMAGE_ICON }),
                    document.createTextNode(label)
                ]);
            })(),
            el('div', { class: 'card__meta' }, [
                el('div', { class: 'card__tags' }, [priorityBadge(task.priority), severityBadge(task.severity)]),
                avatar(task.assignee),
            ]),
        ]);

        if (draggable) {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', String(task.id));
                e.dataTransfer.effectAllowed = 'move';
                requestAnimationFrame(() => card.classList.add('card--dragging'));
            });
            card.addEventListener('dragend', () => card.classList.remove('card--dragging'));
        }
        return card;
    }

    function attachDropZone(column) {
        column.addEventListener('dragover', (e) => {
            e.preventDefault();
            column.classList.add('column--drop');
        });
        column.addEventListener('dragleave', (e) => {
            if (!column.contains(e.relatedTarget)) column.classList.remove('column--drop');
        });
        column.addEventListener('drop', (e) => {
            e.preventDefault();
            column.classList.remove('column--drop');
            const id = Number(e.dataTransfer.getData('text/plain'));
            const task = state.tasks.find((t) => t.id === id);
            if (task && task.status !== column.dataset.status) {
                task.status = column.dataset.status;
                if (task.status === 'closed') {
                    task.screenshot = '';
                }
                fetch(`/api/tasks/${task.id}/update/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({ status: task.status }),
                }).catch((e) => console.error('Ошибка обновления задачи:', e));
                saveTasks();
                render();
            }
        });
    }

    function renderPeople() {
        peopleEl.innerHTML = '';
        CONFIG.assignees.forEach((u) => {
            const id = String(u.id);
            const count = state.tasks.filter((t) => t.assignee === id && isOpen(t)).length;
            peopleEl.append(el('li', {
                class: `person${state.filters.assignee === id ? ' person--active' : ''}`,
                title: 'Показать задачи исполнителя',
                onclick: () => {
                    state.filters.assignee = state.filters.assignee === id ? '' : id;
                    filterAssignee.value = state.filters.assignee;
                    render();
                },
            }, [
                avatar(id),
                el('span', { class: 'person__name' }, [
                    document.createTextNode(u.name),
                    u.role ? el('span', { class: 'person__role', title: u.role, text: u.role }) : null,
                ]),
                el('span', { class: 'person__count', text: count }),
            ]));
        });
    }

    // ---------- Карта офиса ----------
    const floorTabsEl = document.getElementById('floorTabs');
    const floorSvg = document.getElementById('floorSvg');
    const panelEl = document.getElementById('officePanel');
    const deskHoverCardEl = document.getElementById('deskHoverCard');
    const officeCanvasEl = document.getElementById('officeCanvas');

    // ---------- Масштабирование (Zoom) и перемещение (Pan) карты ----------
    let mapZoom = 1.0;
    let mapViewBox = { x: 0, y: 0, w: 1200, h: 700 };
    let isPanning = false;
    let panStart = { x: 0, y: 0, vx: 0, vy: 0 };

    function applyMapViewBox() {
        if (!floorSvg) return;
        floorSvg.setAttribute('viewBox', `${mapViewBox.x} ${mapViewBox.y} ${mapViewBox.w} ${mapViewBox.h}`);
    }

    function setMapZoom(newZoom, anchorX, anchorY) {
        const clampedZoom = Math.max(0.4, Math.min(5.0, newZoom));
        const curFloor = floorsById[state.floor];
        const baseW = curFloor && curFloor.width ? curFloor.width : 1200;
        const baseH = curFloor && curFloor.height ? curFloor.height : 700;

        const rx = (anchorX - mapViewBox.x) / mapViewBox.w;
        const ry = (anchorY - mapViewBox.y) / mapViewBox.h;

        const newW = baseW / clampedZoom;
        const newH = baseH / clampedZoom;

        mapViewBox.x = anchorX - rx * newW;
        mapViewBox.y = anchorY - ry * newH;
        mapViewBox.w = newW;
        mapViewBox.h = newH;
        mapZoom = clampedZoom;

        applyMapViewBox();
    }

    if (floorSvg) {
        // Зум колёсиком мыши с фокусом в точку курсора
        floorSvg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const pt = floorSvg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const cursorPt = pt.matrixTransform(floorSvg.getScreenCTM().inverse());

            const factor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
            setMapZoom(mapZoom * factor, cursorPt.x, cursorPt.y);
        }, { passive: false });

        // Перетаскивание зажатой мышкой (Pan)
        floorSvg.addEventListener('mousedown', (e) => {
            if (e.target.closest('.desk')) return;
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY, vx: mapViewBox.x, vy: mapViewBox.y };
            floorSvg.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            const rect = floorSvg.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const scaleX = mapViewBox.w / rect.width;
            const scaleY = mapViewBox.h / rect.height;
            mapViewBox.x = panStart.vx - (e.clientX - panStart.x) * scaleX;
            mapViewBox.y = panStart.vy - (e.clientY - panStart.y) * scaleY;
            applyMapViewBox();
        });

        window.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                floorSvg.style.cursor = '';
            }
        });

        // Двойной клик на пустое место — сброс масштаба в 100%
        floorSvg.addEventListener('dblclick', (e) => {
            if (e.target.closest('.desk')) return;
            const curFloor = floorsById[state.floor];
            mapZoom = 1.0;
            const baseW = curFloor && curFloor.width ? curFloor.width : 1200;
            const baseH = curFloor && curFloor.height ? curFloor.height : 700;
            mapViewBox = { x: 0, y: 0, w: baseW, h: baseH };
            applyMapViewBox();
        });
    }

    let hoverHideTimer = null;

    if (deskHoverCardEl) {
        deskHoverCardEl.addEventListener('mouseenter', () => clearTimeout(hoverHideTimer));
        deskHoverCardEl.addEventListener('mouseleave', () => scheduleHideHoverCard());
    }

    function scheduleHideHoverCard(delay = 180) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = setTimeout(() => {
            hideHoverCard();
        }, delay);
    }

    function hideHoverCard() {
        clearTimeout(hoverHideTimer);
        if (!deskHoverCardEl) return;
        deskHoverCardEl.classList.remove('desk-hover-card--visible');
        deskHoverCardEl.hidden = true;
    }

    function findEmployeeForPlace(wp) {
        if (!wp) return null;
        const wpCode = (wp.code || wp.id || '').trim().toLowerCase();
        const wpEmpName = (wp.employee || '').trim().toLowerCase();

        // 1. По коду рабочего места (из модели Employee)
        if (wpCode) {
            const byCode = state.employees.find((e) =>
                e.workplace && (e.workplace.code || '').trim().toLowerCase() === wpCode
            );
            if (byCode) return byCode;
        }

        // 2. По точному совпадению ФИО с wp.employee
        if (wpEmpName) {
            const byName = state.employees.find((e) =>
                e.full_name && e.full_name.trim().toLowerCase() === wpEmpName
            );
            if (byName) return byName;

            // 3. По совпадению частей имени (например "Виктор Макаров" и "Макаров Виктор Сергеевич")
            const parts = wpEmpName.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                const byParts = state.employees.find((e) => {
                    if (!e.full_name) return false;
                    const eLow = e.full_name.toLowerCase();
                    return parts.every((p) => eLow.includes(p));
                });
                if (byParts) return byParts;
            }
        }

        // 4. Если на месте подписан сотрудник, но в базе нет полного профиля
        if (wp.employee && wp.employee.trim()) {
            return {
                id: null,
                full_name: wp.employee.trim(),
                initials: initials(wp.employee.trim()),
                photo_url: null,
                position: wp.label || '',
                department: wp.room || '',
                work_phone: '',
                email: '',
                workplace: { code: wp.id, room: wp.room },
            };
        }

        return null;
    }

    function getTasksCreatedByEmployee(emp, wp) {
        const candidates = new Set();
        if (emp && emp.full_name) {
            candidates.add(emp.full_name.trim().toLowerCase());
            const parts = emp.full_name.trim().split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                candidates.add(`${parts[0]} ${parts[1]}`.toLowerCase());
                candidates.add(`${parts[1]} ${parts[0]}`.toLowerCase());
            }
        }
        if (wp && wp.employee) {
            candidates.add(wp.employee.trim().toLowerCase());
            const parts = wp.employee.trim().split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                candidates.add(`${parts[0]} ${parts[1]}`.toLowerCase());
                candidates.add(`${parts[1]} ${parts[0]}`.toLowerCase());
            }
        }

        if (!candidates.size) return [];

        return state.tasks.filter((t) => {
            if (!t.creator) return false;
            const c = t.creator.trim().toLowerCase();
            for (const cand of candidates) {
                if (c === cand || c.includes(cand) || cand.includes(c)) {
                    return true;
                }
            }
            return false;
        });
    }

    function showDeskHoverCard(wp, deskNode) {
        if (!deskHoverCardEl || !officeCanvasEl) return;
        clearTimeout(hoverHideTimer);

        const emp = findEmployeeForPlace(wp);
        // Задачи на карте привязаны к рабочему месту, а не к сотруднику
        const placeTasks = state.tasks.filter((t) => t.workplace === wp.id || (wp.code && t.workplace === wp.code));
        const sortedTasks = placeTasks.slice().sort(sortByUrgency);
        const openTasks = sortedTasks.filter(isOpen);

        deskHoverCardEl.innerHTML = '';

        // --- Левая колонка: краткая карточка сотрудника ---
        const leftCol = el('div', {
            class: `desk-hover-card__left${emp && emp.id ? ' desk-hover-card__left--clickable' : ''}`,
            title: emp && emp.id ? 'Нажмите, чтобы открыть карточку сотрудника' : '',
            onclick: (e) => {
                if (emp && emp.id) {
                    e.stopPropagation();
                    hideHoverCard();
                    openEmployeeModal(emp);
                }
            }
        });

        // Аватар / Фото
        let avatarEl;
        if (emp && emp.photo_url) {
            avatarEl = el('img', {
                class: 'desk-hover-card__avatar',
                src: emp.photo_url,
                alt: emp.full_name || 'Фото сотрудника'
            });
        } else {
            const empInitials = (emp && (emp.initials || initials(emp.full_name))) || (wp.label ? initials(wp.label) : (wp.id || '—'));
            const colorIdx = emp && emp.id ? Number(emp.id) : (wp.id ? wp.id.charCodeAt(0) : 0);
            const bgColor = AVATAR_COLORS[Math.abs(colorIdx) % AVATAR_COLORS.length];
            avatarEl = el('div', {
                class: 'desk-hover-card__avatar desk-hover-card__avatar--placeholder',
                style: `background: ${bgColor}`,
                text: empInitials
            });
        }

        const wpPill = el('span', { class: 'desk-hover-card__place-pill', text: `Место ${wp.id}` });
        const avatarRow = el('div', { class: 'desk-hover-card__avatar-row' }, [avatarEl, wpPill]);

        // ФИО
        const empName = (emp && emp.full_name) || wp.employee || `Рабочее место ${wp.id}`;
        const nameEl = el('div', { class: 'desk-hover-card__emp-name', text: empName });

        // Должность и отдел
        const empPos = (emp && emp.position) || (wp.label ? wp.label : (emp ? '' : 'Рабочее место'));
        const posEl = empPos ? el('div', { class: 'desk-hover-card__emp-pos', text: empPos }) : null;
        const empDept = (emp && emp.department) || wp.room;
        const deptEl = empDept ? el('div', { class: 'desk-hover-card__emp-dept', text: empDept }) : null;

        // Контакты
        const phoneIcon = '<svg class="desk-hover-card__icon" viewBox="0 0 24 24"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.24 1.02l-2.21 2.2z"/></svg>';
        const emailIcon = '<svg class="desk-hover-card__icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>';

        const phoneVal = emp && emp.work_phone ? emp.work_phone : '';
        const phoneItem = el('div', {
            class: `desk-hover-card__contact${!phoneVal ? ' desk-hover-card__contact--muted' : ''}`,
            title: phoneVal ? `Телефон: ${phoneVal}` : 'Телефон не указан',
            html: phoneIcon
        }, [el('span', { text: phoneVal || 'Телефон не указан' })]);

        const emailVal = emp && emp.email ? emp.email : '';
        const emailItem = el('div', {
            class: `desk-hover-card__contact${!emailVal ? ' desk-hover-card__contact--muted' : ''}`,
            title: emailVal ? `E-mail: ${emailVal}` : 'Почта не указана',
            html: emailIcon
        }, [el('span', { text: emailVal || 'Почта не указана' })]);

        const contactsEl = el('div', { class: 'desk-hover-card__contacts' }, [phoneItem, emailItem]);

        leftCol.append(avatarRow, nameEl);
        if (posEl) leftCol.append(posEl);
        if (deptEl) leftCol.append(deptEl);
        leftCol.append(contactsEl);

        // --- Правая колонка: задачи, привязанные к этому рабочему месту ---
        const rightCol = el('div', { class: 'desk-hover-card__right' });

        const headTitle = el('span', { class: 'desk-hover-card__title', text: `Задачи места ${wp.id}` });
        const countChip = el('span', {
            class: `desk-hover-card__count${openTasks.length ? ' desk-hover-card__count--active' : ''}`,
            title: openTasks.length ? `Открытых задач: ${openTasks.length} из ${sortedTasks.length}` : 'Все задачи закрыты',
            text: sortedTasks.length
        });
        const headerEl = el('div', { class: 'desk-hover-card__header' }, [headTitle, countChip]);
        rightCol.append(headerEl);

        if (sortedTasks.length > 0) {
            const tasksList = el('div', { class: 'desk-hover-card__tasks' });
            sortedTasks.forEach((t) => {
                const statusName = CONFIG.statuses.find((s) => s.id === t.status)?.name || t.status;
                const taskRow = el('div', {
                    class: `desk-hover-card__task${t.status === 'closed' ? ' desk-hover-card__task--closed' : ''}`,
                    title: `Открыть задачу ${KEY_PREFIX}-${t.id}`,
                    onclick: (e) => {
                        e.stopPropagation();
                        hideHoverCard();
                        openModal(t);
                    }
                }, [
                    el('div', { class: 'desk-hover-card__task-top' }, [
                        el('span', { class: 'desk-hover-card__task-key', text: `${KEY_PREFIX}-${t.id}` }),
                        el('div', { class: 'desk-hover-card__task-badges' }, [
                            severityBadge(t.severity),
                            priorityBadge(t.priority),
                            el('span', { class: 'panel__status-chip', text: statusName })
                        ])
                    ]),
                    el('div', { class: 'desk-hover-card__task-title', text: t.title }),
                    t.creator ? el('div', { class: 'desk-hover-card__task-creator', text: `Создал: ${t.creator}` }) : null
                ]);
                tasksList.append(taskRow);
            });
            rightCol.append(tasksList);
        } else {
            rightCol.append(el('div', { class: 'desk-hover-card__empty' }, [
                el('div', { class: 'desk-hover-card__empty-icon', text: '🎉' }),
                el('div', { text: 'На этом месте нет задач' }),
                el('div', { style: 'font-size: 11px; color: var(--text-secondary);', text: 'Всё работает исправно' })
            ]));
        }

        deskHoverCardEl.append(leftCol, rightCol);

        deskHoverCardEl.hidden = false;
        positionHoverCard(deskNode);
        requestAnimationFrame(() => {
            deskHoverCardEl.classList.add('desk-hover-card--visible');
        });
    }

    function positionHoverCard(deskNode) {
        if (!deskHoverCardEl || !officeCanvasEl || !deskNode) return;

        const deskRect = deskNode.getBoundingClientRect();
        const canvasRect = officeCanvasEl.getBoundingClientRect();

        const cardWidth = deskHoverCardEl.offsetWidth || 530;
        const cardHeight = deskHoverCardEl.offsetHeight || 220;

        const deskCenterX = (deskRect.left + deskRect.width / 2) - canvasRect.left;
        const deskTop = deskRect.top - canvasRect.top;
        const deskBottom = deskRect.bottom - canvasRect.top;

        // По горизонтали: центрируем над местом
        let left = deskCenterX - cardWidth / 2;
        const padding = 12;
        if (left < padding) left = padding;
        if (left + cardWidth > canvasRect.width - padding) {
            left = Math.max(padding, canvasRect.width - cardWidth - padding);
        }

        // По вертикали: пробуем сверху, иначе снизу
        let top = deskTop - cardHeight - 12;
        if (top < padding) {
            top = deskBottom + 12;
            if (top + cardHeight > canvasRect.height - padding) {
                top = Math.max(padding, canvasRect.height - cardHeight - padding);
            }
        }

        deskHoverCardEl.style.left = `${Math.round(left)}px`;
        deskHoverCardEl.style.top = `${Math.round(top)}px`;
    }

    function openTasksByPlace(tasks) {
        const map = {};
        tasks.filter(isOpen).forEach((t) => {
            if (!t.workplace) return;
            (map[t.workplace] ||= []).push(t);
        });
        return map;
    }

    function renderMap(tasks) {
        const byPlace = openTasksByPlace(tasks);
        const floor = floorsById[state.floor] || CONFIG.floors[0] || { id: 1, name: 'Этаж', width: 1200, height: 700, workplaces: [] };
        const floorWorkplaces = floor.workplaces || [];

        // Вкладки этажей с количеством открытых задач
        floorTabsEl.innerHTML = '';
        (CONFIG.floors || []).forEach((f) => {
            const count = (f.workplaces || []).reduce((n, wp) => n + (byPlace[wp.id]?.length || 0), 0);
            floorTabsEl.append(el('button', {
                class: `floor-tab${String(f.id) === state.floor ? ' floor-tab--active' : ''}`,
                type: 'button',
                role: 'tab',
                onclick: () => { state.floor = String(f.id); state.selectedPlace = null; render(); },
            }, [
                el('span', { text: f.name }),
                count ? el('span', { class: 'floor-tab__count', text: count }) : null,
            ]));
        });

        // Кнопка перехода в редактор текущего этажа
        const editFloorBtn = document.getElementById('editFloorBtn');
        if (editFloorBtn) {
            editFloorBtn.href = `/constructor/${floor.id}/`;
        }

        // План этажа: стены и подписи (из БД) или прямоугольники (fallback)
        mapZoom = 1.0;
        mapViewBox = { x: 0, y: 0, w: floor.width || 1200, h: floor.height || 700 };
        applyMapViewBox();
        floorSvg.innerHTML = '';
        if (floor.walls && floor.walls.length) {
            const wallsGroup = svg('g', { class: 'floor__walls' });
            floor.walls.forEach((w) => {
                wallsGroup.append(svg('line', {
                    class: 'wall-line',
                    x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2
                }));
            });
            floorSvg.append(wallsGroup);
        } else if (floor.rooms) {
            floor.rooms.forEach((r) => {
                floorSvg.append(svg('g', { class: `room${r.name === 'Серверная' ? ' room--server' : ''}` }, [
                    svg('rect', { class: 'room__rect', x: r.x, y: r.y, width: r.w, height: r.h, rx: 14 }),
                    svg('text', { class: 'room__label', x: r.x + 16, y: r.y + 26, text: r.name }),
                ]));
            });
        }

        if (floor.labels && floor.labels.length) {
            const labelsGroup = svg('g', { class: 'floor__labels' });
            floor.labels.forEach((l) => {
                labelsGroup.append(svg('text', {
                    class: 'room__label',
                    x: l.x,
                    y: l.y,
                    text: l.text
                }));
            });
            floorSvg.append(labelsGroup);
        }

        const q = state.filters.query.trim().toLowerCase();
        const active = filtersActive();

        floorWorkplaces.forEach((wp) => {
            const open = byPlace[wp.id] || [];
            const worst = worstSeverity(open);
            const status = worst ? `st-${worst}` : 'st-ok';
            const dimmed = active && !open.length && !(q && placeMatchesQuery(wp, q));
            const selected = state.selectedPlace === wp.id;
            const w = 72, h = 48;

            const g = svg('g', {
                class: `desk ${status}${selected ? ' desk--selected' : ''}${dimmed ? ' desk--dimmed' : ''}`,
                tabindex: 0,
                role: 'button',
                'aria-label': `${wp.id} ${placeTitle(wp)}`,
                onclick: () => { hideHoverCard(); selectPlace(wp.id); },
                onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideHoverCard(); selectPlace(wp.id); } },
            }, [
                worst === 's1' ? svg('rect', { class: 'desk__pulse', x: wp.x - w / 2, y: wp.y - h / 2, width: w, height: h, rx: 10 }) : null,
                svg('rect', { class: 'desk__body', x: wp.x - w / 2, y: wp.y - h / 2, width: w, height: h, rx: 10 }),
                svg('path', { class: 'desk__icon', d: KIND_ICON[wp.kind] || KIND_ICON.pc, transform: `translate(${wp.x - 10} ${wp.y - 21}) scale(0.84)` }),
                svg('text', { class: 'desk__id', x: wp.x, y: wp.y + 17, text: wp.id }),
                svg('text', { class: 'desk__name', x: wp.x, y: wp.y + h / 2 + 16, text: formatDeskLabel(wp.label) }),
                open.length ? svg('g', { class: 'desk__badge' }, [
                    svg('circle', { cx: wp.x + w / 2 - 2, cy: wp.y - h / 2 + 2, r: 11 }),
                    svg('text', { x: wp.x + w / 2 - 2, y: wp.y - h / 2 + 2, text: open.length }),
                ]) : null,
            ]);
            g.addEventListener('mouseenter', () => showDeskHoverCard(wp, g));
            g.addEventListener('mouseleave', () => scheduleHideHoverCard());
            floorSvg.append(g);
        });

        renderPanel(tasks, byPlace, floor);
    }

    function selectPlace(id) {
        state.selectedPlace = state.selectedPlace === id ? null : id;
        render();
    }

    function renderPanel(tasks, byPlace, floor) {
        panelEl.innerHTML = '';
        const wp = workplacesById[state.selectedPlace];
        const floorWorkplaces = (floor && floor.workplaces) || [];

        if (!wp) {
            // Сводка по этажу: проблемные места
            const problems = floorWorkplaces
                .filter((p) => byPlace[p.id]?.length)
                .sort((a, b) => severityOrder[worstSeverity(byPlace[a.id])] - severityOrder[worstSeverity(byPlace[b.id])]);

            panelEl.append(el('div', {}, [
                el('h3', { class: 'panel__title', text: floor.name }),
                el('div', { class: 'panel__sub', text: `Мест: ${floorWorkplaces.length} · с проблемами: ${problems.length}` }),
            ]));

            if (!problems.length) {
                panelEl.append(el('div', { class: 'panel__ok', text: 'На этаже всё работает 🎉' }));
            } else {
                panelEl.append(el('div', { class: 'panel__section-title', text: 'Где что не работает' }));
                const list = el('div', { class: 'panel__list' });
                problems.forEach((p) => {
                    const open = byPlace[p.id];
                    const worst = worstSeverity(open);
                    list.append(el('div', { class: 'card', onclick: () => selectPlace(p.id) }, [
                        el('div', { class: 'card__top' }, [
                            el('span', { class: 'card__key', text: p.id }),
                            severityBadge(worst),
                        ]),
                        el('div', { class: 'card__title', text: placeTitle(p) }),
                        el('div', { class: 'card__desc', text: open.slice().sort(sortByUrgency).map((t) => t.title).join(' · ') }),
                    ]));
                });
                panelEl.append(list);
            }
            panelEl.append(el('div', { class: 'panel__empty' }, [
                el('div', { text: 'Нажмите на рабочее место на карте, чтобы увидеть его задачи' }),
            ]));
            return;
        }

        const open = (byPlace[wp.id] || []).slice().sort(sortByUrgency);
        const closed = tasks.filter((t) => t.workplace === wp.id && !isOpen(t));
        const worst = worstSeverity(open);

        panelEl.append(el('div', { class: 'panel__head' }, [
            el('div', { class: `panel__status ${worst ? `st-${worst}` : 'st-ok'}`, html: `<svg viewBox="0 0 24 24"><path d="${KIND_ICON[wp.kind] || KIND_ICON.pc}"/></svg>` }),
            el('div', {}, [
                el('h3', { class: 'panel__title', text: `${wp.id} · ${placeTitle(wp)}` }),
                el('div', { class: 'panel__sub', text: `${KIND_NAME[wp.kind] || 'Рабочее место'} · ${wp.room} · ${floorsById[wp.floor]?.name || ''}` }),
            ]),
            el('button', { class: 'icon-btn', type: 'button', title: 'Закрыть', text: '×', style: 'margin-left:auto', onclick: () => selectPlace(wp.id) }),
        ]));

        if (wp.kind === 'server') {
            const rackEquip = (state.inventory || []).filter((it) => it.workplace_code === wp.id || it.workplace_code === (wp.code || wp.id));
            const rackBlock = el('div', { class: 'rack-block' }, [
                el('div', { class: 'rack-block__head' }, [
                    el('h4', { class: 'rack-block__title', text: `Оборудование стойки (${rackEquip.length})` }),
                    el('button', {
                        class: 'btn btn--ghost btn--icon-sm',
                        type: 'button',
                        text: '+ Добавить в стойку',
                        onclick: () => {
                            openRackDeviceModal(null, wp);
                        }
                    })
                ])
            ]);

            if (rackEquip.length === 0) {
                rackBlock.append(el('div', { class: 'rack-block__empty', text: 'В стойке пока нет оборудования' }));
            } else {
                const list = el('div', { class: 'rack-block__list' });
                rackEquip.forEach((eq) => {
                    const devStatus = getPingerDeviceStatus(eq.ip);
                    const isChecked = isPingerDeviceChecked(devStatus);
                    const isOnline = isPingerDeviceOnline(devStatus);
                    const indCls = isChecked ? (isOnline ? '' : 'pinger-indicator--alert') : 'pinger-indicator--off';
                    const indTitle = isChecked ? (isOnline ? 'Доступен по сети' : 'Недоступен!') : 'Не проверялся';
                    list.append(el('div', {
                        class: 'rack-item',
                        style: 'cursor: pointer;',
                        onclick: () => openRackDeviceModal(eq, wp)
                    }, [
                        el('div', { class: 'rack-item__main' }, [
                            el('div', { class: 'rack-item__name' }, [
                                eq.ip ? el('span', {
                                    class: `pinger-indicator ${indCls}`,
                                    style: 'display:inline-block; margin-right: 6px;',
                                    title: indTitle
                                }) : null,
                                el('span', { text: eq.name })
                            ]),
                            el('div', { class: 'rack-item__meta' }, [
                                el('span', { text: `${eq.type_code || 'NW'} · ${eq.inventory_number || 'Без номера'}` }),
                                eq.ip ? el('span', { class: 'rack-item__ip', text: ` · ${eq.ip}` }) : null
                            ])
                        ]),
                        el('button', {
                            class: 'btn btn--ghost btn--icon-sm',
                            type: 'button',
                            text: '✎',
                            title: 'Редактировать в стойке',
                            onclick: (e) => {
                                e.stopPropagation();
                                openRackDeviceModal(eq, wp);
                            }
                        })
                    ]));
                });
                rackBlock.append(list);
            }
            panelEl.append(rackBlock);
        } else if (wp.kind === 'printer') {
            const printerEquip = (state.inventory || []).filter((it) => it.workplace_code === wp.id || it.workplace_code === (wp.code || wp.id));
            const printerItem = printerEquip[0] || null;
            const currentIp = (printerItem && printerItem.ip) || wp.ip || '';
            const devStatus = getPingerDeviceStatus(currentIp);
            const isPrChecked = isPingerDeviceChecked(devStatus);
            const isPrOnline = isPingerDeviceOnline(devStatus);
            const prIndCls = isPrChecked ? (isPrOnline ? '' : 'pinger-indicator--alert') : 'pinger-indicator--off';
            const prIndTitle = isPrChecked ? (isPrOnline ? 'Принтер в сети' : 'Принтер недоступен!') : 'Не проверялся';

            const pBlock = el('div', { class: 'rack-block' }, [
                el('div', { class: 'rack-block__head' }, [
                    el('h4', { class: 'rack-block__title', text: 'Сетевой принтер' }),
                    el('button', {
                        class: 'btn btn--ghost btn--icon-sm',
                        type: 'button',
                        text: currentIp ? 'Настроить IP' : '+ Указать IP',
                        onclick: () => openPrinterSettingsModal(wp, printerItem)
                    })
                ]),
                el('div', { class: 'rack-block__list' }, [
                    el('div', {
                        class: 'rack-item',
                        style: 'cursor: pointer;',
                        onclick: () => openPrinterSettingsModal(wp, printerItem)
                    }, [
                        el('div', { class: 'rack-item__main' }, [
                            el('div', { class: 'rack-item__name' }, [
                                currentIp ? el('span', {
                                    class: `pinger-indicator ${prIndCls}`,
                                    style: 'display:inline-block; margin-right: 6px;',
                                    title: prIndTitle
                                }) : null,
                                el('span', { text: (printerItem && printerItem.name) || wp.label || 'Сетевое МФУ' })
                            ]),
                            el('div', { class: 'rack-item__meta' }, [
                                el('span', { text: currentIp ? `IP: ${currentIp}` : 'IP-адрес не задан (мониторинг отключен)' }),
                                (printerItem && printerItem.inventory_number) ? el('span', { text: ` · ${printerItem.inventory_number}` }) : null
                            ])
                        ]),
                        el('button', {
                            class: 'btn btn--ghost btn--icon-sm',
                            type: 'button',
                            text: '✎',
                            title: 'Настроить сетевые параметры',
                            onclick: (e) => {
                                e.stopPropagation();
                                openPrinterSettingsModal(wp, printerItem);
                            }
                        })
                    ])
                ])
            ]);
            panelEl.append(pBlock);
        } else if (wp.kind === 'meeting') {
            const meetingCode = wp.code || wp.id;
            const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';

            const mBlock = el('div', { class: 'rack-block' }, [
                el('div', { class: 'rack-block__head' }, [
                    el('h4', { class: 'rack-block__title', text: 'Экран переговорной' }),
                    el('a', {
                        class: 'btn btn--ghost btn--icon-sm',
                        href: `/tablet/rooms/${encodeURIComponent(meetingCode)}/`,
                        target: '_blank',
                        text: 'Открыть экран ↗',
                        title: 'Открыть настенный планшет переговорной в новой вкладке'
                    })
                ]),
                el('div', { class: 'rack-block__list', id: 'meetingRoomScheduleBox' }, [
                    el('div', { class: 'rack-item', style: 'padding: 10px 14px; font-size: 13px; color: var(--text-muted);' }, [
                        el('span', { text: 'Загрузка расписания бронирований...' })
                    ])
                ])
            ]);
            panelEl.append(mBlock);

            fetch(`/api/rooms/tablet-info/${encodeURIComponent(meetingCode)}/`)
                .then(r => r.json())
                .then(data => {
                    const box = document.getElementById('meetingRoomScheduleBox');
                    if (!box) return;
                    box.innerHTML = '';

                    const isBusy = data.status === 'busy' && data.current_meeting;
                    const statusTag = el('div', {
                        style: `display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; margin-bottom: 8px; background: ${isBusy ? 'rgba(239, 68, 68, .15)' : 'rgba(16, 185, 129, .15)'}; color: ${isBusy ? '#ef4444' : '#10b981'};`
                    }, [
                        el('span', { style: 'width: 8px; height: 8px; border-radius: 50%; background: currentColor;' }),
                        document.createTextNode(isBusy ? `Занято: ${data.current_meeting.title}` : 'Свободно прямо сейчас')
                    ]);
                    box.append(statusTag);

                    const bookings = data.today_bookings || [];
                    if (bookings.length === 0) {
                        box.append(el('div', { style: 'font-size: 12.5px; color: var(--text-muted); padding: 4px 0;', text: 'На сегодня встреч не запланировано' }));
                    } else {
                        bookings.forEach(b => {
                            const isCur = data.current_meeting && Number(data.current_meeting.id) === Number(b.id);
                            box.append(el('div', {
                                class: 'rack-item',
                                style: isCur ? 'border-left: 3px solid #ef4444;' : ''
                            }, [
                                el('div', { class: 'rack-item__main' }, [
                                    el('div', { class: 'rack-item__name', text: b.title }),
                                    el('div', { class: 'rack-item__meta', text: `${fmtTime(b.start_time)} — ${fmtTime(b.end_time)} · ${b.organizer}` })
                                ])
                            ]));
                        });
                    }
                })
                .catch(() => {});
        }

        panelEl.append(el('div', { class: 'panel__section-title', text: `Открытые задачи · ${open.length}` }));
        if (open.length) {
            panelEl.append(el('div', { class: 'panel__list' }, open.map((t) => renderCard(t, { draggable: false, showPlace: false }))));
        } else {
            panelEl.append(el('div', { class: 'panel__ok', text: 'Всё работает' }));
        }

        if (closed.length) {
            panelEl.append(el('div', { class: 'panel__section-title', text: `Закрытые · ${closed.length}` }));
            panelEl.append(el('div', { class: 'panel__list' }, closed.map((t) => renderCard(t, { draggable: false, showPlace: false }))));
        }

        panelEl.append(el('button', {
            class: 'btn btn--action', type: 'button',
            onclick: () => openModal(null, { workplace: wp.id }),
        }, [el('span', { class: 'btn__plus', text: '+' }), document.createTextNode(' Задача на это место')]));
    }

    // ---------- Модальное окно ----------
    const modal = document.getElementById('taskModal');
    const form = document.getElementById('taskForm');
    const modalTitle = document.getElementById('modalTitle');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    fillSelect(form.assignee, [{ id: '', name: 'Не назначен' }, ...CONFIG.assignees]);
    fillSelect(form.status, CONFIG.statuses);
    fillSelect(form.priority, CONFIG.priorities);
    fillSelect(form.severity, CONFIG.severities);

    // Рабочие места сгруппированы по этажам
    form.workplace.append(el('option', { value: '', text: 'Не указано' }));
    (CONFIG.floors || []).forEach((f) => {
        const wps = f.workplaces || [];
        if (wps.length > 0) {
            form.workplace.append(el('optgroup', { label: f.name },
                wps.map((wp) => el('option', { value: wp.id, text: `${wp.id} · ${placeTitle(wp)} (${wp.room})` }))));
        }
    });

    function openModal(task, preset = {}) {
        form.reset();
        const isEdit = Boolean(task);
        modalTitle.textContent = isEdit ? `${KEY_PREFIX}-${task.id}` : 'Новая задача';
        saveBtn.textContent = isEdit ? 'Сохранить' : 'Создать';
        deleteBtn.hidden = !isEdit;

        const defaultCreator = (state.auth && (state.auth.employee_name || state.auth.username)) || '';
        const initialWorkplace = isEdit ? (task.workplace || '') : (preset.workplace || '');
        const initialCreator = isEdit ? (task.creator || '') : (preset.creator || defaultCreator);

        form.id.value = isEdit ? task.id : '';
        form.title.value = isEdit ? task.title : '';
        form.description.value = isEdit ? task.description : '';
        if (form.creator) form.creator.value = initialCreator;
        form.workplace.value = initialWorkplace;
        form.assignee.value = isEdit ? (task.assignee || '') : '';
        form.status.value = isEdit ? task.status : (preset.status || CONFIG.statuses[0].id);
        form.priority.value = isEdit ? task.priority : 'normal';
        form.severity.value = isEdit ? task.severity : 's3';
        if (typeof setTaskScreenshots === 'function') {
            setTaskScreenshots(isEdit && task.screenshot ? task.screenshot : '');
        }

        modal.hidden = false;
        setTimeout(() => form.title.focus(), 0);
    }

    function closeModal() {
        modal.hidden = true;
        if (typeof setTaskScreenshots === 'function') {
            setTaskScreenshots('');
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        let screenshotVal = document.getElementById('taskScreenshotInput')?.value?.trim() || '';
        if (form.status.value === 'closed') {
            screenshotVal = '';
            currentScreenshots = [];
        }
        const data = {
            title: form.title.value.trim(),
            description: form.description.value.trim(),
            creator: form.creator ? form.creator.value.trim() : '',
            workplace: form.workplace.value,
            assignee: form.assignee.value,
            status: form.status.value,
            priority: form.priority.value,
            severity: form.severity.value,
            screenshot: screenshotVal,
        };
        if (!data.title) { form.title.focus(); return; }

        const id = Number(form.id.value);
        if (id) {
            try {
                await fetch(`/api/tasks/${id}/update/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify(data),
                });
            } catch (err) {
                console.error('Ошибка сохранения задачи:', err);
            }
            Object.assign(state.tasks.find((t) => t.id === id), data);
        } else {
            try {
                const resp = await fetch('/api/tasks/create/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify(data),
                });
                const res = await resp.json();
                if (res.task) {
                    state.tasks.push(res.task);
                } else {
                    state.tasks.push({ id: nextId(), createdAt: Date.now(), ...data });
                }
            } catch (err) {
                console.error('Ошибка создания задачи:', err);
                state.tasks.push({ id: nextId(), createdAt: Date.now(), ...data });
            }
        }
        saveTasks();
        closeModal();
        render();
    });

    // Модальное окно подтверждения удаления задачи
    const deleteTaskModal = document.getElementById('deleteTaskModal');
    const deleteTaskModalMessage = document.getElementById('deleteTaskModalMessage');
    const confirmDeleteTaskBtn = document.getElementById('confirmDeleteTaskBtn');
    let taskIdToDelete = null;

    function openDeleteTaskModal(id) {
        if (!deleteTaskModal || !id) return;
        taskIdToDelete = id;
        const taskObj = state.tasks.find((t) => Number(t.id) === Number(id));
        const taskTitle = taskObj && taskObj.title ? ` «${escapeHtml(taskObj.title)}»` : '';
        if (deleteTaskModalMessage) {
            deleteTaskModalMessage.innerHTML = `Вы действительно хотите удалить задачу <strong>${KEY_PREFIX}-${id}</strong>${taskTitle}?`;
        }
        deleteTaskModal.hidden = false;
    }

    function closeDeleteTaskModal() {
        if (deleteTaskModal) deleteTaskModal.hidden = true;
        taskIdToDelete = null;
    }

    if (deleteTaskModal) {
        deleteTaskModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeDeleteTaskModal);
        });
    }

    if (confirmDeleteTaskBtn) {
        confirmDeleteTaskBtn.addEventListener('click', async () => {
            if (!taskIdToDelete) return;
            const id = taskIdToDelete;
            confirmDeleteTaskBtn.disabled = true;
            try {
                await fetch(`/api/tasks/${id}/delete/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                });
            } catch (err) {
                console.error('Ошибка удаления задачи:', err);
            } finally {
                confirmDeleteTaskBtn.disabled = false;
            }
            state.tasks = state.tasks.filter((t) => Number(t.id) !== Number(id));
            saveTasks();
            closeDeleteTaskModal();
            closeModal();
            render();
            showToast(`Задача ${KEY_PREFIX}-${id} удалена`, 'success');
        });
    }

    deleteBtn.addEventListener('click', () => {
        const id = Number(form.id.value);
        if (!id) return;
        openDeleteTaskModal(id);
    });

    modal.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideHoverCard();
            if (deleteTaskModal && !deleteTaskModal.hidden) {
                closeDeleteTaskModal();
                return;
            }
            if (!modal.hidden) closeModal();
        }
    });
    window.addEventListener('scroll', hideHoverCard, { passive: true });
    window.addEventListener('resize', hideHoverCard, { passive: true });

    // ---------- Фильтры и поиск ----------
    const filterAssignee = document.getElementById('filterAssignee');
    const filterPriority = document.getElementById('filterPriority');
    const filterSeverity = document.getElementById('filterSeverity');
    const searchInput = document.getElementById('searchInput');

    fillSelect(filterAssignee, [...CONFIG.assignees, { id: 'none', name: 'Не назначен' }], { keepFirst: true });
    fillSelect(filterPriority, CONFIG.priorities, { keepFirst: true });
    fillSelect(filterSeverity, CONFIG.severities, { keepFirst: true });

    filterAssignee.addEventListener('change', () => { state.filters.assignee = filterAssignee.value; render(); });
    filterPriority.addEventListener('change', () => { state.filters.priority = filterPriority.value; render(); });
    filterSeverity.addEventListener('change', () => { state.filters.severity = filterSeverity.value; render(); });
    searchInput.addEventListener('input', () => { state.filters.query = searchInput.value; render(); });

    document.getElementById('resetFilters').addEventListener('click', () => {
        state.filters = { assignee: '', priority: '', severity: '', query: '' };
        filterAssignee.value = filterPriority.value = filterSeverity.value = searchInput.value = '';
        render();
    });

    // ---------- ЛОГИКА СОТРУДНИКОВ ----------

    function filteredEmployees() {
        let list = state.employees;
        const q = (state.empFilters.query || (state.view === 'employees' ? state.filters.query : '')).trim().toLowerCase();
        if (q) {
            list = list.filter((e) => {
                return (e.full_name && e.full_name.toLowerCase().includes(q)) ||
                       (e.position && e.position.toLowerCase().includes(q)) ||
                       (e.department && e.department.toLowerCase().includes(q)) ||
                       (e.email && e.email.toLowerCase().includes(q)) ||
                       (e.work_phone && e.work_phone.toLowerCase().includes(q)) ||
                       (e.workplace && e.workplace.code.toLowerCase().includes(q)) ||
                       (e.equipment && e.equipment.toLowerCase().includes(q));
            });
        }
        if (state.empFilters.dept) {
            list = list.filter((e) => e.department === state.empFilters.dept);
        }
        if (state.empFilters.workplace === 'assigned') {
            list = list.filter((e) => Boolean(e.workplace));
        } else if (state.empFilters.workplace === 'unassigned') {
            list = list.filter((e) => !e.workplace);
        }
        if (state.empFilters.floor) {
            list = list.filter((e) => e.workplace && String(e.workplace.floor_id) === String(state.empFilters.floor));
        }
        return list;
    }

    function canEditEmployee(emp) {
        if (!emp) return false;
        if (state.auth && state.auth.is_admin) return true;
        if (state.auth && state.auth.is_authenticated && state.auth.employee_id && Number(state.auth.employee_id) === Number(emp.id)) return true;
        return Boolean(state.auth && state.auth.is_authenticated && emp.can_edit);
    }

    function renderEmployees() {
        if (!employeesGridEl) return;
        const list = filteredEmployees();
        employeesGridEl.innerHTML = '';

        if (list.length === 0) {
            if (employeesEmptyEl) employeesEmptyEl.hidden = false;
            return;
        }
        if (employeesEmptyEl) employeesEmptyEl.hidden = true;

        list.forEach((emp) => {
            const card = el('article', { class: 'emp-card', 'data-id': String(emp.id) });

            // Аватар
            let avatarEl;
            if (emp.photo_url) {
                avatarEl = el('img', { class: 'emp-avatar', src: emp.photo_url, alt: emp.full_name });
            } else {
                avatarEl = el('div', { class: 'emp-avatar emp-avatar--placeholder', text: emp.initials || '—' });
            }

            const headMain = el('div', { class: 'emp-card__main' }, [
                el('h3', { class: 'emp-card__name', text: emp.full_name }),
                el('div', { class: 'emp-card__pos', text: emp.position || 'Должность не указана' }),
                emp.department ? el('span', { class: 'emp-card__dept', text: emp.department }) : null,
            ].filter(Boolean));

            const head = el('div', { class: 'emp-card__head' }, [avatarEl, headMain]);

            // Рабочее место
            let wpBlock;
            if (emp.workplace) {
                wpBlock = el('div', { class: 'emp-card__workplace emp-card__workplace--assigned' }, [
                    el('span', { text: `📍 ${emp.workplace.code} · ${emp.workplace.floor_name || ''} ${emp.workplace.room ? '(' + emp.workplace.room + ')' : ''}`.trim() })
                ]);
            } else {
                // Если рабочее место не задано, укажи, что "Не задано"
                wpBlock = el('div', { class: 'emp-card__workplace emp-card__workplace--unassigned' }, [
                    el('span', { text: '📍 Не задано' })
                ]);
            }

            // Контакты
            const contactItems = [];
            if (emp.work_phone) {
                contactItems.push(el('div', { class: 'emp-card__contact-item', title: 'Рабочий телефон' }, [
                    el('svg', { viewBox: '0 0 24 24' }, [el('path', { d: 'M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.24 1.02l-2.21 2.2z' })]),
                    el('span', { text: emp.work_phone })
                ]));
            }
            if (emp.email) {
                contactItems.push(el('div', { class: 'emp-card__contact-item', title: 'E-mail' }, [
                    el('svg', { viewBox: '0 0 24 24' }, [el('path', { d: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' })]),
                    el('span', { text: emp.email })
                ]));
            }
            const contactsBlock = contactItems.length > 0 ? el('div', { class: 'emp-card__contacts' }, contactItems) : null;

            // Нижняя строка карточки
            const footerChildren = [];
            const empInv = (Array.isArray(emp.inventory_items) && emp.inventory_items.length > 0)
                ? emp.inventory_items
                : (state.inventory || []).filter((it) => it.employee_id === emp.id);

            if (empInv.length > 0) {
                footerChildren.push(el('span', {
                    title: empInv.map((i) => `${i.inventory_number}: ${i.name}`).join('\n'),
                    text: `Техника: ${empInv.length} шт.`
                }));
            } else if (emp.equipment) {
                footerChildren.push(el('span', { title: emp.equipment, text: 'Техника закреплена' }));
            } else {
                footerChildren.push(el('span', { text: '' }));
            }
            if (canEditEmployee(emp)) {
                footerChildren.push(el('span', { class: 'emp-card__badge-edit', text: 'Редактировать' }));
            }
            const footer = el('div', { class: 'emp-card__footer' }, footerChildren);

            card.append(head, wpBlock);
            if (contactsBlock) card.append(contactsBlock);
            card.append(footer);

            card.addEventListener('click', () => openEmployeeModal(emp, false));
            employeesGridEl.appendChild(card);
        });
    }

    // ---------- Мои задачи ----------
    function getMyTasks() {
        const empName = state.auth.employee_name || '';
        const username = state.auth.username || '';
        const wpId = state.auth.workplace_id ? Number(state.auth.workplace_id) : null;

        return state.tasks.filter((t) => {
            const matchesCreator = (empName && t.creator === empName) || (username && t.creator === username);
            const matchesWorkplace = wpId && t.workplace && Number(t.workplace) === wpId;
            return matchesCreator || matchesWorkplace;
        });
    }

    function renderMyTasks() {
        if (!myTasksGridEl) return;
        myTasksGridEl.innerHTML = '';
        const myTasks = getMyTasks();

        if (myTasks.length === 0) {
            if (myTasksEmptyEl) myTasksEmptyEl.hidden = false;
            return;
        }
        if (myTasksEmptyEl) myTasksEmptyEl.hidden = true;

        myTasks.forEach((task) => {
            const statusObj = CONFIG.statuses.find((s) => s.id === task.status) || { name: task.status, id: task.status };
            const priorityObj = CONFIG.priorities.find((p) => p.id === task.priority) || { name: task.priority };

            const assigneeName = task.assignee || '';
            const hasAssignee = Boolean(assigneeName && assigneeName.trim());

            let wpLabel = '';
            if (task.workplace && workplacesById[task.workplace]) {
                const wp = workplacesById[task.workplace];
                wpLabel = `${wp.code}${wp.room ? ' · ' + wp.room : ''}`;
            }

            const card = el('div', { class: 'my-task-card', onclick: () => openModal(task) }, [
                el('div', { class: 'my-task-card__top' }, [
                    el('div', { class: 'my-task-card__tags' }, [
                        el('span', { class: `my-task-card__badge my-task-card__status--${task.status}`, text: statusObj.name }),
                        el('span', { class: 'tag', text: priorityObj.name })
                    ]),
                    el('span', { class: 'card__key', text: `${KEY_PREFIX}-${task.id}` })
                ]),
                el('div', {}, [
                    el('h3', { class: 'my-task-card__title', text: task.title }),
                    task.description ? el('p', { class: 'my-task-card__desc', text: task.description }) : null
                ]),
                el('div', { class: 'my-task-card__footer' }, [
                    el('div', { class: 'my-task-card__assignee' }, [
                        el('span', { class: `my-task-card__assignee-dot ${hasAssignee ? '' : 'my-task-card__assignee-dot--empty'}` }),
                        el('span', {
                            style: hasAssignee ? 'color: var(--text-primary);' : 'color: var(--text-secondary); font-style: italic;',
                            text: hasAssignee ? `Исполнитель: ${assigneeName}` : 'Исполнитель: не назначен'
                        })
                    ]),
                    el('div', { class: 'my-task-card__meta-row' }, [
                        wpLabel ? el('span', { text: `Стол: ${wpLabel}` }) : el('span', { text: 'Без привязки к месту' }),
                        task.creator ? el('span', { text: `Автор: ${task.creator}` }) : el('span', {})
                    ])
                ])
            ]);

            myTasksGridEl.appendChild(card);
        });
    }

    function openEmployeeModal(emp, isEditMode = false) {
        if (!employeeModalEl || !employeeDialogEl) return;
        employeeDialogEl.innerHTML = '';
        const editable = canEditEmployee(emp);

        if (!isEditMode) {
            // ----- РЕЖИМ ПРОСМОТРА -----
            const header = el('div', { class: 'modal__header' }, [
                el('h2', { text: 'Карточка сотрудника' }),
                el('button', { class: 'icon-btn', type: 'button', 'data-close': '', html: '&times;', onclick: closeEmployeeModal })
            ]);

            let avatarBig;
            if (emp.photo_url) {
                avatarBig = el('img', { class: 'emp-modal-view__avatar', src: emp.photo_url, alt: emp.full_name });
            } else {
                avatarBig = el('div', { class: 'emp-modal-view__avatar emp-modal-view__avatar--placeholder', text: emp.initials || '—' });
            }

            const heroInfo = el('div', { class: 'emp-modal-view__info' }, [
                el('h1', { class: 'emp-modal-view__name', text: emp.full_name }),
                el('div', { class: 'emp-modal-view__pos', text: emp.position || 'Должность не указана' }),
                emp.department ? el('span', { class: 'emp-modal-view__dept-tag', text: emp.department }) : null,
            ].filter(Boolean));

            const hero = el('div', { class: 'emp-modal-view__hero' }, [avatarBig, heroInfo]);

            // Блоки деталей
            let wpValEl;
            if (emp.workplace) {
                wpValEl = el('div', {}, [
                    el('div', { style: 'font-weight: 600; color: #0066cc; margin-bottom: 4px;', text: `📍 ${emp.workplace.code} · ${emp.workplace.floor_name || ''} ${emp.workplace.room ? '(' + emp.workplace.room + ')' : ''}`.trim() }),
                    el('button', {
                        class: 'btn btn--ghost btn--small',
                        type: 'button',
                        style: 'margin-top: 4px; font-size: 12px;',
                        text: 'Показать на карте этажа',
                        onclick: () => {
                            closeEmployeeModal();
                            state.floor = String(emp.workplace.floor_id);
                            state.selectedPlace = emp.workplace.code;
                            setView('map');
                        }
                    })
                ]);
            } else {
                wpValEl = el('div', { style: 'color: #9c5800; font-weight: 600;', text: 'Не задано' });
            }

            const empInv = (Array.isArray(emp.inventory_items) && emp.inventory_items.length > 0)
                ? emp.inventory_items
                : (state.inventory || []).filter((it) => it.employee_id === emp.id);

            let equipmentValEl;
            if (empInv.length > 0) {
                const canManageInv = Boolean(editable || (state.auth && (state.auth.is_admin || state.auth.is_mto)));
                equipmentValEl = el('div', { class: 'emp-inventory-list' }, empInv.map((it) => {
                    const st = INV_STATUS_MAP[it.status] || { name: it.status || 'В работе', cls: 'inv-status--assigned' };
                    const actionBtns = [
                        el('button', {
                            class: 'btn btn--ghost btn--icon-sm',
                            type: 'button',
                            text: 'Печать',
                            title: 'Печать термонаклейки 50x30 мм',
                            onclick: (e) => {
                                e.stopPropagation();
                                printInventorySticker(it);
                            }
                        })
                    ];
                    if (canManageInv && it.status !== 'decommissioned') {
                        actionBtns.push(el('button', {
                            class: 'btn btn--danger-ghost btn--icon-sm',
                            type: 'button',
                            text: 'Списать',
                            title: 'Перевести оборудование в статус «Списано»',
                            onclick: (e) => {
                                e.stopPropagation();
                                openDecommissionInventoryModal(it, emp);
                            }
                        }));
                    }
                    return el('div', {
                        class: 'emp-inventory-item emp-inventory-item--clickable',
                        title: 'Нажмите для редактирования оборудования',
                        onclick: () => {
                            closeEmployeeModal();
                            openInventoryModal(it);
                        }
                    }, [
                        el('div', { class: 'emp-inventory-item__info' }, [
                            el('span', { class: 'inventory-num', text: it.inventory_number || '' }),
                            el('span', { class: 'inventory-name', text: it.name || '' }),
                            el('span', { class: `inv-status-badge ${st.cls}`, text: st.name }),
                        ]),
                        el('div', { class: 'emp-inventory-item__actions' }, actionBtns)
                    ]);
                }));
            } else if (emp.equipment) {
                equipmentValEl = el('div', { class: 'emp-detail-block__val', style: 'white-space: pre-wrap; line-height: 1.5;', text: emp.equipment });
            } else {
                equipmentValEl = el('div', { class: 'emp-detail-block__val', style: 'color: var(--text-secondary);', text: 'Оборудование пока не закреплено' });
            }

            const detailsGridChildren = [
                el('div', { class: 'emp-detail-block' }, [
                    el('span', { class: 'emp-detail-block__label', text: 'Рабочее место' }),
                    wpValEl,
                ]),
                el('div', { class: 'emp-detail-block' }, [
                    el('span', { class: 'emp-detail-block__label', text: 'Контакты' }),
                    el('div', { class: 'emp-detail-block__val' }, [
                        emp.work_phone ? el('div', { html: `тел: <a href="tel:${emp.work_phone}">${emp.work_phone}</a>` }) : el('div', { text: 'тел: —' }),
                        emp.email ? el('div', { html: `email: <a href="mailto:${emp.email}">${emp.email}</a>` }) : el('div', { text: 'email: —' }),
                    ]),
                ]),
                el('div', { class: 'emp-detail-block emp-detail-block--full' }, [
                    el('span', { class: 'emp-detail-block__label', text: 'Закреплённая техника (Инвентаризация)' }),
                    equipmentValEl,
                ]),
            ];

            if (state.auth && state.auth.is_admin) {
                detailsGridChildren.push(el('div', { class: 'emp-detail-block emp-detail-block--full' }, [
                    el('span', { class: 'emp-detail-block__label', text: 'Учётная запись (доступ в систему)' }),
                    el('div', { class: 'emp-detail-block__val' }, [
                        emp.user && emp.user.username
                            ? el('span', { style: 'font-weight: 500;', text: `Логин: ${emp.user.username}${emp.user.is_admin ? ' (Администратор)' : ''}` })
                            : el('span', { style: 'color: var(--text-secondary);', text: 'Учётная запись не создана (нет доступа в систему)' })
                    ])
                ]));
            }

            const detailsGrid = el('div', { class: 'emp-details-grid' }, detailsGridChildren);

            // Плашка прав доступа
            let permBanner;
            if (editable) {
                permBanner = el('div', { class: 'emp-modal__perm-banner emp-modal__perm-banner--ok' }, [
                    el('span', { text: 'Вы можете редактировать эту карточку (как администратор системы или владелец).' }),
                    el('button', {
                        class: 'btn btn--action btn--small',
                        type: 'button',
                        text: 'Редактировать',
                        onclick: () => openEmployeeModal(emp, true)
                    })
                ]);
            } else if (!state.auth.is_authenticated) {
                permBanner = el('div', { class: 'emp-modal__perm-banner emp-modal__perm-banner--info' }, [
                    el('span', { text: 'Редактировать карточки сотрудников могут либо администраторы системы, либо сами сотрудники.' }),
                    el('button', {
                        class: 'btn btn--ghost btn--small',
                        type: 'button',
                        text: 'Войти',
                        onclick: () => openLoginModal()
                    })
                ]);
            } else {
                permBanner = el('div', { class: 'emp-modal__perm-banner emp-modal__perm-banner--info' }, [
                    el('span', { text: 'Редактировать карточку может только сам сотрудник или администратор системы.' })
                ]);
            }

            const body = el('div', { class: 'modal__body emp-modal-view' }, [hero, detailsGrid, permBanner]);

            const footer = el('div', { class: 'modal__footer' }, [
                el('div', {}),
                el('div', { class: 'modal__footer-right' }, [
                    el('button', { class: 'btn btn--ghost', type: 'button', text: 'Закрыть', onclick: closeEmployeeModal }),
                    editable ? el('button', { class: 'btn btn--action', type: 'button', text: 'Редактировать', onclick: () => openEmployeeModal(emp, true) }) : null,
                ].filter(Boolean))
            ]);

            employeeDialogEl.append(header, body, footer);
        } else {
            // ----- РЕЖИМ РЕДАКТИРОВАНИЯ -----
            const form = el('form', { id: 'empEditForm', autocomplete: 'off' });

            const isNew = !emp || !emp.id;
            const header = el('div', { class: 'modal__header' }, [
                el('h2', { text: isNew ? 'Новый сотрудник' : `Редактирование: ${emp.full_name}` }),
                el('button', { class: 'icon-btn', type: 'button', 'data-close': '', html: '&times;', onclick: () => isNew ? closeEmployeeModal() : openEmployeeModal(emp, false) })
            ]);

            const errBanner = el('div', {
                class: 'emp-modal__perm-banner emp-modal__perm-banner--error',
                hidden: true
            });

            // Загрузка фото (кастомный контрол с превью, именем файла и кнопкой сброса)
            const previewContainer = el('div', { class: 'photo-uploader__preview-wrap' });
            function renderAvatarPreview(srcUrl) {
                previewContainer.innerHTML = '';
                if (srcUrl) {
                    previewContainer.appendChild(el('img', { class: 'photo-uploader__preview', src: srcUrl, alt: emp.full_name || 'Фото' }));
                } else {
                    previewContainer.appendChild(el('div', { class: 'photo-uploader__preview', text: emp.initials || initials(emp.full_name || '') || '—' }));
                }
            }
            renderAvatarPreview(emp.photo_url || '');

            const deletePhotoInput = el('input', { type: 'hidden', name: 'delete_photo', value: 'false' });
            const photoInput = el('input', {
                type: 'file',
                name: 'photo',
                accept: 'image/*',
                class: 'custom-file-upload__input',
                id: 'empPhotoFileInput'
            });

            const uploadSvgIcon = '<svg viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>';
            const chooseBtn = el('label', {
                class: 'custom-file-upload__btn',
                for: 'empPhotoFileInput',
                html: `${uploadSvgIcon}<span>Выбрать фото</span>`
            });

            const fileNameSpan = el('span', {
                class: 'custom-file-upload__filename',
                text: emp.photo_url ? 'Загружено текущее фото' : 'Файл не выбран'
            });

            const resetPhotoBtn = el('button', {
                class: 'custom-file-upload__reset',
                type: 'button',
                hidden: !emp.photo_url,
                text: emp.photo_url ? 'Удалить фото' : 'Сбросить',
                onclick: () => {
                    photoInput.value = '';
                    if (emp.photo_url && deletePhotoInput.value === 'false') {
                        deletePhotoInput.value = 'true';
                        renderAvatarPreview('');
                        fileNameSpan.textContent = 'Текущее фото будет удалено';
                        fileNameSpan.classList.remove('custom-file-upload__filename--active');
                        resetPhotoBtn.hidden = true;
                    } else {
                        deletePhotoInput.value = 'false';
                        renderAvatarPreview(emp.photo_url || '');
                        fileNameSpan.textContent = emp.photo_url ? 'Загружено текущее фото' : 'Файл не выбран';
                        fileNameSpan.classList.remove('custom-file-upload__filename--active');
                        resetPhotoBtn.textContent = 'Удалить фото';
                        resetPhotoBtn.hidden = !emp.photo_url;
                    }
                }
            });

            photoInput.addEventListener('change', () => {
                if (photoInput.files && photoInput.files[0]) {
                    const file = photoInput.files[0];
                    deletePhotoInput.value = 'false';
                    fileNameSpan.textContent = file.name;
                    fileNameSpan.classList.add('custom-file-upload__filename--active');
                    resetPhotoBtn.textContent = 'Сбросить';
                    resetPhotoBtn.hidden = false;

                    const reader = new FileReader();
                    reader.onload = (e) => {
                        renderAvatarPreview(e.target.result);
                    };
                    reader.readAsDataURL(file);
                }
            });

            const customUploader = el('div', { class: 'custom-file-upload' }, [
                photoInput,
                deletePhotoInput,
                el('div', { class: 'custom-file-upload__row' }, [
                    chooseBtn,
                    fileNameSpan,
                    resetPhotoBtn
                ])
            ]);

            const photoBlock = el('div', { class: 'photo-uploader' }, [
                previewContainer,
                el('div', { class: 'photo-uploader__controls' }, [
                    el('span', { class: 'field__label', text: 'Фотография сотрудника' }),
                    customUploader
                ])
            ]);

            // Выбор рабочего места
            const wpSelect = el('select', { class: 'input', name: 'workplace_id' }, [
                el('option', { value: '', text: '— Не задано —' })
            ]);

            // Группируем по этажам
            const floorsGrouped = {};
            state.workplaces.forEach((w) => {
                const fname = w.floor_name || `Этаж ${w.floor_id}`;
                if (!floorsGrouped[fname]) floorsGrouped[fname] = [];
                floorsGrouped[fname].push(w);
            });
            Object.entries(floorsGrouped).forEach(([fname, wps]) => {
                const optgroup = el('optgroup', { label: fname });
                wps.forEach((w) => {
                    const opt = el('option', {
                        value: String(w.id),
                        text: `${w.code}${w.room ? ' · ' + w.room : ''}${w.label ? ' · ' + w.label : ''}`.trim()
                    });
                    if (emp.workplace && String(emp.workplace.id) === String(w.id)) {
                        opt.selected = true;
                    }
                    optgroup.appendChild(opt);
                });
                wpSelect.appendChild(optgroup);
            });

            // Форма
            const bodyFields = [
                errBanner,
                photoBlock,
                el('label', { class: 'field' }, [
                    el('span', { class: 'field__label', html: 'ФИО <span class="req">*</span>' }),
                    el('input', { class: 'input', name: 'full_name', value: emp.full_name, required: true, maxlength: '200' })
                ]),
                el('div', { class: 'grid-2' }, [
                    el('label', { class: 'field' }, [
                        el('span', { class: 'field__label', text: 'Должность' }),
                        el('input', { class: 'input', name: 'position', value: emp.position || '', placeholder: 'Инженер, менеджер...' })
                    ]),
                    el('label', { class: 'field' }, [
                        el('span', { class: 'field__label', text: 'Отдел' }),
                        el('input', { class: 'input', name: 'department', list: 'empDeptDatalist', value: emp.department || '', placeholder: 'Отдел...' }),
                    ]),
                ]),
                el('div', { class: 'grid-2' }, [
                    el('label', { class: 'field' }, [
                        el('span', { class: 'field__label', text: 'Рабочий телефон' }),
                        el('input', { class: 'input', name: 'work_phone', value: emp.work_phone || '', placeholder: '+7 (xxx) xxx-xx-xx' })
                    ]),
                    el('label', { class: 'field' }, [
                        el('span', { class: 'field__label', text: 'E-mail' }),
                        el('input', { class: 'input', type: 'email', name: 'email', value: emp.email || '', placeholder: 'user@company.ru' })
                    ]),
                ]),
                el('label', { class: 'field' }, [
                    el('span', { class: 'field__label', text: 'Рабочее место на плане этажа' }),
                    wpSelect
                ]),
                el('label', { class: 'field' }, [
                    el('span', { class: 'field__label', text: 'Закреплённая техника (для инвентаризации)' }),
                    el('textarea', { class: 'input input--area', name: 'equipment', rows: '4', placeholder: 'ПК Dell OptiPlex, монитор 27", периферия...' }, [
                        document.createTextNode(emp.equipment || '')
                    ])
                ]),
            ];

            if (state.auth && state.auth.is_admin) {
                const userLogin = (emp.user && emp.user.username) || '';
                const passwordInput = el('input', {
                    class: 'input',
                    type: 'text',
                    name: 'password',
                    placeholder: userLogin ? 'Оставьте пустым, чтобы не изменять' : 'Введите пароль или нажмите «Сгенерировать»'
                });

                const genPassBtn = el('button', {
                    class: 'btn-gen-pass',
                    type: 'button',
                    text: 'Сгенерировать пароль',
                    onclick: () => {
                        const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
                        let pass = '';
                        for (let i = 0; i < 10; i++) {
                            pass += chars.charAt(Math.floor(Math.random() * chars.length));
                        }
                        passwordInput.value = pass;
                        passwordInput.focus();
                    }
                });

                bodyFields.push(el('div', {
                    class: 'emp-modal__auth-box'
                }, [
                    el('div', { class: 'emp-modal__auth-title' }, [
                        document.createTextNode('Учётная запись (доступ в систему)')
                    ]),
                    el('div', { class: 'grid-2' }, [
                        el('div', { class: 'field' }, [
                            el('div', { class: 'field__label-row' }, [
                                el('span', { class: 'field__label', text: 'Логин (username)' })
                            ]),
                            el('input', { class: 'input', name: 'username', value: userLogin, placeholder: 'например, ivanov' })
                        ]),
                        el('div', { class: 'field' }, [
                            el('div', { class: 'field__label-row' }, [
                                el('span', { class: 'field__label', text: 'Пароль' }),
                                genPassBtn
                            ]),
                            passwordInput
                        ])
                    ])
                ]));
            }

            const body = el('div', { class: 'modal__body' }, bodyFields);

            const footer = el('div', { class: 'modal__footer' }, [
                el('div', {}),
                el('div', { class: 'modal__footer-right' }, [
                    el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена', onclick: () => isNew ? closeEmployeeModal() : openEmployeeModal(emp, false) }),
                    el('button', { class: 'btn btn--action', type: 'submit', id: 'empSaveBtn', text: isNew ? 'Создать сотрудника' : 'Сохранить изменения' }),
                ])
            ]);

            form.append(header, body, footer);

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const saveBtn = form.querySelector('#empSaveBtn');
                saveBtn.disabled = true;
                saveBtn.textContent = 'Сохранение...';
                errBanner.hidden = true;

                const formData = new FormData(form);
                try {
                    const url = isNew ? '/api/employees/create/' : `/api/employees/${emp.id}/update/`;
                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'X-CSRFToken': getCsrfToken(),
                        },
                        body: formData,
                    });
                    const res = await resp.json();
                    if (!resp.ok || !res.success) {
                        throw new Error(res.error || 'Не удалось сохранить данные сотрудника');
                    }
                    // Обновляем сотрудника в памяти
                    const updatedEmp = res.employee;
                    if (isNew) {
                        state.employees.push(updatedEmp);
                    } else {
                        const idx = state.employees.findIndex((x) => x.id === emp.id);
                        if (idx !== -1) {
                            state.employees[idx] = updatedEmp;
                        }
                    }
                    // Добавляем отдел в фильтры если новый
                    if (updatedEmp.department && !state.departments.includes(updatedEmp.department)) {
                        state.departments.push(updatedEmp.department);
                        state.departments.sort();
                        initEmployeeFilters();
                    }
                    populateCreatorList();
                    render();
                    openEmployeeModal(updatedEmp, false);
                } catch (err) {
                    errBanner.textContent = err.message;
                    errBanner.hidden = false;
                    saveBtn.disabled = false;
                    saveBtn.textContent = isNew ? 'Создать сотрудника' : 'Сохранить изменения';
                }
            });

            employeeDialogEl.appendChild(form);
        }

        employeeModalEl.hidden = false;
    }

    function closeEmployeeModal() {
        if (employeeModalEl) employeeModalEl.hidden = true;
    }

    // ---------- АВТОРИЗАЦИЯ И USER PILL ----------

    function renderUserPill() {
        if (!userPillEl) return;
        userPillEl.innerHTML = '';

        // Ограничение видимости конструктора только для администратора
        const isAdmin = state.auth && state.auth.is_admin;
        const constructorNav = document.getElementById('constructorNavBtn');
        if (constructorNav) {
            constructorNav.style.display = isAdmin ? '' : 'none';
        }
        const editFloorBtn = document.getElementById('editFloorBtn');
        if (editFloorBtn) {
            editFloorBtn.style.display = isAdmin ? '' : 'none';
        }

        userPillEl.classList.toggle('user-pill--guest', !state.auth.is_authenticated);

        if (state.auth.is_authenticated) {
            const username = state.auth.username || 'Пользователь';
            const isAdmin = state.auth.is_admin;
            const initial = username.charAt(0).toUpperCase();

            const avatar = el('span', { class: 'user-pill__avatar', text: initial });
            const nameSpan = el('span', { style: 'font-weight: 600;', text: username });
            const roleBadge = el('span', {
                class: `user-pill__role ${isAdmin ? 'user-pill__role--admin' : ''}`,
                text: isAdmin ? 'Администратор' : 'Сотрудник'
            });
            const logoutBtn = el('button', {
                class: 'user-pill__btn',
                type: 'button',
                text: 'Выйти',
                onclick: handleLogout
            });

            userPillEl.append(avatar, nameSpan, roleBadge, logoutBtn);
        } else {
            const loginBtn = el('button', {
                class: 'btn btn--ghost',
                style: 'padding: 4px 12px; font-size: 13px; height: 34px;',
                type: 'button',
                text: 'Войти',
                onclick: openLoginModal
            });
            userPillEl.append(loginBtn);
        }
    }

    function openLoginModal() {
        if (!loginModalEl || !loginFormEl) return;
        loginFormEl.reset();
        if (loginErrorEl) loginErrorEl.hidden = true;
        loginModalEl.hidden = false;
        setTimeout(() => {
            const uInput = loginFormEl.querySelector('input[name="username"]');
            if (uInput) uInput.focus();
        }, 50);
    }

    function closeLoginModal() {
        if (loginModalEl) loginModalEl.hidden = true;
    }

    async function handleLogout() {
        try {
            await fetch('/api/auth/logout/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
            });
        } catch (e) { /* ignore */ }
        state.auth = { is_authenticated: false, username: '', is_admin: false };
        state.workday = null;
        if (workdayTimerInterval) {
            clearInterval(workdayTimerInterval);
            workdayTimerInterval = null;
        }
        await refreshEmployees();
        render();
    }

    if (loginFormEl) {
        loginFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginErrorEl) loginErrorEl.hidden = true;
            const submitBtn = loginFormEl.querySelector('button[type="submit"]');
            submitBtn.disabled = true;

            const username = loginFormEl.username.value.trim();
            const password = loginFormEl.password.value;

            try {
                const resp = await fetch('/api/auth/login/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({ username, password }),
                });
                const res = await resp.json();
                if (!resp.ok || !res.success) {
                    throw new Error(res.error || 'Неверный логин или пароль');
                }
                state.auth = {
                    is_authenticated: true,
                    username: res.user.username,
                    is_admin: res.user.is_admin,
                    is_mto: Boolean(res.user.is_mto || res.user.is_admin),
                };
                closeLoginModal();
                await refreshEmployees();
                await loadWorkdayStatus();
                render();
            } catch (err) {
                if (loginErrorEl) {
                    loginErrorEl.textContent = err.message;
                    loginErrorEl.hidden = false;
                }
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    async function refreshEmployees() {
        try {
            const resp = await fetch('/api/employees/');
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && data.employees) {
                state.employees = data.employees;
                state.departments = data.departments || state.departments;
                if (data.auth) state.auth = data.auth;
                initEmployeeFilters();
                populateCreatorList();
            }
        } catch (e) {
            console.error('Ошибка обновления списка сотрудников:', e);
        }
    }

    function initEmployeeFilters() {
        if (!filterEmpDeptEl) return;
        filterEmpDeptEl.innerHTML = '<option value="">Все отделы</option>';
        state.departments.forEach((dept) => {
            const opt = el('option', { value: dept, text: dept });
            if (state.empFilters.dept === dept) opt.selected = true;
            filterEmpDeptEl.appendChild(opt);
        });

        if (filterEmpFloorEl) {
            filterEmpFloorEl.innerHTML = '<option value="">Все этажи</option>';
            CONFIG.floors.forEach((f) => {
                const opt = el('option', { value: String(f.id), text: f.name });
                if (state.empFilters.floor === String(f.id)) opt.selected = true;
                filterEmpFloorEl.appendChild(opt);
            });
        }
    }

    function populateCreatorList() {
        if (!creatorListEl) return;
        creatorListEl.innerHTML = '';
        const names = new Set();
        (state.employees || []).forEach((e) => {
            if (e.full_name) names.add(e.full_name.trim());
        });
        (CONFIG.assignees || []).forEach((a) => {
            if (a.name) names.add(a.name.trim());
        });
        workplaces.forEach((wp) => {
            if (wp.employee) names.add(wp.employee.trim());
        });
        Array.from(names).sort().forEach((name) => {
            creatorListEl.appendChild(el('option', { value: name }));
        });
    }

    if (employeeModalEl) {
        employeeModalEl.querySelectorAll('[data-close]').forEach((n) =>
            n.addEventListener('click', closeEmployeeModal));
    }
    if (loginModalEl) {
        loginModalEl.querySelectorAll('[data-close]').forEach((n) =>
            n.addEventListener('click', closeLoginModal));
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (employeeModalEl && !employeeModalEl.hidden) closeEmployeeModal();
            if (loginModalEl && !loginModalEl.hidden) closeLoginModal();
            if (inventoryModalEl && !inventoryModalEl.hidden) closeInventoryModal();
        }
    });

    if (filterEmpDeptEl) {
        filterEmpDeptEl.addEventListener('change', () => {
            state.empFilters.dept = filterEmpDeptEl.value;
            render();
        });
    }
    if (filterEmpWorkplaceEl) {
        filterEmpWorkplaceEl.addEventListener('change', () => {
            state.empFilters.workplace = filterEmpWorkplaceEl.value;
            render();
        });
    }
    if (filterEmpFloorEl) {
        filterEmpFloorEl.addEventListener('change', () => {
            state.empFilters.floor = filterEmpFloorEl.value;
            render();
        });
    }
    if (resetEmpFiltersEl) {
        resetEmpFiltersEl.addEventListener('click', () => {
            state.empFilters = { dept: '', workplace: '', floor: '', query: '' };
            if (filterEmpDeptEl) filterEmpDeptEl.value = '';
            if (filterEmpWorkplaceEl) filterEmpWorkplaceEl.value = '';
            if (filterEmpFloorEl) filterEmpFloorEl.value = '';
            if (searchInput) searchInput.value = '';
            render();
        });
    }

    // Инициализируем фильтры и список создателей
    initEmployeeFilters();
    populateCreatorList();

    // ---------- Переключение доска / карта / сотрудники / мои задачи / инвентаризация / переговорные ----------
    function setView(view) {
        state.view = view;
        const hash = view === 'map' ? '#map' : (view === 'employees' ? '#employees' : (view === 'my-tasks' ? '#my-tasks' : (view === 'inventory' ? '#inventory' : (view === 'rooms' ? '#rooms' : '#board'))));
        history.replaceState(null, '', hash);
        if (view === 'inventory' && !state.inventoryLoaded) {
            loadInventory();
        }
        render();
    }

    const appSidebarEl = document.getElementById('appSidebar');
    const sidebarOverlayEl = document.getElementById('sidebarOverlay');
    const mobileMenuBtnEl = document.getElementById('mobileMenuBtn');

    function closeMobileSidebar() {
        if (appSidebarEl) appSidebarEl.classList.remove('sidebar--open');
        if (sidebarOverlayEl) sidebarOverlayEl.hidden = true;
    }

    if (mobileMenuBtnEl && appSidebarEl) {
        mobileMenuBtnEl.addEventListener('click', () => {
            const isOpen = appSidebarEl.classList.toggle('sidebar--open');
            if (sidebarOverlayEl) sidebarOverlayEl.hidden = !isOpen;
        });
    }
    if (sidebarOverlayEl) {
        sidebarOverlayEl.addEventListener('click', closeMobileSidebar);
    }

    document.getElementById('toggleViewBtn').addEventListener('click', () =>
        setView(state.view === 'map' ? 'board' : 'map'));
    document.querySelectorAll('.nav-item[data-view]').forEach((n) =>
        n.addEventListener('click', (e) => {
            e.preventDefault();
            closeMobileSidebar();
            setView(n.dataset.view);
        }));
    window.addEventListener('hashchange', () => {
        state.view = parseHashView();
        if (state.view === 'inventory' && !state.inventoryLoaded) {
            loadInventory();
        }
        render();
    });

    document.getElementById('createBtn').addEventListener('click', () => {
        if (state.view === 'rooms') {
            openRoomBookingModal();
            return;
        }
        if (state.view === 'inventory') {
            openInventoryModal();
            return;
        }
        if (state.view === 'employees') {
            openEmployeeModal({
                id: 0,
                full_name: '',
                position: '',
                department: '',
                work_phone: '',
                email: '',
                equipment: '',
                workplace: null,
                can_edit: true,
            }, true);
            return;
        }
        if (state.view === 'my-tasks') {
            openModal(null, {
                creator: state.auth.employee_name || state.auth.username || '',
                workplace: state.auth.workplace_id ? String(state.auth.workplace_id) : ''
            });
            return;
        }
        openModal(null, state.view === 'map' && state.selectedPlace ? { workplace: state.selectedPlace } : {});
    });

    const createMyTaskBtn = document.getElementById('createMyTaskBtn');
    if (createMyTaskBtn) {
        createMyTaskBtn.addEventListener('click', () => {
            openModal(null, {
                creator: state.auth.employee_name || state.auth.username || '',
                workplace: state.auth.workplace_id ? String(state.auth.workplace_id) : ''
            });
        });
    }

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

    // ---------- Учёт рабочего времени ----------
    const START_PHRASES = [
        'Прекрасно выглядите! Хорошего дня!',
        'Рады вас видеть!',
        'Отличного настроения и легких задач!'
    ];

    const FINISH_PHRASES = [
        'Хорошего вечера!'
    ];

    let toastTimeout = null;
    function showToast(text, type = 'info') {
        const toastEl = document.getElementById('trackerToast');
        if (!toastEl) return;
        toastEl.textContent = text;
        toastEl.className = 'toast toast--show';
        if (type === 'success') toastEl.classList.add('toast--success');
        if (type === 'error') toastEl.classList.add('toast--error');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('toast--show');
        }, 3500);
    }

    function getWorkdayElapsedMs(session) {
        if (!session || !session.started_at) return 0;
        const start = new Date(session.started_at).getTime();
        const now = Date.now();
        let pauseMs = (session.paused_duration || 0) * 1000;

        if (session.status === 'paused' && session.paused_at) {
            pauseMs += Math.max(0, now - new Date(session.paused_at).getTime());
        }

        if (session.status === 'finished' && session.finished_at) {
            const finish = new Date(session.finished_at).getTime();
            return Math.max(0, finish - start - pauseMs);
        }

        return Math.max(0, now - start - pauseMs);
    }

    function formatDuration(ms) {
        const totalSec = Math.floor(Math.max(0, ms) / 1000);
        const hrs = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }

    let workdayTimerInterval = null;
    function updateTimerDisplay() {
        const timerEl = document.getElementById('workdayTimer');
        if (!timerEl || !state.workday) return;
        const elapsed = getWorkdayElapsedMs(state.workday);
        const timeStr = formatDuration(elapsed);
        if (state.workday.status === 'paused') {
            timerEl.textContent = `${timeStr} (пауза)`;
        } else {
            timerEl.textContent = timeStr;
        }
    }

    function renderWorkdayWidget() {
        const widgetEl = document.getElementById('workdayWidget');
        if (!widgetEl) return;
        widgetEl.innerHTML = '';

        if (!state.auth || !state.auth.is_authenticated) {
            if (workdayTimerInterval) {
                clearInterval(workdayTimerInterval);
                workdayTimerInterval = null;
            }
            return;
        }

        const session = state.workday;

        if (!session || session.status === 'none' || session.status === 'finished') {
            if (workdayTimerInterval) {
                clearInterval(workdayTimerInterval);
                workdayTimerInterval = null;
            }
            const startBtn = el('button', {
                class: 'btn btn--action btn--small',
                style: 'height: 32px; font-size: 13px;',
                type: 'button',
                text: 'Начать рабочий день',
                onclick: async () => {
                    startBtn.disabled = true;
                    try {
                        const resp = await fetch('/api/workday/start/', {
                            method: 'POST',
                            headers: { 'X-CSRFToken': getCsrfToken() }
                        });
                        const res = await resp.json();
                        if (resp.ok && res.session) {
                            state.workday = res.session;
                            const phrase = START_PHRASES[Math.floor(Math.random() * START_PHRASES.length)];
                            showToast(phrase, 'success');
                            renderWorkdayWidget();
                        } else {
                            showToast(res.error || 'Не удалось начать рабочий день', 'error');
                        }
                    } catch (e) {
                        showToast('Ошибка при начале рабочего дня', 'error');
                    } finally {
                        startBtn.disabled = false;
                    }
                }
            });
            widgetEl.append(startBtn);
            return;
        }

        if (session.status === 'active' || session.status === 'paused') {
            const isPaused = session.status === 'paused';
            const elapsed = getWorkdayElapsedMs(session);
            const timeStr = formatDuration(elapsed);

            const timerEl = el('span', {
                class: `workday-timer ${isPaused ? 'workday-timer--paused' : ''}`,
                id: 'workdayTimer',
                text: isPaused ? `${timeStr} (пауза)` : timeStr
            });

            if (!isPaused && !workdayTimerInterval) {
                workdayTimerInterval = setInterval(updateTimerDisplay, 1000);
            } else if (isPaused && workdayTimerInterval) {
                clearInterval(workdayTimerInterval);
                workdayTimerInterval = null;
            }

            const pauseBtn = el('button', {
                class: 'btn btn--ghost btn--small',
                style: 'height: 32px; font-size: 13px;',
                type: 'button',
                text: isPaused ? 'Продолжить работу' : 'На обед',
                onclick: async () => {
                    pauseBtn.disabled = true;
                    try {
                        const resp = await fetch('/api/workday/pause/', {
                            method: 'POST',
                            headers: { 'X-CSRFToken': getCsrfToken() }
                        });
                        const res = await resp.json();
                        if (resp.ok && res.session) {
                            state.workday = res.session;
                            renderWorkdayWidget();
                        } else {
                            showToast(res.error || 'Ошибка изменения статуса', 'error');
                        }
                    } catch (e) {
                        showToast('Ошибка при переключении паузы', 'error');
                    } finally {
                        pauseBtn.disabled = false;
                    }
                }
            });

            const finishBtn = el('button', {
                class: 'btn btn--danger-ghost btn--small',
                style: 'height: 32px; font-size: 13px;',
                type: 'button',
                text: 'Завершить день',
                onclick: async () => {
                    finishBtn.disabled = true;
                    try {
                        const resp = await fetch('/api/workday/finish/', {
                            method: 'POST',
                            headers: { 'X-CSRFToken': getCsrfToken() }
                        });
                        const res = await resp.json();
                        if (resp.ok && res.session) {
                            state.workday = null;
                            if (workdayTimerInterval) {
                                clearInterval(workdayTimerInterval);
                                workdayTimerInterval = null;
                            }
                            const phrase = FINISH_PHRASES[Math.floor(Math.random() * FINISH_PHRASES.length)];
                            showToast(phrase, 'success');
                            renderWorkdayWidget();
                        } else {
                            showToast(res.error || 'Ошибка завершения дня', 'error');
                        }
                    } catch (e) {
                        showToast('Ошибка при завершении дня', 'error');
                    } finally {
                        finishBtn.disabled = false;
                    }
                }
            });

            widgetEl.append(timerEl, pauseBtn, finishBtn);
            return;
        }
    }

    async function loadWorkdayStatus() {
        if (!state.auth || !state.auth.is_authenticated) return;
        try {
            const resp = await fetch('/api/workday/status/');
            if (resp.ok) {
                const data = await resp.json();
                if (data.has_session && data.session && data.session.status !== 'finished') {
                    state.workday = data.session;
                } else {
                    state.workday = null;
                }
                renderWorkdayWidget();
            }
        } catch (e) {
            console.error('Ошибка загрузки статуса рабочего дня:', e);
        }
    }

    // ---------- ЛОГИКА ИНВЕНТАРИЗАЦИИ (МТО) ----------

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const inventoryModalEl = document.getElementById('inventoryModal');
    const inventoryViewDialogEl = document.getElementById('inventoryViewDialog');
    const inventoryFormEl = document.getElementById('inventoryForm');
    const invModalTitleEl = document.getElementById('invModalTitle');
    const invCategorySelectEl = document.getElementById('invCategorySelect');
    const invTypeCodeInputEl = document.getElementById('invTypeCodeInput');
    const invStatusSelectEl = document.getElementById('invStatusSelect');
    const invWorkplaceInputEl = document.getElementById('invWorkplaceInput');
    const invWorkplaceAutoDisplayEl = document.getElementById('invWorkplaceAutoDisplay');
    const invEmployeeSelectEl = document.getElementById('invEmployeeSelect');
    const invEmployeeSearchInputEl = document.getElementById('invEmployeeSearchInput');
    const invEmployeeClearBtnEl = document.getElementById('invEmployeeClearBtn');
    const invEmpAutocompleteListEl = document.getElementById('invEmpAutocompleteList');
    const invNumberInputEl = document.getElementById('invNumberInput');
    const invIpInputEl = document.getElementById('invIpInput');
    const invDeleteBtnEl = document.getElementById('invDeleteBtn');
    const invPrintStickerBtnEl = document.getElementById('invPrintStickerBtn');
    const invSaveBtnEl = document.getElementById('invSaveBtn');

    const stickerPrintAreaEl = document.getElementById('stickerPrintArea');
    const stickerQrContainerEl = document.getElementById('stickerQrContainer');
    const stickerInvNumberEl = document.getElementById('stickerInvNumber');
    const stickerInvNameEl = document.getElementById('stickerInvName');
    const stickerInvPlaceEl = document.getElementById('stickerInvPlace');

    let currentEditingInvItem = null;

    const CATEGORY_TO_TYPE = {
        'Монитор': 'MO',
        'Компьютер': 'PC',
        'Ноутбук': 'NB',
        'Оргтехника': 'PR',
        'Сетевое оборудование': 'NW',
        'Другое': 'EQ'
    };

    const TYPE_TO_CATEGORY = {
        'MO': 'Монитор',
        'PC': 'Компьютер',
        'NB': 'Ноутбук',
        'PR': 'Оргтехника',
        'NW': 'Сетевое оборудование',
        'EQ': 'Другое'
    };

    const INV_STATUS_MAP = {
        'assigned': { name: 'В работе', cls: 'inv-status--assigned' },
        'storage': { name: 'На складе', cls: 'inv-status--storage' },
        'repair': { name: 'В ремонте', cls: 'inv-status--repair' },
        'decommissioned': { name: 'Списано', cls: 'inv-status--decommissioned' }
    };

    function resolveEmployeeWorkplace(emp) {
        if (!emp) return null;
        if (emp.workplace && emp.workplace.code) {
            return emp.workplace;
        }
        for (const f of (CONFIG.floors || [])) {
            for (const wp of (f.workplaces || [])) {
                const wpCode = wp.code || wp.id;
                if (emp.workplace_id && Number(wp.id) === Number(emp.workplace_id)) {
                    return { id: wp.id, code: wpCode, room: wp.room, floor_name: f.name };
                }
                if (wp.employee && emp.full_name && wp.employee.trim().toLowerCase() === emp.full_name.trim().toLowerCase()) {
                    return { id: wp.id, code: wpCode, room: wp.room, floor_name: f.name };
                }
            }
        }
        return null;
    }

    function applyInvEmployeeSelection(emp, preserveCustomWorkplace = '') {
        if (emp && emp.id) {
            if (invEmployeeSelectEl) invEmployeeSelectEl.value = String(emp.id);
            if (invEmployeeSearchInputEl) invEmployeeSearchInputEl.value = emp.full_name || '';
            if (invEmployeeClearBtnEl) invEmployeeClearBtnEl.hidden = false;

            const wp = resolveEmployeeWorkplace(emp);
            const wpCode = (wp && wp.code) ? wp.code : (preserveCustomWorkplace && preserveCustomWorkplace !== 'STOCK' ? preserveCustomWorkplace : 'STOCK');
            if (invWorkplaceInputEl) invWorkplaceInputEl.value = wpCode;
            if (invWorkplaceAutoDisplayEl) {
                if (wp && wp.code) {
                    const details = [wp.code, wp.room, wp.floor_name].filter(Boolean).join(' · ');
                    invWorkplaceAutoDisplayEl.textContent = details;
                    invWorkplaceAutoDisplayEl.classList.add('inv-workplace-auto--assigned');
                } else if (wpCode && wpCode !== 'STOCK') {
                    invWorkplaceAutoDisplayEl.textContent = wpCode;
                    invWorkplaceAutoDisplayEl.classList.add('inv-workplace-auto--assigned');
                } else {
                    invWorkplaceAutoDisplayEl.textContent = 'У сотрудника не задан стол (STOCK)';
                    invWorkplaceAutoDisplayEl.classList.remove('inv-workplace-auto--assigned');
                }
            }
        } else {
            if (invEmployeeSelectEl) invEmployeeSelectEl.value = '';
            if (invEmployeeSearchInputEl) invEmployeeSearchInputEl.value = '';
            if (invEmployeeClearBtnEl) invEmployeeClearBtnEl.hidden = true;
            const wpCode = (preserveCustomWorkplace && preserveCustomWorkplace !== 'STOCK') ? preserveCustomWorkplace : 'STOCK';
            if (invWorkplaceInputEl) invWorkplaceInputEl.value = wpCode;
            if (invWorkplaceAutoDisplayEl) {
                invWorkplaceAutoDisplayEl.textContent = wpCode !== 'STOCK' ? `${wpCode} (без сотрудника)` : 'На складе (STOCK)';
                invWorkplaceAutoDisplayEl.classList.toggle('inv-workplace-auto--assigned', wpCode !== 'STOCK');
            }
        }
    }

    function initInvEmployeeAutocomplete() {
        if (!invEmployeeSearchInputEl || !invEmpAutocompleteListEl) return;

        function highlightMatch(text, query) {
            if (!query) return escapeHtml(text);
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) return escapeHtml(text);
            const before = escapeHtml(text.slice(0, idx));
            const match = escapeHtml(text.slice(idx, idx + query.length));
            const after = escapeHtml(text.slice(idx + query.length));
            return `${before}<mark>${match}</mark>${after}`;
        }

        function renderEmpSuggestions(query) {
            const q = query.trim().toLowerCase();
            const emps = state.employees || [];
            const matched = emps.filter((e) => {
                if (!q) return true;
                return (e.full_name && e.full_name.toLowerCase().includes(q)) ||
                       (e.position && e.position.toLowerCase().includes(q)) ||
                       (e.department && e.department.toLowerCase().includes(q)) ||
                       (e.email && e.email.toLowerCase().includes(q));
            }).slice(0, 12);

            invEmpAutocompleteListEl.innerHTML = '';

            if (matched.length === 0) {
                const emptyEl = el('div', {
                    class: 'emp-autocomplete-empty',
                    text: 'Сотрудники не найдены'
                });
                invEmpAutocompleteListEl.appendChild(emptyEl);
                invEmpAutocompleteListEl.hidden = false;
                return;
            }

            matched.forEach((e) => {
                let avatarNode;
                if (e.photo_url) {
                    avatarNode = el('img', {
                        class: 'emp-autocomplete-avatar',
                        src: e.photo_url,
                        alt: e.full_name
                    });
                } else {
                    avatarNode = el('div', {
                        class: 'emp-autocomplete-avatar',
                        text: e.initials || initials(e.full_name || '—')
                    });
                }

                const nameNode = el('div', {
                    class: 'emp-autocomplete-name',
                    html: highlightMatch(e.full_name || '', q)
                });
                const subParts = [e.position, e.department].filter(Boolean);
                const subNode = el('div', {
                    class: 'emp-autocomplete-sub',
                    text: subParts.join(' · ') || 'Должность не указана'
                });
                const infoNode = el('div', { class: 'emp-autocomplete-info' }, [nameNode, subNode]);

                const wp = resolveEmployeeWorkplace(e);
                const badgeNode = (wp && wp.code)
                    ? el('span', { class: 'emp-autocomplete-badge', text: wp.code, title: `Рабочее место ${wp.code}` })
                    : null;

                const row = el('div', {
                    class: 'emp-autocomplete-item',
                    onmousedown: (evt) => {
                        evt.preventDefault();
                        applyInvEmployeeSelection(e);
                        if (invStatusSelectEl && invStatusSelectEl.value === 'storage') {
                            invStatusSelectEl.value = 'assigned';
                        }
                        invEmpAutocompleteListEl.hidden = true;
                    }
                }, [avatarNode, infoNode, badgeNode]);

                invEmpAutocompleteListEl.appendChild(row);
            });

            invEmpAutocompleteListEl.hidden = false;
        }

        invEmployeeSearchInputEl.addEventListener('input', () => {
            const val = invEmployeeSearchInputEl.value;
            if (!val.trim()) {
                applyInvEmployeeSelection(null);
            } else if (invEmployeeClearBtnEl) {
                invEmployeeClearBtnEl.hidden = false;
            }
            renderEmpSuggestions(val);
        });

        invEmployeeSearchInputEl.addEventListener('focus', () => {
            renderEmpSuggestions(invEmployeeSearchInputEl.value);
        });

        invEmployeeSearchInputEl.addEventListener('blur', () => {
            setTimeout(() => {
                invEmpAutocompleteListEl.hidden = true;
                // Если пользователь ввёл текст, но не выбрал сотрудника — синхронизируем отображение
                const curEmpId = invEmployeeSelectEl ? Number(invEmployeeSelectEl.value) : 0;
                if (curEmpId) {
                    const found = (state.employees || []).find((x) => Number(x.id) === curEmpId);
                    if (found) invEmployeeSearchInputEl.value = found.full_name;
                } else {
                    invEmployeeSearchInputEl.value = '';
                    if (invEmployeeClearBtnEl) invEmployeeClearBtnEl.hidden = true;
                }
            }, 180);
        });

        if (invEmployeeClearBtnEl) {
            invEmployeeClearBtnEl.addEventListener('click', () => {
                applyInvEmployeeSelection(null);
                invEmpAutocompleteListEl.hidden = true;
                invEmployeeSearchInputEl.focus();
            });
        }
    }
    initInvEmployeeAutocomplete();

    async function loadInventory() {
        try {
            const resp = await fetch('/api/inventory/');
            if (!resp.ok) {
                const errText = await resp.text();
                console.error('Ошибка /api/inventory/:', resp.status, errText);
                showToast(`Ошибка загрузки инвентаря (${resp.status}): ${errText}`, 'error');
                return;
            }
            const data = await resp.json();
            state.inventory = Array.isArray(data.items) ? data.items : [];
            state.inventoryLoaded = true;
            render();
        } catch (err) {
            console.error('Ошибка загрузки инвентаря:', err);
            showToast('Ошибка сети при загрузке инвентаря: ' + (err.message || ''), 'error');
        }
    }

    function filteredInventory() {
        let list = state.inventory || [];
        const status = state.invFilters.status;
        if (status && status !== 'all') {
            list = list.filter((item) => item.status === status);
        }
        const category = state.invFilters.category;
        if (category) {
            list = list.filter((item) => item.category === category);
        }
        const q = (state.filters.query || '').trim().toLowerCase();
        if (q) {
            list = list.filter((item) => {
                return (item.name && item.name.toLowerCase().includes(q)) ||
                       (item.inventory_number && item.inventory_number.toLowerCase().includes(q)) ||
                       (item.workplace_code && item.workplace_code.toLowerCase().includes(q)) ||
                       (item.type_code && item.type_code.toLowerCase().includes(q)) ||
                       (item.notes && item.notes.toLowerCase().includes(q)) ||
                       (item.employee && item.employee.full_name && item.employee.full_name.toLowerCase().includes(q));
            });
        }
        return list;
    }

    function renderInventory(items) {
        if (!inventoryTableBodyEl) return;
        inventoryTableBodyEl.innerHTML = '';

        if (!items || items.length === 0) {
            if (inventoryEmptyEl) inventoryEmptyEl.hidden = false;
            return;
        }
        if (inventoryEmptyEl) inventoryEmptyEl.hidden = true;

        items.forEach((item) => {
            const tr = document.createElement('tr');

            const st = INV_STATUS_MAP[item.status] || { name: item.status || 'В работе', cls: 'inv-status--assigned' };
            const placeText = item.workplace_code ? item.workplace_code : 'На складе';
            const empText = (item.employee && item.employee.full_name) ? item.employee.full_name : '—';
            const notesText = item.notes ? item.notes : '—';

            tr.innerHTML = `
                <td><span class="inventory-num">${escapeHtml(item.inventory_number || '')}</span></td>
                <td><div class="inventory-name">${escapeHtml(item.name || '')}</div></td>
                <td><span class="inventory-type-pill">${escapeHtml(item.type_code || '')} · ${escapeHtml(item.category || '')}</span></td>
                <td><span class="inv-status-badge ${st.cls}">${escapeHtml(st.name)}</span></td>
                <td>${escapeHtml(placeText)}</td>
                <td>${escapeHtml(empText)}</td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(notesText)}">${escapeHtml(notesText)}</td>
                <td class="inventory-actions-th">
                    <div class="inventory-actions">
                        <button class="btn btn--ghost btn--icon-sm" type="button" data-inv-action="print" title="Печать наклейки 50x30 мм">Печать</button>
                        <button class="btn btn--ghost btn--icon-sm" type="button" data-inv-action="edit">Изменить</button>
                        <button class="btn btn--danger-ghost btn--icon-sm" type="button" data-inv-action="delete" title="Удалить оборудование">Удалить</button>
                    </div>
                </td>
            `;

            tr.querySelector('[data-inv-action="print"]').addEventListener('click', (e) => {
                e.stopPropagation();
                printInventorySticker(item);
            });

            tr.querySelector('[data-inv-action="edit"]').addEventListener('click', (e) => {
                e.stopPropagation();
                openInventoryModal(item);
            });

            tr.querySelector('[data-inv-action="delete"]').addEventListener('click', (e) => {
                e.stopPropagation();
                openDeleteInventoryModal(item);
            });

            tr.addEventListener('click', () => {
                openInventoryViewModal(item);
            });

            inventoryTableBodyEl.appendChild(tr);
        });
    }

    function openInventoryViewModal(item) {
        if (!inventoryModalEl || !inventoryViewDialogEl || !item) return;
        currentEditingInvItem = item;
        if (inventoryFormEl) inventoryFormEl.hidden = true;
        inventoryViewDialogEl.hidden = false;
        inventoryViewDialogEl.innerHTML = '';

        const st = INV_STATUS_MAP[item.status] || { name: item.status || 'В работе', cls: 'inv-status--assigned' };
        const placeText = (item.workplace_code && item.workplace_code !== 'STOCK') ? item.workplace_code : 'На складе (STOCK)';
        const assignedEmp = item.employee || (item.employee_id ? (state.employees || []).find((e) => Number(e.id) === Number(item.employee_id)) : null);

        const header = el('div', { class: 'modal__header' }, [
            el('h2', { text: 'Карточка оборудования' }),
            el('button', { class: 'icon-btn', type: 'button', html: '&times;', 'aria-label': 'Закрыть', onclick: closeInventoryModal })
        ]);

        const qrBox = el('div', {
            class: 'inv-modal-view__qr',
            title: `QR: ${item.inventory_number || item.id}`,
            html: createQRCodeSvg(item.inventory_number || String(item.id))
        });

        const hero = el('div', { class: 'inv-modal-view__hero' }, [
            el('div', { class: 'inv-modal-view__main' }, [
                el('div', { class: 'inv-modal-view__badges' }, [
                    el('span', { class: 'inventory-num', text: item.inventory_number || 'Без номера' }),
                    el('span', { class: 'inventory-type-pill', text: `${item.type_code || 'EQ'} · ${item.category || 'Другое'}` }),
                    el('span', { class: `inv-status-badge ${st.cls}`, text: st.name })
                ]),
                el('h1', { class: 'emp-modal-view__name', style: 'margin-top: 4px;', text: item.name || 'Оборудование' })
            ]),
            qrBox
        ]);

        let empBlockVal;
        if (assignedEmp && assignedEmp.full_name) {
            empBlockVal = el('div', {}, [
                el('div', { style: 'font-weight: 600;', text: assignedEmp.full_name }),
                assignedEmp.department ? el('div', { style: 'font-size: 12px; color: var(--text-secondary);', text: `${assignedEmp.position ? assignedEmp.position + ' · ' : ''}${assignedEmp.department}` }) : null,
                el('button', {
                    class: 'btn btn--ghost btn--icon-sm',
                    type: 'button',
                    style: 'margin-top: 6px;',
                    text: 'Открыть карточку сотрудника',
                    onclick: () => {
                        const fullEmp = (state.employees || []).find((e) => Number(e.id) === Number(assignedEmp.id)) || assignedEmp;
                        closeInventoryModal();
                        openEmployeeModal(fullEmp, false);
                    }
                })
            ]);
        } else {
            empBlockVal = el('div', { style: 'color: var(--text-secondary);', text: 'Не назначен (на складе или общее оборудование)' });
        }

        const detailsGrid = el('div', { class: 'emp-details-grid' }, [
            el('div', { class: 'emp-detail-block' }, [
                el('span', { class: 'emp-detail-block__label', text: 'Ответственный сотрудник' }),
                el('div', { class: 'emp-detail-block__val' }, [empBlockVal])
            ]),
            el('div', { class: 'emp-detail-block' }, [
                el('span', { class: 'emp-detail-block__label', text: 'Рабочее место / Локация' }),
                el('div', { class: 'emp-detail-block__val', text: placeText })
            ]),
            el('div', { class: 'emp-detail-block' }, [
                el('span', { class: 'emp-detail-block__label', text: 'Категория' }),
                el('div', { class: 'emp-detail-block__val', text: item.category || '—' })
            ]),
            el('div', { class: 'emp-detail-block' }, [
                el('span', { class: 'emp-detail-block__label', text: 'Код типа' }),
                el('div', { class: 'emp-detail-block__val', text: item.type_code || '—' })
            ]),
            item.ip ? el('div', { class: 'emp-detail-block' }, [
                el('span', { class: 'emp-detail-block__label', text: 'IP-адрес' }),
                el('div', { class: 'emp-detail-block__val' }, [
                    el('code', { style: 'font-weight: 600; font-size: 13px; color: var(--accent);', text: item.ip })
                ])
            ]) : null,
            el('div', { class: 'emp-detail-block emp-detail-block--full' }, [
                el('span', { class: 'emp-detail-block__label', text: 'Заметки / Характеристики' }),
                el('div', {
                    class: 'emp-detail-block__val',
                    style: item.notes ? 'white-space: pre-wrap; line-height: 1.5;' : 'color: var(--text-secondary);',
                    text: item.notes || 'Характеристики и заметки не указаны'
                })
            ])
        ]);

        const body = el('div', { class: 'modal__body emp-modal-view' }, [hero, detailsGrid]);

        const footerLeft = el('div', { class: 'modal__footer-left' }, [
            el('button', {
                class: 'btn btn--danger-ghost',
                type: 'button',
                text: 'Удалить',
                onclick: () => openDeleteInventoryModal(item)
            }),
            el('button', {
                class: 'btn btn--ghost',
                type: 'button',
                text: 'Печать наклейки',
                onclick: () => printInventorySticker(item)
            })
        ]);

        const footerRight = el('div', { class: 'modal__footer-right' }, [
            el('button', {
                class: 'btn btn--ghost',
                type: 'button',
                text: 'Закрыть',
                onclick: closeInventoryModal
            }),
            el('button', {
                class: 'btn btn--action',
                type: 'button',
                text: 'Изменить',
                onclick: () => openInventoryModal(item)
            })
        ]);

        const footer = el('div', { class: 'modal__footer' }, [footerLeft, footerRight]);
        inventoryViewDialogEl.append(header, body, footer);
        inventoryModalEl.hidden = false;
    }

    function openInventoryModal(item = null) {
        currentEditingInvItem = item;
        if (inventoryViewDialogEl) inventoryViewDialogEl.hidden = true;
        if (inventoryFormEl) {
            inventoryFormEl.reset();
            inventoryFormEl.hidden = false;
        }
        if (invEmpAutocompleteListEl) invEmpAutocompleteListEl.hidden = true;

        if (item && item.id) {
            invModalTitleEl.textContent = 'Редактирование оборудования';
            inventoryFormEl.elements['id'].value = item.id;
            inventoryFormEl.elements['name'].value = item.name || '';
            const cat = (item.category && CATEGORY_TO_TYPE[item.category]) ? item.category : (TYPE_TO_CATEGORY[item.type_code] || 'Монитор');
            const tCode = (item.type_code && TYPE_TO_CATEGORY[item.type_code]) ? item.type_code : (CATEGORY_TO_TYPE[cat] || 'MO');
            invCategorySelectEl.value = cat;
            invTypeCodeInputEl.value = tCode;
            invStatusSelectEl.value = item.status || 'assigned';

            const assignedEmp = (item.employee_id ? (state.employees || []).find((e) => Number(e.id) === Number(item.employee_id)) : null) || item.employee || null;
            applyInvEmployeeSelection(assignedEmp, item.workplace_code || '');

            invNumberInputEl.value = item.inventory_number || '';
            invNumberInputEl.placeholder = item.inventory_number || '';
            if (invIpInputEl) invIpInputEl.value = item.ip || '';
            inventoryFormEl.elements['notes'].value = item.notes || '';

            invDeleteBtnEl.hidden = false;
            invPrintStickerBtnEl.hidden = false;
            invSaveBtnEl.textContent = 'Сохранить';
        } else {
            invModalTitleEl.textContent = 'Новое оборудование';
            inventoryFormEl.elements['id'].value = '';
            const presetCat = (item && item.category) || (item && item.workplace_code ? 'Сетевое оборудование' : 'Монитор');
            invCategorySelectEl.value = presetCat;
            invTypeCodeInputEl.value = CATEGORY_TO_TYPE[presetCat] || 'MO';
            invStatusSelectEl.value = (item && item.status) || 'assigned';
            applyInvEmployeeSelection(null, (item && item.workplace_code) || '');
            invNumberInputEl.value = '';
            invNumberInputEl.placeholder = 'Оставьте пустым для автогенерации (например INV_MO_1-01_01)';
            if (invIpInputEl) invIpInputEl.value = (item && item.ip) || '';

            invDeleteBtnEl.hidden = true;
            invPrintStickerBtnEl.hidden = true;
            invSaveBtnEl.textContent = 'Создать';
        }

        inventoryModalEl.hidden = false;
        inventoryFormEl.elements['name'].focus();
    }

    function closeInventoryModal() {
        inventoryModalEl.hidden = true;
        if (inventoryViewDialogEl) inventoryViewDialogEl.hidden = true;
        if (inventoryFormEl) inventoryFormEl.hidden = false;
        if (invEmpAutocompleteListEl) invEmpAutocompleteListEl.hidden = true;
        currentEditingInvItem = null;
    }

    if (inventoryModalEl) {
        inventoryModalEl.querySelectorAll('[data-close]').forEach((n) =>
            n.addEventListener('click', closeInventoryModal));
    }

    if (invCategorySelectEl) {
        invCategorySelectEl.addEventListener('change', () => {
            const mapped = CATEGORY_TO_TYPE[invCategorySelectEl.value];
            if (mapped) {
                invTypeCodeInputEl.value = mapped;
            }
        });
    }

    if (invTypeCodeInputEl) {
        invTypeCodeInputEl.addEventListener('change', () => {
            const mappedCat = TYPE_TO_CATEGORY[invTypeCodeInputEl.value];
            if (mappedCat && invCategorySelectEl) {
                invCategorySelectEl.value = mappedCat;
            }
        });
    }

    if (inventoryFormEl) {
        inventoryFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = inventoryFormEl.elements['id'].value;
            const isEdit = Boolean(id);
            const empVal = invEmployeeSelectEl.value;

            const payload = {
                name: inventoryFormEl.elements['name'].value.trim(),
                category: invCategorySelectEl.value,
                type_code: invTypeCodeInputEl.value.trim().toUpperCase(),
                status: invStatusSelectEl.value,
                workplace_code: invWorkplaceInputEl.value.trim(),
                employee_id: empVal ? Number(empVal) : null,
                inventory_number: invNumberInputEl.value.trim(),
                ip: invIpInputEl ? invIpInputEl.value.trim() : '',
                notes: inventoryFormEl.elements['notes'].value.trim(),
            };

            const url = isEdit ? `/api/inventory/${id}/update/` : '/api/inventory/create/';
            try {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const text = await resp.text();
                let res = null;
                try {
                    res = JSON.parse(text);
                } catch (parseErr) {
                    // ответ в виде plain text (например, от http.Error)
                }

                if (!resp.ok || (res && res.error)) {
                    const errorMsg = (res && res.error) || text || ('Ошибка HTTP ' + resp.status);
                    showToast(errorMsg, 'error');
                    return;
                }
                showToast(isEdit ? 'Оборудование обновлено' : 'Оборудование добавлено', 'success');
                closeInventoryModal();
                await loadInventory();
                await refreshEmployees();
                render();
            } catch (err) {
                console.error(err);
                showToast('Ошибка отправки запроса: ' + (err.message || 'Сбой сети'), 'error');
            }
        });
    }

    // Модальное окно подтверждения удаления оборудования
    const deleteInventoryModal = document.getElementById('deleteInventoryModal');
    const deleteInventoryModalMessage = document.getElementById('deleteInventoryModalMessage');
    const confirmDeleteInventoryBtn = document.getElementById('confirmDeleteInventoryBtn');
    let invItemToDelete = null;

    function openDeleteInventoryModal(item) {
        if (!deleteInventoryModal || !item) return;
        invItemToDelete = item;
        if (deleteInventoryModalMessage) {
            deleteInventoryModalMessage.innerHTML = `Вы действительно хотите удалить оборудование <strong>«${escapeHtml(item.name)}»</strong> (${escapeHtml(item.inventory_number || '')})?`;
        }
        deleteInventoryModal.hidden = false;
    }

    function closeDeleteInventoryModal() {
        if (deleteInventoryModal) deleteInventoryModal.hidden = true;
        invItemToDelete = null;
    }

    if (deleteInventoryModal) {
        deleteInventoryModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeDeleteInventoryModal);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !deleteInventoryModal.hidden) {
                closeDeleteInventoryModal();
            }
        });
    }

    if (confirmDeleteInventoryBtn) {
        confirmDeleteInventoryBtn.addEventListener('click', async () => {
            if (!invItemToDelete) return;
            const item = invItemToDelete;
            confirmDeleteInventoryBtn.disabled = true;

            try {
                const resp = await fetch(`/api/inventory/${item.id}/delete/`, {
                    method: 'POST',
                });
                const text = await resp.text();
                let res = null;
                try {
                    res = JSON.parse(text);
                } catch (parseErr) {}

                if (!resp.ok || (res && res.error)) {
                    const errorMsg = (res && res.error) || text || ('Ошибка HTTP ' + resp.status);
                    showToast(errorMsg, 'error');
                    return;
                }
                showToast('Оборудование удалено', 'success');
                closeDeleteInventoryModal();
                closeInventoryModal();
                await loadInventory();
                await refreshEmployees();
                render();
            } catch (err) {
                console.error(err);
                showToast('Ошибка отправки запроса: ' + (err.message || 'Сбой сети'), 'error');
            } finally {
                confirmDeleteInventoryBtn.disabled = false;
            }
        });
    }

    // Модальное окно подтверждения списания оборудования (из карточки сотрудника)
    const decommissionInventoryModal = document.getElementById('decommissionInventoryModal');
    const decommissionInventoryModalMessage = document.getElementById('decommissionInventoryModalMessage');
    const confirmDecommissionInventoryBtn = document.getElementById('confirmDecommissionInventoryBtn');
    let invItemToDecommission = null;
    let empForDecommission = null;

    function openDecommissionInventoryModal(item, emp = null) {
        if (!decommissionInventoryModal || !item) return;
        invItemToDecommission = item;
        empForDecommission = emp;
        if (decommissionInventoryModalMessage) {
            decommissionInventoryModalMessage.innerHTML = `Вы действительно хотите списать оборудование <strong>«${escapeHtml(item.name)}»</strong> (${escapeHtml(item.inventory_number || '')})?`;
        }
        decommissionInventoryModal.hidden = false;
    }

    function closeDecommissionInventoryModal() {
        if (decommissionInventoryModal) decommissionInventoryModal.hidden = true;
        invItemToDecommission = null;
        empForDecommission = null;
    }

    if (decommissionInventoryModal) {
        decommissionInventoryModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeDecommissionInventoryModal);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !decommissionInventoryModal.hidden) {
                closeDecommissionInventoryModal();
            }
        });
    }

    if (confirmDecommissionInventoryBtn) {
        confirmDecommissionInventoryBtn.addEventListener('click', async () => {
            if (!invItemToDecommission) return;
            const item = invItemToDecommission;
            const empRef = empForDecommission;
            confirmDecommissionInventoryBtn.disabled = true;

            try {
                const payload = {
                    name: item.name,
                    category: item.category,
                    type_code: item.type_code,
                    status: 'decommissioned',
                    workplace_code: item.workplace_code || 'STOCK',
                    employee_id: item.employee_id || null,
                    inventory_number: item.inventory_number,
                    notes: item.notes || ''
                };
                const resp = await fetch(`/api/inventory/${item.id}/update/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const text = await resp.text();
                let res = null;
                try {
                    res = JSON.parse(text);
                } catch (parseErr) {}

                if (!resp.ok || (res && res.error)) {
                    const errorMsg = (res && res.error) || text || ('Ошибка HTTP ' + resp.status);
                    showToast(errorMsg, 'error');
                    return;
                }

                showToast('Оборудование переведено в статус «Списано»', 'success');
                closeDecommissionInventoryModal();
                await loadInventory();
                await refreshEmployees();
                render();

                if (empRef && employeeModalEl && !employeeModalEl.hidden) {
                    const updatedEmp = (state.employees || []).find((x) => Number(x.id) === Number(empRef.id)) || empRef;
                    openEmployeeModal(updatedEmp, false);
                }
            } catch (err) {
                console.error(err);
                showToast('Ошибка при списании оборудования: ' + (err.message || 'Сбой сети'), 'error');
            } finally {
                confirmDecommissionInventoryBtn.disabled = false;
            }
        });
    }

    if (invDeleteBtnEl) {
        invDeleteBtnEl.addEventListener('click', () => {
            if (currentEditingInvItem) {
                openDeleteInventoryModal(currentEditingInvItem);
            }
        });
    }

    if (invPrintStickerBtnEl) {
        invPrintStickerBtnEl.addEventListener('click', () => {
            if (currentEditingInvItem) {
                printInventorySticker(currentEditingInvItem);
            }
        });
    }

    if (filterInvStatusEl) {
        filterInvStatusEl.addEventListener('change', () => {
            state.invFilters.status = filterInvStatusEl.value;
            render();
        });
    }

    if (filterInvCategoryEl) {
        filterInvCategoryEl.addEventListener('change', () => {
            state.invFilters.category = filterInvCategoryEl.value;
            render();
        });
    }

    if (resetInvFiltersEl) {
        resetInvFiltersEl.addEventListener('click', () => {
            state.invFilters = { status: 'all', category: '', query: '' };
            if (filterInvStatusEl) filterInvStatusEl.value = 'all';
            if (filterInvCategoryEl) filterInvCategoryEl.value = '';
            if (searchInput) searchInput.value = '';
            state.filters.query = '';
            render();
        });
    }

    // ---------- Генерация QR-кода и печать наклеек 50x30 мм ----------

    function createQRCodeSvg(text) {
        const utf8Bytes = [];
        for (let i = 0; i < text.length; i++) {
            let code = text.charCodeAt(i);
            if (code < 0x80) {
                utf8Bytes.push(code);
            } else if (code < 0x800) {
                utf8Bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else {
                utf8Bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
        }

        let version = 1;
        let totalDataBytes = 16;
        let ecBytesPerBlock = 10;
        let numBlocks = 1;
        let alignPos = [];

        const dataLen = utf8Bytes.length;
        if (dataLen <= 14) {
            version = 1;
            totalDataBytes = 16;
            ecBytesPerBlock = 10;
            numBlocks = 1;
            alignPos = [];
        } else if (dataLen <= 26) {
            version = 2;
            totalDataBytes = 28;
            ecBytesPerBlock = 16;
            numBlocks = 1;
            alignPos = [6, 18];
        } else if (dataLen <= 42) {
            version = 3;
            totalDataBytes = 44;
            ecBytesPerBlock = 26;
            numBlocks = 2;
            alignPos = [6, 22];
        } else {
            version = 4;
            totalDataBytes = 64;
            ecBytesPerBlock = 36;
            numBlocks = 2;
            alignPos = [6, 26];
        }

        const size = 17 + 4 * version;
        let bitBuffer = [];
        function putBits(num, count) {
            for (let i = count - 1; i >= 0; i--) {
                bitBuffer.push((num >> i) & 1);
            }
        }

        putBits(4, 4);
        putBits(dataLen, 8);
        for (const b of utf8Bytes) putBits(b, 8);
        const rem = totalDataBytes * 8 - bitBuffer.length;
        putBits(0, Math.min(4, rem));
        while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);
        const pad = [0xEC, 0x11];
        let padIdx = 0;
        while (bitBuffer.length < totalDataBytes * 8) {
            putBits(pad[padIdx % 2], 8);
            padIdx++;
        }

        const dataBytes = [];
        for (let i = 0; i < bitBuffer.length; i += 8) {
            let b = 0;
            for (let j = 0; j < 8; j++) b = (b << 1) | bitBuffer[i + j];
            dataBytes.push(b);
        }

        const EXP = new Uint8Array(512);
        const LOG = new Uint8Array(256);
        let x = 1;
        for (let i = 0; i < 255; i++) {
            EXP[i] = x;
            EXP[i + 255] = x;
            LOG[x] = i;
            x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
        }

        function gmul(a, b) {
            if (a === 0 || b === 0) return 0;
            return EXP[LOG[a] + LOG[b]];
        }

        function getGeneratorPoly(degree) {
            let poly = [1];
            for (let i = 0; i < degree; i++) {
                const next = new Array(poly.length + 1).fill(0);
                for (let j = 0; j < poly.length; j++) {
                    next[j] ^= gmul(poly[j], EXP[i]);
                    next[j + 1] ^= poly[j];
                }
                poly = next;
            }
            return poly;
        }

        const ecCountPerBlock = ecBytesPerBlock / numBlocks;
        const dataCountPerBlock = totalDataBytes / numBlocks;
        const gen = getGeneratorPoly(ecCountPerBlock);

        function calcEC(dataBlock) {
            const ec = new Array(ecCountPerBlock).fill(0);
            for (let i = 0; i < dataBlock.length; i++) {
                const factor = dataBlock[i] ^ ec[0];
                ec.shift();
                ec.push(0);
                for (let j = 0; j < ecCountPerBlock; j++) {
                    ec[j] ^= gmul(gen[j], factor);
                }
            }
            return ec;
        }

        const dataBlocks = [];
        const ecBlocks = [];
        for (let b = 0; b < numBlocks; b++) {
            const d = dataBytes.slice(b * dataCountPerBlock, (b + 1) * dataCountPerBlock);
            dataBlocks.push(d);
            ecBlocks.push(calcEC(d));
        }

        const finalBytes = [];
        for (let i = 0; i < dataCountPerBlock; i++) {
            for (let b = 0; b < numBlocks; b++) finalBytes.push(dataBlocks[b][i]);
        }
        for (let i = 0; i < ecCountPerBlock; i++) {
            for (let b = 0; b < numBlocks; b++) finalBytes.push(ecBlocks[b][i]);
        }

        const matrix = Array.from({ length: size }, () => Array(size).fill(null));
        const isReserved = Array.from({ length: size }, () => Array(size).fill(false));

        function setModule(r, c, val) {
            matrix[r][c] = val ? 1 : 0;
            isReserved[r][c] = true;
        }

        function addFinder(r0, c0) {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const row = r0 + r;
                    const col = c0 + c;
                    if (row >= 0 && row < size && col >= 0 && col < size) {
                        const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
                        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                        const isFinder = (r >= 0 && r <= 6 && c >= 0 && c <= 6);
                        setModule(row, col, isFinder && (isBorder || isCenter));
                    }
                }
            }
        }
        addFinder(0, 0);
        addFinder(0, size - 7);
        addFinder(size - 7, 0);

        if (alignPos.length > 0) {
            for (const r of alignPos) {
                for (const c of alignPos) {
                    if (isReserved[r][c]) continue;
                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
                            const isCenter = dr === 0 && dc === 0;
                            setModule(r + dr, c + dc, isBorder || isCenter);
                        }
                    }
                }
            }
        }

        for (let i = 8; i < size - 8; i++) {
            if (!isReserved[6][i]) setModule(6, i, i % 2 === 0);
            if (!isReserved[i][6]) setModule(i, 6, i % 2 === 0);
        }

        setModule(4 * version + 9, 8, true);

        for (let i = 0; i < 9; i++) {
            if (!isReserved[8][i]) isReserved[8][i] = true;
            if (!isReserved[i][8]) isReserved[8][i] = true;
        }
        for (let i = 0; i < 8; i++) {
            if (!isReserved[8][size - 1 - i]) isReserved[8][size - 1 - i] = true;
            if (!isReserved[size - 1 - i][8]) isReserved[size - 1 - i] = true;
        }

        let bitIndex = 0;
        const finalBits = [];
        for (const fb of finalBytes) {
            for (let j = 7; j >= 0; j--) finalBits.push((fb >> j) & 1);
        }

        let dir = -1;
        let col = size - 1;
        while (col > 0) {
            if (col === 6) col--;
            for (let i = 0; i < size; i++) {
                const row = dir === -1 ? size - 1 - i : i;
                for (let c = 0; c < 2; c++) {
                    const curCol = col - c;
                    if (!isReserved[row][curCol]) {
                        let bit = bitIndex < finalBits.length ? finalBits[bitIndex++] : 0;
                        if ((row + curCol) % 2 === 0) bit ^= 1;
                        matrix[row][curCol] = bit;
                    }
                }
            }
            dir = -dir;
            col -= 2;
        }

        const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
        const tlCoords = [
            [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
            [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
        ];
        for (let i = 0; i < 15; i++) {
            const [r, c] = tlCoords[i];
            matrix[r][c] = formatBits[i];
        }
        for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = formatBits[i];
        for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = formatBits[7 + i];

        let pathD = '';
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (matrix[r][c] === 1) {
                    pathD += `M${c},${r}h1v1h-1z `;
                }
            }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${pathD}" fill="#000000"/></svg>`;
    }

    function printInventorySticker(item) {
        if (!item) return;
        if (stickerInvNumberEl) stickerInvNumberEl.textContent = item.inventory_number || '';
        if (stickerInvNameEl) stickerInvNameEl.textContent = item.name || '';
        if (stickerInvPlaceEl) {
            stickerInvPlaceEl.textContent = item.workplace_code ? `Место: ${item.workplace_code}` : 'Склад';
        }
        if (stickerQrContainerEl) {
            stickerQrContainerEl.innerHTML = createQRCodeSvg(item.inventory_number || String(item.id));
        }
        window.print();
    }

    // ---------- Переключатель темы (Dark / Light Mode) ----------
    let themeTransitionTimer = null;
    function initThemeToggle() {
        const THEME_KEY = 'ptracker.theme';
        const btn = document.getElementById('themeToggleBtn');
        const root = document.documentElement;

        function applyTheme(theme, animate = false) {
            if (animate) {
                root.classList.add('theme-transitioning');
                if (themeTransitionTimer) clearTimeout(themeTransitionTimer);
                themeTransitionTimer = setTimeout(() => {
                    root.classList.remove('theme-transitioning');
                }, 460);
            }
            if (theme === 'dark') {
                root.setAttribute('data-theme', 'dark');
                document.body.classList.add('theme-dark');
            } else {
                root.removeAttribute('data-theme');
                document.body.classList.remove('theme-dark');
            }
            if (btn) {
                const isDark = theme === 'dark';
                btn.title = isDark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему';
                btn.setAttribute('aria-label', btn.title);
            }
        }

        const saved = localStorage.getItem(THEME_KEY);
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const initialTheme = saved ? saved : (prefersDark ? 'dark' : 'light');
        applyTheme(initialTheme, false);

        if (btn) {
            btn.addEventListener('click', () => {
                const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
                const next = current === 'dark' ? 'light' : 'dark';
                localStorage.setItem(THEME_KEY, next);
                applyTheme(next, true);
            });
        }

        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem(THEME_KEY)) {
                    applyTheme(e.matches ? 'dark' : 'light', true);
                }
            });
        }
    }

    // ---------- Pinger сетевой мониторинг ----------
    let pingerData = { enabled: false, interval_minutes: 10, devices: [] };

    function isPingerDeviceOnline(d) {
        if (!d) return false;
        return Boolean(d.is_online !== undefined ? d.is_online : d.online);
    }

    function getPingerDeviceLastCheck(d) {
        if (!d) return '';
        return d.last_checked_at || d.last_check || '';
    }

    function isPingerDeviceChecked(d) {
        const ts = getPingerDeviceLastCheck(d);
        return Boolean(ts && !ts.startsWith('0001'));
    }

    function getPingerDeviceStatus(ip) {
        if (!ip || !pingerData || !pingerData.devices) return null;
        const cleanIp = String(ip).trim();
        return pingerData.devices.find((d) => String(d.ip).trim() === cleanIp) || null;
    }

    async function loadPingerStatus() {
        try {
            const resp = await fetch('/api/pinger/status/');
            if (!resp.ok) return;
            pingerData = await resp.json();
            updatePingerUI();
        } catch (err) {
            console.error('Ошибка загрузки статуса pinger:', err);
        }
    }

    function updatePingerUI() {
        const ind = document.getElementById('pingerIndicator');
        const countEl = document.getElementById('pingerDeviceCount');
        const listEl = document.getElementById('pingerDevicesList');

        const devices = pingerData.devices || [];
        const hasOffline = devices.some((d) => isPingerDeviceChecked(d) && !isPingerDeviceOnline(d));

        if (ind) {
            ind.className = 'pinger-indicator';
            if (!pingerData.enabled) {
                ind.classList.add('pinger-indicator--off');
                ind.parentElement.title = 'Pinger: мониторинг выключен';
            } else if (hasOffline) {
                ind.classList.add('pinger-indicator--alert');
                ind.parentElement.title = 'Pinger: обнаружены недоступные устройства!';
            } else {
                ind.parentElement.title = 'Pinger: все проверенные устройства доступны';
            }
        }

        if (countEl) countEl.textContent = String(devices.length);

        if (listEl) {
            listEl.innerHTML = '';
            if (devices.length === 0) {
                listEl.append(el('div', { class: 'panel__empty', text: 'Нет оборудования с указанным IP-адресом' }));
            } else {
                devices.forEach((d) => {
                    const isOnline = isPingerDeviceOnline(d);
                    const checked = isPingerDeviceChecked(d);
                    const tagCls = checked ? (isOnline ? 'pinger-status-tag--online' : 'pinger-status-tag--offline') : '';
                    const tagText = checked ? (isOnline ? 'В сети' : 'Недоступен') : 'Не проверялся';
                    const ts = getPingerDeviceLastCheck(d);
                    const lastCheck = checked ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

                    listEl.append(el('div', { class: 'pinger-device-item' }, [
                        el('div', { class: 'pinger-device-info' }, [
                            el('div', { class: 'pinger-device-name', text: d.name || 'Оборудование' }),
                            el('div', { class: 'pinger-device-sub' }, [
                                el('span', { text: `${d.workplace || d.workplace_code || 'Склад'} · ` }),
                                el('span', { class: 'pinger-device-ip', text: d.ip })
                            ])
                        ]),
                        el('div', { style: 'display:flex; flex-direction:column; align-items:flex-end; gap:4px;' }, [
                            el('span', { class: `pinger-status-tag ${tagCls}`, text: tagText }),
                            el('span', { style: 'font-size:11px; color:var(--text-secondary);', text: `Проверка: ${lastCheck}` })
                        ])
                    ]));
                });
            }
        }
    }

    function initPingerModal() {
        const pingerStatusBtn = document.getElementById('pingerStatusBtn');
        const pingerModal = document.getElementById('pingerModal');
        const pingerEnabledToggle = document.getElementById('pingerEnabledToggle');
        const pingerIntervalInput = document.getElementById('pingerIntervalInput');
        const savePingerConfigBtn = document.getElementById('savePingerConfigBtn');
        const pingerCheckNowBtn = document.getElementById('pingerCheckNowBtn');

        if (!pingerModal) return;

        pingerModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', () => { pingerModal.hidden = true; });
        });

        if (pingerStatusBtn) {
            pingerStatusBtn.addEventListener('click', async () => {
                await loadPingerStatus();
                if (pingerEnabledToggle) pingerEnabledToggle.checked = Boolean(pingerData.enabled);
                if (pingerIntervalInput) pingerIntervalInput.value = pingerData.interval_minutes || 10;
                pingerModal.hidden = false;
            });
        }

        if (savePingerConfigBtn) {
            savePingerConfigBtn.addEventListener('click', async () => {
                const payload = {
                    enabled: pingerEnabledToggle ? pingerEnabledToggle.checked : false,
                    interval_minutes: pingerIntervalInput ? Math.max(1, parseInt(pingerIntervalInput.value, 10) || 10) : 10
                };
                try {
                    const resp = await fetch('/api/pinger/config/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!resp.ok) {
                        const txt = await resp.text();
                        showToast('Ошибка сохранения: ' + txt, 'error');
                        return;
                    }
                    showToast('Настройки Pinger сохранены', 'success');
                    pingerModal.hidden = true;
                    await loadPingerStatus();
                } catch (err) {
                    showToast('Ошибка отправки: ' + err.message, 'error');
                }
            });
        }

        if (pingerCheckNowBtn) {
            pingerCheckNowBtn.addEventListener('click', async () => {
                const origHtml = pingerCheckNowBtn.innerHTML;
                pingerCheckNowBtn.disabled = true;
                pingerCheckNowBtn.innerHTML = '<span>Опрашиваем...</span>';
                try {
                    const resp = await fetch('/api/pinger/check-now/', { method: 'POST' });
                    if (!resp.ok) {
                        showToast('Ошибка запуска проверки', 'error');
                        pingerCheckNowBtn.disabled = false;
                        pingerCheckNowBtn.innerHTML = origHtml;
                        return;
                    }
                    showToast('Опрос оборудования запущен...', 'info');

                    setTimeout(async () => {
                        await loadPingerStatus();
                        render();
                        const devs = pingerData.devices || [];
                        const checkedDevs = devs.filter((d) => isPingerDeviceChecked(d));
                        const onlineCount = checkedDevs.filter((d) => isPingerDeviceOnline(d)).length;
                        const offlineCount = checkedDevs.filter((d) => !isPingerDeviceOnline(d)).length;

                        if (checkedDevs.length > 0) {
                            if (offlineCount > 0) {
                                showToast(`Опрос завершен: ${onlineCount} в сети, ${offlineCount} недоступно`, 'error');
                            } else {
                                showToast(`Опрос завершен: все устройства (${onlineCount}) в сети`, 'success');
                            }
                        } else {
                            showToast('Опрос завершен', 'success');
                        }

                        pingerCheckNowBtn.disabled = false;
                        pingerCheckNowBtn.innerHTML = origHtml;
                    }, 2600);
                } catch (err) {
                    pingerCheckNowBtn.disabled = false;
                    pingerCheckNowBtn.innerHTML = origHtml;
                    showToast('Ошибка: ' + err.message, 'error');
                }
            });
        }
    }

    // ---------- Модальные окна оборудования стойки и сетевого принтера ----------
    let currentRackItem = null;
    let currentRackWp = null;

    function openRackDeviceModal(item = null, wp = null) {
        const rackDeviceModal = document.getElementById('rackDeviceModal');
        const rackDeviceForm = document.getElementById('rackDeviceForm');
        const rackDeviceIdInput = document.getElementById('rackDeviceIdInput');
        const rackDeviceWorkplaceCodeInput = document.getElementById('rackDeviceWorkplaceCodeInput');
        const rackDeviceWorkplaceDisplay = document.getElementById('rackDeviceWorkplaceDisplay');
        const rackDeviceNameInput = document.getElementById('rackDeviceNameInput');
        const rackDeviceTypeSelect = document.getElementById('rackDeviceTypeSelect');
        const rackDeviceIpInput = document.getElementById('rackDeviceIpInput');
        const rackDeviceNumberInput = document.getElementById('rackDeviceNumberInput');
        const rackDeviceUnitInput = document.getElementById('rackDeviceUnitInput');
        const rackDeviceNotesInput = document.getElementById('rackDeviceNotesInput');
        const rackDeviceModalTitle = document.getElementById('rackDeviceModalTitle');
        const deleteRackDeviceBtn = document.getElementById('deleteRackDeviceBtn');
        const saveRackDeviceBtn = document.getElementById('saveRackDeviceBtn');

        if (!rackDeviceModal || !rackDeviceForm) return;
        currentRackItem = item;
        currentRackWp = wp;
        rackDeviceForm.reset();

        const wpCode = (item && item.workplace_code) || (wp && (wp.code || wp.id)) || 'SRV';
        rackDeviceWorkplaceCodeInput.value = wpCode;
        if (rackDeviceWorkplaceDisplay) {
            rackDeviceWorkplaceDisplay.textContent = `Стойка: ${wpCode}${wp && wp.room ? ' · ' + wp.room : ''}`;
        }

        if (item && item.id) {
            rackDeviceModalTitle.textContent = 'Редактирование устройства стойки';
            rackDeviceIdInput.value = item.id;
            rackDeviceNameInput.value = item.name || '';
            rackDeviceIpInput.value = item.ip || '';
            rackDeviceNumberInput.value = item.inventory_number || '';
            rackDeviceNumberInput.placeholder = item.inventory_number || '';

            let notes = item.notes || '';
            let unit = '';
            const match = notes.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (match) {
                unit = match[1];
                notes = match[2];
            }
            rackDeviceUnitInput.value = unit;
            rackDeviceNotesInput.value = notes;

            const nLower = (item.name || '').toLowerCase();
            if (nLower.includes('роутер') || nLower.includes('маршрутизатор')) {
                rackDeviceTypeSelect.value = 'Маршрутизатор';
            } else if (nLower.includes('сервер')) {
                rackDeviceTypeSelect.value = 'Сервер';
            } else if (nLower.includes('ибп') || nLower.includes('ups')) {
                rackDeviceTypeSelect.value = 'ИБП';
            } else if (nLower.includes('патч')) {
                rackDeviceTypeSelect.value = 'Патч-панель';
            } else {
                rackDeviceTypeSelect.value = 'Коммутатор';
            }

            if (deleteRackDeviceBtn) deleteRackDeviceBtn.hidden = false;
            if (saveRackDeviceBtn) saveRackDeviceBtn.textContent = 'Сохранить';
        } else {
            rackDeviceModalTitle.textContent = 'Новое устройство в стойку';
            rackDeviceIdInput.value = '';
            rackDeviceNumberInput.placeholder = `Например: INV_NW_${wpCode}_01`;
            if (deleteRackDeviceBtn) deleteRackDeviceBtn.hidden = true;
            if (saveRackDeviceBtn) saveRackDeviceBtn.textContent = 'Добавить в стойку';
        }

        rackDeviceModal.hidden = false;
        rackDeviceNameInput.focus();
    }

    function closeRackDeviceModal() {
        const rackDeviceModal = document.getElementById('rackDeviceModal');
        if (rackDeviceModal) rackDeviceModal.hidden = true;
        currentRackItem = null;
        currentRackWp = null;
    }

    function initRackDeviceModal() {
        const rackDeviceModal = document.getElementById('rackDeviceModal');
        const rackDeviceForm = document.getElementById('rackDeviceForm');
        const rackDeviceIdInput = document.getElementById('rackDeviceIdInput');
        const rackDeviceWorkplaceCodeInput = document.getElementById('rackDeviceWorkplaceCodeInput');
        const rackDeviceNameInput = document.getElementById('rackDeviceNameInput');
        const rackDeviceTypeSelect = document.getElementById('rackDeviceTypeSelect');
        const rackDeviceIpInput = document.getElementById('rackDeviceIpInput');
        const rackDeviceNumberInput = document.getElementById('rackDeviceNumberInput');
        const rackDeviceUnitInput = document.getElementById('rackDeviceUnitInput');
        const rackDeviceNotesInput = document.getElementById('rackDeviceNotesInput');
        const deleteRackDeviceBtn = document.getElementById('deleteRackDeviceBtn');

        if (!rackDeviceModal) return;

        rackDeviceModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeRackDeviceModal);
        });

        if (rackDeviceForm) {
            rackDeviceForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const id = rackDeviceIdInput.value;
                const isEdit = Boolean(id);
                const wpCode = rackDeviceWorkplaceCodeInput.value.trim();
                const devType = rackDeviceTypeSelect.value;
                const category = (devType === 'ИБП' || devType === 'Другое') ? 'Другое' : 'Сетевое оборудование';
                const typeCode = (devType === 'ИБП' || devType === 'Другое') ? 'EQ' : 'NW';

                const unit = rackDeviceUnitInput.value.trim();
                const notesRaw = rackDeviceNotesInput.value.trim();
                const finalNotes = unit ? `[${unit}] ${notesRaw}` : notesRaw;

                const payload = {
                    name: rackDeviceNameInput.value.trim(),
                    category: category,
                    type_code: typeCode,
                    status: 'assigned',
                    workplace_code: wpCode,
                    employee_id: null,
                    inventory_number: rackDeviceNumberInput.value.trim(),
                    ip: rackDeviceIpInput.value.trim(),
                    notes: finalNotes
                };

                const url = isEdit ? `/api/inventory/${id}/update/` : '/api/inventory/create/';
                try {
                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!resp.ok) {
                        const txt = await resp.text();
                        showToast('Ошибка сохранения: ' + txt, 'error');
                        return;
                    }
                    showToast(isEdit ? 'Устройство обновлено' : 'Устройство добавлено в стойку', 'success');
                    closeRackDeviceModal();
                    await loadInventory();
                    await loadPingerStatus();
                    render();
                } catch (err) {
                    showToast('Ошибка: ' + err.message, 'error');
                }
            });
        }

        if (deleteRackDeviceBtn) {
            deleteRackDeviceBtn.addEventListener('click', async () => {
                if (!currentRackItem || !currentRackItem.id) return;
                if (!confirm(`Удалить устройство «${currentRackItem.name}» из стойки?`)) return;
                try {
                    const resp = await fetch(`/api/inventory/${currentRackItem.id}/delete/`, { method: 'POST' });
                    if (!resp.ok) {
                        const txt = await resp.text();
                        showToast('Ошибка удаления: ' + txt, 'error');
                        return;
                    }
                    showToast('Устройство удалено из стойки', 'success');
                    closeRackDeviceModal();
                    await loadInventory();
                    await loadPingerStatus();
                    render();
                } catch (err) {
                    showToast('Ошибка: ' + err.message, 'error');
                }
            });
        }
    }

    let currentPrinterWp = null;
    let currentPrinterInv = null;

    function openPrinterSettingsModal(wp, invItem = null) {
        const printerSettingsModal = document.getElementById('printerSettingsModal');
        const printerSettingsForm = document.getElementById('printerSettingsForm');
        const printerWorkplaceIdInput = document.getElementById('printerWorkplaceIdInput');
        const printerWorkplaceCodeInput = document.getElementById('printerWorkplaceCodeInput');
        const printerLocationDisplay = document.getElementById('printerLocationDisplay');
        const printerIpInput = document.getElementById('printerIpInput');
        const printerNameInput = document.getElementById('printerNameInput');

        if (!printerSettingsModal || !printerSettingsForm || !wp) return;
        currentPrinterWp = wp;
        currentPrinterInv = invItem;
        printerSettingsForm.reset();

        printerWorkplaceIdInput.value = wp.id || '';
        const wpCode = wp.code || wp.id || '';
        printerWorkplaceCodeInput.value = wpCode;
        if (printerLocationDisplay) {
            printerLocationDisplay.textContent = `${wpCode} · ${wp.room || 'Коридор'} (${floorsById[wp.floor]?.name || ''})`;
        }

        const ip = (invItem && invItem.ip) || wp.ip || '';
        printerIpInput.value = ip;
        printerNameInput.value = (invItem && invItem.name) || wp.label || 'Сетевое МФУ Kyocera';

        printerSettingsModal.hidden = false;
        printerIpInput.focus();
    }

    function closePrinterSettingsModal() {
        const printerSettingsModal = document.getElementById('printerSettingsModal');
        if (printerSettingsModal) printerSettingsModal.hidden = true;
        currentPrinterWp = null;
        currentPrinterInv = null;
    }

    function initPrinterSettingsModal() {
        const printerSettingsModal = document.getElementById('printerSettingsModal');
        const printerSettingsForm = document.getElementById('printerSettingsForm');
        const printerWorkplaceCodeInput = document.getElementById('printerWorkplaceCodeInput');
        const printerIpInput = document.getElementById('printerIpInput');
        const printerNameInput = document.getElementById('printerNameInput');

        if (!printerSettingsModal) return;

        printerSettingsModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closePrinterSettingsModal);
        });

        if (printerSettingsForm) {
            printerSettingsForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const wpCode = printerWorkplaceCodeInput.value.trim();
                const ipVal = printerIpInput.value.trim();
                const nameVal = printerNameInput.value.trim() || 'Сетевое МФУ';

                if (currentPrinterWp) {
                    currentPrinterWp.ip = ipVal;
                }

                const payload = {
                    name: nameVal,
                    category: 'Оргтехника',
                    type_code: 'PR',
                    status: 'assigned',
                    workplace_code: wpCode,
                    employee_id: null,
                    ip: ipVal,
                    notes: 'Сетевой принтер этажа'
                };

                const url = (currentPrinterInv && currentPrinterInv.id)
                    ? `/api/inventory/${currentPrinterInv.id}/update/`
                    : '/api/inventory/create/';

                try {
                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!resp.ok) {
                        const txt = await resp.text();
                        showToast('Ошибка сохранения параметров принтера: ' + txt, 'error');
                        return;
                    }
                    showToast('Сетевые параметры принтера обновлены', 'success');
                    closePrinterSettingsModal();
                    await loadInventory();
                    await loadPingerStatus();
                    render();
                } catch (err) {
                    showToast('Ошибка: ' + err.message, 'error');
                }
            });
        }
    }

    function parseScreenshots(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter(Boolean);
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return [];
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) return parsed.filter(Boolean);
                } catch (e) {}
            }
            return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
        }
        return [];
    }

    // ---------- Модальное окно просмотра скриншотов / изображений (слайдер) ----------
    const imageViewerModal = document.getElementById('imageViewerModal');
    const imageViewerTitle = document.getElementById('imageViewerTitle');
    const imageViewerImg = document.getElementById('imageViewerImg');
    const imageViewerCounter = document.getElementById('imageViewerCounter');
    const imageViewerPrevBtn = document.getElementById('imageViewerPrevBtn');
    const imageViewerNextBtn = document.getElementById('imageViewerNextBtn');
    const imageViewerOpenTabBtn = document.getElementById('imageViewerOpenTabBtn');

    let viewerUrls = [];
    let viewerIndex = 0;
    let viewerBaseTitle = 'Скриншот задачи';

    function updateImageViewerSlide() {
        if (!viewerUrls.length) return;
        const currentUrl = viewerUrls[viewerIndex];
        if (imageViewerImg) imageViewerImg.src = currentUrl;
        if (imageViewerOpenTabBtn) imageViewerOpenTabBtn.href = currentUrl;
        if (imageViewerCounter) {
            imageViewerCounter.textContent = `${viewerIndex + 1} / ${viewerUrls.length}`;
            imageViewerCounter.hidden = viewerUrls.length <= 1;
        }
        if (imageViewerTitle) {
            imageViewerTitle.textContent = viewerUrls.length > 1
                ? `${viewerBaseTitle} (${viewerIndex + 1}/${viewerUrls.length})`
                : viewerBaseTitle;
        }
        if (imageViewerPrevBtn) {
            imageViewerPrevBtn.disabled = viewerIndex <= 0;
            imageViewerPrevBtn.hidden = viewerUrls.length <= 1;
        }
        if (imageViewerNextBtn) {
            imageViewerNextBtn.disabled = viewerIndex >= viewerUrls.length - 1;
            imageViewerNextBtn.hidden = viewerUrls.length <= 1;
        }
    }

    function openImageViewerList(urls, startIndex = 0, title = 'Скриншот задачи') {
        if (!imageViewerModal || !urls || !urls.length) return;
        viewerUrls = urls;
        viewerIndex = Math.max(0, Math.min(startIndex, urls.length - 1));
        viewerBaseTitle = title;
        updateImageViewerSlide();
        imageViewerModal.hidden = false;
    }

    function openImageViewer(url, title = 'Скриншот задачи') {
        openImageViewerList([url], 0, title);
    }

    function closeImageViewer() {
        if (imageViewerModal) imageViewerModal.hidden = true;
        if (imageViewerImg) imageViewerImg.src = '';
        viewerUrls = [];
        viewerIndex = 0;
    }

    function initImageViewerModal() {
        if (!imageViewerModal) return;
        imageViewerModal.querySelectorAll('[data-close]').forEach((n) => {
            n.addEventListener('click', closeImageViewer);
        });
        if (imageViewerPrevBtn) {
            imageViewerPrevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (viewerIndex > 0) {
                    viewerIndex--;
                    updateImageViewerSlide();
                }
            });
        }
        if (imageViewerNextBtn) {
            imageViewerNextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (viewerIndex < viewerUrls.length - 1) {
                    viewerIndex++;
                    updateImageViewerSlide();
                }
            });
        }
        document.addEventListener('keydown', (e) => {
            if (imageViewerModal.hidden) return;
            if (e.key === 'Escape') {
                closeImageViewer();
            } else if (e.key === 'ArrowLeft' && viewerIndex > 0) {
                viewerIndex--;
                updateImageViewerSlide();
            } else if (e.key === 'ArrowRight' && viewerIndex < viewerUrls.length - 1) {
                viewerIndex++;
                updateImageViewerSlide();
            }
        });
    }

    // ---------- Прикрепление скриншотов к задаче (лимит до 10 шт.) ----------
    const MAX_TASK_SCREENSHOTS = 10;
    const taskScreenshotInput = document.getElementById('taskScreenshotInput');
    const taskScreenshotZone = document.getElementById('taskScreenshotZone');
    const taskScreenshotGrid = document.getElementById('taskScreenshotGrid');
    const taskScreenshotPrompt = document.getElementById('taskScreenshotPrompt');
    const taskScreenshotFileInput = document.getElementById('taskScreenshotFileInput');
    const taskScreenshotCounter = document.getElementById('taskScreenshotCounter');
    const taskScreenshotLimitMsg = document.getElementById('taskScreenshotLimitMsg');

    let currentScreenshots = [];

    function renderScreenshotGrid() {
        if (taskScreenshotInput) {
            taskScreenshotInput.value = currentScreenshots.join(',');
        }
        if (taskScreenshotCounter) {
            taskScreenshotCounter.textContent = `${currentScreenshots.length} / ${MAX_TASK_SCREENSHOTS}`;
            taskScreenshotCounter.style.color = currentScreenshots.length >= MAX_TASK_SCREENSHOTS ? 'var(--accent)' : 'var(--text-muted)';
        }

        const isLimitReached = currentScreenshots.length >= MAX_TASK_SCREENSHOTS;
        if (taskScreenshotPrompt) taskScreenshotPrompt.hidden = isLimitReached;
        if (taskScreenshotLimitMsg) taskScreenshotLimitMsg.hidden = !isLimitReached;
        if (taskScreenshotFileInput) taskScreenshotFileInput.disabled = isLimitReached;

        if (!taskScreenshotGrid) return;
        taskScreenshotGrid.innerHTML = '';

        currentScreenshots.forEach((url, idx) => {
            const item = el('div', { class: 'task-screenshot-item', title: `Скриншот #${idx + 1} (клик для увеличения)` }, [
                el('img', { src: url, alt: `Скриншот ${idx + 1}` }),
                el('button', {
                    type: 'button',
                    class: 'task-screenshot-item__del',
                    title: 'Удалить скриншот',
                    html: '&times;',
                    onclick: (e) => {
                        e.stopPropagation();
                        removeScreenshot(idx);
                    }
                })
            ]);
            item.addEventListener('click', () => {
                openImageViewerList(currentScreenshots, idx, 'Скриншот задачи');
            });
            taskScreenshotGrid.append(item);
        });
    }

    async function removeScreenshot(idx) {
        if (idx >= 0 && idx < currentScreenshots.length) {
            const urlToDelete = currentScreenshots[idx];
            currentScreenshots.splice(idx, 1);
            renderScreenshotGrid();

            const taskId = Number(document.getElementById('taskForm')?.id?.value) || null;
            try {
                await fetch('/api/tasks/delete-screenshot/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({ url: urlToDelete, task_id: taskId }),
                });
            } catch (err) {
                console.error('Ошибка удаления файла скриншота:', err);
            }
        }
    }

    function setTaskScreenshots(val) {
        currentScreenshots = parseScreenshots(val).slice(0, MAX_TASK_SCREENSHOTS);
        renderScreenshotGrid();
    }

    async function uploadScreenshotFiles(files) {
        if (!files || !files.length) return;

        const imgFiles = Array.from(files).filter((f) => f.type && f.type.startsWith('image/'));
        if (!imgFiles.length) {
            showToast('Пожалуйста, выберите файлы изображений (PNG, JPG, WebP, GIF)', 'error');
            return;
        }

        if (currentScreenshots.length >= MAX_TASK_SCREENSHOTS) {
            showToast(`Достигнут лимит: максимум ${MAX_TASK_SCREENSHOTS} скриншотов на одну задачу`, 'error');
            return;
        }

        const availableSlots = MAX_TASK_SCREENSHOTS - currentScreenshots.length;
        let filesToUpload = imgFiles;
        if (imgFiles.length > availableSlots) {
            showToast(`Выбрано ${imgFiles.length} файлов, будет загружено только ${availableSlots} (лимит: 10)`, 'info');
            filesToUpload = imgFiles.slice(0, availableSlots);
        }

        if (taskScreenshotPrompt) {
            taskScreenshotPrompt.style.opacity = '0.5';
            taskScreenshotPrompt.style.pointerEvents = 'none';
        }

        let uploadedCount = 0;
        for (const file of filesToUpload) {
            const formData = new FormData();
            formData.append('screenshot', file);

            try {
                const resp = await fetch('/api/tasks/upload-screenshot/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData,
                });
                if (!resp.ok) {
                    const txt = await resp.text();
                    throw new Error(txt || 'Ошибка сервера при загрузке');
                }
                const data = await resp.json();
                if (data && data.url) {
                    currentScreenshots.push(data.url);
                    uploadedCount++;
                    renderScreenshotGrid();
                }
            } catch (err) {
                console.error('Ошибка загрузки скриншота:', err);
                showToast('Ошибка загрузки файла: ' + err.message, 'error');
            }
        }

        if (taskScreenshotPrompt) {
            taskScreenshotPrompt.style.opacity = '1';
            taskScreenshotPrompt.style.pointerEvents = 'auto';
        }
        if (taskScreenshotFileInput) taskScreenshotFileInput.value = '';

        if (uploadedCount > 0) {
            showToast(`Загружено скриншотов: ${uploadedCount} (всего ${currentScreenshots.length}/${MAX_TASK_SCREENSHOTS})`, 'success');
        }
    }

    function initTaskScreenshot() {
        if (taskScreenshotFileInput) {
            taskScreenshotFileInput.addEventListener('change', async () => {
                if (taskScreenshotFileInput.files && taskScreenshotFileInput.files.length > 0) {
                    await uploadScreenshotFiles(taskScreenshotFileInput.files);
                }
            });
        }

        // Drag & drop файлов на зону загрузки
        if (taskScreenshotZone) {
            taskScreenshotZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (currentScreenshots.length < MAX_TASK_SCREENSHOTS) {
                    taskScreenshotZone.classList.add('task-screenshot-zone--dragover');
                }
            });
            taskScreenshotZone.addEventListener('dragleave', (e) => {
                if (!taskScreenshotZone.contains(e.relatedTarget)) {
                    taskScreenshotZone.classList.remove('task-screenshot-zone--dragover');
                }
            });
            taskScreenshotZone.addEventListener('drop', async (e) => {
                e.preventDefault();
                taskScreenshotZone.classList.remove('task-screenshot-zone--dragover');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    await uploadScreenshotFiles(e.dataTransfer.files);
                }
            });
        }

        // Вставка изображений из буфера обмена (Ctrl+V) при открытом окне задачи
        window.addEventListener('paste', async (e) => {
            const taskModal = document.getElementById('taskModal');
            if (!taskModal || taskModal.hidden) return;

            const items = (e.clipboardData || window.clipboardData)?.items;
            if (!items) return;

            const imageFiles = [];
            for (const item of items) {
                if (item.type && item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }
            if (imageFiles.length > 0) {
                e.preventDefault();
                await uploadScreenshotFiles(imageFiles);
            }
        });
    }

    // ==========================================================================
    // Раздел: Бронирование переговорных комнат
    // ==========================================================================

    function getMeetingRooms() {
        let list = (workplaces || []).filter((wp) => wp.kind === 'meeting');
        if (state.roomFloor) {
            list = list.filter((wp) => String(wp.floor_id) === String(state.roomFloor));
        }
        const q = (state.filters.query || '').trim().toLowerCase();
        if (q && state.view === 'rooms') {
            list = list.filter((wp) => {
                const name = (wp.room || wp.label || '').toLowerCase();
                const code = (wp.code || wp.id || '').toLowerCase();
                return name.includes(q) || code.includes(q);
            });
        }
        return list;
    }

    let deleteBookingTargetId = null;

    function initRoomBooking() {
        if (filterRoomFloor) {
            filterRoomFloor.innerHTML = '<option value="">Все этажи</option>';
            (CONFIG.floors || []).forEach((f) => {
                const opt = document.createElement('option');
                opt.value = String(f.id);
                opt.textContent = f.name;
                filterRoomFloor.appendChild(opt);
            });
            filterRoomFloor.addEventListener('change', () => {
                state.roomFloor = filterRoomFloor.value;
                render();
            });
        }

        if (roomDateInput) {
            roomDateInput.value = state.roomDate;
            roomDateInput.addEventListener('change', () => {
                state.roomDate = roomDateInput.value || new Date().toISOString().split('T')[0];
                render();
            });
        }

        if (todayRoomsBtn) {
            todayRoomsBtn.addEventListener('click', () => {
                state.roomDate = new Date().toISOString().split('T')[0];
                if (roomDateInput) roomDateInput.value = state.roomDate;
                render();
            });
        }

        if (openCreateBookingModalBtn) {
            openCreateBookingModalBtn.addEventListener('click', () => openRoomBookingModal());
        }

        if (roomBookingForm) {
            roomBookingForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const roomCode = roomBookingForm.room_code.value;
                const title = roomBookingForm.title.value.trim();
                const organizer = roomBookingForm.organizer.value.trim();
                const dateVal = roomBookingForm.date.value;
                const startTimeVal = roomBookingForm.start_time.value;
                const endTimeVal = roomBookingForm.end_time.value;

                if (!roomCode || !title || !organizer || !dateVal || !startTimeVal || !endTimeVal) {
                    showBookingError('Заполните все обязательные поля');
                    return;
                }

                const startISO = new Date(`${dateVal}T${startTimeVal}:00`).toISOString();
                const endISO = new Date(`${dateVal}T${endTimeVal}:00`).toISOString();

                if (new Date(endISO) <= new Date(startISO)) {
                    showBookingError('Время окончания должно быть позже времени начала');
                    return;
                }

                const wp = (workplaces || []).find((w) => (w.code || w.id) === roomCode);
                const roomName = wp ? (wp.room || wp.label || roomCode) : roomCode;

                if (submitBookingBtn) submitBookingBtn.disabled = true;

                try {
                    const resp = await fetch('/api/rooms/bookings/create/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify({
                            room_code: roomCode,
                            room_name: roomName,
                            title: title,
                            organizer: organizer,
                            start_time: startISO,
                            end_time: endISO
                        })
                    });

                    if (!resp.ok) {
                        const txt = await resp.text();
                        showBookingError(txt || 'Ошибка при создании бронирования');
                        return;
                    }

                    closeRoomBookingModal();
                    showToast('Встреча успешно забронирована', 'success');
                    renderRooms();
                } catch (err) {
                    showBookingError('Ошибка сети: ' + err.message);
                } finally {
                    if (submitBookingBtn) submitBookingBtn.disabled = false;
                }
            });
        }

        if (confirmDeleteBookingBtn) {
            confirmDeleteBookingBtn.addEventListener('click', async () => {
                if (!deleteBookingTargetId) return;
                confirmDeleteBookingBtn.disabled = true;
                try {
                    const resp = await fetch(`/api/rooms/bookings/${deleteBookingTargetId}/delete/`, {
                        method: 'POST',
                        headers: { 'X-CSRFToken': getCsrfToken() }
                    });
                    if (!resp.ok) {
                        const txt = await resp.text();
                        showToast(txt || 'Ошибка отмены бронирования', 'error');
                        return;
                    }
                    closeDeleteBookingModal();
                    showToast('Бронирование отменено', 'info');
                    renderRooms();
                } catch (err) {
                    showToast('Ошибка сети: ' + err.message, 'error');
                } finally {
                    confirmDeleteBookingBtn.disabled = false;
                }
            });
        }

        [roomBookingModal, deleteBookingModal].forEach((modal) => {
            if (!modal) return;
            modal.querySelectorAll('[data-close]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    modal.hidden = true;
                });
            });
        });
    }

    function showBookingError(msg) {
        if (!bookingErrorMsg) return;
        bookingErrorMsg.textContent = msg;
        bookingErrorMsg.hidden = false;
    }

    function closeRoomBookingModal() {
        if (roomBookingModal) roomBookingModal.hidden = true;
    }

    function closeDeleteBookingModal() {
        if (deleteBookingModal) deleteBookingModal.hidden = true;
        deleteBookingTargetId = null;
    }

    function openRoomBookingModal(preselectedRoomCode) {
        if (!roomBookingModal) return;
        if (bookingErrorMsg) bookingErrorMsg.hidden = true;
        if (roomBookingForm) roomBookingForm.reset();

        const rooms = (workplaces || []).filter((wp) => wp.kind === 'meeting');
        if (bookingRoomSelect) {
            bookingRoomSelect.innerHTML = '';
            rooms.forEach((r) => {
                const opt = document.createElement('option');
                opt.value = r.code || r.id;
                const floor = floorsById[r.floor_id];
                opt.textContent = `${r.room || r.label || 'Переговорная'} (${r.code || r.id})${floor ? ' · ' + floor.name : ''}`;
                bookingRoomSelect.appendChild(opt);
            });
            if (preselectedRoomCode) {
                bookingRoomSelect.value = preselectedRoomCode;
            }
        }

        if (bookingDateInput) {
            bookingDateInput.value = state.roomDate || new Date().toISOString().split('T')[0];
        }

        const now = new Date();
        const start = new Date(now.getTime() + 5 * 60000);
        start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
        const end = new Date(start.getTime() + 30 * 60000);

        const pad = (n) => String(n).padStart(2, '0');
        if (bookingStartTime) bookingStartTime.value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
        if (bookingEndTime) bookingEndTime.value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

        if (bookingOrganizerInput) {
            bookingOrganizerInput.value = state.auth.employee_name || state.auth.username || '';
        }

        roomBookingModal.hidden = false;
    }

    function openDeleteBookingModal(booking) {
        if (!deleteBookingModal) return;
        deleteBookingTargetId = booking.id;
        const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        if (deleteBookingModalMessage) {
            deleteBookingModalMessage.innerHTML = `Вы действительно хотите отменить бронирование <strong>«${escapeHtml(booking.title)}»</strong> (${fmtTime(booking.start_time)} — ${fmtTime(booking.end_time)})?`;
        }
        deleteBookingModal.hidden = false;
    }

    async function renderRooms() {
        if (!roomsGridEl) return;
        const rooms = getMeetingRooms();

        if (roomsEmptyEl) roomsEmptyEl.hidden = rooms.length > 0;
        roomsGridEl.innerHTML = '';

        if (!rooms.length) return;

        const isToday = state.roomDate === new Date().toISOString().split('T')[0];

        rooms.forEach((room) => {
            const roomCode = room.code || room.id;
            const floor = floorsById[room.floor_id];
            const roomName = room.room || room.label || 'Переговорная';

            const card = el('div', { class: 'room-card', 'data-room': roomCode });

            const header = el('div', { class: 'room-card__header' }, [
                el('div', { class: 'room-card__titles' }, [
                    el('h3', { class: 'room-card__name', text: roomName }),
                    el('div', { class: 'room-card__meta' }, [
                        el('span', { class: 'room-card__code-badge', text: roomCode }),
                        floor ? el('span', { text: floor.name }) : null
                    ])
                ]),
                el('div', { class: 'room-status-badge room-status-badge--free', id: `statusBadge_${roomCode}` }, [
                    el('span', { class: 'room-status-badge__dot' }),
                    el('span', { text: 'Свободно' })
                ])
            ]);

            const liveBox = el('div', { class: 'room-card__live-box', id: `liveBox_${roomCode}` }, [
                el('div', { class: 'room-card__live-text', text: 'Загрузка статуса...' }),
                el('div', { class: 'room-card__live-sub', text: 'Синхронизация с экраном...' })
            ]);

            const actions = el('div', { class: 'room-card__actions' }, [
                el('button', {
                    type: 'button',
                    class: 'btn btn--action',
                    style: 'flex: 1;',
                    onclick: () => openRoomBookingModal(roomCode),
                    text: '+ Забронировать'
                }),
                el('a', {
                    class: 'btn btn--ghost',
                    href: `/tablet/rooms/${encodeURIComponent(roomCode)}/`,
                    target: '_blank',
                    title: 'Открыть настенный экран переговорной в новой вкладке',
                    text: 'Экран планшета ↗'
                })
            ]);

            const scheduleSection = el('div', { class: 'room-card__schedule-section' }, [
                el('div', { class: 'room-card__schedule-head' }, [
                    el('span', { text: isToday ? 'Расписание на сегодня' : `Расписание на ${state.roomDate}` }),
                    el('span', { id: `scheduleCount_${roomCode}`, text: '0' })
                ]),
                el('div', { class: 'room-card__schedule-list', id: `scheduleList_${roomCode}` }, [
                    el('div', { class: 'room-schedule-empty', text: 'Загрузка расписания...' })
                ])
            ]);

            card.append(header);
            card.append(liveBox);
            card.append(actions);
            card.append(scheduleSection);
            roomsGridEl.append(card);

            loadRoomCardData(roomCode, isToday);
        });
    }

    async function loadRoomCardData(roomCode, isToday) {
        try {
            const resp = await fetch(`/api/rooms/tablet-info/${encodeURIComponent(roomCode)}/?_=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache, no-store' }
            });
            if (!resp.ok) return;
            const data = await resp.json();

            const statusBadge = document.getElementById(`statusBadge_${roomCode}`);
            const liveBox = document.getElementById(`liveBox_${roomCode}`);
            const scheduleList = document.getElementById(`scheduleList_${roomCode}`);
            const scheduleCount = document.getElementById(`scheduleCount_${roomCode}`);

            if (!statusBadge || !liveBox || !scheduleList) return;

            const isBusy = data.status === 'busy' && data.current_meeting;
            const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';

            if (isBusy) {
                statusBadge.className = 'room-status-badge room-status-badge--busy';
                statusBadge.innerHTML = '<span class="room-status-badge__dot"></span><span>Занято</span>';
            } else {
                statusBadge.className = 'room-status-badge room-status-badge--free';
                statusBadge.innerHTML = '<span class="room-status-badge__dot"></span><span>Свободно</span>';
            }

            liveBox.innerHTML = '';
            if (isBusy) {
                const cur = data.current_meeting;
                liveBox.append(el('div', { class: 'room-card__live-text', style: 'color: #ef4444;', text: `Идёт: ${cur.title}` }));
                liveBox.append(el('div', {
                    class: 'room-card__live-sub',
                    text: `${fmtTime(cur.start_time)} — ${fmtTime(cur.end_time)} · Организатор: ${cur.organizer}`
                }));
            } else {
                if (data.next_meeting) {
                    liveBox.append(el('div', { class: 'room-card__live-text', style: 'color: #10b981;', text: 'Свободно прямо сейчас' }));
                    liveBox.append(el('div', {
                        class: 'room-card__live-sub',
                        text: `Следующая бронь в ${fmtTime(data.next_meeting.start_time)} (${data.next_meeting.title})`
                    }));
                } else {
                    liveBox.append(el('div', { class: 'room-card__live-text', style: 'color: #10b981;', text: 'Свободно прямо сейчас' }));
                    liveBox.append(el('div', { class: 'room-card__live-sub', text: 'Доступна на весь день' }));
                }
            }

            let bookings = [];
            if (isToday) {
                bookings = data.today_bookings || [];
            } else {
                const bookResp = await fetch(`/api/rooms/bookings/?date=${encodeURIComponent(state.roomDate)}&room=${encodeURIComponent(roomCode)}`);
                if (bookResp.ok) {
                    const resJson = await bookResp.json();
                    bookings = resJson.bookings || [];
                }
            }

            if (scheduleCount) scheduleCount.textContent = String(bookings.length);
            scheduleList.innerHTML = '';

            if (!bookings.length) {
                scheduleList.append(el('div', { class: 'room-schedule-empty', text: 'Встреч не запланировано' }));
                return;
            }

            const currentAuthName = (state.auth.employee_name || state.auth.username || '').toLowerCase();
            const isAdmin = !!state.auth.is_admin;

            bookings.forEach((b) => {
                const isCur = data.current_meeting && Number(data.current_meeting.id) === Number(b.id);
                const isOwner = currentAuthName && b.organizer && b.organizer.toLowerCase().includes(currentAuthName);
                const canDelete = isAdmin || isOwner;

                const item = el('div', {
                    class: 'room-schedule-item' + (isCur ? ' is-current' : '')
                }, [
                    el('div', { class: 'room-schedule-item__left' }, [
                        el('div', { class: 'room-schedule-item__title', text: b.title + (isCur ? ' (сейчас)' : '') }),
                        el('div', { class: 'room-schedule-item__meta', text: `${fmtTime(b.start_time)} — ${fmtTime(b.end_time)} · ${b.organizer}` })
                    ])
                ]);

                if (canDelete) {
                    const delBtn = el('button', {
                        type: 'button',
                        class: 'room-schedule-item__delete-btn',
                        title: 'Отменить бронь',
                        html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
                        onclick: (ev) => {
                            ev.stopPropagation();
                            openDeleteBookingModal(b);
                        }
                    });
                    item.append(delBtn);
                }

                scheduleList.append(item);
            });
        } catch (err) {
            console.error('Ошибка загрузки данных комнаты:', err);
        }
    }

    // ---------- Синхронизация задач в реальном времени (SSE) ----------
    function initTaskEvents() {
        if (typeof EventSource === 'undefined') {
            console.warn('[SSE] EventSource не поддерживается браузером');
            return;
        }

        let evtSource = null;

        function connect() {
            try {
                evtSource = new EventSource('/api/tasks/events/');

                evtSource.addEventListener('connected', () => {
                    console.log('[SSE] Соединение реального времени успешно установлено');
                });

                evtSource.addEventListener('task_created', (e) => {
                    try {
                        const task = JSON.parse(e.data);
                        if (!task || !task.id) return;
                        const existingIdx = state.tasks.findIndex((t) => Number(t.id) === Number(task.id));
                        if (existingIdx === -1) {
                            state.tasks.push(task);
                            saveTasks();
                            render();
                            showToast(`Новая задача ${KEY_PREFIX}-${task.id}: ${task.title}`, 'info');
                        } else {
                            Object.assign(state.tasks[existingIdx], task);
                            saveTasks();
                            render();
                        }
                    } catch (err) {
                        console.error('[SSE] Ошибка обработки события task_created:', err);
                    }
                });

                evtSource.addEventListener('task_updated', (e) => {
                    try {
                        const task = JSON.parse(e.data);
                        if (!task || !task.id) return;
                        const existing = state.tasks.find((t) => Number(t.id) === Number(task.id));
                        if (existing) {
                            Object.assign(existing, task);
                            saveTasks();
                            render();
                        } else {
                            state.tasks.push(task);
                            saveTasks();
                            render();
                        }
                    } catch (err) {
                        console.error('[SSE] Ошибка обработки события task_updated:', err);
                    }
                });

                evtSource.addEventListener('task_deleted', (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        if (!data || !data.id) return;
                        const prevLen = state.tasks.length;
                        state.tasks = state.tasks.filter((t) => Number(t.id) !== Number(data.id));
                        if (state.tasks.length !== prevLen) {
                            saveTasks();
                            render();
                        }
                    } catch (err) {
                        console.error('[SSE] Ошибка обработки события task_deleted:', err);
                    }
                });

                const handleRoomEvent = () => {
                    if (state.view === 'rooms') {
                        renderRooms();
                    }
                };
                evtSource.addEventListener('room_booked', handleRoomEvent);
                evtSource.addEventListener('booking_cancelled', handleRoomEvent);
                evtSource.addEventListener('room_freed', handleRoomEvent);
                evtSource.addEventListener('meeting_extended', handleRoomEvent);

                evtSource.onerror = () => {
                    console.warn('[SSE] Обрыв соединения с сервером задач, автоматическое переподключение...');
                };
            } catch (err) {
                console.error('[SSE] Ошибка подключения:', err);
            }
        }

        connect();
    }

    initThemeToggle();
    initCookieBanner();
    initPingerModal();
    initRackDeviceModal();
    initPrinterSettingsModal();
    initTaskScreenshot();
    initImageViewerModal();
    initRoomBooking();
    initTaskEvents();
    loadPingerStatus();
    setInterval(loadPingerStatus, 60000);
    loadInventory();
    render();
    loadWorkdayStatus();
})();
