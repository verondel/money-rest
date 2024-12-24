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

    console.log('VERA (/api/check-client) your user is: ', name, surname, middle_name)
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

    let whereCondition = {}; // Условие для фильтрации транзакций

    // Если `clientName` передан, выполняем точную фильтрацию по ФИО
    if (clientName) {
      const [surname, name, middle_name] = clientName.trim().split(" ");

      if (!surname || !name || !middle_name) {
        return res
          .status(400)
          .json({ message: "ФИО должно включать фамилию, имя и отчество." });
      }

      whereCondition = {
        client: {
          surname: { equals: surname.trim(), mode: "insensitive" },
          name: { equals: name.trim(), mode: "insensitive" },
          middle_name: { equals: middle_name.trim(), mode: "insensitive" },
        },
      };
    }

    // Получаем транзакции с фильтрацией (если указано ФИО) или все транзакции
    const transactions = await prisma.transaction.findMany({
      where: whereCondition,
      select: {
        id: true,
        date: true,
        amount: true,
        approved: true,
        client: {
          select: {
            name: true,
            surname: true,
            middle_name: true,
            wallet: true,
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

    console.log("VERA (/api/all-transactions): Все транзакции: ----------------------------------- ", transactions);

    return res.json(transactions);
  } catch (error) {
    console.error("Ошибка получения транзакций:", error);
    return res.status(500).json({ message: "Ошибка на сервере" });
  }
});


// Маршрут для получения баланса пользователя
app.get("/api/balance", async (req: any, res: any) => {
  try {
    // Получаем userId из query-параметров
    const { userId } = req.query;
    console.log('VERA user 0: ', userId)


    // Проверяем, указан ли userId
    if (!userId) {
      return res.status(400).json({ error: "Необходимо указать userId." });
    }

    console.log('VERA user 1: ', userId)

    // Проверяем, существует ли клиент с данным userId
    const user = await prisma.client.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, name: true, surname: true },
    });

    console.log('VERA user 2: ', user)
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден." });
    }

    // Получаем все транзакции пользователя и вычисляем сумму
    const transactions = await prisma.transaction.findMany({
      where: { clientId: parseInt(userId) },
      select: { amount: true },
    });

    // Суммируем все транзакции
    const balance = transactions.reduce((total: any, transaction: any) => total + transaction.amount, 0);

    // Возвращаем баланс пользователя
    return res.status(200).json({
      userId: user.id,
      name: `${user.name} ${user.surname}`,
      balance: balance.toFixed(2), // Ограничиваем до 2-х знаков после запятой
    });
  } catch (error) {
    console.error("Ошибка получения баланса:", error);
    return res.status(500).json({ error: "Ошибка сервера. Попробуйте позже." });
  }
});


app.post("/api/withdraw", async (req: any, res: any) => {
  try {
    const { userId, bankId, amount } = req.body;

    // Проверка входных данных
    if (!userId || !bankId || typeof amount !== "number") {
      return res.status(400).json({ error: "Некорректные входные данные" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Сумма должна быть положительным числом" });
    }

    // Проверяем, существует ли пользователь
    const user = await prisma.client.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Рассчитываем текущий баланс пользователя
    const transactions = await prisma.transaction.findMany({
      where: { clientId: userId },
      select: { amount: true },
    });

    const currentBalance = transactions.reduce((sum: any, transaction: any) => sum + transaction.amount, 0);

    // Проверяем, достаточно ли средств для снятия
    if (currentBalance < amount) {
      return res.status(400).json({ error: "Недостаточно средств для снятия" });
    }

    // Создаем транзакцию со снятием
    const withdrawal = await prisma.transaction.create({
      data: {
        clientId: userId,
        bankId: bankId,
        date: new Date(),
        amount: -amount, // Отрицательное значение для снятия
        approved: true, // Одобряем операцию сразу
      },
    });

    return res.status(200).json({
      message: "Снятие выполнено успешно",
      transaction: withdrawal,
    });
  } catch (error) {
    console.error("Ошибка выполнения снятия:", error);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});


// Возвращает номер телефона клиента по id клиента  
app.get("/api/client-number", async (req: any, res: any) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({ message: "Не указан clientId" });
    }

    // Получаем данные клиента из базы
    const client = await prisma.client.findUnique({
      where: { id: parseInt(clientId) },
      select: { phone: true }, // Возвращаем только поле phone
    });

    if (!client) {
      return res.status(404).json({ message: "Клиент не найден" });
    }

    return res.json({ phone: client.phone });
  } catch (error) {
    console.error("Ошибка получения номера клиента:", error);
    return res.status(500).json({ message: "Ошибка на сервере" });
  }
});



