package repository

import (
	"PTracker/internal/domain"

	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error {
	err := db.AutoMigrate(
		&domain.Floor{},
		&domain.Wall{},
		&domain.RoomLabel{},
		&domain.Workplace{},
		&domain.Employee{},
		&domain.Task{},
	)
	if err != nil {
		return err
	}
	return nil
}
