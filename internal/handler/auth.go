package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
	"strings"

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

func (h *Handler) currentAuth(r *http.Request) map[string]any {
	cookie, err := r.Cookie("session_user")
	if err != nil || cookie.Value == "" {
		return map[string]any{
			"is_authenticated": false,
			"username":         "",
			"is_admin":         false,
		}
	}
	var user domain.User
	if err := h.db.Preload("Employee").Where("username = ?", cookie.Value).First(&user).Error; err == nil {
		empName := ""
		var wpID *uint
		isMTO := false
		if user.Employee != nil {
			empName = user.Employee.FullName
			wpID = user.Employee.WorkplaceID
			dept := strings.ToLower(user.Employee.Department)
			pos := strings.ToLower(user.Employee.Position)
			if strings.Contains(dept, "МТО") || strings.Contains(pos, "МТО") {
				isMTO = true
			}
		}
		return map[string]any{
			"is_authenticated": true,
			"username":         user.Username,
			"is_admin":         user.IsAdmin,
			"is_mto":           isMTO || user.IsAdmin,
			"user_id":          user.ID,
			"employee_name":    empName,
			"workplace_id":     wpID,
		}
	}
	return map[string]any{
		"is_authenticated": false,
		"username":         "",
		"is_admin":         false,
	}
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session_user",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

func (h *Handler) RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := h.currentAuth(r)
		isAdmin, _ := auth["is_admin"].(bool)
		if !isAdmin {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]any{
				"success": false,
				"error":   "Доступ запрещён: требуются права администратора",
			})
			return
		}
		// Если админ — передаём управление дальше целевому обработчику
		next(w, r)
	}
}

func (h *Handler) currentUser(r *http.Request) *domain.User {
	cookie, err := r.Cookie("session_user")
	if err != nil || cookie.Value == "" {
		return nil
	}
	var user domain.User
	if err := h.db.Where("username = ?", cookie.Value).First(&user).Error; err == nil {
		return &user
	}
	return nil
}