// для получения ID клиента по ФИО
app.get("/api/client-id", async (req: any, res: any) => {
  try {
    const { name, surname, middle_name } = req.query;

    if (!name || !surname || !middle_name) {
      return res.status(400).json({ message: "Все поля (name, surname, middle_name) должны быть указаны" });
    }

    // Поиск клиента в базе данных
    const client = await prisma.client.findFirst({
      where: {
        name: name.trim(),
        surname: surname.trim(),
        middle_name: middle_name.trim(),
      },
      select: {
        id: true,
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Клиент не найден" });
    }

    return res.json({ clientId: client.id });
  } catch (error) {
    console.error("Ошибка получения ID клиента:", error);
    return res.status(500).json({ message: "Ошибка на сервере" });
  }
});


// Получения данных о приходах и расходах
app.get('/api/transactions-summary', async (req: any, res: any) => {
  try {
    const summary = await prisma.client.findMany({
      select: {
        id: true,
        name: true,
        surname: true,
        middle_name: true,
        transactions: {
          select: {
            amount: true,
          },
        },
      },
    });

    const result = summary.map((user: any) => {
      const userName = `${user.surname} ${user.name} ${user.middle_name.charAt(0)}.`;
      const income = user.transactions
        .filter((transaction: any) => transaction.amount > 0)
        .reduce((sum: any, transaction: any) => sum + transaction.amount, 0);
      const expense = user.transactions
        .filter((transaction: any) => transaction.amount < 0)
        .reduce((sum: any, transaction: any) => sum + Math.abs(transaction.amount), 0);

      return {
        userId: user.id,
        userName,
        income,
        expense,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Ошибка получения сводных данных транзакций:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


app.get('/api/balance-history', async (req: any, res: any) => {
  try {
    const { fio, startDate, endDate } = req.query;
    console.log('VERA  /api/balance-history Date Filter 2:', startDate, endDate);

    if (!fio) {
      return res.status(400).json({ error: 'ФИО пользователя обязательно для запроса' });
    }

    const [surname, name, middleName] = fio.split(' ');

    if (!surname || !name || !middleName) {
      return res.status(400).json({ error: 'Введите ФИО в формате: Фамилия Имя Отчество' });
    }

    // Найти пользователя по ФИО
    const client = await prisma.client.findFirst({
      where: {
        surname,
        name,
        middle_name: middleName,
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Пользователь с таким ФИО не найден' });
    }

    // Установить фильтры по дате
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      const parsedStartDate = new Date(startDate);
      if (isNaN(parsedStartDate.getTime())) {
        return res.status(400).json({ error: 'Некорректная дата начала' });
      }
      dateFilter.gte = parsedStartDate;
    }
    if (endDate) {
      const parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) {
        return res.status(400).json({ error: 'Некорректная дата конца' });
      }
      dateFilter.lte = parsedEndDate;
    }

    console.log('VERA  /api/balance-history Date Filter 2:', dateFilter);

    // Получить транзакции пользователя
    const transactions = await prisma.transaction.findMany({
      where: {
        clientId: client.id,
        ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }), // Применяем фильтр только при наличии дат
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Рассчитать остатки на основе транзакций
    let balance = 0;
    const balanceHistory = transactions.map((transaction: any) => {
      balance += transaction.amount;
      return {
        date: transaction.date,
        balance,
      };
    });

    res.json({ transactions: balanceHistory });
  } catch (error) {
    console.error('Ошибка получения истории баланса:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});



const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


