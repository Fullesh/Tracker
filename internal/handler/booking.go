package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
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
