package seed

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"PTracker/internal/domain"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type fngResponse struct {
	Data []struct {
		Name struct {
			Full string `json:"full"`
		} `json:"name"`
		Email string `json:"email"`
		Phone struct {
			Number string `json:"number"`
		} `json:"phone"`
		Occupation string `json:"occupation"`
		Company    string `json:"company"`
		Portrait   struct {
			UrlJPG string `json:"url_jpg"`
		} `json:"portrait"`
	} `json:"data"`
}

type roomDef struct {
	Name string
	Kind string
	X1   int
	Y1   int
	X2   int
	Y2   int
}

var fallbackEmployees = []domain.Employee{
	{
		FullName:   "Константин Воронов",
		Position:   "Генеральный директор",
		Department: "Кабинет директора",
		WorkPhone:  "+7 (495) 100-01-01",
		Email:      "voronov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300",
	},
	{
		FullName:   "Анастасия Лебедева",
		Position:   "Главный бухгалтер",
		Department: "Бухгалтерия и кадры",
		WorkPhone:  "+7 (495) 100-01-02",
		Email:      "lebedeva@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300",
	},
	{
		FullName:   "Елена Смирнова",
		Position:   "HR-менеджер",
		Department: "Бухгалтерия и кадры",
		WorkPhone:  "+7 (495) 100-01-03",
		Email:      "smirnova@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300",
	},
	{
		FullName:   "Дмитрий Соколов",
		Position:   "Руководитель отдела продаж",
		Department: "Отдел продаж",
		WorkPhone:  "+7 (495) 100-01-04",
		Email:      "sokolov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300",
	},
	{
		FullName:   "Ольга Кузнецова",
		Position:   "Менеджер по продажам",
		Department: "Отдел продаж",
		WorkPhone:  "+7 (495) 100-01-05",
		Email:      "kuznetsova@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300",
	},
	{
		FullName:   "Максим Новиков",
		Position:   "Менеджер по работе с клиентами",
		Department: "Отдел продаж",
		WorkPhone:  "+7 (495) 100-01-06",
		Email:      "novikov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=300",
	},
	{
		FullName:   "Павел Белов",
		Position:   "Lead Frontend Engineer",
		Department: "Frontend & Mobile",
		WorkPhone:  "+7 (495) 100-02-01",
		Email:      "belov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300",
	},
	{
		FullName:   "Ирина Морозова",
		Position:   "Frontend Developer",
		Department: "Frontend & Mobile",
		WorkPhone:  "+7 (495) 100-02-02",
		Email:      "morozova@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300",
	},
	{
		FullName:   "Артём Васильев",
		Position:   "iOS / Android Developer",
		Department: "Frontend & Mobile",
		WorkPhone:  "+7 (495) 100-02-03",
		Email:      "vasiliev@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300",
	},
	{
		FullName:   "Иван Петров",
		Position:   "Lead Backend Developer",
		Department: "Backend & DevOps",
		WorkPhone:  "+7 (495) 100-02-04",
		Email:      "petrov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300",
	},
	{
		FullName:   "Роман Зайцев",
		Position:   "DevOps Engineer / SRE",
		Department: "Backend & DevOps",
		WorkPhone:  "+7 (495) 100-02-05",
		Email:      "zaytsev@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300",
	},
	{
		FullName:   "Сергей Ковалёв",
		Position:   "Golang Backend Developer",
		Department: "Backend & DevOps",
		WorkPhone:  "+7 (495) 100-02-06",
		Email:      "kovalev@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300",
	},
	{
		FullName:   "Татьяна Федорова",
		Position:   "QA Lead",
		Department: "Отдел QA и тестирование",
		WorkPhone:  "+7 (495) 100-02-07",
		Email:      "fedorova@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=300",
	},
	{
		FullName:   "Виктор Михайлов",
		Position:   "QA Automation Engineer",
		Department: "Отдел QA и тестирование",
		WorkPhone:  "+7 (495) 100-02-08",
		Email:      "mikhailov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=300",
	},
	{
		FullName:   "Никита Орлов",
		Position:   "Системный администратор",
		Department: "Техническая поддержка",
		WorkPhone:  "+7 (495) 100-02-09",
		Email:      "orlov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1513956589380-bad6acb9b9d4?w=300",
	},
	{
		FullName:   "Денис Попов",
		Position:   "Специалист техподдержки",
		Department: "Техническая поддержка",
		WorkPhone:  "+7 (495) 100-02-10",
		Email:      "popov@ptracker.local",
		Photo:      "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300",
	},
}

