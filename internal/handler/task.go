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
)

type createTaskPayload struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Creator     string `json:"creator"`
	Assignee    string `json:"assignee"`
	Workplace   any    `json:"workplace"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	Severity    string `json:"severity"`
	Screenshot  string `json:"screenshot"`
}

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
	var payload createTaskPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	payload.Title = strings.TrimSpace(payload.Title)
	if payload.Title == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Название задачи обязательно для заполнения",
		})
		return
	}

	if payload.Status == "" {
		payload.Status = "open"
	}

	var wpID *uint
	switch v := payload.Workplace.(type) {
	case float64:
		id := uint(v)
		if id > 0 {
			wpID = &id
		}
	case string:
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			id := uint(n)
			wpID = &id
		}
	}

	task := domain.Task{
		Title:       payload.Title,
		Description: payload.Description,
		Creator:     payload.Creator,
		Assignee:    payload.Assignee,
		Status:      payload.Status,
		Priority:    payload.Priority,
		Severity:    payload.Severity,
		Screenshot:  strings.TrimSpace(payload.Screenshot),
		WorkplaceID: wpID,
	}

	if err := h.db.Create(&task).Error; err != nil {
		http.Error(w, "Ошибка создания задачи: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.sse != nil {
		h.sse.Broadcast("task_created", task)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"task":    task,
	})
}

func deleteScreenshotFile(urlStr string) {
	cleanURL := strings.TrimSpace(urlStr)
	if cleanURL == "" {
		return
	}
	filename := filepath.Base(cleanURL)
	if filename == "" || filename == "." || filename == "/" || strings.Contains(filename, "..") {
		return
	}

	uploadDir := filepath.Join("web", "static", "uploads", "tasks")
	filePath := filepath.Join(uploadDir, filename)

	if _, err := os.Stat(filePath); err == nil {
		_ = os.Remove(filePath)
	}
}

func parseScreenshotsList(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	var result []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func (h *Handler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	taskID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID задачи", http.StatusBadRequest)
		return
	}
	var payload createTaskPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	var task domain.Task
	if err := h.db.First(&task, taskID).Error; err != nil {
		http.Error(w, "Задача не найдена", http.StatusNotFound)
		return
	}
	if payload.Title != "" {
		task.Title = payload.Title
	}
	if payload.Status != "" {
		task.Status = payload.Status
	}
	if payload.Severity != "" {
		task.Severity = payload.Severity
	}
	if payload.Priority != "" {
		task.Priority = payload.Priority
	}

	if payload.Workplace != nil {
		var wpID *uint
		switch v := payload.Workplace.(type) {
		case float64:
			id := uint(v)
			if id > 0 {
				wpID = &id
			}
		case string:
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				id := uint(n)
				wpID = &id
			}
		}
		task.WorkplaceID = wpID
	}
	task.Description = payload.Description
	if payload.Creator != "" {
		task.Creator = payload.Creator
	}
	task.Assignee = payload.Assignee

	// Если задача закрывается (status == "closed"):
	// автоматически удаляем все скриншоты с сервера и очищаем поле screenshot
	if task.Status == "closed" {
		oldScreenshots := parseScreenshotsList(task.Screenshot)
		for _, url := range oldScreenshots {
			deleteScreenshotFile(url)
		}
		newScreenshots := parseScreenshotsList(payload.Screenshot)
		for _, url := range newScreenshots {
			deleteScreenshotFile(url)
		}
		task.Screenshot = ""
	} else {
		// Если задача не закрыта, но пользователь удалил часть скриншотов
		oldShots := parseScreenshotsList(task.Screenshot)
		newShotsMap := make(map[string]bool)
		for _, s := range parseScreenshotsList(payload.Screenshot) {
			newShotsMap[s] = true
		}
		for _, old := range oldShots {
			if !newShotsMap[old] {
				deleteScreenshotFile(old)
			}
		}
		task.Screenshot = strings.TrimSpace(payload.Screenshot)
	}

	if err := h.db.Save(&task).Error; err != nil {
		http.Error(w, "Ошибка редактирования задачи: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.sse != nil {
		h.sse.Broadcast("task_updated", task)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"task":    task,
	})
}

func (h *Handler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	taskID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID задачи", http.StatusBadRequest)
		return
	}

	var task domain.Task
	if err := h.db.First(&task, taskID).Error; err == nil {
		for _, s := range parseScreenshotsList(task.Screenshot) {
			deleteScreenshotFile(s)
		}
	}

	if err := h.db.Delete(&domain.Task{}, taskID).Error; err != nil {
		http.Error(w, "Ошибка удаления задачи: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.sse != nil {
		h.sse.Broadcast("task_deleted", map[string]any{"id": taskID})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

type deleteScreenshotPayload struct {
	URL    string `json:"url"`
	TaskID *uint  `json:"task_id"`
}

func (h *Handler) DeleteTaskScreenshot(w http.ResponseWriter, r *http.Request) {
	var payload deleteScreenshotPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	deleteScreenshotFile(payload.URL)

	if payload.TaskID != nil && *payload.TaskID > 0 {
		var task domain.Task
		if err := h.db.First(&task, *payload.TaskID).Error; err == nil {
			shots := parseScreenshotsList(task.Screenshot)
			var updated []string
			for _, s := range shots {
				if s != strings.TrimSpace(payload.URL) {
					updated = append(updated, s)
				}
			}
			task.Screenshot = strings.Join(updated, ",")
			h.db.Save(&task)
			if h.sse != nil {
				h.sse.Broadcast("task_updated", task)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true})
}

func (h *Handler) TaskEvents(w http.ResponseWriter, r *http.Request) {
	if h.sse != nil {
		h.sse.ServeHTTP(w, r)
	} else {
		http.Error(w, "SSE сервис недоступен", http.StatusServiceUnavailable)
	}
}

func (h *Handler) UploadTaskScreenshot(w http.ResponseWriter, r *http.Request) {
	// Максимальный размер 15 МБ
	if err := r.ParseMultipartForm(15 << 20); err != nil {
		http.Error(w, "Файл слишком большой (максимум 15 МБ)", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("screenshot")
	if err != nil {
		file, header, err = r.FormFile("file")
		if err != nil {
			http.Error(w, "Файл изображения не передан", http.StatusBadRequest)
			return
		}
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".png"
	}
	allowedExts := map[string]bool{
		".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true,
	}
	if !allowedExts[ext] {
		http.Error(w, "Недопустимый формат файла (разрешены png, jpg, jpeg, webp, gif)", http.StatusBadRequest)
		return
	}

	uploadDir := filepath.Join("web", "static", "uploads", "tasks")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		http.Error(w, "Ошибка создания директории загрузки: "+err.Error(), http.StatusInternalServerError)
		return
	}

	fileName := fmt.Sprintf("task_%d_%d%s", time.Now().Unix(), time.Now().UnixNano()%100000, ext)
	destPath := filepath.Join(uploadDir, fileName)
	dst, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "Ошибка сохранения файла: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "Ошибка записи файла: "+err.Error(), http.StatusInternalServerError)
		return
	}

	url := "/static/uploads/tasks/" + fileName
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"url":     url,
	})
}
