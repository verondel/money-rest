const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(bodyParser.json());


// Исправляем типы для Request и Response
app.post("/api/client", async (req: any, res: any) => {
  // Типизация для тела запроса
  interface ClientRequestBody {
    name: string;
    surname: string;
    middle_name: string;
    birth: string;
    phone: string;
    wallet: string;
  }
  const { name, surname, middle_name, birth, phone, wallet } = req.body as ClientRequestBody;

  try {
    const newUser = await prisma.client.create({
      data: {
        name,
        surname,
        middle_name,
        birth,
        phone,
        wallet,
      },
    });

    res.status(200).json({
      message: "User added successfully!",
      data: newUser,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      message: "Failed to create user.",
      error: errorMessage,
    });
  }
});


app.get("/api/clients", async (req: any, res: any) => {
  try {
    const clients = await prisma.client.findMany();
    res.json(clients);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

app.post("/api/check-client", async (req: any, res: any) => {
  try {
    const { name, surname, middle_name } = req.body;

    // Проверяем, переданы ли все поля
    if (!name || !surname || !middle_name) {
      return res.status(400).json({ message: "Все поля ФИО должны быть заполнены." });
    }

    // Ищем клиента в базе данных
    const user = await prisma.client.findFirst({
      where: {
        name: name.trim(),
        surname: surname.trim(),
        middle_name: middle_name.trim(),
      },
    });

    console.log('your user is: ', name, surname, middle_name)
    console.log(user)

    if (!user) {
      return res.json({ exists: false });
    }

    // Получаем транзакции клиента
    const transactions = await prisma.transaction.findMany({
      where: {
        client: {
          id: user.id, // Фильтруем транзакции по ID клиента
        },
      },
      select: {
        id: true,
        date: true,
        amount: true,
        approved: true, // Добавляем статус подтверждения
        bank: {
          select: {
            name: true, // Получаем имя банка
          },
        },
      },
      orderBy: {
        date: "desc", // Сортировка по дате
      },
    });


    // Форматируем транзакции для клиента
    const formattedTransactions = transactions.map((transaction: any) => ({
      id: transaction.id,
      date: transaction.date,
      amount: transaction.amount,
      approved: transaction.approved,
      bankName: transaction.bank.name, // Извлекаем имя банка
    }));

    // Возвращаем данные клиента и его транзакции
    return res.json({
      exists: true,
      user: {
        id: user.id,
        name: user.name,
        surname: user.surname,
        middle_name: user.middle_name,
        wallet: user.wallet,
      },
      transactions: formattedTransactions, // Передаем обработанные транзакции
    });
  } catch (error) {
    console.error("Ошибка при поиске клиента:", error);
    return res.status(500).json({ message: "Ошибка на сервере. Попробуйте позже." });
  }
});


// ---- Маршрут для получения списка банков
app.get("/api/banks", async (req: any, res: any) => {
  try {
    const banks = await prisma.bank.findMany({
      select: {
        id: true,
        name: true,
      },
    });
    res.json(banks);
  } catch (error) {
    console.error("Ошибка получения списка банков:", error);
    res.status(500).json({ message: "Ошибка на сервере." });
  }
});


// ---- Маршрут для получения лимита пополнений
app.get("/api/limits", async (req: any, res: any) => {
  try {
    const limitRecord = await prisma.limit.findFirst();
    if (!limitRecord) {
      return res.status(404).json({ message: "Лимит не установлен." });
    }
    res.json({ limit: limitRecord.limit });
  } catch (error) {
    console.error("Ошибка получения лимита:", error);
    res.status(500).json({ message: "Ошибка на сервере." });
  }
});


// ---- Маршрут для получения суммы пополнений за последний месяц
app.post("/api/monthly-transactions", async (req: any, res: any) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "ID пользователя не указан." });
    }

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    console.log("ID пользователя:", userId);
    console.log("Фильтр даты:", oneMonthAgo);


    const total = await prisma.transaction.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        client: {
          id: userId, // Используем связь для фильтрации по ID клиента
        },
        date: {
          gte: oneMonthAgo, // Только транзакции за последний месяц
        },
      },
    });
    console.log('Пополнения за месяц:', total)

    res.json({ total: total._sum.amount || 0 });
  } catch (error) {
    console.error("Ошибка получения транзакций за месяц:", error);
    res.status(500).json({ message: "Ошибка на сервере." });
  }
});


// ---- Маршрут для пополнения кошелька
app.post("/api/top-up", async (req: any, res: any) => {
  const { userId, bankId, amount } = req.body;

  if (!userId || !bankId || !amount) {
    return res.status(400).json({ message: "Необходимые данные не предоставлены." });
  }

  try {
    // Получаем лимит пользователя
    const limitResponse = await prisma.limit.findFirst({});
    const limit = limitResponse?.limit || 0;

    // Рассчитываем сумму транзакций за последний месяц
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const monthlyTotalResponse = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        client: { id: userId },
        date: { gte: oneMonthAgo },
      },
    });

    const monthlyTotal = monthlyTotalResponse._sum.amount || 0;

    // Проверяем, превышает ли сумма лимит
    const newMonthlyTotal = monthlyTotal + amount;
    const approved = newMonthlyTotal <= limit;

    // Создаём транзакцию
    const newTransaction = await prisma.transaction.create({
      data: {
        client: {
          connect: { id: userId },
        },
        bank: {
          connect: { id: bankId },
        },
        date: new Date(),
        amount,
        approved, // Сохраняем статус approved
      },
    });

    res.status(201).json({
      message: "Транзакция создана.",
      transaction: newTransaction,
    });
  } catch (error) {
    console.error("Ошибка создания транзакции:", error);
    res.status(500).json({ message: "Ошибка сервера." });
  }
});


app.get("/api/all-transactions", async (req: any, res: any) => {
  try {
    const { clientName } = req.query;

    const transactions = await prisma.transaction.findMany({
      where: clientName
        ? {
          client: {
            OR: [
              { name: { contains: clientName.trim(), mode: "insensitive" } },
              { surname: { contains: clientName.trim(), mode: "insensitive" } },
            ],
          },
        }
        : {}, // Если clientName передан, фильтруем по имени и фамилии
      select: {
        id: true,
        date: true,
        amount: true,
        approved: true,
        client: {
          select: {
            name: true,
            surname: true,
          },
        },
        bank: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        date: "desc",
      },
    });
    console.log('VERA all transactions')
    return res.json(transactions);
  } catch (error) {
    console.error("Ошибка получения транзакций:", error);
    return res.status(500).json({ message: "Ошибка на сервере" });
  }
});



const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


