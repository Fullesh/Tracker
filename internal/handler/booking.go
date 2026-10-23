package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"html/template"
	"net/http"
	"strconv"
	"time"
)

type createBookingPayload struct {
	RoomCode  string    `json:"room_code"`
	RoomName  string    `json:"room_name"`
	Title     string    `json:"title"`
	Organizer string    `json:"organizer"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
}

type quickBookPayload struct {
	RoomCode        string `json:"room_code"`
	DurationMinutes int    `json:"duration_minutes"`
	Title           string `json:"title"`
	Organizer       string `json:"organizer"`
}

type finishEarlyPayload struct {
	RoomCode string `json:"room_code"`
}

func (h *Handler) GetRoomBookings(w http.ResponseWriter, r *http.Request) {
	dateStr := r.URL.Query().Get("date")
	room := r.URL.Query().Get("room")
	now := time.Now()
	targetDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	if dateStr != "" {
		if parsed, err := time.ParseInLocation("2006-01-02", dateStr, now.Location()); err == nil {
			targetDate = parsed
		}
	}

	dayStart := targetDate
	dayEnd := targetDate.Add(24 * time.Hour)

	query := h.db.Model(&domain.RoomBooking{}).
		Where("start_time < ? AND end_time > ?", dayEnd, dayStart)

	if room != "" {
		query = query.Where("room_code = ?", room)
	}

	var bookings []domain.RoomBooking
	if err := query.Order("start_time ASC").Find(&bookings).Error; err != nil {
		http.Error(w, "Ошибка получения бронирований: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"bookings": bookings,
		"date":     targetDate.Format("2006-01-02"),
		"total":    len(bookings),
	})
}

func (h *Handler) CreateRoomBooking(w http.ResponseWriter, r *http.Request) {
	var payload createBookingPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON в теле запроса", http.StatusBadRequest)
		return
	}

	if payload.RoomCode == "" || payload.Title == "" || payload.Organizer == "" {
		http.Error(w, "Укажите комнату, тему встречи и организатора", http.StatusBadRequest)
		return
	}

	if !payload.EndTime.After(payload.StartTime) {
		http.Error(w, "Время окончания встречи должно быть позже времени начала", http.StatusBadRequest)
		return
	}

	var conflictCount int64
	h.db.Model(&domain.RoomBooking{}).
		Where("room_code = ? AND start_time < ? AND end_time > ?", payload.RoomCode, payload.EndTime, payload.StartTime).
		Count(&conflictCount)

	if conflictCount > 0 {
		http.Error(w, "Это время уже занято другой встречей", http.StatusConflict)
		return
	}

	if payload.RoomName == "" {
		var wp domain.Workplace
		if err := h.db.Where("code = ?", payload.RoomCode).First(&wp).Error; err == nil && wp.Room != "" {
			payload.RoomName = wp.Room
		} else {
			payload.RoomName = payload.RoomCode
		}
	}

	booking := domain.RoomBooking{
		RoomCode:  payload.RoomCode,
		RoomName:  payload.RoomName,
		Title:     payload.Title,
		Organizer: payload.Organizer,
		StartTime: payload.StartTime,
		EndTime:   payload.EndTime,
	}

	if err := h.db.Create(&booking).Error; err != nil {
		http.Error(w, "Ошибка сохранения бронирования: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if h.sse != nil {
		h.sse.Broadcast("room_booked", booking)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"booking": booking,
	})
}

func (h *Handler) DeleteRoomBooking(w http.ResponseWriter, r *http.Request) {
	var booking domain.RoomBooking
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 0 {
		http.Error(w, "Некорректный ID бронирования", http.StatusBadRequest)
		return
	}

	if err := h.db.First(&booking, id).Error; err != nil {
		http.Error(w, "Бронирование не найдено", http.StatusNotFound)
		return
	}

	if err := h.db.Delete(&booking).Error; err != nil {
		http.Error(w, "Ошибка удаления: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.sse != nil {
		h.sse.Broadcast("booking_cancelled", map[string]any{
			"id":        id,
			"room_code": booking.RoomCode,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

func (h *Handler) GetRoomTabletInfo(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	if code == "" {
		http.Error(w, "Не указан код переговорной", http.StatusBadRequest)
		return
	}

	roomName := code
	var wp domain.Workplace
	if err := h.db.Where("code = ?", code).First(&wp).Error; err == nil && wp.Room != "" {
		roomName = wp.Room
	}

	now := time.Now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	dayEnd := dayStart.Add(24 * time.Hour)

	var todayBookings []domain.RoomBooking
	h.db.Where("room_code = ? AND start_time < ? AND end_time > ?", code, dayEnd, dayStart).
		Order("start_time ASC").
		Find(&todayBookings)

	var currentMeeting *domain.RoomBooking
	var nextMeeting *domain.RoomBooking

	for i := range todayBookings {
		b := &todayBookings[i]
		if (b.StartTime.Before(now) || b.StartTime.Equal(now)) && b.EndTime.After(now) {
			currentMeeting = b
		} else if b.StartTime.After(now) && nextMeeting == nil {
			nextMeeting = b
		}
	}

	status := "free"
	remainingSeconds := 0
	if currentMeeting != nil {
		status = "busy"
		remainingSeconds = int(currentMeeting.EndTime.Sub(now).Seconds())
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"room_code":         code,
		"room_name":         roomName,
		"status":            status,
		"current_meeting":   currentMeeting,
		"next_meeting":      nextMeeting,
		"today_bookings":    todayBookings,
		"remaining_seconds": remainingSeconds,
		"server_time":       now.Format(time.RFC3339),
	})
}

func (h *Handler) QuickBookRoom(w http.ResponseWriter, r *http.Request) {
	var payload quickBookPayload
	json.NewDecoder(r.Body).Decode(&payload)

	if payload.RoomCode == "" {
		http.Error(w, "Не указан код переговорной", http.StatusBadRequest)
		return
	}

	if payload.DurationMinutes <= 0 {
		payload.DurationMinutes = 15
	}

	if payload.Title == "" {
		payload.Title = "Быстрая встреча"
	}

	if payload.Organizer == "" {
		payload.Organizer = "Бронь с экрана"
	}

	startTime := time.Now()
	endTime := startTime.Add(time.Duration(payload.DurationMinutes) * time.Minute)

	var conflictCount int64
	h.db.Model(&domain.RoomBooking{}).
		Where("room_code = ? AND start_time < ? AND end_time > ?", payload.RoomCode, endTime, startTime).
		Count(&conflictCount)
	if conflictCount > 0 {
		http.Error(w, "Невозможно забронировать: время пересекается со следующей забронированной встречей", http.StatusConflict)
		return
	}
	roomName := payload.RoomCode
	var wp domain.Workplace
	if err := h.db.Where("code = ?", payload.RoomCode).First(&wp).Error; err == nil && wp.Room != "" {
		roomName = wp.Room
	}

	booking := domain.RoomBooking{
		RoomCode:  payload.RoomCode,
		RoomName:  roomName,
		Title:     payload.Title,
		Organizer: payload.Organizer,
		StartTime: startTime,
		EndTime:   endTime,
	}

	if err := h.db.Create(&booking).Error; err != nil {
		http.Error(w, "Ошибка сохранения бронирования: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.sse != nil {
		h.sse.Broadcast("room_booked", booking)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"booking": booking,
	})
}

func (h *Handler) FinishMeetingEarly(w http.ResponseWriter, r *http.Request) {
	var payload finishEarlyPayload
	json.NewDecoder(r.Body).Decode(&payload)
	if payload.RoomCode == "" {
		http.Error(w, "Не указан код переговорной", http.StatusBadRequest)
		return
	}

	now := time.Now()
	var current domain.RoomBooking
	err := h.db.Where("room_code = ? AND start_time <= ? AND end_time > ?", payload.RoomCode, now, now).
		First(&current).Error
	if err != nil {
		http.Error(w, "Активная встреча в этой переговорной не найдена", http.StatusNotFound)
		return
	}

	current.EndTime = now
	if err := h.db.Save(&current).Error; err != nil {
		http.Error(w, "Ошибка обновления встречи: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.sse != nil {
		h.sse.Broadcast("room_freed", map[string]any{
			"room_code": payload.RoomCode,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

func (h *Handler) TabletPage(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	if code == "" {
		http.Error(w, "Не указан код переговорной", http.StatusBadRequest)
		return
	}

	roomName := code
	var wp domain.Workplace
	if err := h.db.Where("code = ?", code).First(&wp).Error; err == nil && wp.Room != "" {
		roomName = wp.Room
	}

	tmpl, err := template.ParseFiles("web/templates/tablet.html")
	if err != nil {
		http.Error(w, "Ошибка загрузки шаблона: "+err.Error(), http.StatusInternalServerError)
		return
	}

	data := map[string]any{
		"RoomCode": code,
		"RoomName": roomName,
	}

	tmpl.Execute(w, data)
}
