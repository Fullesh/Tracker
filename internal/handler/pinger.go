package handler

import (
	"encoding/json"
	"net/http"
)

type pingerConfigPayload struct {
	Enabled         *bool `json:"enabled"`
	IntervalMinutes *int  `json:"interval_minutes"`
}

func (h *Handler) GetPingerStatus(w http.ResponseWriter, r *http.Request) {
	if h.pinger == nil {
		http.Error(w, "Сервис pinger не инициализирован", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(h.pinger.GetStatus())
}

func (h *Handler) UpdatePingerConfig(w http.ResponseWriter, r *http.Request) {
	var payload pingerConfigPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}
	h.pinger.UpdateConfig(payload.Enabled, payload.IntervalMinutes)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

func (h *Handler) TriggerPingCheck(w http.ResponseWriter, r *http.Request) {
	go h.pinger.CheckAll()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": "Опрос запущен",
	})
}