// Seed — главная точка входа для наполнения базы первичными данными
func Seed(db *gorm.DB) error {
	// 1. Проверяем и генерируем сотрудников
	if err := seedEmployees(db); err != nil {
		return fmt.Errorf("ошибка наполнения сотрудников: %w", err)
	}

	// 2. Проверяем и генерируем этажи, стены и столы
	if err := seedFloors(db); err != nil {
		return fmt.Errorf("ошибка наполнения этажей: %w", err)
	}

	// 3. Создаем учетную запись администратора
	if err := seedAdmin(db); err != nil {
		return fmt.Errorf("ошибка создания админа: %w", err)
	}

	// 4. Создаем демонстрационные задачи
	if err := seedTasks(db); err != nil {
		return fmt.Errorf("ошибка создания задач: %w", err)
	}

	// 5. Генерируем инвентарь (мониторы, ПК, ноутбуки, МФУ, серверные стойки)
	if err := seedInventory(db); err != nil {
		return fmt.Errorf("ошибка наполнения инвентаря: %w", err)
	}

	// 6. Генерируем учетные записи для всех сотрудников и выводим таблицу
	if err := seedUsers(db); err != nil {
		return fmt.Errorf("ошибка создания пользователей: %w", err)
	}

	log.Println("Наполнение базы данных успешно завершено!")
	return nil
}

func seedEmployees(db *gorm.DB) error {
	var count int64
	if err := db.Model(&domain.Employee{}).Count(&count).Error; err != nil {
		return err
	}

	if count > 0 {
		log.Printf("В базе уже есть %d сотрудников, пропускаем генерацию из API", count)
		return nil
	}

	var employees []domain.Employee

	apiKey := os.Getenv("FNG_API_KEY")
	if apiKey != "" && apiKey != "fng_live..." {
		client := &http.Client{Timeout: 5 * time.Second}
		url := "https://www.fakenamegenerator.com/api/v1/identities?count=20&country=ru-cyrl&name_set=russian"

		req, err := http.NewRequest("GET", url, nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+apiKey)
			resp, err := client.Do(req)
			if err == nil && resp.StatusCode == http.StatusOK {
				var apiResult fngResponse
				if err := json.NewDecoder(resp.Body).Decode(&apiResult); err == nil && len(apiResult.Data) > 0 {
					for _, p := range apiResult.Data {
						emp := domain.Employee{
							FullName:   p.Name.Full,
							Photo:      p.Portrait.UrlJPG,
							Position:   p.Occupation,
							Department: p.Company,
							WorkPhone:  p.Phone.Number,
							Email:      p.Email,
						}
						employees = append(employees, emp)
					}
					log.Printf("Загружено %d сотрудников из Fake Name Generator API", len(employees))
				}
				resp.Body.Close()
			}
		}
	}

	if len(employees) == 0 {
		log.Printf("Используем встроенный список сотрудников (%d сотрудников)", len(fallbackEmployees))
		employees = make([]domain.Employee, len(fallbackEmployees))
		copy(employees, fallbackEmployees)
	}

	if err := db.Create(&employees).Error; err != nil {
		return fmt.Errorf("ошибка сохранения сотрудников в БД: %w", err)
	}
	log.Printf("Успешно сохранено %d сотрудников в PostgreSQL!", len(employees))
	return nil
}

