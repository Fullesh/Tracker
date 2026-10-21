package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"

	"golang.org/x/crypto/bcrypt"
)

type loginPayload struct {
	Username string
	Password string
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var payload loginPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	var user domain.User
	if err := h.db.Where("username = ?", payload.Username).First(&user).Error; err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(payload.Password)) != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Неверный логин или пароль",
		})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session_user",
		Value:    user.Username,
		Path:     "/",
		HttpOnly: true,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"user": map[string]any{
			"username": user.Username,
			"is_admin": user.IsAdmin,
		},
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	return
}
