package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func saveUploadedPhoto(r *http.Request, empID uint) (string, error) {
	if err := os.MkdirAll("web/static/uploads", 0755); err != nil {
		return "", err
	}
	file, header, err := r.FormFile("photo")
	if err != nil {
		return "", nil
	}
	defer file.Close()
	extension := filepath.Ext(header.Filename)
	fileName := fmt.Sprintf("emp_%d_%d%s", empID, time.Now().UnixNano(), extension)
	destPath := filepath.Join("web", "static", "uploads", fileName)
	dst, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		return "", err
	}
	return "/static/uploads/" + fileName, nil
}

func (h *Handler) saveUserCredentials(empID uint, username, password string) error {
	if username == "" && password == "" {
		return nil // логин и пароль не переданы — ничего не делаем
	}
	var user domain.User
	err := h.db.Where("employee_id = ?", empID).First(&user).Error
	if err == nil {
		// 1. Пользователь уже существует — обновляем логин и/или пароль
		if username != "" {
			user.Username = username
		}
		if password != "" {
			// Если пришёл новый пароль — обновляем хеш
			hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			user.PasswordHash = string(hash)
		}
		return h.db.Save(&user).Error
	}
	if username == "" {
		return nil
	}
	// 2. Пользователя ещё нет — создаём новую учётку
	var hash []byte
	if password != "" {
		var err error
		hash, err = bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
	}
	newUser := domain.User{
		EmployeeID:   &empID,
		Username:     username,
		PasswordHash: string(hash),
		IsAdmin:      false,
	}
	return h.db.Create(&newUser).Error
}

func (h *Handler) GetEmployees(w http.ResponseWriter, r *http.Request) {
	var employees []domain.Employee
	if err := h.db.Preload("Workplace").Preload("User").Preload("InventoryItems").Order("full_name ASC").Find(&employees).Error; err != nil {
		http.Error(w, "Ошибка полученяи сотрудников"+err.Error(), http.StatusInternalServerError)
		return
	}
	auth := h.currentAuth(r)
	isAdmin, _ := auth["is_admin"].(bool)
	for i := range employees {
		employees[i].CanEdit = isAdmin
	}

	var departments []string
	h.db.Model(&domain.Employee{}).Distinct("department").Order("department ASC").Pluck("department", &departments)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"employees":   employees,
		"departments": departments,
		"auth":        h.currentAuth(r),
	})

}

func (h *Handler) UpdateEmployee(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	employeeID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID сотрудника", http.StatusBadRequest)
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Ошибка чтения формы", http.StatusBadRequest)
		return
	}

	auth := h.currentAuth(r)
	isAdmin, _ := auth["is_admin"].(bool)
	currentUserID, _ := auth["user_id"].(uint)
	currentEmpName, _ := auth["employee_name"].(string)

	var emp domain.Employee
	if err := h.db.Preload("User").First(&emp, employeeID).Error; err != nil {
		http.Error(w, "Сотрудник не найден", http.StatusNotFound)
		return
	}

	isSelf := false
	if emp.User != nil && emp.User.ID == currentUserID {
		isSelf = true
	} else if currentEmpName != "" && strings.EqualFold(strings.TrimSpace(currentEmpName), strings.TrimSpace(emp.FullName)) {
		isSelf = true
	}

	if !isAdmin && !isSelf {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Доступ запрещён: редактировать карточку может только сам сотрудник или администратор",
		})
		return
	}

	if fn := r.FormValue("full_name"); fn != "" {
		emp.FullName = fn
	}
	if pos := r.FormValue("position"); pos != "" || isAdmin {
		emp.Position = pos
	}
	if dept := r.FormValue("department"); dept != "" || isAdmin {
		emp.Department = dept
	}
	emp.WorkPhone = r.FormValue("work_phone")
	emp.Email = r.FormValue("email")
	if isAdmin {
		emp.Equipment = r.FormValue("equipment")
		wpStr := r.FormValue("workplace_id")
		if wpStr == "" {
			emp.WorkplaceID = nil
		} else if wpID, err := strconv.Atoi(wpStr); err == nil {
			id := uint(wpID)
			emp.WorkplaceID = &id
		}
		h.saveUserCredentials(emp.ID, r.FormValue("username"), r.FormValue("password"))
	} else if r.FormValue("password") != "" {
		h.saveUserCredentials(emp.ID, "", r.FormValue("password"))
	}

	if r.FormValue("delete_photo") == "true" {
		emp.Photo = ""
	}
	if photoURL, err := saveUploadedPhoto(r, uint(emp.ID)); err == nil && photoURL != "" {
		emp.Photo = photoURL
	}

	if err := h.db.Save(&emp).Error; err != nil {
		http.Error(w, "Ошибка сохранения: "+err.Error(), http.StatusInternalServerError)
		return
	}

	emp.CanEdit = true
	h.db.Preload("Workplace").Preload("User").Preload("InventoryItems").First(&emp, employeeID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":  true,
		"employee": emp,
	})
}

func (h *Handler) CreateEmployee(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Ошибка чтения формы", http.StatusBadRequest)
		return
	}
	fullName := r.FormValue("full_name")
	if fullName == "" {
		http.Error(w, "ФИО обязательно", http.StatusBadRequest)
		return
	}
	wpStr := r.FormValue("workplace_id")
	emp := domain.Employee{
		FullName:   fullName,
		Position:   r.FormValue("position"),
		Department: r.FormValue("department"),
		WorkPhone:  r.FormValue("work_phone"),
		Email:      r.FormValue("email"),
		Equipment:  r.FormValue("equipment"),
	}
	if wpStr == "" {
		emp.WorkplaceID = nil
	} else if wpID, err := strconv.Atoi(wpStr); err == nil {
		id := uint(wpID)
		emp.WorkplaceID = &id
	}

	if err := h.db.Create(&emp).Error; err != nil {
		http.Error(w, "Ошибка создания сотрудника: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if photoURL, err := saveUploadedPhoto(r, uint(emp.ID)); err == nil && photoURL != "" {
		emp.Photo = photoURL
		h.db.Model(&emp).Update("photo", photoURL)
	}

	if emp.WorkplaceID != nil {
		h.db.Preload("Workplace").First(&emp, emp.ID)
	}
	emp.CanEdit = true

	h.saveUserCredentials(emp.ID, r.FormValue("username"), r.FormValue("password"))
	h.db.Preload("Workplace").Preload("User").Preload("InventoryItems").First(&emp, emp.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":  true,
		"employee": emp,
	})
}