func seedFloors(db *gorm.DB) error {
	var floorCount int64
	if err := db.Model(&domain.Floor{}).Count(&floorCount).Error; err != nil {
		return err
	}

	if floorCount > 0 {
		log.Printf("В базе уже есть %d этажей, пропускаем генерацию карт", floorCount)
		return nil
	}

	// Загружаем всех сотрудников из базы для рассадки за столы
	var allEmployees []domain.Employee
	db.Order("id asc").Find(&allEmployees)
	empIndex := 0

	// Описываем 2 этажа со своими планировками
	floorsPlan := []struct {
		Name   string
		Order  int
		Width  int
		Height int
		Rooms  []roomDef
	}{
		{
			Name:   "1 этаж (Главный офис)",
			Order:  1,
			Width:  1200,
			Height: 700,
			Rooms: []roomDef{
				{Name: "Отдел продаж", Kind: "pc", X1: 70, Y1: 70, X2: 430, Y2: 320},
				{Name: "Бухгалтерия и кадры", Kind: "pc", X1: 490, Y1: 70, X2: 830, Y2: 320},
				{Name: "Кабинет директора", Kind: "pc", X1: 890, Y1: 70, X2: 1130, Y2: 320},
				{Name: "Зона отдыха и кухня", Kind: "meeting", X1: 70, Y1: 400, X2: 390, Y2: 630},
				{Name: "Большая переговорная", Kind: "meeting", X1: 450, Y1: 400, X2: 830, Y2: 630},
				{Name: "Серверная стойка", Kind: "server", X1: 890, Y1: 400, X2: 1130, Y2: 630},
			},
		},
		{
			Name:   "2 этаж (Разработка и IT)",
			Order:  2,
			Width:  1200,
			Height: 700,
			Rooms: []roomDef{
				{Name: "Frontend & Mobile", Kind: "pc", X1: 70, Y1: 70, X2: 450, Y2: 320},
				{Name: "Backend & DevOps", Kind: "pc", X1: 510, Y1: 70, X2: 870, Y2: 320},
				{Name: "Серверная комната #2", Kind: "server", X1: 930, Y1: 70, X2: 1130, Y2: 320},
				{Name: "Отдел QA и тестирование", Kind: "pc", X1: 70, Y1: 400, X2: 510, Y2: 630},
				{Name: "Малая переговорная", Kind: "meeting", X1: 570, Y1: 400, X2: 850, Y2: 630},
				{Name: "Техническая поддержка", Kind: "pc", X1: 910, Y1: 400, X2: 1130, Y2: 630},
			},
		},
	}

	for _, fp := range floorsPlan {
		// 1. Создаем этаж
		floor := domain.Floor{
			Name:   fp.Name,
			Order:  fp.Order,
			Width:  fp.Width,
			Height: fp.Height,
		}
		if err := db.Create(&floor).Error; err != nil {
			return fmt.Errorf("ошибка создания этажа %s: %w", fp.Name, err)
		}
		log.Printf("Создан этаж: %s (ID: %d)", floor.Name, floor.ID)

		// 2. Создаем 4 внешние стены здания
		outerWalls := []domain.Wall{
			{FloorID: floor.ID, X1: 40, Y1: 40, X2: fp.Width - 40, Y2: 40},
			{FloorID: floor.ID, X1: fp.Width - 40, Y1: 40, X2: fp.Width - 40, Y2: fp.Height - 40},
			{FloorID: floor.ID, X1: fp.Width - 40, Y1: fp.Height - 40, X2: 40, Y2: fp.Height - 40},
			{FloorID: floor.ID, X1: 40, Y1: fp.Height - 40, X2: 40, Y2: 40},
		}
		if err := db.Create(&outerWalls).Error; err != nil {
			return err
		}

		deskNumber := 1

		// 3. Создаем каждый кабинет
		for _, room := range fp.Rooms {
			// Стены кабинета (4 перегородки)
			roomWalls := []domain.Wall{
				{FloorID: floor.ID, X1: room.X1, Y1: room.Y1, X2: room.X2, Y2: room.Y1},
				{FloorID: floor.ID, X1: room.X2, Y1: room.Y1, X2: room.X2, Y2: room.Y2},
				{FloorID: floor.ID, X1: room.X2, Y1: room.Y2, X2: room.X1, Y2: room.Y2},
				{FloorID: floor.ID, X1: room.X1, Y1: room.Y2, X2: room.X1, Y2: room.Y1},
			}
			if err := db.Create(&roomWalls).Error; err != nil {
				return err
			}

			// Подпись кабинета по центру
			label := domain.RoomLabel{
				FloorID: floor.ID,
				Text:    room.Name,
				X:       (room.X1 + room.X2) / 2,
				Y:       room.Y1 + 30,
			}
			if err := db.Create(&label).Error; err != nil {
				return err
			}

			// 4. Расстановка столов строго ВНУТРИ стен кабинета
			stepX := 95
			stepY := 85

			for y := room.Y1 + 75; y <= room.Y2-55; y += stepY {
				for x := room.X1 + 65; x <= room.X2-55; x += stepX {
					code := fmt.Sprintf("%d-%02d", floor.Order, deskNumber)
					deskNumber++

					wp := domain.Workplace{
						FloorID: floor.ID,
						Code:    code,
						Kind:    room.Kind,
						Room:    room.Name,
						X:       x,
						Y:       y,
					}

					// Если комната рабочая и есть сотрудники в пуле — сажаем сотрудника
					if room.Kind == "pc" && empIndex < len(allEmployees) {
						emp := &allEmployees[empIndex]
						wp.Employee = emp.FullName

						if err := db.Create(&wp).Error; err != nil {
							return err
						}

						// Привязываем сотрудника к созданному столу
						emp.WorkplaceID = &wp.ID
						db.Model(emp).Update("workplace_id", wp.ID)
						empIndex++
					} else {
						if room.Kind == "server" {
							wp.Label = "Стойка"
						} else if room.Kind == "meeting" {
							wp.Label = "Место переговоров"
						}
						if err := db.Create(&wp).Error; err != nil {
							return err
						}
					}
				}
			}
		}

		// Добавляем принтер в центральный коридор этажа
		printerWP := domain.Workplace{
			FloorID: floor.ID,
			Code:    fmt.Sprintf("%d-PRN", floor.Order),
			IP:      fmt.Sprintf("192.168.10.%d", 20+floor.Order),
			Kind:    "printer",
			Label:   "МФУ Kyocera",
			Room:    "Коридор",
			X:       fp.Width / 2,
			Y:       fp.Height / 2,
		}
		db.Create(&printerWP)
	}

	log.Printf("Карты этажей, стены, подписи и рабочие места успешно сгенерированы!")
	return nil
}

