/**
 * Режим планшета-киоска для переговорных комнат (Tracker Tablet Mode)
 */
(function () {
    'use strict';

    const roomCode = document.body.dataset.room || '';
    if (!roomCode) {
        console.error('Не указан room_code в data-атрибуте');
        return;
    }
    const tabletLocation = document.body.dataset.location || 'outside';
    const isInside = tabletLocation === 'inside';

    // Элементы шапки
    const clockTimeEl = document.getElementById('tabletClockTime');
    const clockDateEl = document.getElementById('tabletClockDate');
    const fullscreenBtn = document.getElementById('tabletFullscreenBtn');
    const roomNameEl = document.getElementById('tabletRoomName');

    // Элементы статуса
    const statusCardEl = document.getElementById('tabletStatusCard');
    const statusTextEl = document.getElementById('tabletStatusText');
    const viewFreeEl = document.getElementById('viewFree');
    const viewBusyEl = document.getElementById('viewBusy');
    const freeUntilSubtitleEl = document.getElementById('freeUntilSubtitle');

    // Элементы текущей встречи
    const endingBannerEl = document.getElementById('tabletEndingBanner');
    const meetingTimeRangeEl = document.getElementById('currentMeetingTimeRange');
    const meetingTitleEl = document.getElementById('currentMeetingTitle');
    const meetingOrganizerValEl = document.getElementById('currentMeetingOrganizerVal');
    const timerValEl = document.getElementById('tabletTimerVal');
    const timerProgressEl = document.getElementById('tabletTimerProgress');

    // Кнопки управления
    const tabletBusyActionsEl = document.getElementById('tabletBusyActions');
    const openExtendModalBtn = document.getElementById('openExtendModalBtn');
    const finishEarlyBtn = document.getElementById('finishEarlyBtn');
    const openCustomBookModalBtn = document.getElementById('openCustomBookModalBtn');

    if (!isInside && tabletBusyActionsEl) {
        tabletBusyActionsEl.hidden = true;
        tabletBusyActionsEl.style.display = 'none';
    }

    // Панель расписания
    const scheduleCountEl = document.getElementById('scheduleCount');
    const scheduleListEl = document.getElementById('scheduleList');

    // Модальные окна
    const extendModalEl = document.getElementById('extendModal');
    const customBookModalEl = document.getElementById('customBookModal');
    const customBookForm = document.getElementById('customBookForm');
    const customStartTimeInput = document.getElementById('customStartTime');
    const customEndTimeInput = document.getElementById('customEndTime');

    // Toast
    const toastEl = document.getElementById('tabletToast');
    let toastTimeout = null;

    // Состояние
    let currentData = null;
    let localSecondsRemaining = 0;
    let totalMeetingDurationSec = 0;
    let currentMeetingStartTime = 0;
    let timerInterval = null;

    // ---------- Toast уведомления ----------
    function showToast(message, type = 'info') {
        if (!toastEl) return;
        toastEl.textContent = message;
        toastEl.className = 'tablet-toast is-visible toast--' + type;
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('is-visible');
        }, 4000);
    }

    // ---------- Цифровые часы шапки ----------
    function updateClock() {
        const now = new Date();
        if (clockTimeEl) {
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            clockTimeEl.textContent = `${h}:${m}:${s}`;
        }
        if (clockDateEl) {
            const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            clockDateEl.textContent = now.toLocaleDateString('ru-RU', options);
        }

        // Проверка перехода комнаты в статус "Занято", когда наступило время следующей встречи
        if (currentData && currentData.status === 'free' && currentData.next_meeting) {
            const nextStart = new Date(currentData.next_meeting.start_time).getTime();
            if (Date.now() >= nextStart) {
                fetchTabletInfo();
            }
        }
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ---------- Полноэкранный режим ----------
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const docEl = document.documentElement;
            const requestFS = docEl.requestFullscreen ||
                              docEl.webkitRequestFullscreen ||
                              docEl.webkitRequestFullScreen ||
                              docEl.mozRequestFullScreen ||
                              docEl.msRequestFullscreen;

            const exitFS = document.exitFullscreen ||
                           document.webkitExitFullscreen ||
                           document.webkitCancelFullScreen ||
                           document.mozCancelFullScreen ||
                           document.msExitFullscreen;

            const isFS = document.fullscreenElement ||
                         document.webkitFullscreenElement ||
                         document.mozFullScreenElement ||
                         document.msFullscreenElement;

            if (requestFS) {
                if (!isFS) {
                    try {
                        const p = requestFS.call(docEl);
                        if (p && typeof p.catch === 'function') {
                            p.catch((err) => {
                                console.warn('Не удалось перейти в полноэкранный режим:', err);
                            });
                        }
                    } catch (e) {
                        console.warn('Ошибка requestFullscreen:', e);
                    }
                } else if (exitFS) {
                    try {
                        const p = exitFS.call(document);
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                    } catch (e) {
                        console.warn('Ошибка exitFullscreen:', e);
                    }
                }
            } else {
                // В iOS Safari на iPhone Apple намеренно не поддерживает стандартный Fullscreen API для произвольных DOM-элементов
                // Настоящий Fullscreen (Kiosk) на iPhone активируется добавлением веб-страницы на домашний экран
                window.scrollTo({ top: 1, behavior: 'smooth' });
                showToast('На iPhone полноэкранный Kiosk режим включается через меню «Поделиться» -> «На экран "Домой"»', 'info');
            }
        });
    }

    // ---------- Форматирование времени ----------
    function formatTime(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function formatDuration(totalSec) {
        if (totalSec <= 0) return '00:00';
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // ---------- Получение данных о комнате ----------
    async function fetchTabletInfo() {
        try {
            const resp = await fetch(`/api/rooms/tablet-info/${encodeURIComponent(roomCode)}/?_=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache, no-store' }
            });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(txt || 'Ошибка сервера');
            }
            const data = await resp.json();
            currentData = data;
            render(data);
        } catch (err) {
            console.error('Ошибка загрузки данных переговорной:', err);
        }
    }

    // ---------- Отрисовка состояния экрана ----------
    function render(data) {
        if (data.room_name && roomNameEl) {
            roomNameEl.textContent = data.room_name;
        }

        const isBusy = data.status === 'busy' && data.current_meeting;

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        if (isBusy) {
            renderBusyState(data);
        } else {
            renderFreeState(data);
        }

        renderSchedule(data.today_bookings || [], data.current_meeting);
    }

    // ---------- Отрисовка состояния СВОБОДНО ----------
    function renderFreeState(data) {
        document.body.className = 'tablet-body status--free';
        if (statusTextEl) statusTextEl.textContent = 'Свободно';

        if (viewFreeEl) viewFreeEl.hidden = false;
        if (viewBusyEl) viewBusyEl.hidden = true;
        if (endingBannerEl) endingBannerEl.hidden = true;

        if (data.next_meeting) {
            const nextStart = formatTime(data.next_meeting.start_time);
            if (freeUntilSubtitleEl) {
                freeUntilSubtitleEl.textContent = `Свободно до ${nextStart} (далее: ${data.next_meeting.title})`;
            }
        } else {
            if (freeUntilSubtitleEl) {
                freeUntilSubtitleEl.textContent = 'Доступна для бронирования на весь день';
            }
        }
    }

    // ---------- Отрисовка состояния ЗАНЯТО ----------
    function renderBusyState(data) {
        const meeting = data.current_meeting;
        if (viewFreeEl) viewFreeEl.hidden = true;
        if (viewBusyEl) viewBusyEl.hidden = false;

        if (meetingTimeRangeEl) {
            meetingTimeRangeEl.textContent = `${formatTime(meeting.start_time)} — ${formatTime(meeting.end_time)}`;
        }
        if (meetingTitleEl) {
            meetingTitleEl.textContent = meeting.title || 'Встреча без темы';
        }
        if (meetingOrganizerValEl) {
            meetingOrganizerValEl.textContent = meeting.organizer || 'Не указан';
        }

        // Вычисляем общую продолжительность встречи и оставшееся время
        const start = new Date(meeting.start_time).getTime();
        const end = new Date(meeting.end_time).getTime();
        currentMeetingStartTime = start;
        totalMeetingDurationSec = Math.max(1, Math.round((end - start) / 1000));
        localSecondsRemaining = Math.max(0, Math.round((end - Date.now()) / 1000));

        updateTimerUI();

        // Запуск тикающего обратного отсчета
        timerInterval = setInterval(() => {
            if (localSecondsRemaining > 0) {
                localSecondsRemaining--;
                updateTimerUI();
            } else {
                clearInterval(timerInterval);
                fetchTabletInfo();
            }
        }, 1000);
    }

    // ---------- Обновление таймера и индикатора окончания ----------
    function updateTimerUI() {
        if (timerValEl) {
            timerValEl.textContent = formatDuration(localSecondsRemaining);
        }

        // Прогресс-бар
        if (timerProgressEl && totalMeetingDurationSec > 0) {
            const progress = (localSecondsRemaining / totalMeetingDurationSec) * 100;
            timerProgressEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        }

        // Предупреждение за 1 минуту до конца (только если встреча уже фактически началась)
        const hasStarted = Date.now() >= currentMeetingStartTime;
        const isEndingSoon = hasStarted && localSecondsRemaining > 0 && localSecondsRemaining <= 60;

        if (isEndingSoon) {
            document.body.className = 'tablet-body status--warning';
            if (statusTextEl) statusTextEl.textContent = 'Скоро завершится';
            if (endingBannerEl) endingBannerEl.hidden = false;
        } else {
            document.body.className = 'tablet-body status--busy';
            if (statusTextEl) statusTextEl.textContent = 'Идёт встреча';
            if (endingBannerEl) endingBannerEl.hidden = true;
        }
    }

    // ---------- Отрисовка списка расписания ----------
    function renderSchedule(bookings, currentMeeting) {
        if (scheduleCountEl) {
            scheduleCountEl.textContent = String(bookings.length);
        }
        if (!scheduleListEl) return;

        if (!bookings.length) {
            scheduleListEl.innerHTML = '<div class="tablet-schedule-empty">На сегодня встреч больше не запланировано</div>';
            return;
        }

        scheduleListEl.innerHTML = '';
        const now = Date.now();

        bookings.forEach((b) => {
            const isCurrent = currentMeeting && Number(currentMeeting.id) === Number(b.id);
            const isPast = new Date(b.end_time).getTime() < now;

            const item = document.createElement('div');
            item.className = 'tablet-schedule-item' + (isCurrent ? ' is-current' : '') + (isPast ? ' is-past' : '');

            const timeDiv = document.createElement('div');
            timeDiv.className = 'tablet-schedule-item__time';
            timeDiv.textContent = `${formatTime(b.start_time)} — ${formatTime(b.end_time)}${isCurrent ? ' (сейчас)' : ''}`;

            const titleDiv = document.createElement('div');
            titleDiv.className = 'tablet-schedule-item__title';
            titleDiv.textContent = b.title;

            const orgDiv = document.createElement('div');
            orgDiv.className = 'tablet-schedule-item__organizer';
            orgDiv.textContent = `Организатор: ${b.organizer}`;

            item.appendChild(timeDiv);
            item.appendChild(titleDiv);
            item.appendChild(orgDiv);
            scheduleListEl.appendChild(item);
        });
    }

    // ---------- Быстрая бронь (+15, +30, +60 мин) ----------
    document.querySelectorAll('.tablet-quick-btn[data-minutes]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const minutes = Number(btn.dataset.minutes) || 15;
            btn.disabled = true;
            try {
                const resp = await fetch('/api/rooms/quick-book/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        room_code: roomCode,
                        duration_minutes: minutes,
                        title: 'Быстрая встреча',
                        organizer: 'Бронь с экрана'
                    })
                });

                if (!resp.ok) {
                    const txt = await resp.text();
                    showToast(txt || 'Не удалось забронировать комнату', 'error');
                    return;
                }
                showToast(`Комната забронирована на ${minutes} минут`, 'success');
                await fetchTabletInfo();
            } catch (err) {
                showToast('Ошибка: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
    });

    // ---------- Завершить встречу досрочно (доступно только внутри переговорной) ----------
    if (finishEarlyBtn) {
        if (!isInside) {
            finishEarlyBtn.hidden = true;
            finishEarlyBtn.style.display = 'none';
        } else {
            finishEarlyBtn.addEventListener('click', async () => {
                finishEarlyBtn.disabled = true;
                try {
                    const resp = await fetch('/api/rooms/finish-early/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            room_code: roomCode,
                            location: tabletLocation
                        })
                    });

                    if (!resp.ok) {
                        const txt = await resp.text();
                        showToast(txt || 'Ошибка освобождения комнаты', 'error');
                        return;
                    }
                    showToast('Переговорная комната освобождена', 'success');
                    await fetchTabletInfo();
                } catch (err) {
                    showToast('Ошибка: ' + err.message, 'error');
                } finally {
                    finishEarlyBtn.disabled = false;
                }
            });
        }
    }

    // ---------- Продление встречи (доступно только с планшета внутри) ----------
    if (openExtendModalBtn) {
        if (!isInside) {
            openExtendModalBtn.hidden = true;
            openExtendModalBtn.style.display = 'none';
        } else {
            openExtendModalBtn.addEventListener('click', () => {
                if (extendModalEl) extendModalEl.hidden = false;
            });
        }
    }

    document.querySelectorAll('.tablet-extend-btn[data-extend]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const duration = Number(btn.dataset.extend) || 15;
            if (extendModalEl) extendModalEl.hidden = true;

            try {
                const resp = await fetch('/api/rooms/extend/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        room_code: roomCode,
                        duration_minutes: duration,
                        location: tabletLocation
                    })
                });

                if (!resp.ok) {
                    const txt = await resp.text();
                    showToast(txt || 'Не удалось продлить встречу', 'error');
                    return;
                }

                const res = await resp.json();
                const msg = res.message || `Встреча продлена на ${duration} минут`;
                showToast(msg, res.partially_extended ? 'warning' : 'success');
                await fetchTabletInfo();
            } catch (err) {
                showToast('Ошибка: ' + err.message, 'error');
            }
        });
    });

    // ---------- Кастомное бронирование (модалка) ----------
    if (openCustomBookModalBtn) {
        openCustomBookModalBtn.addEventListener('click', () => {
            if (!customBookModalEl) return;

            // Предустанавливаем текущее время + 30 минут
            const now = new Date();
            const startH = String(now.getHours()).padStart(2, '0');
            const startM = String(now.getMinutes()).padStart(2, '0');

            const end = new Date(now.getTime() + 30 * 60000);
            const endH = String(end.getHours()).padStart(2, '0');
            const endM = String(end.getMinutes()).padStart(2, '0');

            if (customStartTimeInput) customStartTimeInput.value = `${startH}:${startM}`;
            if (customEndTimeInput) customEndTimeInput.value = `${endH}:${endM}`;

            customBookModalEl.hidden = false;
        });
    }

    if (customBookForm) {
        customBookForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = customBookForm.title.value.trim();
            const organizer = customBookForm.organizer.value.trim();
            const startTimeStr = customBookForm.start_time.value;
            const endTimeStr = customBookForm.end_time.value;

            if (!startTimeStr || !endTimeStr) {
                showToast('Укажите время начала и окончания', 'error');
                return;
            }

            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');

            const startISO = new Date(`${y}-${m}-${d}T${startTimeStr}:00`).toISOString();
            const endISO = new Date(`${y}-${m}-${d}T${endTimeStr}:00`).toISOString();

            try {
                const resp = await fetch('/api/rooms/bookings/create/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        room_code: roomCode,
                        title: title,
                        organizer: organizer,
                        start_time: startISO,
                        end_time: endISO
                    })
                });

                if (!resp.ok) {
                    const txt = await resp.text();
                    showToast(txt || 'Ошибка создания бронирования', 'error');
                    return;
                }

                showToast('Встреча успешно забронирована', 'success');
                if (customBookModalEl) customBookModalEl.hidden = true;
                customBookForm.reset();
                await fetchTabletInfo();
            } catch (err) {
                showToast('Ошибка: ' + err.message, 'error');
            }
        });
    }

    // Закрытие модалок по data-close
    document.querySelectorAll('.tablet-modal [data-close]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.tablet-modal');
            if (modal) modal.hidden = true;
        });
    });

    // ---------- SSE (Server-Sent Events) для мгновенного обновления ----------
    function initSSE() {
        if (typeof EventSource === 'undefined') return;

        try {
            const evtSource = new EventSource('/api/tasks/events/');

            const handleEvent = (e) => {
                try {
                    const payload = JSON.parse(e.data);
                    // Если событие касается нашей комнаты — мгновенно обновляем экран
                    if (!payload || payload.room_code === roomCode || !payload.room_code) {
                        fetchTabletInfo();
                    }
                } catch (err) {
                    fetchTabletInfo();
                }
            };

            evtSource.addEventListener('room_booked', handleEvent);
            evtSource.addEventListener('booking_cancelled', handleEvent);
            evtSource.addEventListener('room_freed', handleEvent);
            evtSource.addEventListener('meeting_extended', handleEvent);
        } catch (err) {
            console.warn('[Tablet SSE] Не удалось подключить SSE:', err);
        }
    }

    // Инициализация
    fetchTabletInfo();
    setInterval(fetchTabletInfo, 5000); // Регулярный опрос каждые 5 секунд с защитой от кэширования
    initSSE();

})();
