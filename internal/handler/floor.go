package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
	"strconv"

	"gorm.io/gorm"
)

type saveFloorPayload struct {
	Name       string             `json:"name"`
	Width      int                `json:"width"`
	Height     int                `json:"height"`
	Walls      []domain.Wall      `json:"walls"`
	Labels     []domain.RoomLabel `json:"labels"`
	Workplaces []domain.Workplace `json:"workplaces"`
}

type createFloorPayload struct {
	Name string `json:"name"`
}

func (h *Handler) SaveFloor(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	floorID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID этажа", http.StatusBadRequest)
		return
	}

	var payload saveFloorPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON в теле запроса", http.StatusBadRequest)
		return
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&domain.Floor{}).Where("id = ?", floorID).Updates(map[string]any{
			"name":   payload.Name,
			"width":  payload.Width,
			"height": payload.Height,
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("floor_id = ?", floorID).Delete(&domain.Wall{}).Error; err != nil {
			return err
		}
		if len(payload.Walls) > 0 {
			for i := range payload.Walls {
				payload.Walls[i].FloorID = uint(floorID)
				payload.Walls[i].ID = 0
			}
			if err := tx.Create(&payload.Walls).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("floor_id = ?", floorID).Delete(&domain.RoomLabel{}).Error; err != nil {
			return err
		}
		if len(payload.Labels) > 0 {
			for i := range payload.Labels {
				payload.Labels[i].FloorID = uint(floorID)
				payload.Labels[i].ID = 0
			}
			if err := tx.Create(&payload.Labels).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("floor_id = ?", floorID).Delete(&domain.Workplace{}).Error; err != nil {
			return err
		}
		if len(payload.Workplaces) > 0 {
			for i := range payload.Workplaces {
				payload.Workplaces[i].FloorID = uint(floorID)
				payload.Workplaces[i].ID = 0
			}
			if err := tx.Create(&payload.Workplaces).Error; err != nil {
				return err
			}
		}
		for _, wp := range payload.Workplaces {
			if wp.Employee != "" {
				if err := tx.Model(&domain.Employee{}).Where("full_name = ?", wp.Employee).Update("workplace_id", wp.ID).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})

	if err != nil {
		http.Error(w, "Ошибка сохранения этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok": true,
		"floor": map[string]any{
			"id":   floorID,
			"name": payload.Name,
		},
	})
}

func (h *Handler) CreateFloor(w http.ResponseWriter, r *http.Request) {
	var payload createFloorPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	if payload.Name == "" {
		payload.Name = "Новый этаж"
	}

	floor := domain.Floor{
		Name:   payload.Name,
		Width:  1200,
		Height: 600,
	}

	if err := h.db.Create(&floor).Error; err != nil {
		http.Error(w, "Ошибка создания этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"floor_id": floor.ID,
		"name":     payload.Name,
	})
}

func (h *Handler) DeleteFloor(w http.ResponseWriter, r *http.Request) {
	var count int64
	idStr := r.PathValue("id")
	floorID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID этажа", http.StatusBadRequest)
		return
	}

	h.db.Model(&domain.Floor{}).Count(&count)
	if count <= 1 {
		http.Error(w, "Нельзя удалить единственный этаж", http.StatusBadRequest)
		return
	}

	tx := h.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var wpIDs []uint
	if err := tx.Model(&domain.Workplace{}).
		Where("floor_id = ?", floorID).
		Pluck("id", &wpIDs).Error; err != nil {
		tx.Rollback()
		http.Error(w, "Ошибка поиска рабочих мест этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if len(wpIDs) > 0 {
		if err := tx.Model(&domain.Employee{}).
			Where("workplace_id IN ?", wpIDs).
			Update("workplace_id", nil).Error; err != nil {
			tx.Rollback()
			http.Error(w, "Ошибка отвязки сотрудников от рабочих мест: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Where("floor_id = ?", floorID).
		Delete(&domain.Workplace{}).Error; err != nil {
		tx.Rollback()
		http.Error(w, "Ошибка удаления рабочих мест этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Where("floor_id = ?", floorID).
		Delete(&domain.Wall{}).Error; err != nil {
		tx.Rollback()
		http.Error(w, "Ошибка удаления стен этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Where("floor_id = ?", floorID).
		Delete(&domain.RoomLabel{}).Error; err != nil {
		tx.Rollback()
		http.Error(w, "Ошибка удаления меток этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Delete(&domain.Floor{}, floorID).Error; err != nil {
		tx.Rollback()
		http.Error(w, "Ошибка при удалении этажа: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit().Error; err != nil {
		http.Error(w, "Ошибка фиксации транзакции: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}