func seedAdmin(db *gorm.DB) error {
	var count int64
	db.Model(&domain.User{}).Where("username = ?", "admin").Count(&count)
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	admin := domain.User{
		Username:     "admin",
		PasswordHash: string(hash),
		IsAdmin:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		return err
	}
	return nil
}

func seedTasks(db *gorm.DB) error {
	var count int64
	db.Model(&domain.Task{}).Count(&count)
	if count > 0 {
		return nil
	}
	var workplaces []domain.Workplace
	db.Order("id ASC").Limit(10).Find(&workplaces)

	wpID := func(index int) *uint {
		if index < len(workplaces) {
			return &workplaces[index].ID
		}
		return nil
	}

	tasks := []domain.Task{
		{
			Title:       "Перегрев стойки R2",
			Description: "Температура на входе 34°C, сработал алерт мониторинга.",
			Creator:     "system",
			Assignee:    "2",
			Status:      "in_progress",
			Priority:    "blocker",
			Severity:    "s1",
			WorkplaceID: wpID(0),
		},
		{
			Title:       "Не печатает МФУ",
			Description: "Ошибка «Замятие бумаги», хотя бумаги внутри нет.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "open",
			Priority:    "high",
			Severity:    "s2",
			WorkplaceID: wpID(1),
		},
		{
			Title:       "Нет доступа к 1С",
			Description: "После обновления пароля не пускает в базу.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "open",
			Priority:    "critical",
			Severity:    "s2",
			WorkplaceID: wpID(2),
		},
		{
			Title:       "Мерцает монитор",
			Description: "Периодически гаснет экран при шевелении провода HDMI.",
			Creator:     "system",
			Assignee:    "2",
			Status:      "open",
			Priority:    "normal",
			Severity:    "s3",
			WorkplaceID: wpID(3),
		},
		{
			Title:       "Не работает ВКС в «Казани»",
			Description: "Камера не определяется в Телемосте.",
			Creator:     "system",
			Assignee:    "2",
			Status:      "review",
			Priority:    "high",
			Severity:    "s3",
			WorkplaceID: wpID(4),
		},
		{
			Title:       "Установить второй монитор",
			Description: "Запрос от руководителя для работы с таблицами.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "open",
			Priority:    "low",
			Severity:    "s4",
			WorkplaceID: wpID(5),
		},
		{
			Title:       "Заменить клавиатуру",
			Description: "Залипает клавиша пробел.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "closed",
			Priority:    "low",
			Severity:    "s4",
			WorkplaceID: wpID(6),
		},
	}

	if err := db.Create(&tasks).Error; err != nil {
		return err
	}
	log.Println("Демо-задачи успешно созданы")
	return nil
}

