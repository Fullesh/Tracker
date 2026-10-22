package repository

import (
	"PTracker/internal/domain"

	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error {
	if db.Migrator().HasTable(&domain.Employee{}) && db.Migrator().HasTable(&domain.Workplace{}) {
		db.Exec("UPDATE employees SET workplace_id = NULL WHERE workplace_id IS NOT NULL AND workplace_id NOT IN (SELECT id FROM workplaces)")
	}
	err := db.AutoMigrate(
		&domain.Floor{},
		&domain.Wall{},
		&domain.RoomLabel{},
		&domain.Workplace{},
		&domain.Employee{},
		&domain.Task{},
		&domain.User{},
		&domain.WorkSession{},
		&domain.InventoryItem{},
	)
	if err != nil {
		return err
	}
	return nil
}
