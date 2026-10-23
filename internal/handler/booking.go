package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
	"time"
)

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