func seedInventory(db *gorm.DB) error {
	var count int64
	if err := db.Model(&domain.InventoryItem{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		log.Printf("В базе уже есть %d позиций инвентаря, пропускаем сидирование инвентаря", count)
		return nil
	}

	var items []domain.InventoryItem

	// 1. Оборудование сотрудников (занятые столы)
	var seatedEmployees []domain.Employee
	if err := db.Preload("Workplace").Where("workplace_id IS NOT NULL").Order("id ASC").Find(&seatedEmployees).Error; err != nil {
		return err
	}

	for i, emp := range seatedEmployees {
		wpCode := "STOCK"
		if emp.Workplace != nil && emp.Workplace.Code != "" {
			wpCode = emp.Workplace.Code
		}

		// Монитор
		monitorName := "Монитор Dell 24\" P2419H"
		if i%2 == 1 {
			monitorName = "Монитор Philips 27\" 273V7QJAB"
		}
		items = append(items, domain.InventoryItem{
			InventoryNumber: fmt.Sprintf("INV_MO_%s_01", wpCode),
			Name:            monitorName,
			Category:        "Монитор",
			TypeCode:        "MO",
			Status:          "assigned",
			WorkplaceCode:   wpCode,
			EmployeeID:      &emp.ID,
			Notes:           fmt.Sprintf("Рабочее место: %s", wpCode),
		})

		// ПК или ноутбук
		var compName, compCat, compType string
		if strings.Contains(emp.Department, "Frontend") || strings.Contains(emp.Department, "Backend") {
			compName = "Ноутбук Lenovo ThinkPad L14 Gen 3"
			compCat = "Ноутбук"
			compType = "NB"
		} else {
			compName = "Системный блок HP ProDesk 400 G6"
			compCat = "Компьютер"
			compType = "PC"
		}

		items = append(items, domain.InventoryItem{
			InventoryNumber: fmt.Sprintf("INV_%s_%s_01", compType, wpCode),
			Name:            compName,
			Category:        compCat,
			TypeCode:        compType,
			Status:          "assigned",
			WorkplaceCode:   wpCode,
			EmployeeID:      &emp.ID,
			Notes:           fmt.Sprintf("Рабочее место: %s", wpCode),
		})

		// Заполняем поле Equipment сотрудника
		empEquipment := fmt.Sprintf("%s, %s", monitorName, compName)
		db.Model(&emp).Update("equipment", empEquipment)
	}

	// 2. Сетевые принтеры
	var printers []domain.Workplace
	db.Where("kind = ?", "printer").Order("id ASC").Find(&printers)
	for _, prn := range printers {
		items = append(items, domain.InventoryItem{
			InventoryNumber: fmt.Sprintf("INV_PR_%s_01", prn.Code),
			Name:            "Сетевое МФУ Kyocera ECOSYS M2040dn",
			Category:        "Оргтехника",
			TypeCode:        "PR",
			IP:              prn.IP,
			Status:          "assigned",
			WorkplaceCode:   prn.Code,
			Notes:           fmt.Sprintf("Коридор этажа (IP: %s)", prn.IP),
		})
	}

	// 3. Серверные стойки и сетевое оборудование (по 4 юнита на каждую стойку)
	var racks []domain.Workplace
	db.Where("kind = ?", "server").Order("id ASC").Find(&racks)
	for rackIdx, rack := range racks {
		rackDevices := []struct {
			name     string
			category string
			typeCode string
			ip       string
		}{
			{name: "Коммутатор Cisco Catalyst 2960-X", category: "Сетевое оборудование", typeCode: "NW", ip: fmt.Sprintf("192.168.1.%d", 10+rackIdx*10+1)},
			{name: "Маршрутизатор MikroTik CCR1009", category: "Сетевое оборудование", typeCode: "NW", ip: fmt.Sprintf("192.168.1.%d", 10+rackIdx*10+2)},
			{name: "Сервер Dell PowerEdge R640", category: "Другое", typeCode: "EQ", ip: fmt.Sprintf("192.168.1.%d", 10+rackIdx*10+3)},
			{name: "ИБП APC Smart-UPS 3000VA", category: "Другое", typeCode: "EQ", ip: fmt.Sprintf("192.168.1.%d", 10+rackIdx*10+4)},
		}

		for devIdx, dev := range rackDevices {
			items = append(items, domain.InventoryItem{
				InventoryNumber: fmt.Sprintf("INV_%s_%s_%02d", dev.typeCode, rack.Code, devIdx+1),
				Name:            dev.name,
				Category:        dev.category,
				TypeCode:        dev.typeCode,
				IP:              dev.ip,
				Status:          "assigned",
				WorkplaceCode:   rack.Code,
				Notes:           fmt.Sprintf("Стойка %s (%s)", rack.Code, rack.Room),
			})
		}
	}

	if len(items) > 0 {
		if err := db.CreateInBatches(&items, 100).Error; err != nil {
			return fmt.Errorf("ошибка создания позиций инвентаря: %w", err)
		}
		log.Printf("Успешно создано %d позиций инвентаря и сетевого оборудования!", len(items))
	}
	return nil
}

type userRow struct {
	id       uint
	name     string
	position string
	login    string
	pass     string
}

func seedUsers(db *gorm.DB) error {
	var count int64
	db.Model(&domain.User{}).Where("username != ?", "admin").Count(&count)
	if count > 0 {
		log.Printf("В базе уже создано %d пользователей, пропускаем сидирование учетных записей", count)
		return nil
	}

	var employees []domain.Employee
	if err := db.Order("id ASC").Find(&employees).Error; err != nil {
		return err
	}
	if len(employees) == 0 {
		return nil
	}

	defaultPassword := "Welcome123!"
	hash, err := bcrypt.GenerateFromPassword([]byte(defaultPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("ошибка генерации хеша пароля: %w", err)
	}
	hashStr := string(hash)

	var rows []userRow
	usedLogins := make(map[string]int)

	for _, emp := range employees {
		login := generateLogin(emp.FullName)
		if n, exists := usedLogins[login]; exists {
			usedLogins[login] = n + 1
			login = fmt.Sprintf("%s%d", login, n+1)
		} else {
			usedLogins[login] = 1
		}

		u := domain.User{
			EmployeeID:   &emp.ID,
			Username:     login,
			PasswordHash: hashStr,
			IsAdmin:      false,
		}
		if err := db.Create(&u).Error; err != nil {
			return fmt.Errorf("ошибка создания пользователя %s: %w", login, err)
		}

		rows = append(rows, userRow{
			id:       emp.ID,
			name:     emp.FullName,
			position: emp.Position,
			login:    login,
			pass:     defaultPassword,
		})
	}

	printUsersTable(rows)
	return nil
}

func generateLogin(fullName string) string {
	parts := strings.Fields(fullName)
	if len(parts) == 0 {
		return "user"
	}
	if len(parts) == 1 {
		tr := transliterate(parts[0])
		if tr == "" {
			return "user"
		}
		return tr
	}

	firstName := transliterate(parts[0])
	secondPartRunes := []rune(parts[1])
	secondInit := ""
	if len(secondPartRunes) > 0 {
		secondInit = transliterate(string(secondPartRunes[:1]))
	}

	if firstName == "" {
		firstName = "user"
	}
	if secondInit == "" {
		return firstName
	}
	return fmt.Sprintf("%s-%s", firstName, secondInit)
}

func transliterate(s string) string {
	var sb strings.Builder
	mapping := map[rune]string{
		'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e",
		'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m",
		'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u",
		'ф': "f", 'х': "kh", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "sch",
		'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
		'А': "a", 'Б': "b", 'В': "v", 'Г': "g", 'Д': "d", 'Е': "e", 'Ё': "e",
		'Ж': "zh", 'З': "z", 'И': "i", 'Й': "y", 'К': "k", 'Л': "l", 'М': "m",
		'Н': "n", 'О': "o", 'П': "p", 'Р': "r", 'С': "s", 'Т': "t", 'У': "u",
		'Ф': "f", 'Х': "kh", 'Ц': "ts", 'Ч': "ch", 'Ш': "sh", 'Щ': "sch",
		'Ъ': "", 'Ы': "y", 'Ь': "", 'Э': "e", 'Ю': "yu", 'Я': "ya",
	}
	for _, r := range s {
		if tr, ok := mapping[r]; ok {
			sb.WriteString(tr)
		} else if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
		}
	}
	return strings.ToLower(sb.String())
}

func padRightUTF8(s string, width int) string {
	cnt := utf8.RuneCountInString(s)
	if cnt >= width {
		return s
	}
	return s + strings.Repeat(" ", width-cnt)
}

func printUsersTable(rows []userRow) {
	wID := 4
	wName := utf8.RuneCountInString("Сотрудник")
	wPos := utf8.RuneCountInString("Должность")
	wLogin := utf8.RuneCountInString("Логин")
	wPass := utf8.RuneCountInString("Пароль")

	for _, r := range rows {
		if l := utf8.RuneCountInString(fmt.Sprintf("%d", r.id)); l > wID {
			wID = l
		}
		if l := utf8.RuneCountInString(r.name); l > wName {
			wName = l
		}
		if l := utf8.RuneCountInString(r.position); l > wPos {
			wPos = l
		}
		if l := utf8.RuneCountInString(r.login); l > wLogin {
			wLogin = l
		}
		if l := utf8.RuneCountInString(r.pass); l > wPass {
			wPass = l
		}
	}

	sep := fmt.Sprintf("+-%s-+-%s-+-%s-+-%s-+-%s-+",
		strings.Repeat("-", wID),
		strings.Repeat("-", wName),
		strings.Repeat("-", wPos),
		strings.Repeat("-", wLogin),
		strings.Repeat("-", wPass),
	)

	fmt.Println()
	fmt.Println("Сгенерированные учетные записи сотрудников:")
	fmt.Println(sep)
	fmt.Printf("| %s | %s | %s | %s | %s |\n",
		padRightUTF8("ID", wID),
		padRightUTF8("Сотрудник", wName),
		padRightUTF8("Должность", wPos),
		padRightUTF8("Логин", wLogin),
		padRightUTF8("Пароль", wPass),
	)
	fmt.Println(sep)
	for _, r := range rows {
		fmt.Printf("| %s | %s | %s | %s | %s |\n",
			padRightUTF8(fmt.Sprintf("%d", r.id), wID),
			padRightUTF8(r.name, wName),
			padRightUTF8(r.position, wPos),
			padRightUTF8(r.login, wLogin),
			padRightUTF8(r.pass, wPass),
		)
	}
	fmt.Println(sep)
	fmt.Println()
}
