package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
	"time"
)

func (h *Handler) GetWorkdayStatus(w http.ResponseWriter, r *http.Request) {
	user := h.currentUser(r)
	if user == nil {
		http.Error(w, "Требуется авторизация", http.StatusUnauthorized)
		return
	}
	var session domain.WorkSession
	err := h.db.Where("user_id = ?", user.ID).Order("id DESC").First(&session).Error
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"has_session": false,
		})
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"has_session": true,
			"session":     session,
		})
	}
	return
}

func (h *Handler) StartWorkday(w http.ResponseWriter, r *http.Request) {
	user := h.currentUser(r)
	if user == nil {
		http.Error(w, "Требуется авторизация", http.StatusUnauthorized)
		return
	}
	session := domain.WorkSession{
		UserID:    user.ID,
		Status:    "active",
		StartedAt: time.Now(),
	}
	if err := h.db.Create(&session).Error; err != nil {
		http.Error(w, "Не удалось начать день: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"session": session,
	})
	return
}

func (h *Handler) TogglePauseWorkday(w http.ResponseWriter, r *http.Request) {
	user := h.currentUser(r)
	if user == nil {
		http.Error(w, "Требуется авторизация", http.StatusUnauthorized)
		return
	}
	var session domain.WorkSession
	if err := h.db.Where("user_id = ?", user.ID).Order("id DESC").First(&session).Error; err != nil {
		http.Error(w, "Сессия не найдена", http.StatusNotFound)
		return
	}
	if session.Status == "active" {
		now := time.Now()
		session.Status = "paused"
		session.PausedAt = &now
	} else if session.Status == "paused" {
		if session.PausedAt != nil {
			diff := int(time.Since(*session.PausedAt).Seconds())
			session.PausedDuration += diff
		}
		session.Status = "active"
		session.PausedAt = nil
	} else {
		http.Error(w, "Рабочий день уже завершён", http.StatusBadRequest)
		return
	}

	h.db.Save(&session)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"session": session,
	})
}

func (h *Handler) FinishWorkday(w http.ResponseWriter, r *http.Request) {
	user := h.currentUser(r)
	if user == nil {
		http.Error(w, "Требуется авторизация", http.StatusUnauthorized)
		return
	}

	var session domain.WorkSession
	if err := h.db.Where("user_id = ?", user.ID).Order("id DESC").First(&session).Error; err != nil {
		http.Error(w, "Сессия не найдена", http.StatusNotFound)
		return
	}
	if session.Status == "finished" {
		http.Error(w, "Рабочий день уже завершён", http.StatusBadRequest)
		return
	}
	if session.PausedAt != nil {
		session.PausedDuration += int(time.Since(*session.PausedAt).Seconds())
	}
	now := time.Now()
	session.Status = "finished"
	session.FinishedAt = &now
	session.PausedAt = nil

	h.db.Save(&session)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"session": session,
	})
}
